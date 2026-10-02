import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describeDisputeEvent, type StripeEventLike } from '../src/lib/disputes'

/** Un contracargo deja rastro. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const dispute = (over: Record<string, unknown> = {}): StripeEventLike => ({
  type: 'charge.dispute.created',
  data: {
    object: {
      id: 'dp_1AbC',
      charge: 'ch_9XyZ',
      payment_intent: 'pi_7Qrs',
      amount: 800,
      currency: 'usd',
      status: 'needs_response',
      reason: 'fraudulent',
      ...over,
    },
  },
})
// El punto y coma no sobra: sin el, el bloque de abajo se lee como el cuerpo
// de una flecha y `({ ... })` pasa a ser una lista de parametros.
;

// ---- una disputa
{
  const d = describeDisputeEvent(dispute())
  ok('la reconoce como disputa', d?.kind === 'dispute')
  ok('la referencia es el id de la disputa', d?.providerRef === 'dp_1AbC')
  ok('guarda el cargo', d?.chargeId === 'ch_9XyZ')
  ok('guarda el intent', d?.paymentIntentId === 'pi_7Qrs')
  ok('centavos a dólares', d?.amount === 8)
  ok('conserva el motivo', d?.reason === 'fraudulent')
  ok('conserva el estado', d?.status === 'needs_response')
}

// ---- el cierre actualiza la misma fila
{
  const closed = describeDisputeEvent({
    type: 'charge.dispute.closed',
    data: { object: { ...(dispute().data.object as object), status: 'lost' } },
  })
  ok('el cierre usa la misma referencia', closed?.providerRef === 'dp_1AbC')
  ok('el cierre trae el desenlace', closed?.status === 'lost')
}

// ---- un reembolso
{
  const r = describeDisputeEvent({
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_9XyZ',
        payment_intent: 'pi_7Qrs',
        amount_refunded: 1250,
        currency: 'usd',
        refunded: true,
      },
    },
  })
  ok('lo reconoce como reembolso', r?.kind === 'refund')
  ok('la referencia es el cargo', r?.providerRef === 'ch_9XyZ')
  ok('el importe es el reembolsado', r?.amount === 12.5)
  ok('un reembolso no tiene motivo de disputa', r?.reason === null)
}

// ---- objetos anidados, que es como los manda Stripe cuando expande
{
  const d = describeDisputeEvent(dispute({ charge: { id: 'ch_nested' }, payment_intent: { id: 'pi_nested' } }))
  ok('cargo expandido', d?.chargeId === 'ch_nested')
  ok('intent expandido', d?.paymentIntentId === 'pi_nested')
}

// ---- lo que no es asunto suyo
{
  ok('otro evento se ignora', describeDisputeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }) === null)
  ok('sin objeto', describeDisputeEvent({ type: 'charge.dispute.created', data: { object: null } }) === null)
  ok('sin id no hay referencia', describeDisputeEvent(dispute({ id: undefined })) === null)
}

// ---- un pago sin intent guardado sigue siendo registrable
{
  const d = describeDisputeEvent(dispute({ payment_intent: null }))
  ok('sin intent NO se descarta', d !== null, 'perder la disputa sería el silencio que esto rompe')
  ok('el intent queda nulo', d?.paymentIntentId === null)
}

// ---- LA GUARDA: nada de esto le escribe a nadie
{
  const lib = readFileSync(join(__dirname, '..', 'src/lib/disputes.ts'), 'utf8')
  // Los manejadores viven en lib/stripe-events.ts (0.3c); la ruta solo verifica la firma.
  const hook = readFileSync(join(__dirname, '..', 'src/app/api/stripe/webhook/route.ts'), 'utf8') + readFileSync(join(__dirname, '..', 'src/lib/stripe-events.ts'), 'utf8')
  // Se afirma sobre la LLAMADA, no sobre el nombre: el modulo menciona
  // `fileSystemTicket` en prosa justamente para explicar por que no lo usa.
  ok('el módulo no abre tickets', !lib.includes('fileSystemTicket('))
  ok('el webhook no abre un ticket por una disputa', !/dispute[\s\S]{0,600}fileSystemTicket\(/.test(hook))
  ok('el webhook atiende la apertura', hook.includes("'charge.dispute.created'"))
  ok('el webhook atiende el cierre', hook.includes("'charge.dispute.closed'"))
  ok('el webhook atiende el reembolso', hook.includes("'charge.refunded'"))

  // 19 de 23 pagos de registro no tienen el intent guardado, asi que sin este
  // respaldo la mayoria de las disputas quedaria sin resolver.
  ok('el webhook cae en la sesión cuando el intent no lleva a nada', hook.includes('checkout.sessions.list'))
  ok('y lee los metadatos de la sesión', hook.includes('session.metadata'))
}

// ══ Work Order 02, Stage 8 ══════════════════════════════════════════════════
{
  const root = join(__dirname, '..')
  const rd = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
  const name = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_disputes_restoring\.sql$/.test(f)).sort().pop()
  ok('una migración de disputas y restitución existe', !!name)
  const mig = name ? rd(`supabase/migrations/${name}`) : ''
  ok('la categoría dispute existe', /category in \([^)]*'dispute'[^)]*\)/.test(mig))
  ok('transfer_type admite sale y restoring', /add value if not exists 'sale'/.test(mig) && /add value if not exists 'restoring'/.test(mig))
  ok('el historial admite restoring', /event_type in \('creation', 'transfer', 'restoring'\)/.test(mig) && /transfer_type in \('sale', 'gift', 'restoring'\)/.test(mig))

  // 8.1 una disputa abre un ticket con su evidencia; su dinero ya se congela (6.4, 064)
  const hookSrc = rd('src/app/api/stripe/webhook/route.ts') + rd('src/lib/stripe-events.ts')
  ok('el webhook abre el ticket de la disputa', /openDisputeTicket\(/.test(hookSrc))
  const t = rd('src/lib/dispute-ticket.ts')
  ok('en la categoría dispute, uno por disputa', /category: 'dispute'/.test(t) && /contains\('context', \{ dispute_ref:/.test(t))
  ok('con el título y su emisión', /title_number/.test(t) && /issued_at/.test(t))
  ok('con los registros y sus firmas', /record_uri/.test(t) && /record_hash/.test(t) && /mint_address/.test(t))
  ok('con el biométrico de la acción de dinero', /satisfied_biometric/.test(t))
  ok('a nadie se le avisa por la disputa (8.5)', !/notify\(/.test(t))

  // 8.4 la restitución
  const r = rd('src/lib/restoring.ts')
  ok('restoreToSeller mueve la obra de vuelta con una fila nueva', /export async function restoreToSeller/.test(r) && /event_type: 'restoring'/.test(r) && /current_owner_id: /.test(r))
  ok('no acumula regalía', /transferType === 'restoring'[\s\S]{0,80}return/.test(rd('src/lib/payout-earnings.ts')))
  ok('el registro lleva el evento restoring', /'restoring'/.test(rd('src/lib/chain/records.ts')))
  ok('una compra escribe sale en el historial, no automatic', /transfer\.transfer_type === 'automatic' \? 'sale'/.test(rd('src/app/api/complete-transfer/route.ts')))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
