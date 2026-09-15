import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { emailCopyFor, type Locale } from '../src/lib/email-templates'

/**
 * Lo que vence solo, vence de verdad — Work Order 01, Step 21.
 *
 * Dos cosas dependían de que alguien abriera una pantalla:
 *
 *  - una ganancia de compra pasaba a disponible solo cuando su dueño abría
 *    Cobros, así que el servidor nunca veía el cambio y nadie podía avisarle;
 *  - una transferencia sin respuesta vencía solo cuando el destinatario intentaba
 *    responder tarde. Si no lo intentaba, la retención seguía en la tarjeta de
 *    quien envió, nadie le avisaba y la obra no se podía volver a enviar
 *    (`transferAlreadyPending`).
 *
 * Esta guarda sostiene los dos barridos diarios que lo resuelven.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const count = (s: string, needle: string) => s.split(needle).length - 1

// ---- el cron
{
  const vercel = JSON.parse(read('vercel.json'))
  const jobs: { path?: string; schedule?: string }[] = vercel.crons ?? []
  const paths = jobs.map((j) => j.path)

  /*
   * Sin programar, a propósito. Update Package 01 deja el programador de tareas
   * para la Work Order 02, en Supabase Cron, y el barrido de transferencias
   * vencidas con él. Las rutas existen y rechazan toda llamada sin CRON_SECRET;
   * volver a programarlas es una decisión del arquitecto, no de un despliegue.
   */
  ok('el barrido de ganancias no está programado', paths.indexOf('/api/cron/payout-release') === -1, 'el programador es de la Work Order 02')
  ok('el de transferencias tampoco', paths.indexOf('/api/cron/transfer-lapse') === -1, 'el programador es de la Work Order 02')
  ok(
    'ningún cron corre más de una vez al día',
    jobs.length > 0 && jobs.every((j) => /^\d+ \d+ \* \* \*$/.test(j.schedule ?? '')),
    'una cuenta Hobby rechaza el despliegue entero'
  )

  const auth = code(readIf('src/lib/cron-auth.ts'))
  ok('sin secreto no pasa nadie', /if \(!secret\) return false/.test(auth), 'estos barridos sueltan retenciones y mueven el estado del dinero')
  ok('compara la cabecera entera', auth.includes("request.headers.get('authorization') === `Bearer ${secret}`"))

  const ROUTES: [string, string][] = [
    ['src/app/api/cron/payout-release/route.ts', 'await releaseDuePayoutEarnings(admin)'],
    ['src/app/api/cron/transfer-lapse/route.ts', 'await lapseUnansweredTransfers(admin)'],
  ]
  for (let i = 0; i < ROUTES.length; i++) {
    const [p, call] = ROUTES[i]
    const src = code(readIf(p))
    ok(`${p}: existe`, src.length > 0)
    ok(`${p}: es dinámica`, src.includes("export const dynamic = 'force-dynamic'"), 'si no, el build la ejecuta una vez y congela la respuesta')
    ok(`${p}: declara su límite de tiempo`, src.includes('export const maxDuration = '))
    const gate = src.indexOf('if (!cronAuthorised(request))')
    const admin = src.indexOf('createAdminClient()')
    ok(`${p}: comprueba el secreto antes de tocar la base`, gate > -1 && admin > gate)
    ok(`${p}: corre el barrido`, src.includes(call))
  }
}

// ---- ganancias retenidas
{
  const src = code(readIf('src/lib/payout-release.ts'))

  const update = src.indexOf(".update({ state: 'available', released_at: now, hold_reason: null })")
  const releasing = update > -1 ? src.slice(update, update + 300) : ''
  ok('libera lo pendiente', releasing.includes(".eq('state', 'pending')"))
  ok('solo lo que tenía ventana', releasing.includes(".not('releases_at', 'is', null)"))
  ok('y cuya ventana ya pasó', releasing.includes(".lte('releases_at', now)"))
  ok('no pasa por la función acotada a quien llama', !src.includes("rpc('release_my_due_payout_earnings'"))

  const notice = src.indexOf("eventKey: 'payout_released'")
  const reading = update > -1 && notice > update ? src.slice(update + 300, notice) : ''
  ok('avisa después de liberar', reading.length > 0)
  ok('solo lo que sigue disponible', reading.includes(".eq('state', 'available')"), 'si ya lo cobró, el aviso llega tarde')
  ok('nunca lo liberado por evento', reading.includes(".not('releases_at', 'is', null)"), 'eso ya avisó payout_available al escribirse')
  ok(
    'también lo que liberó la pantalla de Cobros',
    reading.includes(".gte('released_at', since)"),
    'si la persona abrió Cobros antes que el cron, la fila ya no está pendiente'
  )
  ok('un solo aviso', count(src, "eventKey: 'payout_released'") === 1)
  ok('una vez por ganancia', /eventKey: 'payout_released',\s*dedupeKey: e\.id,/.test(src))
  ok('enseña importe y obra', src.includes('amount: Number(e.amount).toLocaleString(') && src.includes('title: work?.title ??'))
  ok('lleva a donde se cobra', src.includes("href: '/history/payouts'"))
}

// ---- transferencias sin respuesta
{
  const src = code(readIf('src/lib/transfer-lapse.ts'))
  const respond = code(read('src/app/api/transfer/respond/route.ts'))

  ok('la misma ventana que respond', src.includes('HOLD_WINDOW_MS = 24 * 3600 * 1000') && respond.includes('HOLD_WINDOW_MS = 24 * 3600 * 1000'))

  const q = src.indexOf(".from('transfers')")
  const query = q > -1 ? src.slice(q, q + 700) : ''
  ok('solo las de dos fases', query.includes(".eq('is_two_phase', true)"))
  ok('solo las abiertas', query.includes(".eq('payment_status', 'pending')") && query.includes(".is('outcome', null)"))
  ok('solo las autorizadas hace más de 24 horas', query.includes(".not('authorized_at', 'is', null)") && query.includes(".lt('authorized_at', cutoff)"))

  const release = src.indexOf('await releaseHold(')
  const mark = src.indexOf(".update({ payment_status: 'expired', outcome: 'lapsed' })")
  const tell = src.indexOf('dedupeKey: `${t.id}:lapsed`')
  ok('suelta la retención antes de darla por vencida', release > -1 && mark > release)
  ok('si no pudo soltarla, no la marca', /if \(!released\) \{[^}]*continue/.test(src))

  const marking = mark > -1 ? src.slice(mark, mark + 300) : ''
  ok(
    'la marca es condicional',
    marking.includes(".eq('payment_status', 'pending')") && marking.includes(".is('outcome', null)") && marking.includes(".select('id')"),
    'si alguien respondió o canceló entretanto, no se pisa'
  )
  ok('avisa solo si esta pasada la marcó', /if \(!marked\?\.length\) \{[^}]*continue/.test(src) && tell > mark)
  ok(
    'con la misma clave que respond',
    respond.includes('dedupeKey: `${transferId}:${variant}`') && src.includes("eventKey: 'transfers'") && src.includes("variant: 'lapsed'"),
    'una transferencia vence una sola vez, la venza quien la venza'
  )

  ok('sin PaymentIntent, lo busca en la sesión de checkout', src.includes('stripe.checkout.sessions.retrieve('))
  ok('y si no hay nada que soltar, no la vence', /if \(!intentId\) \{[\s\S]{0,300}return false/.test(src), 'una retención huérfana que nadie va a buscar')
  ok('una ya cancelada cuenta como suelta', /payment_intent_unexpected_state[\s\S]{0,300}status === 'canceled'/.test(src))
  ok('una capturada, no', !src.includes("status === 'succeeded'"), 'alguien aceptó y complete-transfer está en camino')
}

// ---- correo y feed
{
  const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < LOCALES.length; i++) {
    const l = LOCALES[i]
    const copy = emailCopyFor('payout_released', l, { amount: '1,234.56', title: 'Raíces Rojas' })
    ok(`${l}: correo con importe y obra`, !!copy && copy.body.includes('1,234.56') && copy.body.includes('Raíces Rojas') && copy.subject.includes('1,234.56'))

    const feed = JSON.parse(read(`src/i18n/messages/${l}.json`)).feed.events.payout_released as string
    ok(`${l}: el feed dice importe y obra`, typeof feed === 'string' && feed.includes('{amount}') && feed.includes('{title}'))
  }
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
