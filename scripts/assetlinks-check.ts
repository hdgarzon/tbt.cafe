import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Chains 01, Stage 1.4 — asset links are checked at entry.
 *
 * A link carrying an email, phone, coordinates or a UUID would be refused at
 * publication by assertNoIdentifiers. Brew checks with the SAME patterns and
 * names the link to change, instead of the record failing after payment.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

async function main() {
  const patternsPath = join(root, 'src/lib/chain/identifier-patterns.ts')
  ok('identifier-patterns.ts exists', existsSync(patternsPath))
  if (!existsSync(patternsPath)) return

  const patterns = read('src/lib/chain/identifier-patterns.ts')
  ok('the patterns module has no Node dependency (Brew runs in the browser)', !/from '(crypto|fs|path)'/.test(patterns))

  const pseudonym = read('src/lib/chain/pseudonym.ts')
  ok('assertNoIdentifiers uses the shared patterns', /from '\.\/identifier-patterns'/.test(pseudonym))
  ok('pseudonym.ts keeps no private copy of a pattern', !/const (EMAIL|PHONE|COORDS)_RE =/.test(pseudonym) && !/export const UUID_RE =/.test(pseudonym))

  const { identifierIn, linkIdentifierProblem } = await import(patternsPath)
  const { assertNoIdentifiers } = await import(join(root, 'src/lib/chain/pseudonym.ts'))

  // Every link Brew refuses, publication would refuse too — and the reverse.
  const cases: Array<[string, string | null]> = [
    ['https://youtu.be/dQw4w9WgXcQ', null],
    ['https://drive.google.com/file/d/1AbC-dEf_GhI/view', null],
    ['ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', null],
    ['https://example.com/?contact=user@example.com', 'email'],
    ['https://example.com/?c=user%40example.com', 'email'],
    ['https://wa.me/+10000000000', 'phone'],
    ['https://maps.example.com/@6.244203,-75.581211', 'coordinates'],
    ['https://example.com/w/123e4567-e89b-12d3-a456-426614174000', 'uuid'],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [link, want] = cases[i]
    const got = linkIdentifierProblem(link)
    ok(`${want ?? 'clean'}: ${link}`, got === want, `got ${got}`)
    if (!link.includes('%40')) {
      let threw = false
      try { assertNoIdentifiers({ asset_links: [link] }) } catch { threw = true }
      ok(`  publication agrees`, threw === (want !== null))
    }
  }
  ok('identifierIn on plain text', identifierIn('write to user@example.com') === 'email')

  const wizard = read('src/components/brew/BrewWizard.tsx')
  const submit = wizard.slice(wizard.indexOf('async function submitWork2()'), wizard.indexOf("setStep('work3')"))
  ok('Brew checks every link before leaving the step', /linkIdentifierProblem\(/.test(submit))
  ok('and names the link to change', /linkHasIdentifier[\s\S]{0,200}\{n\}/.test(submit))

  const langs = ['en', 'es', 'fr', 'pt']
  for (let i = 0; i < langs.length; i++) {
    const m = JSON.parse(read(`src/i18n/messages/${langs[i]}.json`))
    const e = m.brew.errors
    ok(`${langs[i]}: message and the four kinds exist`,
       typeof e.linkHasIdentifier === 'string' && e.linkHasIdentifier.includes('{n}') && e.linkHasIdentifier.includes('{what}') &&
       ['email', 'phone', 'coordinates', 'uuid'].every((k) => typeof e.linkIdentifierKinds?.[k] === 'string'))
  }
}

main().then(() => {
  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
