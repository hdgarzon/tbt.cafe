/**
 * Works — Backend Spec 07 §2.3.
 *
 * Cada TBT y su estado real: la registración, el pasaje de contexto, el
 * resultado del escaneo, las referencias de cadena y el historial de propiedad.
 *
 * Las referencias de cadena se LEEN GUARDADAS, no se recalculan. Un explorador
 * puede caerse o cambiar de formato; lo que se selló queda en la fila.
 *
 * Lo que esta ruta NO expone, y no por olvido (§6): no hay forma de quitar el
 * registro de un TBT, revertir una transferencia en cadena, reescribir una
 * registración ni alterar una regalía congelada. Son permanentes, y un
 * certificado que el emisor puede revisar en silencio no es un certificado. Lo
 * que sí se puede es anotar y emitir un correctivo que supersede sin borrar.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, writeAudit, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'


export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'works.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  try {
    // La autorización ya se comprobó arriba. Las políticas de estas tablas están
    // escritas para el cliente final —sus propios tickets, sus propias obras— y
    // aplicadas al equipo le esconderían justo lo que tiene que ver.
    const supabase = createAdminClient()
    const url = new URL(request.url)
    const tbtId = url.searchParams.get('tbtId')
    const q = (url.searchParams.get('q') ?? '').trim()

    if (!tbtId) {
      if (!q) return NextResponse.json({ works: [] })
      const like = `%${q}%`
      const { data } = await supabase
        .from('works')
        .select('tbt_id, title, status, nft_status, mint_address, created_at')
        .or(`tbt_id.ilike.${like},title.ilike.${like}`)
        .limit(25)
      return NextResponse.json({ works: data ?? [] })
    }

    const work = await supabase
      .from('works')
      .select(
        `id, tbt_id, title, category, status, payment_status, mms_delivery_status,
         mint_address, nft_status, nft_mint_address, nft_explorer_url, nft_token_uri,
         blockchain, blockchain_hash, created_at, certified_at, creator_id, current_owner_id,
         commerce:work_commerce(availability, initial_price, currency, royalty_type, royalty_value, royalty_locked, taking_offers)`
      )
      .eq('tbt_id', tbtId)
      .single()

    if (!work.data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Las dependientes necesitan el id, que solo se conoce tras resolver el
    // TBT-ID, así que van en una segunda vuelta y en paralelo entre ellas.
    const workId = work.data.id
    const [ctx, hist, notes, cert] = await Promise.all([
      supabase
        .from('context_snapshots')
        .select('location_name, country, city, ai_summary, user_edited_summary, ai_model, signed_at')
        .eq('work_id', workId)
        .maybeSingle(),
      supabase
        .from('ownership_history')
        .select('event_type, owner_name, previous_owner_name, transfer_type, price, currency, sequence_number, created_at')
        .eq('work_id', workId)
        .order('sequence_number', { ascending: true }),
      supabase
        .from('work_annotations')
        .select('id, kind, body, supersedes, actor_name, created_at')
        .eq('work_id', workId)
        .order('created_at', { ascending: false }),
      supabase
        .from('certificates')
        .select('version, generated_at')
        .eq('work_id', workId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const c = Array.isArray(work.data.commerce) ? work.data.commerce[0] : work.data.commerce

    return NextResponse.json({
      work: {
        tbtId: work.data.tbt_id,
        title: work.data.title,
        category: work.data.category,
        status: work.data.status,
        paymentStatus: work.data.payment_status,
        mmsDelivery: work.data.mms_delivery_status,
        createdAt: work.data.created_at,
        certifiedAt: work.data.certified_at,
        // Guardadas, no calculadas.
        chain: {
          network: work.data.blockchain,
          mintAddress: work.data.mint_address ?? work.data.nft_mint_address,
          nftStatus: work.data.nft_status,
          explorerUrl: work.data.nft_explorer_url,
          tokenUri: work.data.nft_token_uri,
          hash: work.data.blockchain_hash,
          // Arweave y el ancla de Bitcoin todavía no se escriben.
          arweave: null,
          bitcoinAnchor: null,
        },
        context: ctx.data ?? null,
        commerce: c
          ? {
              availability: c.availability,
              price: c.initial_price,
              currency: c.currency,
              royaltyType: c.royalty_type,
              royaltyValue: c.royalty_value,
              // Congelada en la primera venta: se muestra para que nadie
              // intente cambiarla creyendo que se puede.
              royaltyLocked: c.royalty_locked,
              takingOffers: c.taking_offers,
            }
          : null,
        certificate: cert.data ?? null,
        ownership: hist.data ?? [],
        annotations: notes.data ?? [],
      },
      // Se dice explícitamente lo que NO se puede hacer, para que la interfaz no
      // ofrezca controles que insinúen lo contrario (§6).
      notActionable: [
        'Un-register a TBT',
        'Reverse an on-chain transfer',
        'Alter a registration record',
        'Alter a locked royalty',
      ],
    })
  } catch (error) {
    console.error('[admin/works] failed:', error)
    return NextResponse.json({ error: 'works_failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {

  try {
    const { tbtId, kind, body: text, supersedes } = (await request.json()) as {
      tbtId?: string
      kind?: 'note' | 'correction' | 'flag'
      body?: string
      supersedes?: string
    }
    if (!tbtId || !kind || !text?.trim()) {
      return NextResponse.json({ error: 'tbtId, kind and body required' }, { status: 400 })
    }

    const auth = await authenticate(request)
    if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

    const admin = await loadAdmin(auth.supabase, auth.user.id)
    if (!can(admin, 'works.annotate')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
      return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
    }

    const { data: work } = await createAdminClient()
      .from('works')
      .select('id')
      .eq('tbt_id', tbtId)
      .single()
    if (!work) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data, error } = await createAdminClient()
      .from('work_annotations')
      .insert({
        work_id: work.id,
        kind,
        body: text.trim(),
        supersedes: supersedes ?? null,
        actor_id: admin!.userId,
        actor_name: admin!.displayName,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAudit(auth.supabase, request, {
      actor: admin!,
      action: `work.${kind}`,
      entityType: 'work',
      entityId: tbtId,
      after: { annotationId: data.id, supersedes: supersedes ?? null },
    })

    return NextResponse.json({ ok: true, id: data.id })
  } catch (error) {
    console.error('[admin/works] annotate failed:', error)
    return NextResponse.json({ error: 'annotate_failed' }, { status: 500 })
  }
}
