import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Borrar los datos de prueba — Work Order Chains 01, Stage 10.
 *
 * Toda obra en produccion es de prueba. Esto la borra, con todo lo que cuelga
 * de ella, inmediatamente antes del cambio a mainnet, para que el registro
 * permanente empiece solo con obras reales.
 *
 *   npm run cleanup:test-data                 conteos por tabla y bucket (por defecto)
 *   npm run cleanup:test-data -- --rehearse   lo borra todo dentro de una transaccion
 *                                             que se deshace, y cuenta despues: todo en cero
 *   npm run cleanup:test-data -- --execute --kept kept.json --deleted deleted.json --backup-taken
 *
 * kept.json y deleted.json son arreglos de ids de perfil que confirma Federico
 * (10.2). Ejecutar exige las dos listas, que cada perfil este en una de ellas,
 * y --backup-taken: la copia de la base y el listado del almacenamiento se
 * toman antes (10.4). Despues se cuenta otra vez.
 *
 * Se conserva: admin_audit_log (el registro de seguridad; nombrara obras
 * borradas), platform_config, el contenido de Roast, y lo de Stripe en modo de
 * prueba. Los perfiles de la lista kept quedan, sin obras, con sus
 * registraciones cubiertas completas y sin codigo de creador (se emite uno
 * nuevo). Los de la lista deleted se borran desde auth.users, que arrastra
 * perfil, factores, credenciales y configuracion de cobro.
 *
 * Usa la CLI de Supabase enlazada (`supabase db query --linked`) para el SQL, y
 * la clave de service role solo al ejecutar, para vaciar works-media.
 */

type Mode = 'dry-run' | 'rehearse' | 'execute'

const args = process.argv.slice(2)
const mode: Mode = args.includes('--execute') ? 'execute' : args.includes('--rehearse') ? 'rehearse' : 'dry-run'
const argAfter = (flag: string): string | null => {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}

function refuse(message: string): never {
  console.error(`refused: ${message}`)
  process.exit(2)
}

/**
 * Lo que se borra, en orden: primero lo que apunta a una obra sin cascada
 * (RESTRICT o SET NULL), al final las obras y las series que quedan vacias.
 * `true` es toda la tabla: toda obra es de prueba.
 */
const BUCKETS: Array<[table: string, where: string]> = [
  ['payment_disputes', 'true'],
  ['payout_earnings', 'true'],
  ['payout_blocks', 'true'],
  ['tbt_payments', 'true'],
  ['offer_events', 'true'],
  ['offers', 'true'],
  ['velocity_holds', 'work_id is not null'],
  ['money_action_auth', 'work_id is not null'],
  ['chain_recovery_failures', 'true'],
  ['chain_anchors', 'true'],
  ['work_amendments', 'true'],
  ['ownership_history', 'true'],
  ['transfers', 'true'],
  ['title_files', 'true'],
  ['titles', 'true'],
  ['work_commerce', 'true'],
  ['context_snapshots', 'true'],
  ['work_annotations', 'true'],
  ['plagiarism_scans', 'true'],
  ['email_deliveries', 'work_id is not null'],
  ['mms_deliveries', 'work_id is not null'],
  ['image_vectors', 'true'],
  ['covered_registrations', 'true'],
  ['favorites', "target_type = 'work'"],
  ['curations', "target_type = 'work'"],
  ['notifications', "href like '/work/%' or params ? 'workId' or params ? 'title'"],
  ['tickets', "context ? 'work_id' or context->>'entity_type' in ('work', 'registration', 'transfer', 'payout_block')"],
  ['bonded_private', 'true'],
  ['bonded_creators', 'true'],
  ['works', 'true'],
  ['work_series', 'true'],
]

function runSql(sql: string): Array<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'tbt-cleanup-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql)
  const out = execFileSync('supabase', ['db', 'query', '--linked', '-f', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const start = out.indexOf('{')
  if (start < 0) return []
  const parsed = JSON.parse(out.slice(start, out.lastIndexOf('}') + 1)) as { rows?: Array<Record<string, unknown>> }
  return parsed.rows ?? []
}

const countSql = (tables: string[]): string =>
  BUCKETS.filter(([t]) => tables.includes(t))
    .map(([t, w]) => `select '${t}' as bucket, count(*)::int as n from public.${t} where ${w}`)
    .concat([`select 'storage:works-media' as bucket, count(*)::int as n from storage.objects where bucket_id = 'works-media'`])
    .join('\nunion all\n')

function printCounts(title: string, rows: Array<Record<string, unknown>>): void {
  console.log(`\n${title}`)
  for (let i = 0; i < rows.length; i++) console.log(`  ${String(rows[i].bucket).padEnd(26)} ${rows[i].n}`)
}

function readIds(path: string | null): string[] {
  if (!path) return []
  const ids = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !/^[0-9a-f-]{36}$/.test(x))) refuse(`${path} must be an array of profile ids`)
  return ids as string[]
}

async function emptyWorksMedia(): Promise<number> {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) refuse('execute needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to empty works-media')
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const rows = runSql(`select name from storage.objects where bucket_id = 'works-media' order by name`)
  const names = rows.map((r) => String(r.name))
  for (let i = 0; i < names.length; i += 100) {
    const { error } = await admin.storage.from('works-media').remove(names.slice(i, i + 100))
    if (error) throw error
  }
  return names.length
}

async function main(): Promise<void> {
  const present = runSql(
    `select t from unnest(array[${BUCKETS.map(([t]) => `'${t}'`).join(', ')}]) as t where to_regclass('public.' || t) is not null`
  ).map((r) => String(r.t))
  const missing = BUCKETS.map(([t]) => t).filter((t) => !present.includes(t))
  if (missing.length) console.log(`not in this database yet, skipped: ${missing.join(', ')}`)

  const profiles = runSql(`select id::text as id from public.profiles order by created_at`).map((r) => String(r.id))
  printCounts(`before (${mode})`, runSql(countSql(present)))
  console.log(`  ${'profiles'.padEnd(26)} ${profiles.length}`)
  if (mode === 'dry-run') return

  const kept = readIds(argAfter('--kept'))
  const deleted = readIds(argAfter('--deleted'))
  if (mode === 'execute') {
    if (!kept.length || !deleted.length) refuse('execute needs --kept and --deleted, the two lists Federico confirmed')
    if (!args.includes('--backup-taken')) refuse('execute needs --backup-taken: back up the database and list storage first')
    const unclassified = profiles.filter((p) => !kept.includes(p) && !deleted.includes(p))
    if (unclassified.length) refuse(`unclassified profiles: ${unclassified.join(', ')}`)
    const both = kept.filter((p) => deleted.includes(p))
    if (both.length) refuse(`in both lists: ${both.join(', ')}`)
  }

  const idList = (ids: string[]) => `array[${ids.map((id) => `'${id}'`).join(', ')}]::uuid[]`
  const statements = BUCKETS.filter(([t]) => present.includes(t)).map(([t, w]) => `delete from public.${t} where ${w};`)
  if (kept.length) statements.push(`update public.profiles set creator_code = null where id = any (${idList(kept)});`)
  if (deleted.length) statements.push(`delete from auth.users where id = any (${idList(deleted)});`)

  const sql = ['begin;', ...statements, countSql(present) + ';', mode === 'execute' ? 'commit;' : 'rollback;'].join('\n')
  printCounts(mode === 'execute' ? 'after (committed)' : 'after (rolled back)', runSql(sql))

  if (mode === 'execute') {
    const removed = await emptyWorksMedia()
    console.log(`\nworks-media: ${removed} objects removed`)
    printCounts('after: every count should be zero', runSql(countSql(present)))
  } else {
    console.log('\nworks-media objects are removed through the storage API on --execute only.')
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
