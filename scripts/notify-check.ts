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

// ---- LA GUARDA: el libro de entregas tiene que saber decir que NO
{
  const sms = readFileSync(join(__dirname, '..', 'src/app/api/send-sms/route.ts'), 'utf8')
  const writes = sms.match(/from\('mms_deliveries'\)/g) ?? []

  ok('hay al menos cuatro escrituras al libro', writes.length >= 4)
  ok(
    'ninguna usa el cliente del usuario',
    !sms.includes("supabase.from('mms_deliveries')"),
    'con el token del usuario la RLS la deniega y el registro queda vacío'
  )
  ok(
    'todas leen su error',
    (sms.match(/\{ error: \w+LedgerError \}/g) ?? []).length === writes.length,
    'una denegación muda es como el registro quedó a cero'
  )
  ok(
    'el catch exterior registra el fallo',
    /catch \(error: any\)[\s\S]{0,900}status: 'failed'/.test(sms),
    'con inserts solo en los caminos de éxito, la tabla no puede responder que no'
  )
}

// ---- LA GUARDA: el correo tenía la misma boca cerrada
{
  const email = readFileSync(join(__dirname, '..', 'src/app/api/send-email/route.ts'), 'utf8')

  ok(
    'el correo deja rastro',
    email.includes("from('email_deliveries')"),
    'sin libro, saber si un certificado salió exigía abrir el panel de Resend'
  )
  ok(
    'no usa el cliente del usuario',
    !email.includes("supabase.from('email_deliveries')"),
    'con el token del usuario la RLS la deniega y el registro queda vacío'
  )
  ok(
    'lee el error de la inserción',
    /const \{ error \} = await createAdminClient\(\)\.from\('email_deliveries'\)/.test(email),
    'una denegación muda es como el registro del MMS quedó a cero'
  )

  // Los tres desenlaces, cada uno con su nombre.
  for (const estado of ['sent', 'failed', 'simulated']) {
    ok(`anota '${estado}'`, email.includes(`status: '${estado}'`))
  }
  ok(
    'simulado no se anota como enviado',
    !/simulated: true[\s\S]{0,400}status: 'sent'/.test(email),
    'un libro que llame envío a lo que nadie recibió repite el fallo que vino a registrar'
  )

  // Cuatro caminos terminan mal —sin proveedor, rechazo de Resend, la llamada
  // que revienta, y el fallo previo a llegar al proveedor— y los cuatro anotan.
  ok(
    'los cuatro fallos dejan fila',
    (email.match(/status: 'failed'/g) ?? []).length >= 4,
    'con inserts solo en los caminos de éxito, la tabla no puede responder que no'
  )
  ok(
    'el catch exterior también registra',
    /catch \(error: any\)[\s\S]{0,800}recordDelivery\(/.test(email),
    'un correo que muere antes de Resend es indistinguible de uno que nadie intentó'
  )
  ok(
    'anotar no puede romper lo anotado',
    /async function recordDelivery[\s\S]{0,900}catch \(ledgerError\)/.test(email),
    'si el registro lanza en la rama de éxito, convierte un correo entregado en un 500'
  )

  // La comprobación del proveedor tiene que ver el cuerpo ya leído, o no sabe
  // de qué obra hablar; y la sesión sigue yendo antes que nada.
  ok(
    'el proveedor se comprueba después de leer el cuerpo',
    email.indexOf('const body: SendEmailRequest') < email.indexOf('if (!process.env.RESEND_API_KEY)'),
    'desde arriba no hay workId ni userId que anotar'
  )
  ok(
    'la sesión sigue siendo lo primero',
    email.indexOf('const auth = await authenticate(request)') < email.indexOf('const body: SendEmailRequest'),
    'un extraño no puede preguntarle a la ruta si hay proveedor configurado'
  )
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
