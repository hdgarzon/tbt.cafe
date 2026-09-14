import { readFileSync } from 'fs'
import { join } from 'path'
import { maskForNotice } from '../src/lib/payout-destination-notice'
import { emailCopyFor, type Locale } from '../src/lib/email-templates'

/**
 * Un cambio de destino de cobro se avisa siempre — Work Order 01, Step 21.
 *
 * `payout_destination` estaba en ALWAYS_ON y no se enviaba desde ningun sitio.
 * Esta guarda sostiene lo que hace falta para que el aviso sirva:
 *
 *  - sale de las dos rutas que cambian el destino, despues de guardarlo y solo
 *    si se guardo, y antes de responder o de pagar;
 *  - llega tambien por correo, porque quien cambio el destino puede ser quien
 *    tiene la sesion y ve el feed;
 *  - lo que se pinta lo enmascara el servidor, sin un caracter que pueda colar
 *    HTML en ese correo;
 *  - si el guardado falla, el destino anterior vuelve, en vez de dejar a la
 *    persona sin ninguno.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const SAFE = /^[A-Za-z0-9•… ]+$/

// ---- la mascara
{
  ok('una cuenta numerica deja los cuatro ultimos', maskForNotice('4111 1111 1111 1234') === '•••• 1234', maskForNotice('4111 1111 1111 1234'))
  ok('una direccion deja cuatro y cuatro', maskForNotice('0x71C7656EC7ab88b098defB751B7401B5f6d8976F') === '0x71…976F', maskForNotice('0x71C7656EC7ab88b098defB751B7401B5f6d8976F'))
  ok('algo corto no se enseña', maskForNotice('abc') === '••••' && maskForNotice('12') === '••••')

  const HOSTILE = [
    '"><a href="https://example.com/cancel">Cancel this change</a>',
    '<img src=x onerror=alert(1)>',
    'user@example.com',
    'ES91 2100 0418 4502 0005 1332',
    "javascript:alert('x')//aaaaaaaa",
  ]
  for (let i = 0; i < HOSTILE.length; i++) {
    const m = maskForNotice(HOSTILE[i])
    ok(`sin caracteres que abran HTML: ${JSON.stringify(HOSTILE[i]).slice(0, 32)}`, SAFE.test(m), m)
  }
}

// ---- el aviso
{
  const src = read('src/lib/payout-destination-notice.ts')
  ok('usa la clave del evento protegido', src.includes("eventKey: 'payout_destination'"))
  ok('la clave es la fila nueva', src.includes('dedupeKey: params.destinationId'))
  ok('el destino va enmascarado por el servidor', src.includes('to: maskForNotice(params.destination)'))
  ok('el anterior tambien', src.includes('maskForNotice(params.previousDestination)'))
  ok('no acepta el enmascarado del navegador', !/destinationMasked|destination_masked/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
  ok('lleva a pedir ayuda', src.includes("href: '/help'"))

  const notify = read('src/lib/notify.ts')
  ok(
    'sigue sin poder apagarse',
    /const ALWAYS_ON = new Set\(\[[\s\S]*?'payout_destination'[\s\S]*?\]\)/.test(notify),
    'quien pudiera silenciarlo podria redirigir dinero sin que nadie lo note'
  )
}

// ---- las dos rutas que cambian el destino
{
  const ROUTES = ['src/app/api/payouts/destination/route.ts', 'src/app/api/payouts/collect/route.ts']
  for (let i = 0; i < ROUTES.length; i++) {
    const rel = ROUTES[i]
    const src = read(rel)
    const readPrevious = src.indexOf(".eq('is_default', true)")
    const demote = src.indexOf("update({ is_default: false })")
    const insert = src.indexOf("from('payout_destinations').insert(")
    const selected = src.indexOf(".select('id').single()", insert)
    const checked = src.search(/\|\| !saved\)/)
    const restore = src.indexOf("update({ is_default: true }).eq('id', previous.id)")
    const call = src.indexOf('await notifyPayoutDestinationChanged(admin, {')

    ok(`${rel}: importa el aviso`, src.includes("from '@/lib/payout-destination-notice'"))
    ok(`${rel}: lee el destino anterior antes de bajarlo`, readPrevious > -1 && demote > readPrevious)
    ok(`${rel}: el insert devuelve la fila`, insert > demote && selected > insert)
    ok(`${rel}: comprueba que se guardo antes de avisar`, checked > insert && call > checked, 'no se avisa de un cambio que no quedo guardado')
    ok(`${rel}: si falla, el anterior vuelve`, restore > insert && restore < call, 'sin esto la persona se queda sin destino por defecto')
    ok(`${rel}: avisa con la fila nueva`, call > -1 && /destinationId: saved\.id/.test(src.slice(call, call + 300)))
    ok(`${rel}: el mismo destino no es un cambio`, /previous\.destination (===|!==) (destination\.trim\(\)|typed)/.test(src))
  }

  const destination = read(ROUTES[0])
  // Que exista primero: una llamada ausente da -1, y -1 siempre queda «antes».
  ok(
    'destination: avisa antes de responder',
    destination.indexOf('await notifyPayoutDestinationChanged(') > -1 &&
      destination.indexOf('await notifyPayoutDestinationChanged(') <
        destination.lastIndexOf('return NextResponse.json({ masked: destinationMasked, methodId })')
  )
  const collect = read(ROUTES[1])
  ok(
    'collect: avisa antes de pagar',
    collect.indexOf('await notifyPayoutDestinationChanged(') > -1 &&
      collect.indexOf('await notifyPayoutDestinationChanged(') < collect.indexOf('disburseBlock(admin')
  )
}

// ---- llega por correo, y el feed dice a donde
{
  const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < LOCALES.length; i++) {
    const l = LOCALES[i]
    const copy = emailCopyFor('payout_destination', l, { to: '•••• 1234', from: 'abcd…wxyz' })
    ok(`${l}: hay correo`, copy !== null, 'sin plantilla, el aviso se queda en el feed de quien tenga la sesion')
    ok(`${l}: dice el destino nuevo y el anterior`, !!copy && copy.body.includes('•••• 1234') && copy.body.includes('abcd…wxyz'))
    const first = emailCopyFor('payout_destination', l, { to: '•••• 1234', from: '' })
    ok(`${l}: sin anterior no queda un hueco`, !!first && !first.body.includes('undefined') && !first.body.includes('  '))

    const feed = JSON.parse(read(`src/i18n/messages/${l}.json`)).feed.events.payout_destination as string
    ok(`${l}: el feed dice a donde`, typeof feed === 'string' && feed.includes('{to}'))
  }
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
