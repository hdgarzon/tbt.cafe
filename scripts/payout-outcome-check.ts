import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { emailCopyFor, type Locale } from '../src/lib/email-templates'

/**
 * El desenlace de un cobro se avisa una vez, y solo cuando el libro se movio —
 * Work Order 01, Step 21.
 *
 * `payout_completed` y `payout_failed` estaban definidos y no se enviaban. El
 * segundo es protector: no se apaga. Esta guarda sostiene cuando se avisa y
 * cuando no:
 *
 *  - completado, solo si `settle_payout_block` devolvio true en esta llamada;
 *  - fallido, solo si `fail_payout_block` devolvio true en esta llamada;
 *  - ni el estado indeterminado ni "el dinero salio y la fila no cerro" avisan:
 *    decir "fallo" cuando el dinero pudo salir es peor que callar;
 *  - la clave es el bloque, y lo que se pinta lo genera la base, nunca el
 *    destino enmascarado que mando el navegador.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

// ---- payout-disburse
{
  const src = read('src/lib/payout-disburse.ts')
  const body = code(src)
  ok('importa notify', src.includes("import { notify } from '@/lib/notify'"))

  ok(
    'fallido: solo si esta llamada marco el bloque',
    /const \{ data: moved \} = await admin\.rpc\('fail_payout_block'[\s\S]{0,400}?if \(moved === true\) \{\s*await notify\(admin, \{\s*userId,\s*eventKey: 'payout_failed',\s*dedupeKey: blockId,/.test(body),
    'un reintento sobre un bloque ya marcado avisaria otra vez'
  )
  ok(
    'completado: solo si esta llamada cerro el bloque',
    /await admin\.rpc\('settle_payout_block'[\s\S]*?if \(ok\.data === true\) \{\s*await notify\(admin, \{\s*userId,\s*eventKey: 'payout_completed',\s*dedupeKey: blockId,/.test(body)
  )
  ok('un solo aviso de cada', (body.match(/eventKey: 'payout_failed'/g) ?? []).length === 1 && (body.match(/eventKey: 'payout_completed'/g) ?? []).length === 1)

  const settleError = body.indexOf('if (ok.error) {')
  const settleErrorEnd = body.indexOf("return { status: 'paid'", settleError)
  ok(
    'el dinero salio y la fila no cerro: no avisa',
    settleError > -1 && settleErrorEnd > settleError && !/\bnotify\(/.test(body.slice(settleError, settleErrorEnd)),
    'se reconcilia a mano; un aviso de completado aqui adelanta lo que el libro no dice'
  )

  const pending = body.indexOf("type === 'StripeConnectionError'")
  const pendingEnd = body.indexOf("return { status: 'pending'", pending)
  ok(
    'el estado indeterminado no avisa de fallo',
    pending > -1 && pendingEnd > pending && !/\bnotify\(|\bfail\(/.test(body.slice(pending, pendingEnd)),
    'la transferencia pudo salir: decir que fallo es mentir con dinero de por medio'
  )

  ok(
    'lo que se pinta no es el destino del navegador',
    !/destination_masked|destinationMasked/.test(body),
    'la plantilla inserta los valores en HTML'
  )
  ok('enseña el neto y la referencia del bloque', /const shown = \{\s*amount: netAmount\.toLocaleString\(/.test(body) && /block: blockId,/.test(body))
  ok('lleva a una pagina que existe', body.includes("href: '/history/payouts'") && existsSync(join(root, 'src/app/history/payouts/page.tsx')))
}

// ---- el fallido sigue sin poder apagarse
{
  const notify = read('src/lib/notify.ts')
  ok('payout_failed sigue en ALWAYS_ON', /const ALWAYS_ON = new Set\(\[[\s\S]*?'payout_failed'[\s\S]*?\]\)/.test(notify))
}

// ---- correo y feed, en los cuatro
{
  const LOCALES: Locale[] = ['en', 'es', 'pt', 'fr']
  for (let i = 0; i < LOCALES.length; i++) {
    const l = LOCALES[i]
    const done = emailCopyFor('payout_completed', l, { amount: '1,234.56', block: 'PYT-BLK-7F3A92' })
    ok(`${l}: correo de completado con importe y bloque`, !!done && done.body.includes('1,234.56') && done.body.includes('PYT-BLK-7F3A92'))

    const provider = emailCopyFor('payout_failed', l, { amount: '1,234.56', block: 'PYT-BLK-7F3A92', reason: 'card_declined' })
    const setup = emailCopyFor('payout_failed', l, { amount: '1,234.56', block: 'PYT-BLK-7F3A92', reason: 'transfers_not_enabled' })
    ok(`${l}: correo de fallido con importe y bloque`, !!provider && provider.body.includes('1,234.56') && provider.body.includes('PYT-BLK-7F3A92'))
    ok(`${l}: no enseña el codigo del proveedor`, !!provider && !provider.body.includes('card_declined'))
    ok(
      `${l}: si falta configurar la cuenta, lo dice`,
      !!provider && !!setup && setup.body.length > provider.body.length && setup.body.startsWith(provider.body)
    )

    const events = JSON.parse(read(`src/i18n/messages/${l}.json`)).feed.events
    ok(`${l}: el feed dice el importe`, String(events.payout_completed).includes('{amount}') && String(events.payout_failed).includes('{amount}'))
  }
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
