import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * GET /api/receipts?kind=&id= — los cinco recibos (Work Order 02, Stage 9).
 *
 * Compra (quien compro), venta (quien vendio), transferencia (quien envio),
 * regalia (quien la cobra) y registro (quien registro). Los montos salen solo
 * de lo guardado (0.9c): esta ruta no recalcula ninguna tarifa; a lo sumo
 * resta dos cifras guardadas para nombrar la parte que ya contienen. Cada
 * recibo lo ve solo su parte.
 *
 * Devuelve filas con una clave de etiqueta; la pagina las traduce y las
 * formatea, y tampoco calcula nada.
 */

type Row = { label: string; value: string | number | null; format: 'money' | 'text' | 'date' | 'mono'; total?: boolean; params?: Record<string, string> }
type Receipt = { kind: string; title: string; rows: Row[] }

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const userId = auth.user.id
  const kind = request.nextUrl.searchParams.get('kind')
  const id = request.nextUrl.searchParams.get('id')
  if (!kind || !id) return NextResponse.json({ error: 'kind_and_id_required' }, { status: 400 })

  const db = createAdminClient()
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ── Compra, venta y transferencia: una fila de transferencia ──────────────
  if (kind === 'purchase' || kind === 'sale' || kind === 'transfer') {
    const { data: t } = await db
      .from('transfers')
      .select(
        'id, work_id, from_owner_id, to_owner_id, new_owner_name, sale_price, payment_amount, value_kind, completed_at, created_at, charge_path, buyer_total, processing, royalty_gross, platform_take, seller_net, payment_status, work:works(title, tbt_id)'
      )
      .eq('id', id)
      .maybeSingle()
    if (!t) return notFound()
    const work = one(t.work as { title: string | null; tbt_id: string | null } | { title: string | null; tbt_id: string | null }[] | null)
    const title = work?.title ?? ''
    const date = t.completed_at ?? t.created_at
    const { data: history } = await db.from('ownership_history').select('holder_code, holder_named, holder_public_name').eq('transfer_id', t.id).maybeSingle()
    // El otro lado, como se muestra en publico: su nombre si lo eligio, si no su codigo.
    const publicHolder = history ? (history.holder_named ? history.holder_public_name : `Private collector · ${history.holder_code}`) : null

    if (kind === 'purchase') {
      if (t.to_owner_id !== userId) return notFound()
      const { data: seller } = await db.from('profiles').select('public_alias, display_name').eq('id', t.from_owner_id).maybeSingle()
      const { data: titleRow } = await db.from('titles').select('title_number').eq('source_key', `transfer:${t.id}`).maybeSingle()
      const price = Number(t.sale_price ?? 0)
      const paid = Number(t.buyer_total ?? 0)
      const rows: Row[] = [
        { label: 'work', value: title, format: 'text' },
        { label: 'price', value: price, format: 'money' },
        { label: 'serviceFee', value: round2(paid - price), format: 'money' },
        { label: 'totalPaid', value: paid, format: 'money', total: true },
        { label: 'statement', value: t.charge_path === 'direct' ? seller?.public_alias || seller?.display_name || null : 'TBT.CAFE', format: 'text' },
        { label: 'date', value: date, format: 'date' },
        { label: 'titleNumber', value: titleRow?.title_number ?? null, format: 'mono' },
      ]
      return NextResponse.json({ kind, title, rows } satisfies Receipt)
    }

    if (kind === 'sale') {
      if (t.from_owner_id !== userId) return notFound()
      const price = Number(t.sale_price ?? 0)
      const royalty = Number(t.royalty_gross ?? 0)
      const processing = Number(t.processing ?? 0)
      const net = Number(t.seller_net ?? 0)
      const { data: commerce } = await db.from('work_commerce').select('royalty_type, royalty_value').eq('work_id', t.work_id).maybeSingle()
      const royaltyType = commerce?.royalty_type === 'fixed' ? 'fixed' : commerce?.royalty_type === 'percentage' ? `${Number(commerce.royalty_value)}%` : null
      const rows: Row[] = [
        { label: 'work', value: title, format: 'text' },
        { label: 'buyer', value: publicHolder, format: 'text' },
        { label: 'price', value: price, format: 'money' },
        { label: 'royalty', value: royalty, format: 'money', params: royaltyType ? { type: royaltyType } : undefined },
        { label: 'serviceFee', value: round2(price - royalty - processing - net), format: 'money' },
        { label: 'processing', value: processing, format: 'money' },
        { label: 'net', value: net, format: 'money', total: true },
      ]
      if (t.charge_path === 'direct') {
        rows.push({ label: 'paidToStripe', value: null, format: 'text' })
      } else {
        // La fecha ya incluye la retencion de primer cobro (064).
        const { data: earning } = await db.from('payout_earnings').select('releases_at, state').eq('source', 'sale').eq('source_ref', t.id).maybeSingle()
        if (earning?.releases_at) rows.push({ label: 'settles', value: null, format: 'text', params: { date: earning.releases_at } })
      }
      rows.push({ label: 'date', value: date, format: 'date' })
      return NextResponse.json({ kind, title, rows } satisfies Receipt)
    }

    // kind === 'transfer'
    if (t.from_owner_id !== userId) return notFound()
    const gift = t.value_kind === 'gift'
    const rows: Row[] = [
      { label: 'work', value: title, format: 'text' },
      { label: 'recipient', value: publicHolder ?? t.new_owner_name ?? null, format: 'text' },
      gift ? { label: 'gift', value: null, format: 'text' } : { label: 'declared', value: Number(t.payment_amount ?? 0), format: 'money' },
      { label: 'royalty', value: Number(t.royalty_gross ?? 0), format: 'money' },
      { label: 'transferFee', value: Number(t.platform_take ?? 0), format: 'money' },
      { label: 'processing', value: Number(t.processing ?? 0), format: 'money' },
      { label: 'totalCharged', value: Number(t.buyer_total ?? 0), format: 'money', total: true },
      { label: 'date', value: date, format: 'date' },
    ]
    return NextResponse.json({ kind, title, rows } satisfies Receipt)
  }

  // ── Regalia: una ganancia ─────────────────────────────────────────────────
  if (kind === 'royalty') {
    const columns = 'id, user_id, source, source_ref, amount, state, releases_at, created_at, work:works(title)'
    // El id es la ganancia, o la fila del historial de la que salio (la lista de regalias).
    let { data: e } = await db.from('payout_earnings').select(columns).eq('id', id).maybeSingle()
    if (!e) {
      const { data: h } = await db.from('ownership_history').select('transfer_id').eq('id', id).maybeSingle()
      if (h?.transfer_id) {
        ;({ data: e } = await db
          .from('payout_earnings')
          .select(columns)
          .eq('source', 'royalty')
          .eq('source_ref', h.transfer_id)
          .eq('user_id', userId)
          .maybeSingle())
      }
    }
    if (!e || e.user_id !== userId || e.source !== 'royalty') return notFound()
    const work = one(e.work as { title: string | null } | { title: string | null }[] | null)
    const { data: t } = e.source_ref
      ? await db.from('transfers').select('royalty_gross, royalty_amount').eq('id', e.source_ref).maybeSingle()
      : { data: null }
    const { data: change } = e.source_ref
      ? await db.from('ownership_history').select('sequence_number, created_at').eq('transfer_id', e.source_ref).maybeSingle()
      : { data: null }
    const gross = Number(t?.royalty_gross ?? t?.royalty_amount ?? e.amount)
    const earning = Number(e.amount)
    const rows: Row[] = [
      { label: 'work', value: work?.title ?? '', format: 'text' },
      { label: 'ownershipChange', value: change?.created_at ?? null, format: 'date', params: change ? { index: String(change.sequence_number) } : undefined },
      { label: 'royaltyGross', value: gross, format: 'money' },
      { label: 'royaltyFee', value: round2(gross - earning), format: 'money' },
      { label: 'earning', value: earning, format: 'money', total: true },
      e.state === 'available' || e.state === 'collected'
        ? { label: 'available', value: null, format: 'text' }
        : { label: 'settles', value: null, format: 'text', params: { date: e.releases_at ?? '' } },
    ]
    return NextResponse.json({ kind, title: work?.title ?? '', rows } satisfies Receipt)
  }

  // ── Registro: la obra ─────────────────────────────────────────────────────
  if (kind === 'registration') {
    const { data: w } = await db.from('works').select('id, title, tbt_id, creator_id, certified_at').eq('id', id).maybeSingle()
    if (!w || w.creator_id !== userId) return notFound()
    const [{ data: covered }, { data: payment }] = await Promise.all([
      db.from('covered_registrations').select('id').eq('work_id', w.id).maybeSingle(),
      db.from('tbt_payments').select('amount, status, completed_at').eq('work_id', w.id).eq('status', 'completed').maybeSingle(),
    ])
    const rows: Row[] = [
      { label: 'work', value: w.title, format: 'text' },
      covered ? { label: 'covered', value: null, format: 'text' } : { label: 'registrationFee', value: Number(payment?.amount ?? 0), format: 'money' },
      { label: 'totalPaid', value: covered ? 0 : Number(payment?.amount ?? 0), format: 'money', total: true },
      { label: 'date', value: w.certified_at ?? payment?.completed_at ?? null, format: 'date' },
      { label: 'tbtId', value: w.tbt_id, format: 'mono' },
    ]
    return NextResponse.json({ kind, title: w.title, rows } satisfies Receipt)
  }

  return NextResponse.json({ error: 'unknown_kind' }, { status: 400 })
}
