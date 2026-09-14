import { readFileSync } from 'fs'
import { join } from 'path'
import { emailCopyFor, renderEmail, type Locale } from '../src/lib/email-templates'

/**
 * Compras y transferencias se avisan a las dos partes, una vez — Work Order 01,
 * Step 21.
 *
 * `purchases` y `transfers` estaban definidos y no se enviaban. Esta guarda
 * sostiene:
 *
 *  - que el aviso sale donde el hecho ya es definitivo: al final de
 *    `complete-transfer`, con la propiedad movida, y al rechazar o vencer en
 *    `respond`;
 *  - que cada persona recibe cada aviso una vez, aunque la ruta se reintente o
 *    corra dos veces a la vez: la clave es la transferencia más la variante;
 *  - que el feed y el correo dicen QUÉ pasó, en los cuatro idiomas;
 *  - y que el título de la obra, que escribe el creador, no puede meter HTML en
 *    un correo: `renderEmail` escapa lo que inserta.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

// ---- complete-transfer
{
  const src = read('src/app/api/complete-transfer/route.ts')
  const title = src.indexOf(".from('titles').insert(")
  const back = src.lastIndexOf('return NextResponse.json({\n      success: true,')
  const EXPECT: [string, string][] = [
    ["purchases", 'bought'],
    ["purchases", 'sold'],
    ["transfers", 'received'],
    ["transfers", 'accepted'],
  ]
  for (let i = 0; i < EXPECT.length; i++) {
    const [key, variant] = EXPECT[i]
    const at = src.indexOf(`eventKey: '${key}',\n          dedupeKey: \`\${transfer.id}:${variant}\`,`) > -1
      ? src.indexOf(`eventKey: '${key}',\n          dedupeKey: \`\${transfer.id}:${variant}\`,`)
      : src.indexOf(`eventKey: '${key}',\n        dedupeKey: \`\${transfer.id}:${variant}\`,`)
    ok(`complete-transfer: ${key} · ${variant}, con la transferencia y la variante como clave`, at > -1)
    ok(`complete-transfer: ${key} · ${variant} va después de mover la propiedad y antes de responder`, at > title && at < back)
    ok(`complete-transfer: ${key} · ${variant} dice qué pasó`, src.includes(`data: { variant: '${variant}', ...aboutWork }`))
  }
  ok('una compra se distingue por transfer_type', src.includes("if (transfer.transfer_type === 'automatic') {"))
  ok(
    'no se avisa de recibir a quien no la recibe',
    src.includes('} else if (transfer.to_owner_id && transfer.to_owner_id !== transfer.from_owner_id) {'),
    'sin destinatario con cuenta, o si la obra no cambió de manos, no hay a quién avisar'
  )
}

// ---- respond
{
  const src = read('src/app/api/transfer/respond/route.ts')
  ok('respond: la clave lleva el motivo', src.includes('dedupeKey: `${transferId}:${variant}`,'))
  const lapsedWrite = src.indexOf("outcome: 'lapsed' }).eq('id', transferId)")
  const lapsedNotice = src.indexOf("notifySender(service, transfer.from_owner_id, transferId, 'lapsed', work)")
  ok('respond: vencida avisa a quien envió, después de anotarla', lapsedWrite > -1 && lapsedNotice > lapsedWrite)
  const rejectedWrite = src.indexOf("outcome: 'rejected' }).eq('id', transferId)")
  const rejectedNotice = src.indexOf("notifySender(service, transfer.from_owner_id, transferId, 'declined', work)")
  ok('respond: rechazada avisa a quien envió, después de anotarla', rejectedWrite > -1 && rejectedNotice > rejectedWrite)
  ok('respond: el rechazo que falla en Stripe no avisa', src.indexOf("return NextResponse.json({ error: 'rejectFailed' }") < rejectedNotice)
  ok('respond: trae el título de la obra', src.includes('work:works(current_owner_id, title, tbt_id)'))
}

// ---- el feed dice qué pasó
{
  const feed = read('src/components/NotificationFeed.tsx')
  ok(
    'el feed busca primero el texto de la variante',
    feed.includes('events[`${row.event_key}_${variant}`]') && feed.includes('?? events[row.event_key]')
  )
  const VARIANTS = ['purchases_bought', 'purchases_sold', 'transfers_received', 'transfers_accepted', 'transfers_declined', 'transfers_lapsed']
  const LANGS = ['en', 'es', 'pt', 'fr']
  for (let l = 0; l < LANGS.length; l++) {
    const events = JSON.parse(read(`src/i18n/messages/${LANGS[l]}.json`)).feed.events
    const missing = VARIANTS.filter((k) => typeof events[k] !== 'string' || !events[k].includes('{title}'))
    ok(`${LANGS[l]}: las seis variantes, con el título`, missing.length === 0, missing.join(', '))
  }
}

// ---- el correo
{
  const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']
  const CASES: [string, string][] = [
    ['purchases', 'bought'], ['purchases', 'sold'],
    ['transfers', 'received'], ['transfers', 'accepted'], ['transfers', 'declined'], ['transfers', 'lapsed'],
  ]
  for (let l = 0; l < LOCALES.length; l++) {
    const bodies: string[] = []
    for (let c = 0; c < CASES.length; c++) {
      const [key, variant] = CASES[c]
      const copy = emailCopyFor(key, LOCALES[l], { variant, title: 'Raíces Rojas' })
      ok(`${LOCALES[l]}: correo ${key} · ${variant} con el título`, !!copy && copy.body.includes('Raíces Rojas'))
      if (copy) bodies.push(copy.body)
    }
    ok(`${LOCALES[l]}: cada variante dice algo distinto`, new Set(bodies).size === CASES.length)
  }

  const hostile = '<a href="https://example.com/claim">Claim your payout</a>'
  const copy = emailCopyFor('purchases', 'en', { variant: 'sold', title: hostile })
  const html = copy ? renderEmail(copy, '/work/RRO5501') : ''
  ok(
    'un título con HTML no llega como HTML al correo',
    !!copy && !html.includes('<a href="https://example.com/claim">') && html.includes('&lt;a href='),
    'el título lo escribe el creador; sin escapar, cualquiera mete su enlace en el correo de otra persona'
  )
  const plain = emailCopyFor('ticket_reply', 'en', { ref: 'TKT-0001', subject: '"><script>x</script>' })
  ok('y vale para todas las plantillas', !!plain && !renderEmail(plain, '/help').includes('<script>x</script>'))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
