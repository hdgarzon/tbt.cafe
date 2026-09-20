import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

/**
 * El ID corto y la cadena de respaldo — Update Package 01, §3.
 *
 * Este guard afirma sobre CINCO piezas:
 *   1. La migracion 050 define la regla de letras, el generador con plan B,
 *      la lista de bloqueo, los dos triggers, los revokes y el self-check.
 *   2. El snapshot refleja el nuevo shape del constraint y la columna
 *      tbt_id_blocklist sobre platform_config.
 *   3. La pagina /work/[tbtId] redirige minusculas a mayusculas (308).
 *   4. Los ocho IDs del prototipo se reproducen segun la regla (afirmacion
 *      textual sobre la migracion, no ejecucion real).
 *   5. Ningun archivo bajo src/ o scripts/ escribe fixtures con el formato
 *      largo `^TBT-YYYY-XXXXXX$` — el paquete lo retira.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : '')

// ---- migracion 050
{
  const path = 'supabase/migrations/050_tbt_id_short_form.sql'
  ok(`existe ${path}`, existsSync(join(root, path)))
  const src = read(path)

  // Preflight
  ok('rechaza correr con formato heredado presente', /raise exception[\s\S]{0,200}legacy tbt_id|obras aun llevan tbt_id en formato heredado/.test(src))

  // Blocklist column + seed
  ok('anade tbt_id_blocklist a platform_config', /alter table public\.platform_config[\s\S]{0,200}add column if not exists tbt_id_blocklist text\[\]/.test(src))
  ok('siembra la lista con los grupos del companion', /'ASS'[\s\S]{0,600}'KYS'/.test(src))
  ok('siembra solo si esta vacia (idempotente)', /where id = true[\s\S]{0,200}cardinality\(tbt_id_blocklist\), 0\) = 0/.test(src))

  // is_untitled_title
  ok('reconoce Untitled en cuatro idiomas', /is_untitled_title[\s\S]{0,600}'untitled'[\s\S]{0,120}'sin/.test(src) && /'sem/.test(src) && /'sans titre'/.test(src))

  // Letter rule
  ok('tbt_id_letters devuelve null cuando no salen tres letras', /tbt_id_letters[\s\S]{0,2200}return null;/.test(src))
  ok('la regla parte por la primera coma', /split_part\(coalesce\(p_source, ''\), ',', 1\)/.test(src))
  ok('sin XXX de relleno al final', !/left\(s \|\| 'XXX'/.test(src), 'el plan B reemplaza al padding — Federico condicion (a)')

  // Generator
  ok('generate_tbt_id toma el work_id', /create or replace function public\.generate_tbt_id\(p_work_id uuid\)/.test(src))
  ok('generate_tbt_id corre como propietario', /create or replace function public\.generate_tbt_id\(p_work_id uuid\)[\s\S]{0,400}security definer/.test(src))
  ok('lee titulo y creador via join', /public\.works w[\s\S]{0,120}public\.profiles p on p\.id = w\.creator_id/.test(src))
  ok('consulta la lista de bloqueo', /tbt_id_blocklist[\s\S]{0,120}from public\.platform_config/.test(src))
  ok('plan B: cae al nombre del creador', /Nombre del creador por la misma regla|creator_name|creator's name/.test(src) && /public\.tbt_id_letters\(v_creator_name\)/.test(src))
  ok('ultimo recurso es TBT', /v_letters := 'TBT'/.test(src))
  ok('descartar bloqueadas antes de los digitos', /any \(v_blocklist\)/.test(src))
  ok('200 intentos para digitos', /for attempt in 1 \.\. 200 loop/.test(src))

  // Triggers
  ok('retira el trigger heredado del esquema base', /drop trigger if exists trigger_set_tbt_id on public\.works/.test(src))
  ok('marcador en insert', /create trigger set_tbt_id_placeholder[\s\S]{0,120}before insert on public\.works/.test(src))
  ok('marcador usa el uuid de la obra', /new\.tbt_id := new\.id::text/.test(src))
  ok('emite el ID en la certificacion', /create trigger set_tbt_id_on_certification[\s\S]{0,120}before update on public\.works/.test(src))
  ok('solo en la transicion a certified', /new\.status = 'certified'[\s\S]{0,120}old\.status is distinct from 'certified'/.test(src))
  ok('idempotente si ya lleva el formato corto', /new\.tbt_id !~ '\^\[A-Z\]\{3\}\[0-9\]\{4\}\$'/.test(src))

  // Revokes
  const revokeRe = /revoke execute on function public\.(\w+)/g
  const revoked = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = revokeRe.exec(src))) revoked.add(m[1])
  for (const fn of ['is_untitled_title', 'tbt_id_letters', 'generate_tbt_id', 'set_tbt_id_placeholder', 'set_tbt_id_on_certification']) {
    ok(`revoke sobre ${fn}`, revoked.has(fn))
  }

  // Constraint
  ok('nuevo valid_tbt_id acepta el formato corto', /add constraint valid_tbt_id[\s\S]{0,400}'\^\[A-Z\]\{3\}\[0-9\]\{4\}\$'/.test(src))
  ok('y acepta el marcador del borrador', /add constraint valid_tbt_id[\s\S]{0,400}tbt_id = id::text/.test(src))

  // Sin conversion — Federico condicion (d). Se acepta que el nombre aparezca en
  // comentarios (para explicar que NO se anade), pero no en DDL o DML activo.
  const codeOnly = src.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  ok('no crea la columna legacy_tbt_id', !/add column[\s\S]{0,80}legacy_tbt_id/i.test(codeOnly), 'Federico condicion (d)')
  ok('no anade constraint sobre legacy_tbt_id', !/constraint[^;]*legacy_tbt_id/i.test(codeOnly))
  ok('no crea indice sobre legacy_tbt_id', !/create[^;]*index[^;]*legacy_tbt_id/i.test(codeOnly))
  ok('no actualiza obras existentes', !/update public\.works\s+set tbt_id/i.test(codeOnly))
  ok('no toca work_amendments', !/update public\.work_amendments/i.test(codeOnly))

  // Self-check (los ocho del prototipo)
  const prototypeIds = [
    ['Aurora, No. 4', 'AUR'],
    ['The Weeping Woman', 'TWW'],
    ['La Vie', 'LAV'],
    ['The Old Guitarist', 'TOG'],
    ['Raíces Rojas', 'RRO'],
    ['Tierra y Cielo', 'TYC'],
    ['El Umbral', 'ELU'],
    ['Water Lilies', 'WLI'],
  ]
  for (const [title, id] of prototypeIds) {
    ok(`self-check nombra ${title} → ${id}`, src.includes(`'${title}'`) && src.includes(`'${id}'`))
  }
}

// ---- snapshot
{
  const src = read('supabase/schema-snapshot.sql')
  ok('el snapshot lleva tbt_id_blocklist en platform_config', /tbt_id_blocklist text\[\] not null default '\{\}'/.test(src))
  ok('el snapshot cambia valid_tbt_id al formato corto', /valid_tbt_id CHECK \(\(tbt_id ~ '\^\[A-Z\]\{3\}\[0-9\]\{4\}\$'::text\)/.test(src))
  ok('el snapshot no menciona el formato largo en el constraint', !/valid_tbt_id CHECK \(\(tbt_id ~ '\^TBT-/.test(src))
}

// ---- redirect lowercase → uppercase
{
  const src = read('src/app/work/[tbtId]/page.tsx')
  ok('importa permanentRedirect', /import\s+\{\s*permanentRedirect\s*\}\s+from\s+'next\/navigation'/.test(src))
  ok('detecta el formato corto en minusculas', /\^\[a-z\]\{3\}\[0-9\]\{4\}\$/.test(src))
  ok('redirige a la version en mayusculas', /permanentRedirect\(`\/work\/\$\{[^}]+\.toUpperCase\(\)\}`\)/.test(src))
  ok('la redireccion corre antes del componente', /redirectToCanonicalCase\(params\.tbtId\)[\s\S]{0,200}<WorkClient/.test(src))
}

// ---- ningun fixture usa el formato largo
{
  const LONG_FORM = /TBT-\d{4}-[A-Z0-9]{6}/g
  const skipDirs = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'Documentos'])
  const skipFiles = new Set(['tbt-id-check.ts'])
  const long: string[] = []

  function walk(dir: string) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue
      const rel = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(rel)
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        if (skipFiles.has(entry.name)) continue
        const body = readFileSync(join(root, rel), 'utf8')
        if (LONG_FORM.test(body)) long.push(rel)
      }
    }
  }
  walk('src')
  walk('scripts')

  ok('ningun archivo bajo src o scripts escribe el formato largo', long.length === 0, `todavia lo escriben: ${long.join(', ')}`)
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
