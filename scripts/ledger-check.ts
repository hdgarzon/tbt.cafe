import { readFileSync } from 'fs'
import { join } from 'path'

/** El libro de la obra — Item 10 Change A. Las reglas que el spec fija. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8')
const tab = read('src/components/work/HistoryTab.tsx')
const route = read('src/app/api/work/[tbtId]/ledger/route.ts')
const ots = read('src/app/api/chain/ots/[hash]/route.ts')

// ---- «Pending anchors: quiet. A word, not a warning.»
{
  ok('pendiente se dice en gris', /anchorPending[\s\S]{0,80}text-placeholder|text-placeholder[\s\S]{0,80}anchorPending/.test(tab))
  ok('y solo el fallo se distingue', tab.includes('text-t-red') && tab.includes('anchorFailed'))
  ok('no hay icono de alarma junto al pendiente', !/anchorPending[\s\S]{0,120}<svg/.test(tab))
}

// ---- «.ots download on every confirmed entry»
{
  ok('la descarga cuelga del hash del registro', tab.includes('/api/chain/ots/'))
  ok('solo cuando el ancla está confirmada',
     /anchor\?\.status === 'confirmed'[\s\S]{0,140}linkOts|linkOts[\s\S]{0,140}confirmed/.test(tab),
     'una prueba pendiente no demuestra nada comprobable')
  ok('se sirve como adjunto', ots.includes('Content-Disposition') && ots.includes('.ots'))
  ok('sin sesión, como el hash que la nombra', !ots.includes('authenticate('))
}

// ---- «Three links per entry»
{
  ok('enlace a Arweave', tab.includes('linkArweave'))
  ok('enlace a Solana', tab.includes('linkSolana') && tab.includes('explorer.solana.com'))
  ok('y el cluster correcto', tab.includes("network === 'mainnet-beta' ? '' : `?cluster="))
}

// ---- «Monospace for every identifier and hash»
{
  ok('los hashes van monoespaciados', /font-mono/.test(tab))
  ok('y recortados, no enteros', tab.includes('function short('))
}

// ---- la ruta no abre la tabla de anclas
{
  ok('el libro se compone en el servidor', route.includes('createAdminClient'))
  ok('solo para obras certificadas', route.includes("work.status !== 'certified'"))
  ok('y solo las anclas de esa obra', /\.in\('record_hash', hashes\)/.test(route),
     'abrir chain_anchors dejaría enumerar todas')
}

// ---- una obra sin cadena no se muestra rota
{
  ok('se dice que es anterior a la cadena', tab.includes('ledgerNoChain'))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
