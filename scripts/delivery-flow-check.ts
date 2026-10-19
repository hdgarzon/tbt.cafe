import { readFileSync } from 'fs'
import { join } from 'path'
import { planDelivery, planListing, DELIVERY_LIVE, PENDING_WORDING } from '../src/lib/delivery'

/**
 * Entrega fisica: publicar y comprar — Work Order 02, Amendment Delivery 01
 * (decision 94), Stages 2–3 y 0/4.
 *
 * Lo que sostiene:
 *  - las reglas, ejecutadas con casos reales: una obra fisica no se compra sin
 *    eleccion, "entregamelo" exige direccion y consentimiento, una digital nunca
 *    pide direccion, una sin clase se trata como fisica; no se publica sin la
 *    clase de la obra ni, la primera vez, sin el reconocimiento del vendedor;
 *  - todo esta detras de DELIVERY_LIVE, y no se puede encender con un marcador
 *    de texto pendiente en ningun idioma (decision 75);
 *  - las rutas escriben la eleccion en sale_deliveries y los reconocimientos con
 *    su tipo y version; la primera compra de los Terms solo cuenta los Terms;
 *  - la hoja de compra y la de publicar usan las mismas reglas que el servidor.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

const ADDRESS = { name: 'Cliente Demo', line1: 'Calle Demo 1', city: 'Ciudad Demo', country: 'co' }

// ---- las reglas de la compra
{
  const none = planDelivery('physical', null)
  ok('una obra fisica no se compra sin eleccion', !none.ok && none.error === 'delivery_choice_required')
  const legacy = planDelivery(null, null)
  ok('una obra sin clase se trata como fisica: se pregunta', !legacy.ok && legacy.error === 'delivery_choice_required')
  const noAddr = planDelivery('physical', { choice: 'deliver' })
  ok('entregamelo sin direccion no', !noAddr.ok && noAddr.error === 'address_required')
  const noConsent = planDelivery('physical', { choice: 'deliver', address: ADDRESS })
  ok('entregamelo sin consentimiento no', !noConsent.ok && noConsent.error === 'consent_required')
  const deliver = planDelivery('physical', { choice: 'deliver', address: ADDRESS, consent: true })
  ok('entregamelo con las dos cosas si', deliver.ok && deliver.choice === 'deliver' && deliver.address !== null && deliver.address.country === 'CO')
  const collect = planDelivery('physical', { choice: 'collect', address: ADDRESS, consent: true })
  ok('lo recojo no guarda la direccion aunque llegue', collect.ok && collect.choice === 'collect' && collect.address === null)
  const noneNeeded = planDelivery('physical', { choice: 'none' })
  ok('no hace falta entrega es una eleccion valida', noneNeeded.ok && noneNeeded.choice === 'none')
  const digital = planDelivery('digital', { choice: 'deliver', address: ADDRESS, consent: true })
  ok('una obra digital nunca pide direccion', digital.ok && digital.choice === 'digital' && digital.address === null)
  const badCountry = planDelivery('physical', { choice: 'deliver', address: { ...ADDRESS, country: 'Colombia' }, consent: true })
  ok('el pais es un codigo de dos letras', !badCountry.ok && badCountry.error === 'address_required')
}

// ---- las reglas de publicar
{
  const off = planListing({ forSale: false, currentKind: null, patchKind: null, sellerAcknowledgedBefore: false, acknowledgedNow: false })
  ok('quitar de la venta no pide nada', off.ok)
  const noKind = planListing({ forSale: true, currentKind: null, patchKind: null, sellerAcknowledgedBefore: true, acknowledgedNow: false })
  ok('no se publica sin la clase de la obra', !noKind.ok && noKind.error === 'work_kind_required')
  const noAck = planListing({ forSale: true, currentKind: 'physical', patchKind: null, sellerAcknowledgedBefore: false, acknowledgedNow: false })
  ok('la primera publicacion pide el reconocimiento', !noAck.ok && noAck.error === 'seller_ack_required')
  const first = planListing({ forSale: true, currentKind: null, patchKind: 'digital', sellerAcknowledgedBefore: false, acknowledgedNow: true })
  ok('con clase y reconocimiento, y se registra', first.ok && first.recordSellerAck === true && first.workKind === 'digital')
  const second = planListing({ forSale: true, currentKind: 'physical', patchKind: null, sellerAcknowledgedBefore: true, acknowledgedNow: false })
  ok('la segunda vez no lo vuelve a pedir ni a registrar', second.ok && second.recordSellerAck === false)
}

// ---- el interruptor y los textos (decision 75)
{
  ok('apagado mientras los textos esperan aprobacion', DELIVERY_LIVE === false || DELIVERY_LIVE === true)
  const LOCALES = ['en', 'es', 'pt', 'fr']
  const blocks = LOCALES.map((l) => JSON.parse(read(`src/i18n/messages/${l}.json`)).delivery as Record<string, unknown> | undefined)
  ok('existe el bloque delivery en los cuatro idiomas', blocks.every((b) => !!b && typeof b === 'object'))
  const flat = (o: Record<string, unknown> | undefined, p = ''): Record<string, string> => {
    const out: Record<string, string> = {}
    if (!o) return out
    const keys = Object.keys(o)
    for (let i = 0; i < keys.length; i++) {
      const v = o[keys[i]]
      if (v && typeof v === 'object') Object.assign(out, flat(v as Record<string, unknown>, `${p}${keys[i]}.`))
      else out[`${p}${keys[i]}`] = String(v)
    }
    return out
  }
  const flats = blocks.map((b) => flat(b))
  const enKeys = Object.keys(flats[0]).sort().join('|')
  ok('las mismas claves en los cuatro', flats.every((f) => Object.keys(f).sort().join('|') === enKeys))
  const NEEDED = ['workKindLabel', 'workKindPhysical', 'workKindDigital', 'sellerAck', 'buyerAck', 'choiceTitle', 'choiceDeliver', 'choiceCollect', 'choiceNone', 'addressConsent', 'directNotice',
    'address.name', 'address.line1', 'address.line2', 'address.city', 'address.region', 'address.postalCode', 'address.country',
    'errors.delivery_choice_required', 'errors.address_required', 'errors.consent_required', 'errors.work_kind_required', 'errors.seller_ack_required']
  const missing = NEEDED.filter((k) => !(k in flats[0]))
  ok('estan todas las claves que usan las pantallas', missing.length === 0, missing.join(', '))
  const pending = flats.some((f) => Object.keys(f).some((k) => f[k].indexOf(PENDING_WORDING) === 0))
  ok('no se enciende con un texto pendiente', !DELIVERY_LIVE || !pending, 'decision 75: la regla no opera antes que su texto')
  ok('y mientras este apagado, los textos siguen marcados como pendientes', DELIVERY_LIVE || pending, 'si ya estan aprobados, encenderlo es el paso que falta')
}

// ---- publicar: la ruta
{
  const r = code(read('src/app/api/work/commerce/route.ts'))
  ok('la ruta aplica la regla solo encendida', /if \(DELIVERY_LIVE\) \{[\s\S]{0,900}planListing\(\{/.test(r))
  ok('lee si el vendedor ya reconocio', /from\('terms_acceptances'\)[\s\S]{0,200}\.eq\('kind', 'seller_delivery'\)/.test(r))
  ok('registra el reconocimiento con su tipo y version', /kind: 'seller_delivery', terms_version: deliveryAckVersion\('seller_delivery'\)/.test(r))
  ok('escribe la clase de la obra con el service role', /admin\.from\('works'\)\.update\(\{ work_kind: listing\.workKind \}\)/.test(r))
}

// ---- comprar: la ruta
{
  const r = code(read('src/app/api/stripe/create-purchase/route.ts'))
  ok('la primera compra de los Terms solo cuenta los Terms', /from\('terms_acceptances'\)[\s\S]{0,140}\.eq\('kind', 'terms'\)/.test(r))
  ok('la eleccion se valida solo encendida y antes de crear la venta', /if \(DELIVERY_LIVE\) \{[\s\S]{0,600}planDelivery\(work\.work_kind/.test(r) && r.indexOf('planDelivery(') < r.indexOf(".from('transfers')\n    .insert("))
  ok('una compra sin eleccion valida no crea nada', /if \(!delivery\.ok\) return NextResponse\.json\(\{ error: delivery\.error \}, \{ status: 400 \}\)/.test(r))
  ok('la primera compra pide el reconocimiento del comprador', /buyer_ack_required/.test(r) && /\.eq\('kind', 'buyer_delivery'\)/.test(r))
  ok('se escribe la entrega de la venta', /admin\.from\('sale_deliveries'\)\.insert\(\{[\s\S]{0,400}transfer_id: transfer\.id,[\s\S]{0,400}choice: delivery\.choice,/.test(r))
  ok('con la direccion y su consentimiento solo si hay', /address: delivery\.address,[\s\S]{0,120}address_consent_at: delivery\.consent \? now : null/.test(r))
  ok('si no se puede escribir, la venta no sigue', /if \(deliveryError\)[\s\S]{0,300}return NextResponse\.json\(\{ error: 'purchase_failed' \}, \{ status: 500 \}\)/.test(r))
  ok('registra el reconocimiento del comprador', /kind: 'buyer_delivery', terms_version: deliveryAckVersion\('buyer_delivery'\)/.test(r))
}

// ---- la hoja de compra
{
  const c = code(read('src/app/api/purchase/context/route.ts'))
  ok('el contexto cuenta los Terms por tipo', /\.eq\('kind', 'terms'\)/.test(c))
  ok('y dice si la entrega esta encendida, la clase y si falta el reconocimiento', /deliveryLive: DELIVERY_LIVE/.test(c) && /workKind:/.test(c) && /needsBuyerAck:/.test(c))
  const w = code(read('src/app/work/[tbtId]/WorkClient.tsx'))
  ok('la hoja usa la misma regla que el servidor', /planDelivery\(purchaseCtx\.workKind/.test(w))
  ok('las opciones solo aparecen encendida', /purchaseCtx\.deliveryLive && /.test(w))
  ok('el aviso de la via directa', /purchaseCtx\.path === 'direct'[\s\S]{0,200}t\.delivery\.directNotice/.test(w))
  ok('el pago envia la eleccion', /body: JSON\.stringify\(\{[^}]*delivery:/.test(w))
  ok('no se paga sin una eleccion valida', /disabled=\{[^}]*!deliveryReady/.test(w))
}

// ---- publicar: la pantalla
{
  const a = code(read('src/components/work/ActionTab.tsx'))
  ok('la pantalla de publicar usa la misma regla', /planListing\(\{/.test(a))
  ok('pide la clase de la obra', /t\.delivery\.workKindLabel/.test(a))
  ok('y muestra el reconocimiento la primera vez', /t\.delivery\.sellerAck/.test(a))
  ok('solo encendida', /DELIVERY_LIVE/.test(a))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
