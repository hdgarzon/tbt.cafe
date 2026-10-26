import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { Keypair } from '@solana/web3.js'

/**
 * Chains 01, Stage 5.1 — every Arweave upload is signed by the storage key.
 *
 * The signer of the first mainnet record becomes tbt.cafe's permanent identity
 * on Arweave, and the tethered title checks records against the storage key's
 * address. So the signer is decided here, in one place, from one key:
 *
 *  - The data item is signed locally with TBT_STORAGE_PRIVATE_KEY, and the
 *    signer is read back from the signed bytes, not from what a service says.
 *  - The bytes signed are the bytes that were hashed: the record's canonical
 *    form, unchanged.
 *  - Mainnet sends the signed item to ArDrive Turbo, paid from the storage
 *    key's credits (topped up in SOL by the payer). Devnet sends the same signed
 *    item to Irys devnet, funded by the storage key: Turbo has no test network.
 *  - The old Metaplex library is gone; it only remained for the Irys driver.
 *  - The storage key's credits join the balance alarm (7.2.2), and the
 *    switch-readiness check proves the signer before the day.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}
const root = join(__dirname, '..')
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function walk(dir: string, out: string[]): string[] {
  const names = readdirSync(dir)
  for (let i = 0; i < names.length; i++) {
    const p = join(dir, names[i])
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(p)) out.push(p)
  }
  return out
}

async function main() {
  // ---- the old library is gone
  const pkg = JSON.parse(read('package.json'))
  ok('@metaplex-foundation/js is not a dependency', !(pkg.dependencies ?? {})['@metaplex-foundation/js'])
  const files = walk(join(root, 'src'), [])
  const users: string[] = []
  for (let i = 0; i < files.length; i++) if (/from '@metaplex-foundation\/js'/.test(readFileSync(files[i], 'utf8'))) users.push(files[i])
  ok('nothing under src imports it', users.length === 0, users.join(', '))
  ok('the Irys driver module is gone', !existsSync(join(root, 'src/lib/chain/irys.ts')))
  ok('the Turbo SDK is a dependency', !!(pkg.dependencies ?? {})['@ardrive/turbo-sdk'])

  // ---- the storage key signs, and nothing else does
  const storageKey = Keypair.generate()
  const payerKey = Keypair.generate()
  const authorityKey = Keypair.generate()
  process.env.TBT_STORAGE_PRIVATE_KEY = JSON.stringify(Array.from(storageKey.secretKey))
  process.env.SOLANA_PAYER_PRIVATE_KEY = JSON.stringify(Array.from(payerKey.secretKey))
  process.env.SOLANA_AUTHORITY_PRIVATE_KEY = JSON.stringify(Array.from(authorityKey.secretKey))

  const { signForArweave, signerOf, storageAddress } = await import('../src/lib/chain/storage-upload')
  const { recordFileFor } = await import('../src/lib/chain/arweave')

  const record = {
    schema: 'tbt.record.v1',
    type: 'registration',
    tbt_id: 'TST0001',
    sequence: 1,
    content_hash: 'sha256:' + '0'.repeat(64),
    sealed_at: '2026-10-26T00:00:00Z',
  }
  const file = recordFileFor(record)
  const item = await signForArweave(file)

  ok('the signer is the storage key', signerOf(item) === storageKey.publicKey.toBase58(), signerOf(item))
  ok('never the payer', signerOf(item) !== payerKey.publicKey.toBase58())
  ok('never the authority', signerOf(item) !== authorityKey.publicKey.toBase58())
  ok('storageAddress() names the same key', storageAddress() === storageKey.publicKey.toBase58())
  ok('the signature verifies', await item.isValid())
  ok('the bytes signed are the bytes hashed', Buffer.from(item.rawData).equals(Buffer.from(file.buffer)))
  const want = file.tags.map((t) => `${t.name}=${t.value}`).join('|')
  const got = item.tags.map((t: { name: string; value: string }) => `${t.name}=${t.value}`).join('|')
  ok('the tags go up exactly as built', want === got, got)

  // ---- the code construct: one signer, read from one key
  const up = code(read('src/lib/chain/storage-upload.ts'))
  ok('it reads the storage key', /readSecret\('storage'\)/.test(up))
  ok('and no other key', !/readSecret\('(payer|authority|titleSigning)'\)/.test(up))
  ok('mainnet sends the signed item to Turbo', /TurboFactory\.unauthenticated\(/.test(up) && /\.uploadSignedDataItem\(/.test(up))
  ok('devnet sends it to Irys devnet', /IRYS_DEVNET\}\/tx\/solana/.test(up))
  ok('the service must return the id that was signed', /!== item\.id/.test(up))

  const ar = code(read('src/lib/chain/arweave.ts'))
  ok('uploadToArweave signs with the storage key and sends that item',
     /uploadSigned\(await signForArweave\(file\)\)/.test(ar))
  ok('no driver of its own', !/getMetaplex\(/.test(ar) && !/toMetaplexFile\(/.test(ar))
  const img = code(read('src/lib/chain/publish-image.ts'))
  ok('the image goes through the same upload', /await uploadToArweave\(/.test(img) && !/toMetaplexFile\(/.test(img))

  // ---- the credits: topped up by the payer on mainnet, by the storage key on devnet
  const credits = code(read('src/lib/chain/storage-credits.ts'))
  ok('Turbo credits are read for the storage address', /\.getBalance\(address\)/.test(credits))
  ok('the payer tops up Turbo for the storage address',
     /readSecret\('payer'\)/.test(credits) && /turboCreditDestinationAddress: address/.test(credits))
  ok('devnet funds Irys from the storage key', /readSecret\('storage'\)/.test(credits) && /\/account\/balance\/solana/.test(credits))
  const script = code(read('scripts/storage-credits.ts'))
  ok('the top-up script only reads unless --execute', /process\.argv\.indexOf\('--execute'\) !== -1/.test(script))
  ok('registered in package.json', /"chain:storage-credits"/.test(read('package.json')))

  // ---- the balance alarm watches the storage key too (7.2.2)
  const { storageThresholdsFor, levelFor } = await import('../src/lib/chain/balance-rules')
  const rules = { warningDays: 14, urgentDays: 3, warningFloorSol: 0.5, urgentFloorSol: 0.2 }
  const perImage = 1_000
  const quiet = storageThresholdsFor(0.1, rules, perImage)
  ok('a quiet week still keeps a day of images per day', quiet.warning === 14 * perImage && quiet.urgent === 3 * perImage)
  const busy = storageThresholdsFor(20, rules, perImage)
  ok('a busy week: days of registrations', busy.warning === 14 * 20 * perImage && busy.urgent === 3 * 20 * perImage)
  ok('credits for 2 images is urgent', levelFor(2 * perImage, quiet) === 'urgent')
  ok('credits for 10 images is a warning', levelFor(10 * perImage, quiet) === 'warning')

  const bal = code(read('src/lib/chain/balance.ts'))
  ok('the alarm checks the storage credits', /export async function checkStorageCredits\(/.test(bal) && /storageThresholdsFor\(/.test(bal))
  ok('each account keeps its own open alert', /\.eq\('account', account\)/.test(bal))
  const route = code(read('src/app/api/cron/balance/route.ts'))
  ok('the hourly route runs both', /checkPayerBalance\(/.test(route) && /checkStorageCredits\(/.test(route))
  const mig = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_storage_credits\.sql$/.test(f)).map((f) => read(`supabase/migrations/${f}`)).join('\n')
  ok('balance_alerts accepts the storage account', /check \(account in \('payer', 'storage'\)\)/.test(mig))
  ok('and says which unit it holds', /unit text not null default 'lamports' check \(unit in \('lamports', 'winc'\)\)/.test(mig))

  // ---- the switch-readiness check proves the signer before the day
  const ready = code(read('src/app/api/cron/switch-readiness/route.ts'))
  ok('it signs a probe with the uploader and compares the signer to the storage key',
     /await signForArweave\(/.test(ready) && /signerOf\(probe\) === addresses\.storage/.test(ready))
  ok('it checks the storage key can pay for a full image', /storageCredits\(\)/.test(ready))
  ok('and that mainnet uploads go to Turbo', /UPLOAD_SERVICE\['mainnet-beta'\]/.test(ready))

  console.log(bad === 0 ? '\nall good' : `\n${bad} failure(s)`)
}

main().then(() => process.exit(bad === 0 ? 0 : 1), (error) => {
  console.log('FAIL', error instanceof Error ? error.message : error)
  process.exit(1)
})
