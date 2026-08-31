import { readFileSync } from 'fs'
import { join } from 'path'
import { detailFor } from '../src/lib/provider-events'

/** Un fallo tiene que decir de qué murió. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

// ---- EL FALLO QUE ESTO CIERRA
{
  // La forma exacta que complete-tbt le pasa cuando send-sms devuelve 500.
  // Antes salía "[object Object]" y se perdían el código y el estado.
  const d = detailFor({ code: undefined, status: 500, message: undefined })
  ok('un objeto plano no se aplasta', JSON.stringify(d) !== '{"message":"[object Object]"}')
  ok('conserva el estado', (d as { status?: unknown }).status === 500)
}

// ---- lo estructurado se conserva entero
{
  const d = detailFor({ code: '21606', status: 502, message: 'The From phone number is not valid' })
  ok('conserva el código de Twilio', (d as { code?: unknown }).code === '21606')
  ok('conserva el mensaje', String((d as { message?: unknown }).message).includes('From phone number'))
}

// ---- un Error de verdad
{
  const d = detailFor(new TypeError('algo explotó'))
  ok('un Error da su mensaje', (d as { message?: unknown }).message === 'algo explotó')
  ok('y su nombre', (d as { name?: unknown }).name === 'TypeError')
}

// ---- lo demás
{
  ok('una cadena es el mensaje', (detailFor('se cayó') as { message?: unknown }).message === 'se cayó')
  ok('nulo no revienta', typeof detailFor(null) === 'object')
  ok('indefinido tampoco', typeof detailFor(undefined) === 'object')
  ok('un número se describe', (detailFor(42) as { message?: unknown }).message === '42')
}

// ---- undefined dentro del objeto no borra la clave
{
  const d = detailFor({ code: undefined, status: 500 }) as Record<string, unknown>
  ok('una clave indefinida sobrevive como nula', 'code' in d && d.code === null)
}

// ---- lo circular no puede tumbar la observabilidad
{
  const circular: Record<string, unknown> = { code: 'X' }
  circular.self = circular
  let threw = false
  try { detailFor(circular) } catch { threw = true }
  ok('un objeto circular no lanza', !threw)
}

// ---- LA GUARDA: la cadena entera, de la ruta al registro
{
  const read = (rel: string) =>
    readFileSync(join(__dirname, '..', rel), 'utf8')

  const sms = read('src/app/api/send-sms/route.ts')
  const complete = read('src/app/api/complete-tbt/route.ts')

  ok('send-sms no devuelve un 500 mudo', !sms.includes("{ error: 'Error al enviar mensaje' }"))
  // Sobre la CONSTRUCCION, no sobre la distancia: medir cuantos caracteres
  // separan el catch de la variable se rompe en cuanto crece el bloque.
  ok(
    'la respuesta del catch lleva el fallo de Twilio',
    sms.includes('twilioErrorCode: twilioFailure?.code'),
    'sin esto la causa se pierde y vuelve el "[object Object]"'
  )
  ok('complete-tbt reenvía el cuerpo entero', complete.includes('...smsBody'))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
