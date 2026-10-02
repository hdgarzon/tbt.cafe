import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Sellar una obra certificada en las cadenas — Chain Spec 01 Item 6, Chains 01
 * Stages 1.1, 2, 4.4 y 5.
 *
 * Imagen (si se eligio) → registro de registración → mint → fila de creacion →
 * procedencia de la creacion. Lo llaman la certificacion (`complete-tbt`) y el
 * barrido de recuperacion (7.3 a y b), asi que el orden y sus reglas viven en
 * un solo sitio. Idempotente: lo ya publicado se reutiliza, nunca se republica.
 *
 * Lanza cuando no hay registro publicado: una obra sin registro no se acuña y
 * espera al barrido. Quien llama decide que hacer con eso (la ruta abre un
 * ticket de sistema; el barrido cuenta el intento).
 */
export type SealOutcome = { mintAddress: string; mintSignature: string | null; alreadyMinted: boolean }

export async function sealOnChain(admin: SupabaseClient, workId: string): Promise<SealOutcome> {
  const { mintTitleToken } = await import('@/lib/solana/token')

  const { data: workWithCreator } = await admin
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
      tbtId: workWithCreator.tbt_id as string,
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
        const { registrationRecord, signatureHash } = await import('@/lib/chain/records')
        const { creatorCodeFor } = await import('@/lib/chain/creator-code')
        const { publishRecord } = await import('@/lib/chain/arweave')
        const { cents } = await import('@/lib/fees')

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

              await admin
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
              // Chains 01 2.2: el codigo aleatorio del creador, no un seudonimo calculable.
              id: await creatorCodeFor(admin, workWithCreator.creator_id),
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
            // El valor declarado al registrar: la palabra del creador, en centavos.
            declaredValue:
              Number(workWithCreator.market_price) > 0
                ? { amount_cents: cents(Number(workWithCreator.market_price)), currency: String(workWithCreator.currency || 'USD').toUpperCase() }
                : undefined,
            signatureHash: Array.isArray(workWithCreator.signature_strokes) ? signatureHash(workWithCreator.signature_strokes) : undefined,
            recordingHash: workWithCreator.recording_hash ?? undefined,
            recordingKind: workWithCreator.recording_hash ? (workWithCreator.audio_video_type === 'video' ? 'video' : 'audio') : undefined,
            assetLinks: workWithCreator.registered_asset_links ?? workWithCreator.asset_links ?? undefined,
            sealedAt: new Date(workWithCreator.certified_at || workWithCreator.created_at),
          }) as never
        )

        await admin
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

    let mintResult: Awaited<ReturnType<typeof mintTitleToken>>
    try {
      mintResult = await mintTitleToken(workNftData, recordUri)
    } catch (error) {
      // Chains 01 7.2.3: sin saldo para un mint no se intenta, y suena la urgente.
      const low = /^payer_balance_low: (\d+)/.exec(error instanceof Error ? error.message : '')
      if (low) {
        const { raiseUrgent } = await import('./balance')
        await raiseUrgent(admin, Number(low[1]))
      }
      throw error
    }
    // Core: la direccion del activo, cuyo dueno es la tenencia de <TBT ID>-1.
    const mintAddress = mintResult.assetAddress
    const mintSignature = mintResult.signature
    
    await admin
      .from('works')
      .update({
        mint_address: mintAddress,
        // La procedencia de la creacion lleva esta firma (2.3); el barrido la lee de aqui.
        mint_signature: mintSignature,
        token_uri: recordUri,
        blockchain: 'solana',
        nft_status: 'minted'
      })
      .eq('id', workId)
    
    // Record first owner in ownership_history (creator = first owner).
    // Service-role write: ownership_history is the immutable provenance
    // chain (RLS: public read, service-role-only writes).
    // Una por obra: el barrido puede pasar por aqui despues de la ruta.
    const { data: existingFirst } = await admin
      .from('ownership_history')
      .select('id')
      .eq('work_id', workId)
      .eq('sequence_number', 1)
      .maybeSingle()
    const { data: firstOwner } = existingFirst ? { data: existingFirst } : await admin
      .from('ownership_history')
      .insert({
        work_id: workId,
        owner_name: creatorName,
        owner_user_id: workWithCreator.creator_id,
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
        const { publishProvenance } = await import('@/lib/chain/provenance-publish')
        const outcome = await publishProvenance(admin, firstOwner.id, { solanaSignature: mintSignature })
        console.log('[chain] procedencia de la creacion:', outcome)
      } catch (chainError) {
        console.error('[chain] no se pudo publicar la procedencia:', chainError)
      }
    }

    console.log('NFT minted successfully:', mintAddress)
    return { mintAddress, mintSignature, alreadyMinted: false }
  }
  if (!workWithCreator) throw new Error('seal: work not found')
  return { mintAddress: workWithCreator.mint_address as string, mintSignature: workWithCreator.mint_signature ?? null, alreadyMinted: true }
}
