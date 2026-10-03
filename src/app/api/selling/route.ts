import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { getRules } from '@/lib/rules'
import { coverageFor, ENTITY_TYPES, type EntityType, type ProviderCountry, type SellerRow } from '@/lib/seller'
import { countryFromPhone } from '@/lib/phone-country'
import { lapseOffersOfHolder } from '@/lib/offers-server'

/**
 * Settings → Selling — Work Order 02, Stage 2.
 *
 * GET crea la fila en la primera visita (`not_applied`) y devuelve el estado,
 * la cobertura del pais y el pais que sugiere el telefono. POST solicita,
 * pausa o reanuda. Aprobar, rechazar, suspender y reintegrar son de operadores
 * y pasan por la regla de dos personas (api/admin/sellers).
 *
 * Todo con el service role: la persona lee su fila por RLS, pero ninguna
 * politica le deja escribirla (059).
 */

const SELLER_COLUMNS =
  'user_id, status, suspended_at, suspended_reason, country, charge_path, entity_type, declined_reason, remembered_listings'

async function loadState(userId: string) {
  const admin = createAdminClient()
  await admin.from('seller_accounts').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })

  const [{ data: seller }, { data: countries }, { data: profile }, { data: connect }, rules] = await Promise.all([
    admin.from('seller_accounts').select(SELLER_COLUMNS).eq('user_id', userId).single(),
    admin.from('provider_countries').select('country, merchant, payout_bank, payout_usdc, enabled').eq('enabled', true).order('country'),
    admin.from('profiles').select('phone').eq('id', userId).single(),
    admin.from('payout_connect_accounts').select('status, transfers_enabled, card_payments_enabled').eq('user_id', userId).maybeSingle(),
    getRules(),
  ])

  const list = (countries ?? []) as ProviderCountry[]
  const row = seller as SellerRow
  const countryRow = list.find((c) => c.country === row?.country) ?? null
  return {
    seller: row,
    countries: list.map((c) => ({ country: c.country, covered: coverageFor(c, rules) })),
    covered: row?.country ? coverageFor(countryRow, rules) : null,
    suggestedCountry: countryFromPhone(profile?.phone ?? null),
    // El proveedor dice cuando la cuenta esta lista; la pantalla no lo supone (2.5).
    // En la via directa, lista es poder cobrar tambien: card_payments activa (0.3a).
    providerReady:
      !!connect?.transfers_enabled && (row?.charge_path === 'direct' ? !!connect?.card_payments_enabled : true),
    sellingPaused: rules.pauses.selling.on,
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  return NextResponse.json(await loadState(auth.user.id))
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const body = (await request.json().catch(() => ({}))) as {
    action?: 'apply' | 'pause' | 'resume'
    country?: string
    entityType?: string
    agree?: boolean
    restore?: string[]
  }
  const action = body.action
  const userId = auth.user.id
  const admin = createAdminClient()
  const { seller } = await loadState(userId)

  // ---- Solicitar (2.4). Solo lo que no se sabe ya: pais, tipo y acuerdo.
  if (action === 'apply') {
    if (seller.status !== 'not_applied' && seller.status !== 'declined') {
      return NextResponse.json({ error: 'already_applied' }, { status: 409 })
    }
    const country = String(body.country ?? '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(country)) return NextResponse.json({ error: 'country_required' }, { status: 400 })
    if (ENTITY_TYPES.indexOf(body.entityType as EntityType) === -1) {
      return NextResponse.json({ error: 'entity_required' }, { status: 400 })
    }
    if (body.agree !== true) return NextResponse.json({ error: 'terms_required' }, { status: 400 })

    // M8: sin un rail de cobro en el pais no se acepta la solicitud. La
    // pantalla muestra el estado «aun no disponible» con lo ganado.
    const { data: row } = await admin
      .from('provider_countries')
      .select('country, merchant, payout_bank, payout_usdc, enabled')
      .eq('country', country)
      .maybeSingle()
    if (!coverageFor(row as ProviderCountry | null, await getRules())) {
      return NextResponse.json({ error: 'not_covered', country }, { status: 409 })
    }

    const { error } = await admin
      .from('seller_accounts')
      .update({
        status: 'pending',
        country,
        entity_type: body.entityType,
        applied_at: new Date().toISOString(),
        declined_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
    if (error) return NextResponse.json({ error: 'apply_failed' }, { status: 500 })
    return NextResponse.json(await loadState(userId))
  }

  // ---- Pausar (2.7): lo que esta en venta sale, y se recuerda para volver.
  if (action === 'pause') {
    if (seller.status !== 'active') return NextResponse.json({ error: 'not_active' }, { status: 409 })

    const { data: listed } = await admin
      .from('work_commerce')
      .select('work_id, works!inner(current_owner_id)')
      .eq('availability', 'for_sale')
      .eq('works.current_owner_id', userId)
    const ids = (listed ?? []).map((r) => r.work_id as string)

    // Primero se recuerda, despues se retira: si lo segundo fallara a medias,
    // la lista para volver ya existe.
    const { error } = await admin
      .from('seller_accounts')
      .update({ status: 'paused_self', remembered_listings: ids, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (error) return NextResponse.json({ error: 'pause_failed' }, { status: 500 })
    if (ids.length) {
      await admin.from('work_commerce').update({ availability: 'not_for_sale' }).in('work_id', ids)
    }
    // Las ventas en curso se completan; las ofertas abiertas vencen con aviso a
    // ambos lados (4.9). Las regalias siguen acumulandose.
    await lapseOffersOfHolder(userId, 'seller_paused')
    return NextResponse.json(await loadState(userId))
  }

  // ---- Reanudar (2.7): la hoja de restaurar trae lo recordado, preseleccionado.
  if (action === 'resume') {
    if (seller.status !== 'paused_self') return NextResponse.json({ error: 'not_paused' }, { status: 409 })
    // Una suspension no se levanta reanudando: tiene sus propias columnas.
    if (seller.suspended_at) return NextResponse.json({ error: 'suspended' }, { status: 403 })

    const remembered = seller.remembered_listings ?? []
    const restore = (Array.isArray(body.restore) ? body.restore : []).filter((id) => remembered.indexOf(id) !== -1)

    const { error } = await admin
      .from('seller_accounts')
      .update({ status: 'active', remembered_listings: [], updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (error) return NextResponse.json({ error: 'resume_failed' }, { status: 500 })

    // Vuelven solo las que siguen siendo suyas, y no mientras las ventas esten
    // pausadas para todos.
    let restored = 0
    if (restore.length && !(await getRules()).pauses.selling.on) {
      const { data: still } = await admin.from('works').select('id').in('id', restore).eq('current_owner_id', userId)
      const ids = (still ?? []).map((w) => w.id as string)
      if (ids.length) {
        const { error: relist } = await admin.from('work_commerce').update({ availability: 'for_sale' }).in('work_id', ids)
        if (!relist) restored = ids.length
      }
    }
    return NextResponse.json({ ...(await loadState(userId)), restored })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
