import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { indexCertifiedImage } from '@/lib/image-index'
import { issueTitle } from '@/lib/titles/issue'
import { isProduction, assertServerEnv } from '@/lib/app-env'
import { wasDelivered } from '@/lib/notification-outcome'
import { stripe } from '@/lib/stripe'
import { resolveCoveredRegistration } from '@/lib/covered-registrations'
import { getRules, assertNotPaused } from '@/lib/rules'
import { minPriceFor } from '@/lib/fees'
import { fileSystemTicket } from '@/lib/system-tickets'
import { notify } from '@/lib/notify'
import { recordProviderEvent } from '@/lib/provider-events'
import { authenticate } from '@/lib/route-auth'

/**
 * Esta ruta certifica y mintea: inicializa Irys, consulta precio, transfiere fondos en
 * cadena, sube metadatos con 60 s de espera propia y duerme 2 s a proposito.
 * Sin limite declarado corre con el de la plataforma, que puede cambiar sin
 * avisar; y un corte a mitad deja el cobro hecho y el trabajo sin terminar.
 */
export const maxDuration = 300


export async function POST(request: NextRequest) {

  try {
    /**
     * El despliegue tiene que estar completo antes de tocar dinero.
     *
     * En el backend esto lo garantizaba un `throw` al importar `app-env`, que
     * tumbaba el build entero cuando faltaba una variable. Aqui la comprobacion
     * es explicita y vive DENTRO del try: falla esta ruta, con la lista exacta
     * de lo que falta y en la forma de error que la ruta ya devuelve, y el
     * resto del despliegue sigue en pie.
     */
    assertServerEnv()

    const { workId, couponCode, sessionId } = await request.json()
    console.log('Complete TBT request for workId:', workId)

    if (!workId) {
      return NextResponse.json({ error: 'workId is required' }, { status: 400 })
    }

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

    // Stage 11: una registracion cubierta empieza aqui y se pausa aqui. Una ya
    // pagada (con sesion) se completa siempre: pausar no deja a nadie pagado y sin registro.
    if (!sessionId) {
      const paused = await assertNotPaused('registration')
      if (paused) return NextResponse.json(paused, { status: 423 })
    }
    const { supabase, user, token } = auth
    console.log('Authenticated user:', user.id)

    // Get the work with its stored form data
    const { data: work, error: workError } = await supabase
      .from('works')
      .select('*')
      .eq('id', workId)
      .eq('creator_id', user.id)
      .single()

    console.log('Work query result:', { workId: work?.id, error: workError?.message })

    if (workError) {
      console.error('Work query error:', workError)
      return NextResponse.json({ 
        error: `Work not found: ${workError.message}`,
        details: workError 
      }, { status: 404 })
    }

    if (!work) {
      return NextResponse.json({ error: 'Work not found (null)' }, { status: 404 })
    }

    // Check if payment is completed OR if a valid free coupon is provided
    let paymentBypassed = false;
    
    // TBT coupon only valid outside production
    if (!isProduction && couponCode && couponCode.trim().toUpperCase() === 'TBT') {
       paymentBypassed = true
       console.log('Payment bypassed with dev coupon:', couponCode)
    }

    // Registraciones cubiertas (Backend Spec 01 §1.5): las primeras N de cada
    // creador las paga tbt.cafe. La elegibilidad se resuelve AQUÍ y no en el
    // cliente — si el cliente pudiera declararse cubierto, se regalarían
    // registraciones. El libro se escribe más abajo, solo si la certificación
    // sale bien: un intento abandonado o bloqueado no descuenta la asignación.
    let coveredReason: 'first_n_allowance' | 'admin_grant' | null = null
    if (!paymentBypassed && work.payment_status !== 'completed' && work.payment_status !== 'covered') {
      coveredReason = await resolveCoveredRegistration(supabase, work.creator_id)
      if (coveredReason) {
        paymentBypassed = true
        console.log('Registration covered by tbt.cafe:', coveredReason)
      }
    }

    console.log('Work payment status:', work.payment_status)

    /*
     * 'covered' cuenta como saldado.
     *
     * La guarda de idempotencia vive mas abajo, asi que un reintento sobre una
     * obra ya cubierta pasa PRIMERO por aqui. Sin esto rebotaria con "Payment
     * not completed. Current status: covered" en cuanto la asignacion quedara
     * consumida por su propia fila del libro.
     */
    const settled = work.payment_status === 'completed' || work.payment_status === 'covered'

    // If payment not yet confirmed by webhook, verify directly with Stripe
    if (!paymentBypassed && !settled) {
      const stripeSessionId = sessionId || work.payment_intent_id
      let verified = false

      if (stripeSessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(stripeSessionId)
          // Un cupon del 100% cierra la sesion sin cobro, y Stripe la marca
          // `no_payment_required`: pagada de cero sigue siendo pagada. El
          // webhook nunca miro este campo, asi que solo esta reconciliacion
          // —la que corre cuando el webhook se pierde— rechazaba las sesiones
          // sin importe.
          if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
            verified = true
            await supabase
              .from('works')
              .update({ payment_status: 'completed' })
              .eq('id', workId)
            work.payment_status = 'completed'
            console.log('Payment verified directly with Stripe')
          }
        } catch (stripeError) {
          console.error('Error verifying Stripe session:', stripeError)
        }
      }

      if (!verified) {
        return NextResponse.json({
          error: `Payment not completed. Current status: ${work.payment_status}`
        }, { status: 400 })
      }
    }

    // Check if already finalized (has tbt_id means already processed)
    if (work.tbt_id && work.status === 'certified') {
      console.log('Work already certified:', work.tbt_id)
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        tbtId: work.tbt_id,
        workTitle: work.title,
      })
    }

    const formData = work.context_data || {}
    const creatorData = formData.creatorData || {}
    const commProData = formData.commProData || {}
    const contextData = formData.contextData || {}

    console.log('Starting TBT completion process...')

    // Update profile with creator data
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        creator_type: creatorData.creatorType || 'individual',
        legal_name: creatorData.legalName || null,
        public_alias: creatorData.publicAlias || null,
        collective_name: creatorData.collectiveName || null,
        lead_representative: creatorData.leadRepresentative || null,
        entity_name: creatorData.entityName || null,
        tax_id: creatorData.taxId || null,
        corporate_title: creatorData.corporateTitle || null,
        credentials: creatorData.credentials || null,
        social_linkedin: creatorData.socialLinkedin || null,
        social_website: creatorData.socialWebsite || null,
        social_instagram: creatorData.socialInstagram || null,
        social_facebook: creatorData.socialFacebook || null,
        social_youtube: creatorData.socialYoutube || null,
        social_other: creatorData.socialOther ? [creatorData.socialOther] : null,
        bio: creatorData.aboutCreator || null,
        email: creatorData.email || null,
      })
      .eq('id', user.id)
    
    if (profileError) {
      console.warn('Profile update error:', profileError)
    }

    // Update work to certified
    
    const { error: workUpdateError } = await supabase
      .from('works')
      .update({
        status: 'certified',
        certified_at: new Date().toISOString(),
        /*
         * Una registracion cubierta queda saldada, y se dice.
         *
         * Sin esto la obra quedaba `certified` con `payment_status: 'pending'`,
         * que en el panel de admin se lee como impagada. El libro de
         * `covered_registrations` guarda el motivo y el importe; esta columna
         * solo evita que la misma fila se contradiga a si misma.
         *
         * Solo se toca cuando de verdad hubo cubierta: un pago normal ya lo
         * dejo en 'completed' y no hay que pisarlo.
         */
        ...(coveredReason ? { payment_status: 'covered' } : {}),
        transfer_status: 'active',
        context_summary: contextData.userEditedSummary || contextData.aiSummary || null,
        context_signed_at: contextData.isSigned ? new Date().toISOString() : null,
        originality_type: commProData.originalityDeclaration || 'original',
        original_work_reference: commProData.derivativeReference || null,
        signature_phone: contextData.signaturePhone || null,
      })
      .eq('id', workId)

    if (workUpdateError) {
      console.error('Work update error:', workUpdateError)
      return NextResponse.json({ error: 'Failed to update work status' }, { status: 500 })
    }

    console.log('Work updated to certified')

    // El escaneo de la fase Proteccion se guardo sin obra (052). Se enlaza
    // aqui, y solo si es del mismo creador y no pertenece ya a otra obra: el
    // id lo escribio el navegador en el borrador y no se le cree por si solo.
    // Idempotente — un segundo paso no encuentra fila con work_id nulo.
    if (work.plagiarism_scan_id) {
      const { data: linked, error: scanLinkError } = await createAdminClient()
        .from('plagiarism_scans')
        .update({ work_id: workId })
        .eq('id', work.plagiarism_scan_id)
        .eq('user_id', user.id)
        .is('work_id', null)
        .select('id')
      if (scanLinkError || !linked?.length) {
        await recordProviderEvent({ provider: 'image_processor', operation: 'link_scan', ok: false, entityType: 'work', entityId: workId, error: { code: scanLinkError?.code ?? 'not_linked', detail: scanLinkError?.message ?? null } })
      }
    }

    // La fila de comercio de la obra. Con el service role: el navegador ya no
    // escribe work_commerce (060). El techo y el piso de configuracion se
    // aplican aqui igual que en /api/work/commerce (Work Order 02, 3.4, 3.5).
    const commerceRules = await getRules()
    const registeredType = commProData.royaltyType === 'none' ? null : commProData.royaltyType
    const registeredValue = registeredType
      ? Math.min(parseFloat(commProData.royaltyValue || '0') || 0, registeredType === 'percentage' ? commerceRules.royalty.pctCeiling : Infinity)
      : 0
    const askedPrice = commProData.marketPrice ? parseFloat(commProData.marketPrice) || 0 : 0
    // Un precio de 0 es «sin precio»: no se sube; uno puesto por debajo del piso, si.
    const registeredPrice = registeredType === 'fixed' && askedPrice > 0
      ? Math.max(askedPrice, minPriceFor({ type: 'fixed', value: registeredValue }, commerceRules))
      : askedPrice
    const { error: commerceError } = await createAdminClient()
      .from('work_commerce')
      .upsert({
        work_id: workId,
        initial_price: registeredPrice,
        currency: commProData.currency || 'USD',
        royalty_type: registeredType,
        royalty_value: registeredValue,
        is_for_sale: true,
      }, { onConflict: 'work_id' })

    if (commerceError) {
      console.warn('Commerce insert error:', commerceError)
    }

    // Create context_snapshot record
    const { error: contextError } = await supabase
      .from('context_snapshots')
      .insert({
        work_id: workId,
        location_name: contextData.location || null,
        gps_coordinates: contextData.coordinates || null,
        weather_data: contextData.weather ? { conditions: contextData.weather } : null,
        top_headlines: contextData.headlines || null,
        ai_summary: contextData.aiSummary || null,
        user_edited_summary: contextData.userEditedSummary || null,
        signed_at: contextData.isSigned ? new Date().toISOString() : null,
      })

    if (contextError) {
      console.warn('Context snapshot insert error:', contextError)
    }

    // Get updated work to retrieve tbt_id
    const { data: updatedWork } = await supabase
      .from('works')
      .select('tbt_id')
      .eq('id', workId)
      .single()

    /*
     * La firma del creador se congela en la obra al certificar (Title Spec 02
     * §5 c): nunca cambia para esta obra aunque el creador redibuje la suya.
     * Solo si la obra todavía no tiene una — un segundo paso por aquí no la pisa.
     */
    const { data: signer } = await createAdminClient()
      .from('profiles')
      .select('signature_strokes')
      .eq('id', user.id)
      .single()
    if (signer?.signature_strokes) {
      await createAdminClient()
        .from('works')
        .update({ signature_strokes: signer.signature_strokes })
        .eq('id', workId)
        .is('signature_strokes', null)
    }

    /*
     * Emitir el título (Work Order 01 Stage 5). Lo emite el servidor: la 055
     * cerró la inserción desde el cliente. El render tarda unos segundos en Fly,
     * así que va en `after()` — el creador no lo espera y el despliegue sí. Una
     * clave por hecho hace que un reintento de esta ruta no emita dos títulos.
     */
    after(() =>
      issueTitle(createAdminClient(), {
        workId,
        holderId: user.id,
        event: 'REGISTERED',
        eventDate: new Date(),
        sourceKey: `registration:${workId}`,
      }).then((outcome) => console.log('[title] registro:', outcome))
    )

    console.log('TBT certified with ID:', updatedWork?.tbt_id)

    // Mint NFT on Solana — single-wallet model (project wallet owns all NFTs)
    let mintAddress = ''
    let mintSignature = ''
    let solscanUrl = ''
    
    try {
      const { mintTitleToken } = await import('@/lib/solana/token')
      const { getExplorerUrl } = await import('@/lib/solana/config')
      
      const { data: workWithCreator } = await supabase
        .from('works')
        .select(`
          *,
          creator:profiles!works_creator_id_fkey(display_name, public_alias, creator_type),
          context:context_snapshots(location_name)
        `)
        .eq('id', workId)
        .single()
      
      if (workWithCreator && !workWithCreator.mint_address) {
        const creatorInfo = workWithCreator.creator as any
        const creatorName = creatorInfo?.public_alias || creatorInfo?.display_name || 'Unknown Artist'
        
        const ctxData = Array.isArray(workWithCreator.context) ? workWithCreator.context[0] : workWithCreator.context
        
        // Solo el TBT ID: el mint ya no publica nada propio (Chains 01, 1.1).
        const workNftData = {
          tbtId: workWithCreator.tbt_id || updatedWork?.tbt_id,
        }
        
        /*
         * ── Item 6, paso 3: el registro sube ANTES del mint ──────────────
         *
         * La URI que se escribe en cadena tiene que apuntar a algo que ya
         * exista, asi que este orden no es preferencia.
         *
         * Y se GUARDA antes de mintear. El spec avisa de que si el mint falla
         * despues de la subida el registro queda sin referencia —recuperable—
         * pero que jamas hay que reintentar la subida: dos registros de
         * registracion para un TBT sin enlace `supersedes` entre ellos es la
         * unica forma que este modelo no sabe expresar. Guardarla es lo que
         * permite reintentar el MINT contra ella.
         *
         * Una obra sin registro publicado NO se acuna (Chains 01, 1.1): el
         * camino que subia metadata propia publicaba precio, lugar y nombres
         * sin pasar por assertNoIdentifiers. Espera al barrido de
         * recuperacion (Stage 7), con su ticket de sistema.
         */
        let recordUri: string | undefined = workWithCreator.registration_record_uri ?? undefined

        if (!recordUri && workWithCreator.content_hash) {
          try {
            const { registrationRecord } = await import('@/lib/chain/records')
            const { pseudonymFor } = await import('@/lib/chain/pseudonym')
            const { publishRecord } = await import('@/lib/chain/arweave')

            /*
             * ── Item 10: la imagen sube ANTES del registro ────────────────
             *
             * Por lo mismo que el registro sube antes del mint: el registro la
             * NOMBRA, y nombrar algo que todavia no existe deja una direccion
             * permanente hacia un 404.
             *
             * Solo se publica lo que el creador eligio en el Sello. La columna
             * viene por defecto en 'none', asi que una ruta que se olvide del
             * campo no publica nada — y las 58 obras anteriores a esta decision
             * tampoco.
             *
             * Su fallo NO tumba el registro: lleva su propio catch y la obra se
             * certifica igual, con el hash del contenido, que es lo que hace
             * verificable al certificado. La imagen es legibilidad, no prueba.
             *
             * Y si el registro sale sin ella, ya no se le anade: queda sellado,
             * y sumarle algo despues seria una enmienda (Item 5), no un
             * reintento. Es el precio correcto — el registro no cambia.
             */
            let image: { uri: string; hash: string; kind: 'thumbnail' | 'full' | 'reduced' } | undefined
            const choice = workWithCreator.chain_image as string | null
            // Chains 01, 5.4: `full` cuya fuente no es el original es la copia bajo el techo.
            const kind =
              choice === 'full' && workWithCreator.chain_image_url && workWithCreator.chain_image_url !== workWithCreator.media_url ? 'reduced' : choice

            if (kind === 'thumbnail' || kind === 'full' || kind === 'reduced') {
              if (workWithCreator.chain_image_uri && workWithCreator.chain_image_hash) {
                // Ya subida en un intento anterior. Se reutiliza, nunca se
                // republica: dos copias de la misma obra en un almacen
                // permanente no son un estado que este modelo sepa expresar.
                image = {
                  uri: workWithCreator.chain_image_uri,
                  hash: workWithCreator.chain_image_hash,
                  kind,
                }
              } else if (workWithCreator.chain_image_url) {
                try {
                  const { publishWorkImage } = await import('@/lib/chain/publish-image')
                  const pub = await publishWorkImage({
                    sourceUrl: workWithCreator.chain_image_url,
                    kind,
                    tbtId: workNftData.tbtId,
                  })

                  await createAdminClient()
                    .from('works')
                    .update({ chain_image_uri: pub.uri, chain_image_hash: pub.hash })
                    .eq('id', workId)

                  image = { uri: pub.uri, hash: pub.hash, kind }
                  console.log(`Work image published (${choice}): ${pub.uri}`)
                } catch (imageError) {
                  console.error('[chain] no se pudo publicar la imagen:', imageError)
                }
              }
            }

            const published = await publishRecord(
              registrationRecord({
                tbtId: workNftData.tbtId,
                sequence: 1,
                contentHash: workWithCreator.content_hash,
                creator: {
                  name: creatorName,
                  id: pseudonymFor(workWithCreator.creator_id),
                  type: (creatorInfo?.creator_type ?? 'individual') as 'individual' | 'group' | 'corporation',
                },
                work: {
                  title: workWithCreator.title,
                  year: new Date(workWithCreator.creation_date || workWithCreator.created_at).getUTCFullYear(),
                  category: workWithCreator.category ?? undefined,
                  technique: workWithCreator.technique ?? undefined,
                  originality: (workWithCreator.originality_type ?? 'original') as 'original' | 'derivative' | 'authorized_edition',
                },
                context: {
                  statement: workWithCreator.context_summary ?? undefined,
                  city: ctxData?.location_name ?? undefined,
                },
                ...(image ? { image } : {}),
                sealedAt: new Date(workWithCreator.certified_at || workWithCreator.created_at),
              }) as never
            )

            await createAdminClient()
              .from('works')
              .update({
                registration_record_uri: published.uri,
                registration_record_hash: published.hash,
              })
              .eq('id', workId)

            recordUri = published.uri
            console.log(`Registration record published: ${published.uri}`)
          } catch (chainError) {
            // La cadena no puede tumbar una certificacion que ya se cobro.
            console.error('[chain] no se pudo publicar el registro:', chainError)
          }
        }

        if (!recordUri) throw new Error('No registration record published; the title token waits for the recovery sweep.')

        const mintResult = await mintTitleToken(workNftData, recordUri)
        // Core: la direccion del activo, cuyo dueno es la tenencia de <TBT ID>-1.
        mintAddress = mintResult.assetAddress
        mintSignature = mintResult.signature
        solscanUrl = getExplorerUrl(mintAddress)
        
        await supabase
          .from('works')
          .update({
            mint_address: mintAddress,
            token_uri: recordUri,
            blockchain: 'solana',
            nft_status: 'minted'
          })
          .eq('id', workId)
        
        // Record first owner in ownership_history (creator = first owner).
        // Service-role write: ownership_history is the immutable provenance
        // chain (RLS: public read, service-role-only writes).
        const { data: firstOwner } = await createAdminClient()
          .from('ownership_history')
          .insert({
            work_id: workId,
            owner_name: creatorName,
            owner_user_id: user.id,
            event_type: 'creation',
            sequence_number: 1,
            // El creador es el primer titular y va nombrado: su autoria ya es
            // publica (Chains 01 3.3). El codigo lo emite la base (062).
            holder_named: true,
            holder_public_name: creatorName,
          })
          .select('id')
          .single()

        /*
         * ── Item 6, paso 5: procedencia, secuencia 1 ────────────────────
         *
         * `event: creation` y sin `prior_record`: es el origen de la cadena, y
         * `provenanceRecord` rechaza que la secuencia 1 lleve uno.
         *
         * Va DESPUES del mint porque lleva dentro la firma de Solana, que
         * antes no existe. Si falla, la obra queda minteada y con su registro
         * de registracion; le faltara el primer eslabon de procedencia, que se
         * puede publicar despues contra los mismos datos.
         */
        if (recordUri && firstOwner?.id) {
          try {
            const { provenanceRecord } = await import('@/lib/chain/records')
            const { pseudonymFor } = await import('@/lib/chain/pseudonym')
            const { publishRecord } = await import('@/lib/chain/arweave')

            const published = await publishRecord(
              provenanceRecord({
                tbtId: workNftData.tbtId,
                sequence: 1,
                event: 'creation',
                to: { name: creatorName, id: pseudonymFor(workWithCreator.creator_id) },
                occurredAt: new Date(workWithCreator.certified_at || workWithCreator.created_at),
                solanaSignature: mintSignature,
                registrationRecord: recordUri,
              }) as never
            )

            await createAdminClient()
              .from('ownership_history')
              .update({ record_uri: published.uri, record_hash: published.hash })
              .eq('id', firstOwner.id)

            console.log(`Provenance record published: ${published.uri}`)
          } catch (chainError) {
            console.error('[chain] no se pudo publicar la procedencia:', chainError)
          }
        }

        console.log('NFT minted successfully:', mintAddress)
      } else if (workWithCreator?.mint_address) {
        mintAddress = workWithCreator.mint_address
        solscanUrl = getExplorerUrl(mintAddress)
        console.log('NFT already minted:', mintAddress)
      }
    } catch (mintError: any) {
      console.warn('Error minting NFT:', mintError?.message || mintError)
      void recordProviderEvent({
        provider: 'solana',
        operation: 'mint_nft',
        ok: false,
        error: mintError,
        entityType: 'work',
        entityId: workId,
      })
      // La obra y el certificado están a salvo; lo que no confirmó es el
      // asiento en cadena. Severidad secundaria: se puede arreglar sin que el
      // creador haga nada, pero deja de perderse en un log (Spec 03 §1.2).
      await fileSystemTicket(supabase, {
        userId: user.id,
        eventCode: 'solana_registration_failed',
        entityType: 'registration',
        entityId: workId,
        errorDetail: { message: mintError?.message ?? String(mintError) },
      })
    }

    // Contacto de quien registra. Columnas privadas: el cliente del usuario ya
    // no las lee (053); el servidor sí, y la fila es la de quien autenticó.
    const { data: profile } = await createAdminClient()
      .from('profiles')
      .select('email, phone')
      .eq('id', user.id)
      .single()

    const userPhone = contextData.signaturePhone || profile?.phone || ''
    const userEmail = creatorData.email || profile?.email || ''

    let smsSent = false
    let emailSent = false

    // Send SMS/MMS notification
    if (userPhone) {
      try {
        const smsResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-sms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // El token de quien llamó, reenviado. getSession() aquí es null
            // cuando la petición vino cross-origin con el token en la cabecera.
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            phoneNumber: userPhone,
            workId: workId,
            userId: user.id,
          }),
        })
        // El código de Twilio agrupa mucho mejor que el HTTP: 21211 y 21606 son
        // problemas distintos y un http_502 los mezclaría en un solo grupo.
        const smsBody = await smsResponse.clone().json().catch(() => null)
        smsSent = wasDelivered(smsResponse, smsBody)
        void recordProviderEvent({
          provider: 'twilio',
          operation: 'send_mms',
          ok: smsSent,
          error: smsSent
            ? undefined
            : smsBody?.simulated
              ? { code: 'simulated' }
              : {
                // El cuerpo ENTERO: `detailFor` lo guarda tal cual en jsonb, y
                // ahi es donde viven las dos causas que el log tuvo que
                // revelar la primera vez.
                ...smsBody,
                code: smsBody?.twilioErrorCode
                  ? String(smsBody.twilioErrorCode)
                  : (smsBody?.failureCode ?? undefined),
                status: smsResponse.status,
              },
          entityType: 'work',
          entityId: workId,
        })
        if (!smsSent) {
          await fileSystemTicket(supabase, {
            userId: user.id,
            eventCode: 'mms_delivery_failed',
            entityType: 'registration',
            entityId: workId,
            errorDetail: { status: smsResponse.status, body: await smsResponse.text().catch(() => null) },
          })
        }
      } catch (smsError) {
        console.warn('Error sending SMS:', smsError)
        void recordProviderEvent({
          provider: 'twilio',
          operation: 'send_mms',
          ok: false,
          error: smsError,
          entityType: 'work',
          entityId: workId,
        })
        // Severidad financiera aunque no mueva dinero: el certificado y la
        // llave son el producto y solo se entregan por MMS. Si no llegan, el
        // creador pagó y no recibió nada (Spec 03 §1.2).
        await fileSystemTicket(supabase, {
          userId: user.id,
          eventCode: 'mms_delivery_failed',
          entityType: 'registration',
          entityId: workId,
          errorDetail: { message: smsError instanceof Error ? smsError.message : String(smsError) },
        })
      }
    }

    // Send email notification
    if (userEmail) {
      try {

        const emailResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: userEmail,
            workId: workId,
            userId: user.id,
            mintAddress,
            solscanUrl,
          }),
        })
        const emailBody = await emailResponse.clone().json().catch(() => null)
        emailSent = wasDelivered(emailResponse, emailBody)
        void recordProviderEvent({
          provider: 'resend',
          operation: 'send_certification',
          ok: emailSent,
          error: emailSent
            ? undefined
            : emailBody?.simulated
              ? { code: 'simulated' }
              : { status: emailResponse.status },
          entityType: 'work',
          entityId: workId,
        })
      } catch (emailError) {
        console.warn('Error sending email:', emailError)
        void recordProviderEvent({
          provider: 'resend',
          operation: 'send_certification',
          ok: false,
          error: emailError,
          entityType: 'work',
          entityId: workId,
        })
      }
    }

    // El costo absorbido se registra como una transacción que ocurrió y que
    // tbt.cafe asumió — nunca como un cobro ausente. El índice único sobre
    // work_id evita que una obra consuma la asignación dos veces.
    if (coveredReason) {
      // `covered_registrations` no tiene política de inserción para el cliente
      // a propósito: si la tuviera, cualquiera podría regalarse registraciones.
      const { error: ledgerError } = await createAdminClient().from('covered_registrations').insert({
        creator_id: work.creator_id,
        work_id: workId,
        // Lo que se habria cobrado, de configuracion (Work Order 02, 1.2).
        amount: (await getRules()).fees.registration,
        reason: coveredReason,
      })
      if (ledgerError) console.error('Covered registration ledger write failed:', ledgerError)
    }

    await notify(supabase, {
      userId: user.id,
      eventKey: 'registrations',
      dedupeKey: workId,
      data: { title: work.title, tbtId: updatedWork?.tbt_id ?? '' },
      href: updatedWork?.tbt_id ? `/work/${updatedWork.tbt_id}` : undefined,
    })

    console.log('TBT completion finished successfully')

    /*
     * La imagen entra al índice de originalidad DESPUÉS de responder, en
     * `after()`: el creador no espera a que el procesador calcule el embedding,
     * y el despliegue sí espera a que termine. Antes era un `fetch` suelto que
     * serverless podía cortar y cuyo fallo solo quedaba en un log. Ahora cada
     * desenlace queda registrado y un fallo abre un ticket (N10 b).
     */
    if (work.media_url) {
      const mediaUrl: string = work.media_url
      after(() => indexCertifiedImage({ workId: work.id, creatorId: work.creator_id, mediaUrl }))
    }

    return NextResponse.json({
      success: true,
      tbtId: updatedWork?.tbt_id || workId,
      workTitle: work.title,
      phoneNumber: userPhone,
      email: userEmail,
      smsSent,
      emailSent,
      solscanUrl,
      mintAddress,
    })

  } catch (error: any) {
    console.error('Error completing TBT:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to complete TBT' },
      { status: 500 }
    )
  }
}
