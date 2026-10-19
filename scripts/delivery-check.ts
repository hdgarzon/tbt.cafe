import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Entrega fisica, los cimientos — Work Order 02, Amendment Delivery 01 (decision 94).
 *
 * tbt.cafe responde por la venta y el TBT, nunca por la obra fisica. En la via
 * de plataforma, cuando el comprador pidio que se la entreguen, la ganancia de
 * la venta no se puede cobrar hasta que el vendedor de los datos de entrega. En
 * la via directa no se retiene nada.
 *
 * Esta guarda sostiene la parte que no tiene pantalla:
 *  - el plazo es un valor de configuracion del operador, sin valor por defecto;
 *  - la obra declara si es fisica o digital;
 *  - la entrega de cada venta vive en su propia tabla, que solo escribe el
 *    servidor y solo leen comprador y vendedor: si viviera en `transfers`, el
 *    vendedor podria cambiar "entregamelo" por "lo recojo" y soltar su cobro;
 *  - una ganancia de venta con entrega pedida nace retenida, y la base se niega
 *    a liberarla mientras lo este; las dos rutas que liberan la saltan;
 *  - una regalia nunca se retiene por esto;
 *  - el reconocimiento se registra por tipo, en la misma tabla que los Terms;
 *  - las tres promesas viven en codigo, nunca en configuracion.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const readIf = (p: string) => (existsSync(join(root, p)) ? read(p) : '')
const sql = (s: string) => s.replace(/--.*$/gm, '')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const migName = readdirSync(join(root, 'supabase/migrations')).filter((f) => /_delivery_foundation\.sql$/.test(f))[0]
ok('existe la migracion de los cimientos de entrega', !!migName)
const m = migName ? sql(read(`supabase/migrations/${migName}`)) : ''

// ---- configuracion
{
  ok('platform_config.delivery_details_deadline, entero', /alter table public\.platform_config\s+add column if not exists delivery_details_deadline integer;/.test(m))
  ok('sin valor por defecto: lo fija Federico', !/delivery_details_deadline integer[^;]*default/.test(m))
  ok('vacio o positivo', /check \(delivery_details_deadline is null or delivery_details_deadline > 0\)/.test(m))
  ok('legible con la clave publica, como las demas reglas', /grant select \(delivery_details_deadline\) on public\.platform_config to anon, authenticated;/.test(m))

  const shape = code(read('src/lib/rules-shape.ts'))
  ok('autoridad de operador', /delivery_details_deadline: 'operator',/.test(shape))
  ok('el lector lo entrega como numero o null', /detailsDeadlineDays: row\.delivery_details_deadline == null \? null : num\(row, 'delivery_details_deadline'\)/.test(shape))
  ok('el tipo admite null', /delivery: \{ detailsDeadlineDays: number \| null \}/.test(shape))

  const cfg = code(read('src/app/api/admin/config/route.ts'))
  ok('el panel puede dejarlo vacio', /column === 'delivery_details_deadline'[\s\S]{0,200}value === null[\s\S]{0,40}\{ ok: true, value: null \}/.test(cfg))
  ok('y solo acepta enteros positivos', /column === 'delivery_details_deadline'[\s\S]{0,400}Number\.isInteger\(n\) && n > 0/.test(cfg))
}

// ---- la obra
{
  ok('works.work_kind', /alter table public\.works\s+add column if not exists work_kind text;/.test(m))
  ok('fisica o digital', /check \(work_kind is null or work_kind in \('physical', 'digital'\)\)/.test(m))
}

// ---- la entrega de cada venta
{
  ok('existe sale_deliveries, una fila por venta', /create table if not exists public\.sale_deliveries \(\s*transfer_id uuid primary key references public\.transfers \(id\)/.test(m))
  ok('la eleccion es una de cuatro', /choice text not null check \(choice in \('deliver', 'collect', 'none', 'digital'\)\)/.test(m))
  ok('una obra digital nunca pide direccion', /check \(\(work_kind = 'digital'\) = \(choice = 'digital'\)\)/.test(m))
  ok('entregamelo exige direccion y consentimiento', /check \(choice <> 'deliver' or \(address is not null and address_consent_at is not null\)\)/.test(m))
  ok('y la direccion solo existe con esa eleccion', /check \(choice = 'deliver' or \(address is null and address_consent_at is null\)\)/.test(m))
  ok('los datos de entrega llegan con su hora', /check \(\(details is null\) = \(details_submitted_at is null\)\)/.test(m))
  ok('con RLS', /alter table public\.sale_deliveries enable row level security;/.test(m))
  ok('la leen comprador y vendedor de esa venta', /create policy "[^"]+" on public\.sale_deliveries\s+for select using \(\(select auth\.uid\(\)\) in \(buyer_id, seller_id\)\);/.test(m))
  ok('ninguna politica deja escribir al cliente', !/on public\.sale_deliveries\s+for (insert|update|delete|all)/i.test(m))
  ok('y el cliente no tiene permiso de escritura', /revoke insert, update, delete on public\.sale_deliveries from anon, authenticated;/.test(m))
  ok('nadie la lee sin sesion', /revoke select on public\.sale_deliveries from anon;/.test(m))
}

// ---- la retencion
{
  ok('payout_earnings.awaiting_delivery_details', /alter table public\.payout_earnings\s+add column if not exists awaiting_delivery_details boolean not null default false;/.test(m))

  const hold = m.slice(m.indexOf('function public.hold_sale_earning_for_delivery'), m.indexOf('$$;', m.indexOf('function public.hold_sale_earning_for_delivery')))
  ok('una ganancia de venta con entrega pedida nace retenida', /new\.source = 'sale'[\s\S]{0,200}d\.choice = 'deliver' and d\.details_submitted_at is null[\s\S]{0,120}new\.awaiting_delivery_details := true/.test(hold))
  ok('una regalia nunca', /new\.source = 'sale'/.test(hold) && !/'royalty'/.test(hold))
  ok('al insertarse', /create trigger payout_earnings_hold_for_delivery\s+before insert on public\.payout_earnings/.test(m))

  const refuse = m.slice(m.indexOf('function public.refuse_release_awaiting_delivery'), m.indexOf('$$;', m.indexOf('function public.refuse_release_awaiting_delivery')))
  ok('la base se niega a liberarla mientras espera', /new\.state = 'available' and old\.state is distinct from 'available' and new\.awaiting_delivery_details[\s\S]{0,80}raise exception/.test(refuse))
  ok('en cada cambio de estado', /create trigger payout_earnings_refuse_release_awaiting\s+before update of state on public\.payout_earnings/.test(m))

  ok('la funcion de Cobros la salta', /create or replace function public\.release_my_due_payout_earnings\(\)[\s\S]*?and releases_at <= now\(\)\s*and not awaiting_delivery_details;/.test(m))
  ok('y conserva sus permisos', /revoke all on function public\.release_my_due_payout_earnings\(\) from public, anon;\s*grant execute on function public\.release_my_due_payout_earnings\(\) to authenticated;/.test(m))

  const sweep = code(read('src/lib/payout-release.ts'))
  ok('el barrido la salta', /\.update\(\{ state: 'available'[^}]*\}\)\s*\.eq\('state', 'pending'\)\s*\.eq\('awaiting_delivery_details', false\)/.test(sweep))
}

// ---- el reconocimiento, una vez por tipo
{
  ok('terms_acceptances.kind', /alter table public\.terms_acceptances\s+add column if not exists kind text not null default 'terms';/.test(m))
  ok('terms, comprador o vendedor', /check \(kind in \('terms', 'buyer_delivery', 'seller_delivery'\)\)/.test(m))
}

// ---- las promesas, en codigo
{
  const p = code(readIf('src/lib/promises.ts'))
  ok('existe src/lib/promises.ts', p.length > 0)
  ok('la obra fisica es del vendedor', /physicalWorkIsTheSellers:/.test(p))
  ok('la retencion por entrega solo en la via de plataforma', /deliveryHoldPlatformPathOnly:/.test(p))
  ok('los terminos se aceptan una vez', /termsAcceptedOnce:/.test(p))
  ok('congeladas', /Object\.freeze\(/.test(p))
  const authority = code(read('src/lib/rules-shape.ts'))
  ok('ninguna es configurable', !/physical_work|delivery_hold|terms_once/.test(authority))
}

// ---- el snapshot
{
  const snap = read('supabase/schema-snapshot.sql')
  ok('el snapshot tiene sale_deliveries', snap.includes('create table if not exists public.sale_deliveries ('))
  ok('y las columnas nuevas', snap.includes('awaiting_delivery_details boolean default false not null') && snap.includes('work_kind text') && snap.includes('delivery_details_deadline integer'))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
