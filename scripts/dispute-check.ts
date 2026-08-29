import { readFileSync } from 'fs'
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
  const hook = readFileSync(join(__dirname, '..', 'src/app/api/stripe/webhook/route.ts'), 'utf8')
  // Se afirma sobre la LLAMADA, no sobre el nombre: el modulo menciona
  // `fileSystemTicket` en prosa justamente para explicar por que no lo usa.
  ok('el módulo no abre tickets', !lib.includes('fileSystemTicket('))
  ok('el webhook no abre un ticket por una disputa', !/dispute[\s\S]{0,600}fileSystemTicket\(/.test(hook))
  ok('el webhook atiende la apertura', hook.includes("'charge.dispute.created'"))
  ok('el webhook atiende el cierre', hook.includes("'charge.dispute.closed'"))
  ok('el webhook atiende el reembolso', hook.includes("'charge.refunded'"))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
