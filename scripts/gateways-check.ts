import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 5.5 — gateways live in one list.
 *
 * The work page links through the first; the tethered title embeds them all
 * (Stage 9). A gateway hardcoded anywhere else is one the list cannot replace.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')

function walk(dir: string, out: string[]): string[] {
  const entries = readdirSync(dir)
  for (let i = 0; i < entries.length; i++) {
    const p = join(dir, entries[i])
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

async function main() {
  const g = await import(join(root, 'src/lib/chain/gateways.ts'))
  const list: string[] = g.ARWEAVE_GATEWAYS
  ok('arweave.net is first', list[0] === 'https://arweave.net')
  ok('at least four Arweave gateways', list.length >= 4)
  ok('every gateway is https with no trailing slash', list.every((u) => /^https:\/\/[a-z0-9.-]+$/.test(u)))
  ok('no duplicates', Array.from(new Set(list)).length === list.length)
  ok('Solana public endpoints listed', g.SOLANA_PUBLIC_ENDPOINTS.length >= 1)
  ok('Bitcoin header sources listed', g.BITCOIN_HEADER_SOURCES.length >= 2)
  ok('arweaveUrl uses the first gateway', g.arweaveUrl('abc') === 'https://arweave.net/abc')

  const arweave = readFileSync(join(root, 'src/lib/chain/arweave.ts'), 'utf8')
  ok('gatewayUri goes through arweaveUrl', /arweaveUrl\(id\)/.test(arweave))

  const files = walk(join(root, 'src'), [])
  const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const hard = files.filter((f) => !f.endsWith('gateways.ts') && code(f).includes('https://arweave.net/'))
  ok('no gateway hardcoded outside gateways.ts', hard.length === 0, hard.map((f) => f.slice(root.length + 1)).join(', '))
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
