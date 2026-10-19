import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { planDeliveryDetails } from '../src/lib/delivery'

/**
 * Entrega fisica: despues de la venta — Work Order 02, Amendment Delivery 01
 * (decision 94), Stages 7, 8 y 12.
 *
 * Lo que sostiene:
 *  - los datos de entrega dependen de lo que eligio el comprador, no de lo que
 *    mande el navegador: transportista y guia con "entregamelo", recogida
 *    confirmada con "lo recojo", el medio de envio de una obra digital; "no hace
 *    falta entrega" no pide nada;
 *  - solo el vendedor de esa venta, y solo con la venta completada; quien es se
 *    toma de la sesion, nunca del cuerpo; y darlos suelta la retencion de la 079
 *    en la misma transaccion;
 *  - quien vende se entera de la peticion y quien compra de la respuesta, una
 *    vez; ninguno de los dos avisos lleva la direccion;
 *  - la disputa lleva la eleccion, el reconocimiento y los datos con su hora;
 *  - nada de esto va detras del interruptor: todo parte de una fila que ya
 *    existe, y un vendedor con dinero retenido siempre puede dar sus datos.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : '')
const sql = (s: string) => s.replace(/--.*$/gm, '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')

// ---- la regla
{
  const carrierMissing = planDeliveryDetails('deliver', { carrier: 'Demo' })
  ok('entregamelo pide transportista y guia', !carrierMissing.ok && carrierMissing.error === 'carrier_required')
  const carrier = planDeliveryDetails('deliver', { carrier: ' Demo Express ', tracking: ' DEMO123 ', method: 'email' })
  ok('y con los dos, el tipo lo da la eleccion', carrier.ok && carrier.kind === 'carrier' && carrier.details.carrier === 'Demo Express' && carrier.details.tracking === 'DEMO123' && !('method' in carrier.details))
  const collected = planDeliveryDetails('collect', { tracking: 'ignored' })
  ok('lo recojo es una confirmacion, sin campos', collected.ok && collected.kind === 'collected' && Object.keys(collected.details).length === 0)
  const noMethod = planDeliveryDetails('digital', { method: 'pigeon' })
  ok('una obra digital dice como se envio, de una lista', !noMethod.ok && noMethod.error === 'method_required')
  const digital = planDeliveryDetails('digital', { method: 'download_link', note: 'Demo' })
  ok('y puede anadir una nota', digital.ok && digital.kind === 'digital' && digital.details.method === 'download_link' && digital.details.note === 'Demo')
  const none = planDeliveryDetails('none', {})
  ok('no hace falta entrega no pide datos', !none.ok && none.error === 'no_details_needed')
}

// ---- la base: una transaccion que da los datos y suelta la retencion
{
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_delivery_details\.sql$/.test(f))[0]
  ok('existe la migracion de los datos de entrega', !!name)
  const m = name ? sql(read(`supabase/migrations/${name}`)) : ''
  const fn = m.slice(m.indexOf('function public.submit_delivery_details'), m.indexOf('$$;', m.indexOf('function public.submit_delivery_details')))
  ok('bloquea la fila', /from public\.sale_deliveries where transfer_id = p_transfer for update/.test(fn))
  ok('solo el vendedor de esa venta', /v_row\.seller_id is distinct from p_seller[\s\S]{0,80}raise exception 'not_seller'/.test(fn))
  ok('solo con la venta completada', /payment_status = 'completed'[\s\S]{0,200}raise exception 'sale_not_completed'/.test(fn))
  ok('el tipo sale de la eleccion, no del llamante', /when 'deliver' then 'carrier'[\s\S]{0,80}when 'collect' then 'collected'[\s\S]{0,80}when 'digital' then 'digital'/.test(fn))
  ok('no hace falta entrega no admite datos', /'none'[\s\S]{0,120}raise exception 'no_details_needed'/.test(fn))
  ok('una segunda vez no reescribe', /if v_row\.details_submitted_at is null then/.test(fn))
  ok('y suelta la retencion de la venta', /update public\.payout_earnings\s+set awaiting_delivery_details = false\s+where source = 'sale' and source_ref = p_transfer and awaiting_delivery_details/.test(fn))
  ok('no es security definer', !/security definer/.test(fn))
  ok('nadie la llama con la clave publica', /revoke all on function public\.submit_delivery_details\(uuid, uuid, jsonb\) from public, anon, authenticated;/.test(m))
  ok('solo el servidor', /grant execute on function public\.submit_delivery_details\(uuid, uuid, jsonb\) to service_role;/.test(m))
}

// ---- la ruta
{
  const r = code(readIf('src/app/api/delivery/details/route.ts'))
  ok('existe la ruta', r.length > 0)
  ok('pide sesion', /authenticate\(request\)/.test(r))
  ok('aplica la regla', /planDeliveryDetails\(/.test(r))
  ok('el vendedor es quien tiene la sesion', /p_seller: auth\.user\.id/.test(r) && !/p_seller: body\./.test(r))
  ok('lo hace en una sola llamada a la base', /admin\.rpc\('submit_delivery_details'/.test(r))
  ok('no va detras del interruptor', !/DELIVERY_LIVE/.test(r), 'un vendedor con dinero retenido siempre tiene que poder dar sus datos')
  ok('quien compra se entera, una vez', /eventKey: 'delivery_details_received',\s*dedupeKey: `\$\{body\.transferId\}:delivery_details`/.test(r))
  ok('solo la primera vez', /if \(result\?\.submitted\)/.test(r))
}

// ---- la peticion, al completar la venta
{
  const s = code(read('src/lib/complete-sale.ts'))
  ok('lee la entrega de la venta', /from\('sale_deliveries'\)\.select\('choice'\)\.eq\('transfer_id', transfer\.id\)/.test(s))
  ok('quien vende se entera de la peticion, una vez', /eventKey: 'delivery_requested',\s*dedupeKey: `\$\{transfer\.id\}:delivery_requested`/.test(s))
  ok('salvo con no hace falta entrega', /saleDelivery && saleDelivery\.choice !== 'none'/.test(s))
}

// ---- los avisos
{
  const n = code(read('src/lib/notify.ts'))
  const KEYS = ['delivery_requested', 'delivery_details_received', 'delivery_details_overdue']
  for (let i = 0; i < KEYS.length; i++) ok(`${KEYS[i]} es transaccional`, new RegExp(`\\b${KEYS[i]}: 'transactional'`).test(n))
  const LOCALES = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < LOCALES.length; i++) {
    const events = JSON.parse(read(`src/i18n/messages/${LOCALES[i]}.json`)).feed.events
    const missing = KEYS.filter((k) => typeof events[k] !== 'string')
    ok(`${LOCALES[i]}: los tres tienen su linea del feed`, missing.length === 0, missing.join(', '))
  }
  const files = [read('src/lib/complete-sale.ts'), readIf('src/app/api/delivery/details/route.ts')]
  let leaks = false
  for (let i = 0; i < files.length; i++) {
    const at = files[i].indexOf("eventKey: 'delivery_")
    if (at > -1 && /address/i.test(files[i].slice(at, at + 400))) leaks = true
  }
  ok('ningun aviso lleva la direccion', !leaks, 'la direccion se ve en la pantalla de Cobros, autenticada')
}

// ---- la pantalla del vendedor
{
  const p = code(read('src/app/history/payouts/page.tsx'))
  ok('lista las ventas que esperan datos', /from\('sale_deliveries'\)[\s\S]{0,300}\.is\('details_submitted_at', null\)/.test(p))
  ok('salvo las que no los necesitan', /\.neq\('choice', 'none'\)/.test(p))
  ok('y envia los datos a la ruta', /fetch\('\/api\/delivery\/details'/.test(p))
}

// ---- la disputa
{
  const d = code(read('src/lib/dispute-ticket.ts'))
  ok('lee la entrega de la venta', /from\('sale_deliveries'\)/.test(d))
  ok('la evidencia lleva la eleccion y los datos con su hora', /delivery: saleDelivery[\s\S]{0,300}choice:[\s\S]{0,900}details_submitted_at:/.test(d))
  ok('y el reconocimiento del comprador', /\.eq\('kind', 'buyer_delivery'\)/.test(d) && /delivery_acknowledgment:/.test(d))
  ok('y lo que el Stage 0 ya guarda', /satisfied_three_ds: /.test(d) && !/satisfied_three_ds: null/.test(d) && /terms_acceptance: /.test(d) && !/terms_acceptance: null/.test(d))
  ok('sin la lista de pendientes del Stage 0', !/pending_from_stage_0/.test(d))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
