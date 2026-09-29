import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 1.1 — no legacy metadata path.
 *
 * generateNftMetadata and the uploadMetadata branch published price, royalty,
 * owner names, location and weather, and bypassed assertNoIdentifiers. They ran
 * precisely when the registration record had failed. A work with no published
 * registration record is not minted; it waits for the recovery sweep.
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
    else if (/\.(ts|tsx|js|mjs)$/.test(p)) out.push(p)
  }
  return out
}

const files = walk(join(root, 'src'), [])
const offenders: string[] = []
for (let i = 0; i < files.length; i++) {
  const s = readFileSync(files[i], 'utf8')
  if (s.includes('uploadMetadata(') || s.includes('generateNftMetadata(')) offenders.push(files[i].slice(root.length + 1))
}
ok('no uploadMetadata( or generateNftMetadata( under src/', offenders.length === 0, offenders.join(', '))

const oldName = files.filter((f) => readFileSync(f, 'utf8').includes('mintTBTNft('))
ok('mintTBTNft is gone', oldName.length === 0, oldName.map((f) => f.slice(root.length + 1)).join(', '))

const nft = readFileSync(join(root, 'src/lib/solana/nft.ts'), 'utf8')
const sig = /export async function mintTitleToken\(([\s\S]*?)\)\s*:/.exec(nft)
ok('mintTitleToken exists', !!sig)
ok('the record URI is required, not optional',
   !!sig && /registrationRecordUri: string/.test(sig[1]) && !/registrationRecordUri\?/.test(sig[1]))
ok('the mint refuses an empty record URI', /if \(!registrationRecordUri\) throw/.test(nft))
ok('the token URI is the record URI', /uri: registrationRecordUri/.test(nft))
ok('the mint takes no price, location or weather',
   !/marketPrice|creationLocation|creationWeather|royaltyPercentage/.test(nft))

const route = readFileSync(join(root, 'src/app/api/complete-tbt/route.ts'), 'utf8')
const call = route.indexOf('await mintTitleToken(')
ok('complete-tbt calls mintTitleToken', call > 0)
const guardAt = route.lastIndexOf('if (!recordUri) throw', call)
ok('the call is reached only with a record URI', guardAt > 0 && call - guardAt < 400,
   'a work without a record waits for the sweep')

console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
