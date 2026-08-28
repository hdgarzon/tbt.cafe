import { readFileSync } from 'fs'
import { join } from 'path'
import { wasDelivered } from '../src/lib/notification-outcome'

/** Simular no es enviar, tampoco un piso más arriba. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

// ---- lo que sí salió
ok('200 sin marca de simulación', wasDelivered({ ok: true }, {}) === true)
ok('200 con simulated en falso', wasDelivered({ ok: true }, { simulated: false }) === true)
ok('200 sin cuerpo legible', wasDelivered({ ok: true }, null) === true)
ok('200 con cuerpo ausente', wasDelivered({ ok: true }, undefined) === true)

// ---- lo que no
ok('200 simulado no es enviado', wasDelivered({ ok: true }, { simulated: true }) === false)
ok('502 no es enviado', wasDelivered({ ok: false }, {}) === false)
ok('502 simulado tampoco', wasDelivered({ ok: false }, { simulated: true }) === false)

// ---- una marca que no sea booleana sigue siendo una marca
ok('simulated con cualquier valor cierto', wasDelivered({ ok: true }, { simulated: 1 }) === false)

// ---- LA GUARDA: quien llama ya no se fía solo del HTTP
{
  const complete = readFileSync(join(__dirname, '..', 'src/app/api/complete-tbt/route.ts'), 'utf8')
  ok('el correo no se da por enviado por el ok de HTTP', !complete.includes('emailSent = emailResponse.ok'))
  ok('el SMS no se da por enviado por el ok de HTTP', !complete.includes('smsSent = smsResponse.ok'))
  ok('ambos pasan por la misma regla', (complete.match(/wasDelivered\(/g) ?? []).length === 2)
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
