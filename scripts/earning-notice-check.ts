import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { emailCopyFor, type Locale } from '../src/lib/email-templates'

/**
 * Una regalía que llega disponible se avisa una vez — Work Order 01, Step 21.
 *
 * `payout_available` estaba definido y no se enviaba. Esta guarda sostiene cuándo
 * se avisa y cuándo no:
 *
 *  - solo la regalía que entra ya disponible, la de liberación por evento (una
 *    transferencia aceptada). La de una compra entra pendiente, y avisar ahí
 *    diría "lista para cobrar" de un dinero que todavía no se puede cobrar;
 *  - solo cuando esta pasada escribió la fila. Un reintento choca con el índice
 *    único de la 020 y no trae fila: su aviso salió la primera vez;
 *  - nunca al creador que vende lo suyo, porque ahí no hay regalía;
 *  - con el neto, que es lo que se puede cobrar, y un enlace a donde se cobra.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

// ---- payout-earnings
{
  const src = read('src/lib/payout-earnings.ts')
  const body = code(src)

  ok('importa notify', src.includes("import { notify } from '@/lib/notify'"))
  ok('lee el título de la obra', body.includes(".select('creator_id, title, commerce:work_commerce(royalty_type, royalty_value)')"))
  ok('el insert devuelve la fila', /from\('payout_earnings'\)\.insert\(\{[\s\S]{0,500}?\}\)\.select\('id'\)\.single\(\)/.test(body))

  ok(
    'avisa solo si entra disponible y esta pasada la escribió',
    /if \(release === 'event' && !error && saved\) \{\s*await notify\(admin, \{\s*userId: work\.creator_id,\s*eventKey: 'payout_available',\s*dedupeKey: saved\.id,/.test(body),
    'una de compra entra pendiente; un reintento choca con el índice y no trae fila'
  )
  ok('un solo aviso', (body.match(/eventKey: 'payout_available'/g) ?? []).length === 1)

  const selfSale = body.indexOf('work.creator_id === fromOwnerId) return')
  const notice = body.indexOf("eventKey: 'payout_available'")
  ok('el creador que vende lo suyo sale antes de llegar al aviso', selfSale > -1 && notice > selfSale)
  ok('el aviso va después de comprobar el error del insert', body.indexOf("error.code !== '23505'") > -1 && notice > body.indexOf("error.code !== '23505'"))

  ok('enseña el neto, no el bruto', body.includes('amount: net.toLocaleString(') && !/amount: gross/.test(body))
  ok('lleva a donde se cobra', body.includes("href: '/history/payouts'") && existsSync(join(root, 'src/app/history/payouts/page.tsx')))
  ok('y esa página es la del botón de cobrar', read('src/app/history/payouts/page.tsx').includes('<CollectSheet'))
}

// ---- correo y feed
{
  const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < LOCALES.length; i++) {
    const l = LOCALES[i]
    const copy = emailCopyFor('payout_available', l, { amount: '1,234.56', title: 'Raíces Rojas' })
    ok(`${l}: correo con importe y obra`, !!copy && copy.body.includes('1,234.56') && copy.body.includes('Raíces Rojas') && copy.subject.includes('1,234.56'))

    const feed = JSON.parse(read(`src/i18n/messages/${l}.json`)).feed.events.payout_available as string
    ok(`${l}: el feed dice importe y obra`, typeof feed === 'string' && feed.includes('{amount}') && feed.includes('{title}'))
  }
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
