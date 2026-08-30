import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { generateTransferCode } from '@/lib/transfer-code'
import { isProduction, assertServerEnv } from '@/lib/app-env'
import { wasDelivered } from '@/lib/notification-outcome'
import { stripe } from '@/lib/stripe'
import { resolveCoveredRegistration, REGISTRATION_FEE } from '@/lib/covered-registrations'
import { fileSystemTicket } from '@/lib/system-tickets'
import { notify } from '@/lib/notify'
import { recordProviderEvent } from '@/lib/provider-events'
import { authenticate } from '@/lib/route-auth'
import { createHash } from 'crypto'

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

    // Generate transfer code and update work to certified
    const transferCode = generateTransferCode()
    
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
        // Solo el hash. El codigo en si viaja por MMS y no vuelve a existir en
        // ningun sitio nuestro: ni en la base, ni en pantalla, ni en cadena.
        transfer_code_hash: createHash('sha256').update(transferCode).digest('hex'),
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

    // Create work_commerce record
    const { error: commerceError } = await supabase
      .from('work_commerce')
      .upsert({
        work_id: workId,
        initial_price: commProData.marketPrice ? parseFloat(commProData.marketPrice) : 0,
        currency: commProData.currency || 'USD',
        royalty_type: commProData.royaltyType === 'none' ? null : commProData.royaltyType,
        royalty_value: commProData.royaltyType !== 'none' ? parseFloat(commProData.royaltyValue || '0') : 0,
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

    // Create certificate record
    const { error: certError } = await supabase
      .from('certificates')
      .insert({
        work_id: workId,
        owner_id: user.id,
        qr_code_data: `${process.env.NEXT_PUBLIC_APP_URL}/work/${updatedWork?.tbt_id || workId}`,
        version: 1,
      })

    if (certError) {
      console.warn('Certificate insert error:', certError)
    }

    console.log('TBT certified with ID:', updatedWork?.tbt_id)

    // Mint NFT on Solana — single-wallet model (project wallet owns all NFTs)
    let mintAddress = ''
    let solscanUrl = ''
    
    try {
      const { mintTBTNft } = await import('@/lib/solana/nft')
      const { getExplorerUrl } = await import('@/lib/solana/config')
      
      const { data: workWithCreator } = await supabase
        .from('works')
        .select(`
          *,
          creator:profiles!works_creator_id_fkey(display_name, public_alias, creator_type),
          context:context_snapshots(location_name, weather_data, elaboration_type),
          commerce:work_commerce(initial_price, currency, royalty_type, royalty_value)
        `)
        .eq('id', workId)
        .single()
      
      if (workWithCreator && !workWithCreator.mint_address) {
        const creatorInfo = workWithCreator.creator as any
        const creatorName = creatorInfo?.public_alias || creatorInfo?.display_name || 'Unknown Artist'
        
        const ctxData = Array.isArray(workWithCreator.context) ? workWithCreator.context[0] : workWithCreator.context
        const commData = Array.isArray(workWithCreator.commerce) ? workWithCreator.commerce[0] : workWithCreator.commerce
        const weatherInfo = ctxData?.weather_data as any
        
        const certDate = new Date(workWithCreator.certified_at || workWithCreator.created_at).toISOString().split('T')[0]
        
        const workNftData = {
          tbtId: workWithCreator.tbt_id || updatedWork?.tbt_id,
          title: workWithCreator.title,
          description: workWithCreator.description,
          category: workWithCreator.category,
          technique: workWithCreator.technique,
          creatorName,
          mediaUrl: workWithCreator.media_url,
          certifiedAt: certDate,
          creationLocation: ctxData?.location_name,
          creationWeather: weatherInfo?.conditions,
          elaborationType: ctxData?.elaboration_type,
          marketPrice: commData?.initial_price,
          currency: commData?.currency || 'USD',
          royaltyPercentage: commData?.royalty_type === 'percentage' ? commData?.royalty_value : undefined,
          transferHistory: [{
            type: 'creation' as const,
            date: certDate,
            toName: creatorName,
          }]
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
         * Una obra sin `content_hash` no puede tener registro —
         * `registrationRecord` lo exige— y son 46 de las 47 certificadas antes
         * de que el hash existiera. Esas se mintean como siempre en vez de
         * quedarse sin mintear: la cadena SUMA, no condiciona.
         */
        let recordUri: string | undefined = workWithCreator.registration_record_uri ?? undefined

        if (!recordUri && workWithCreator.content_hash) {
          try {
            const { registrationRecord } = await import('@/lib/chain/records')
            const { publishRecord } = await import('@/lib/chain/arweave')

            const published = await publishRecord(
              registrationRecord({
                tbtId: workNftData.tbtId,
                sequence: 1,
                contentHash: workWithCreator.content_hash,
                creator: {
                  name: creatorName,
                  id: workWithCreator.creator_id,
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

        console.log('Minting NFT for TBT:', workNftData.tbtId)

        const mintResult = await mintTBTNft(workNftData, recordUri)
        mintAddress = mintResult.mintAddress
        solscanUrl = getExplorerUrl(mintAddress)
        
        await supabase
          .from('works')
          .update({
            mint_address: mintAddress,
            token_uri: mintResult.tokenUri,
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
            const { publishRecord } = await import('@/lib/chain/arweave')

            const published = await publishRecord(
              provenanceRecord({
                tbtId: workNftData.tbtId,
                sequence: 1,
                event: 'creation',
                to: { name: creatorName, id: workWithCreator.creator_id },
                occurredAt: new Date(workWithCreator.certified_at || workWithCreator.created_at),
                solanaSignature: mintAddress,
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

    // Get user contact info
    const { data: profile } = await supabase
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
        amount: REGISTRATION_FEE,
        reason: coveredReason,
      })
      if (ledgerError) console.error('Covered registration ledger write failed:', ledgerError)
    }

    await notify(supabase, {
      userId: user.id,
      eventKey: 'registrations',
      data: { title: work.title, tbtId: updatedWork?.tbt_id ?? '' },
      href: updatedWork?.tbt_id ? `/work/${updatedWork.tbt_id}` : undefined,
    })

    console.log('TBT completion finished successfully')

    // Register image in vector DB for future plagiarism checks (non-blocking)
    if (work.media_url) {
      try {
        const imageRes = await fetch(work.media_url)
        if (imageRes.ok) {
          const blob = await imageRes.blob()
          const imageForm = new FormData()
          const fileName = work.media_url.split('/').pop() || 'image.jpg'
          imageForm.append('file', blob, fileName)
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
          fetch(`${appUrl}/api/tbt-image/register`, {
            method: 'POST',
            // El token de quien llamo, como en las otras dos llamadas internas
            // de esta ruta. Sin el, register es un endpoint abierto que
            // cualquiera puede usar para envenenar el indice de similitud.
            headers: { Authorization: `Bearer ${token}` },
            body: imageForm,
          }).catch((err) => console.warn('[tbt-image/register] background error:', err))
        }
      } catch (err) {
        console.warn('[tbt-image/register] Could not fetch media_url:', err)
      }
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
