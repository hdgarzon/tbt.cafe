import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { recordRoyaltyEarning } from '@/lib/payout-earnings'
import { stripe } from '@/lib/stripe'
import { processTransferOnChain } from '@/lib/solana/transfer'
import { TransferHistoryEntry } from '@/lib/solana/nft'
import { generateTransferCode } from '@/lib/transfer-code'
import { isProduction, assertServerEnv } from '@/lib/app-env'
import { authenticate } from '@/lib/route-auth'
import { createHash } from 'crypto'


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

    const requestBody = await request.json()
    const { transferId, sessionId } = requestBody

    if (!transferId) {
      return NextResponse.json({ error: 'transferId is required' }, { status: 400 })
    }

    // Bearer token (llamadas cross-origin desde tbt.cafe) o cookies (esta app)
    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
    const { supabase, user } = auth

    const { data: transfer, error: transferError } = await supabase
      .from('transfers')
      .select('*, work:works(*)')
      .eq('id', transferId)
      .single()

    if (transferError || !transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 })
    }

    // Either the seller (from_owner_id, the existing /transferir flow) or the
    // buyer (to_owner_id, a buyer-initiated purchase from /work/[tbtId]) may
    // complete a transfer. The buyer is never current_owner_id at this point
    // — that's exactly what completing the transfer changes — so the writes
    // below use service-role rather than the caller's session, otherwise the
    // buyer's RLS-filtered writes would silently affect 0 rows while this
    // route still returned success.
    const isSeller = transfer.from_owner_id === user.id
    const isBuyer = transfer.to_owner_id === user.id
    if (!isSeller && !isBuyer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check payment status with fallback to Stripe verification
    if (transfer.payment_status !== 'completed') {
      const { couponCode } = requestBody
      let paymentBypassed = false

      if (!isProduction && couponCode && couponCode.trim().toUpperCase() === 'TBT') {
        paymentBypassed = true
        console.log('Payment bypassed with dev coupon:', couponCode)

        await supabase
          .from('transfers')
          .update({
            payment_status: 'completed',
            payment_reference: 'coupon:TBT'
          })
          .eq('id', transferId)

        transfer.payment_status = 'completed'
      }

      if (!paymentBypassed) {
        const stripeSessionId = requestBody.sessionId || transfer.stripe_checkout_session_id

        let verified = false
        if (stripeSessionId) {
          try {
            console.log('Verifying payment with Stripe for session:', stripeSessionId)
            const session = await stripe.checkout.sessions.retrieve(stripeSessionId)
            if (session.payment_status === 'paid') {
              verified = true
              await supabase
                .from('transfers')
                .update({
                  payment_status: 'completed',
                  payment_reference: session.payment_intent as string,
                  stripe_checkout_session_id: stripeSessionId
                })
                .eq('id', transferId)

              transfer.payment_status = 'completed'
              console.log('Payment verified via Stripe API')
            }
          } catch (stripeError) {
            console.error('Error verifying Stripe session:', stripeError)
          }
        }

        if (!verified) {
          return NextResponse.json({
            error: `Payment not completed. Current status: ${transfer.payment_status}`
          }, { status: 400 })
        }
      }
    }

    // Check if THIS transfer already succeeded (retry/double-submit by its
    // own buyer) — must run before the ownership-drift guard below, since a
    // legitimate repeat of a transfer that already completed would otherwise
    // get rejected as "someone else bought it" instead of "you already own it".
    if (transfer.to_owner_id && transfer.work.current_owner_id === transfer.to_owner_id) {
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        tbtId: transfer.work.tbt_id,
        workTitle: transfer.work.title,
      })
    }

    // Ownership-drift guard: the seller this transfer names must still be the
    // work's current owner. Without this, two buyers racing to complete
    // purchases of the same work (public Buy button, double-click, or two
    // concurrent buyers) could each pay and each successfully call this
    // route — whoever completes LAST would silently steal ownership from
    // whoever completed first, with a corrupted ownership_history chain and
    // no refund for the loser. Runs BEFORE the transfer_status shortcut below
    // on purpose: that check is work-level, not transfer-specific, so if it
    // ran first it would tell this (superseded) buyer "already completed"
    // instead of the true "sold to someone else" — a misleading false success.
    if (transfer.from_owner_id !== transfer.work.current_owner_id) {
      return NextResponse.json({
        error: 'This work has already changed hands since this transfer was created. ' +
          'It may have been sold to someone else — no further charge was made.',
      }, { status: 409 })
    }

    // Retry of a transfer whose to_owner_id is null (owner-initiated transfer
    // to a recipient without an account, tracked by name/phone only) — the
    // ownership-drift guard above already confirmed from_owner_id still
    // matches, so reaching a 'transferred' status here means this exact
    // transfer's own prior run completed it.
    if (transfer.work.transfer_status === 'transferred' && transfer.work.transferred_at) {
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        tbtId: transfer.work.tbt_id,
        workTitle: transfer.work.title,
      })
    }

    console.log('Completing transfer:', transferId)

    // Service-role for every mutating write below: the seller-initiated path
    // happens to satisfy the works UPDATE RLS (auth.uid() = current_owner_id,
    // true for the seller until this exact update runs) but the buyer never
    // does — using the caller's session here would silently no-op for buyers.
    const serviceClient = createAdminClient()

    // Update work ownership in Supabase
    // When to_owner_id is null (owner-initiated transfer), keep current_owner_id as from_owner_id
    const { error: updateError } = await serviceClient
      .from('works')
      .update({
        current_owner_id: transfer.to_owner_id || transfer.from_owner_id,
        transfer_status: 'transferred',
        transferred_at: new Date().toISOString(),
      })
      .eq('id', transfer.work_id)

    if (updateError) {
      throw updateError
    }

    // Generate new transfer code for the new owner
    const newTransferCode = generateTransferCode()

    const { error: codeUpdateError } = await serviceClient
      .from('works')
      .update({
        // Solo el hash. El codigo en si viaja por MMS y no vuelve a existir en
        // ningun sitio nuestro: ni en la base, ni en pantalla, ni en cadena.
        transfer_code_hash: createHash('sha256').update(newTransferCode).digest('hex'),
        transfer_status: 'active',
      })
      .eq('id', transfer.work_id)

    if (codeUpdateError) {
      console.error('Error setting new transfer code:', codeUpdateError)
    }

    // Get the current sequence number for this work
    const { count: historyCount } = await supabase
      .from('ownership_history')
      .select('*', { count: 'exact', head: true })
      .eq('work_id', transfer.work_id)

    const sequenceNumber = (historyCount || 0) + 1

    // Build the new owner name from the transfer form
    const newOwnerName = transfer.new_owner_name || 'Unknown'
    const previousOwnerName = transfer.from_owner_name || 'Unknown'

    // Record in ownership_history.
    // Service-role write: ownership_history is the immutable provenance
    // chain (RLS: public read, service-role-only writes).
    await serviceClient.from('ownership_history').insert({
      work_id: transfer.work_id,
      owner_name: newOwnerName,
      owner_user_id: transfer.to_owner_id,
      event_type: 'transfer',
      previous_owner_name: previousOwnerName,
      transfer_type: transfer.transfer_type || 'sale',
      price: transfer.payment_amount || null,
      currency: transfer.payment_currency || 'USD',
      sequence_number: sequenceNumber,
    })

    /**
     * La regalía que se le debe al creador — §1.3.
     *
     * Va aquí, inmediatamente después de ownership_history: ese insert es el
     * punto en que la venta es definitiva. Antes sería apuntar dinero de algo
     * que aún podía fallar; después, dentro del bloque on-chain, se perdería
     * en las obras sin mint.
     *
     * No se escribe ganancia por el PRECIO: Stripe solo cobró la tarifa y la
     * regalía, y el precio cambió de manos fuera de la plataforma.
     */
    await recordRoyaltyEarning(
      {
        admin: serviceClient,
        workId: transfer.work_id,
        transferId: transfer.id,
        fromOwnerId: transfer.from_owner_id ?? null,
        amount: Number(transfer.sale_price ?? transfer.payment_amount ?? 0),
      },
      // /api/transfer/respond delega en esta ruta al aceptar, así que las dos
      // rutas de dinero pasan por aquí. La de dos fases ya tiene el acuerdo de
      // ambas partes: libera por evento, no por reloj.
      transfer.is_two_phase ? 'event' : 'timer'
    )

    // Update NFT metadata on-chain with the new owner and history
    let solscanUrl = ''
    let nftUpdated = false

    if (transfer.work.mint_address) {
      try {
        console.log('Updating on-chain metadata for mint:', transfer.work.mint_address)

        // Build full transfer history from Supabase
        const { data: fullHistory } = await supabase
          .from('ownership_history')
          .select('*')
          .eq('work_id', transfer.work_id)
          .order('sequence_number', { ascending: true })

        const transferHistory: TransferHistoryEntry[] = (fullHistory || []).map(entry => ({
          type: entry.event_type as 'creation' | 'transfer',
          date: new Date(entry.created_at).toISOString().split('T')[0],
          fromName: entry.previous_owner_name || undefined,
          toName: entry.owner_name,
          transferType: entry.transfer_type as 'sale' | 'gift' | undefined,
          price: entry.price ? String(entry.price) : undefined,
          currency: entry.currency || undefined,
        }))

        // Get creator info for metadata
        const { data: workWithCreator } = await supabase
          .from('works')
          .select(`
            *,
            creator:profiles!works_creator_id_fkey(display_name, public_alias),
            context:context_snapshots(location_name, weather_data, elaboration_type),
            commerce:work_commerce(initial_price, currency, royalty_type, royalty_value)
          `)
          .eq('id', transfer.work_id)
          .single()

        if (workWithCreator) {
          const creatorInfo = workWithCreator.creator as any
          const creatorName = creatorInfo?.public_alias || creatorInfo?.display_name || 'Unknown Artist'
          const ctxData = Array.isArray(workWithCreator.context) ? workWithCreator.context[0] : workWithCreator.context
          const commData = Array.isArray(workWithCreator.commerce) ? workWithCreator.commerce[0] : workWithCreator.commerce
          const weatherInfo = ctxData?.weather_data as any

          const updatedWorkData = {
            tbtId: workWithCreator.tbt_id,
            title: workWithCreator.title,
            description: workWithCreator.description,
            category: workWithCreator.category,
            technique: workWithCreator.technique,
            creatorName,
            mediaUrl: workWithCreator.media_url,
            certifiedAt: new Date(workWithCreator.certified_at || workWithCreator.created_at).toISOString().split('T')[0],
            creationLocation: ctxData?.location_name,
            creationWeather: weatherInfo?.conditions,
            elaborationType: ctxData?.elaboration_type,
            marketPrice: commData?.initial_price,
            currency: commData?.currency || 'USD',
            royaltyPercentage: commData?.royalty_type === 'percentage' ? commData?.royalty_value : undefined,
            transferHistory,
          }

          const result = await processTransferOnChain(
            transfer.work.mint_address,
            updatedWorkData
          )

          if (result.success) {
            solscanUrl = result.explorerUrl || ''
            nftUpdated = true

            if (result.newTokenUri) {
              const { error: uriError } = await serviceClient
                .from('works')
                .update({ token_uri: result.newTokenUri })
                .eq('id', transfer.work_id)
              if (uriError) console.error('Error saving new token_uri:', uriError)
            }

            console.log('NFT metadata updated successfully')
          } else {
            console.error('NFT metadata update failed:', result.error)
          }
        }
      } catch (nftError) {
        console.error('Error during NFT metadata update:', nftError)
      }
    }

    // Create certificate snapshot for new owner
    const { error: certError } = await serviceClient.from('certificates').insert({
      work_id: transfer.work_id,
      owner_id: transfer.to_owner_id,
      qr_code_data: `${process.env.NEXT_PUBLIC_APP_URL}/work/${transfer.work.tbt_id}`,
      version: 1,
    })
    if (certError) console.error('Error creating certificate:', certError)

    return NextResponse.json({
      success: true,
      tbtId: transfer.work.tbt_id,
      workTitle: transfer.work.title,
      newOwnerName,
      solscanUrl,
      nftUpdated,
      mintAddress: transfer.work.mint_address
    })

  } catch (error: any) {
    console.error('Error completing transfer:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
