import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { TBT_ID_PATTERN, LEGACY_TBT_ID_PATTERN } from '../src/lib/tbt-id'

/**
 * El ID de una obra es de tres letras y cuatro digitos — Work Order 01, Stage 2.
 *
 * La forma larga no era una alternativa sino un error fijado por un constraint,
 * y con ella el codigo del titulo necesita dos versiones de QR mas y deja de
 * escanear. Esta guarda sostiene las tres mitades del cambio: la base genera la
 * forma corta, lo ya compartido sigue llegando, y nada vuelve a escribir la larga.
 *
 * La regla de las letras NO se prueba aqui: vive en SQL y la migracion 045 se
 * comprueba a si misma contra los ocho ejemplos del prototipo antes de confirmar.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
// Sin comentarios: las cabeceras explican el formato viejo, y sobre prosa no se afirma.
const sqlOf = (p: string) => read(p).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

// La forma larga se compone en vez de escribirse, para que la busqueda de la
// entrega —cero apariciones— tambien pase sobre esta guarda.
const LONG = ['TBT', '1999', 'ABC123'].join('-')
const NEEDLE = 'TBT' + '-20'

// ---- los patrones
const PROTOTYPE = ['AUR4421', 'TWW8803', 'LAV2209', 'TOG1107', 'RRO5501', 'TYC3302', 'ELU7704', 'WLI9901']
for (let i = 0; i < PROTOTYPE.length; i++) {
  ok(`acepta ${PROTOTYPE[i]}, del prototipo`, TBT_ID_PATTERN.test(PROTOTYPE[i]))
}
ok('rechaza la forma larga', !TBT_ID_PATTERN.test(LONG))
ok('la reconoce como anterior', LEGACY_TBT_ID_PATTERN.test(LONG))
ok('no toma una corta por anterior', !LEGACY_TBT_ID_PATTERN.test('RRO5501'))

// ---- la migracion
{
  const m = sqlOf('supabase/migrations/045_tbt_id_short_form.sql')
  ok('quita el constraint viejo', /drop constraint if exists valid_tbt_id/.test(m))
  ok('pone el nuevo', m.includes("check (tbt_id ~ '^[A-Z]{3}[0-9]{4}$')"))
  ok('el trigger deriva el ID del titulo', /new\.tbt_id := public\.generate_tbt_id\(new\.title\)/.test(m))
  ok(
    'el trigger corre como propietario',
    /function public\.set_tbt_id\(\)\s*returns trigger[\s\S]{0,60}security definer/.test(m),
    'con la RLS de quien inserta, un ID ocupado por un borrador ajeno pasaria por libre'
  )
  ok('retira el generador sin argumentos', m.includes('drop function if exists public.generate_tbt_id();'))
  ok('guarda el ID anterior', /add column if not exists legacy_tbt_id text/.test(m))
  ok('work_amendments sigue a la obra', /update public\.work_amendments/.test(m))
  const EXAMPLES = [['Aurora, No. 4', 'AUR'], ['The Weeping Woman', 'TWW'], ['La Vie', 'LAV'], ['The Old Guitarist', 'TOG'],
    ['Raíces Rojas', 'RRO'], ['Tierra y Cielo', 'TYC'], ['El Umbral', 'ELU'], ['Water Lilies', 'WLI']]
  for (let i = 0; i < EXAMPLES.length; i++) {
    ok(`se comprueba contra '${EXAMPLES[i][0]}'`, m.includes(`['${EXAMPLES[i][0]}', '${EXAMPLES[i][1]}']`))
  }
}

// ---- el snapshot describe el destino
{
  const snap = read('supabase/schema-snapshot.sql')
  ok('snapshot: el constraint nuevo', snap.includes("valid_tbt_id CHECK ((tbt_id ~ '^[A-Z]{3}[0-9]{4}$'::text))"))
  ok('snapshot: sin el viejo', !/valid_tbt_id CHECK \(\(tbt_id ~ '\^TBT-/.test(snap))
  ok('snapshot: legacy_tbt_id', /\n {2}legacy_tbt_id text,\n/.test(snap))
}

// ---- lo ya compartido sigue llegando
{
  const page = read('src/app/work/[tbtId]/page.tsx')
  ok('la pagina resuelve el ID anterior', /currentTbtIdFor\(publicClient\(\), params\.tbtId\)/.test(page))
  ok('y redirige para siempre', /if \(moved\) permanentRedirect\(`\/work\/\$\{moved\}`\)/.test(page))
  ok('la imagen OG lo resuelve sin redirigir', /currentTbtIdFor\(supabase, tbtId\)/.test(read('src/app/og/[slug]/route.tsx')))
  ok('la API del ledger lo resuelve', /currentTbtIdFor\(admin, params\.tbtId\)/.test(read('src/app/api/work/[tbtId]/ledger/route.ts')))
}

// ---- nadie vuelve a escribir la forma larga
{
  const hits: string[] = []
  const walk = (dir: string) => {
    const names = readdirSync(join(root, dir))
    for (let i = 0; i < names.length; i++) {
      const rel = join(dir, names[i])
      if (statSync(join(root, rel)).isDirectory()) walk(rel)
      else if (/\.(ts|tsx|json|md)$/.test(rel) && read(rel).includes(NEEDLE)) hits.push(rel)
    }
  }
  walk('src')
  walk('scripts')
  ok('src y scripts no escriben la forma larga', hits.length === 0, hits.join(', '))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
