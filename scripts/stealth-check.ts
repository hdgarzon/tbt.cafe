import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Fuera de los buscadores mientras dure el modo sigiloso — Update Package 01, N1.
 *
 * Nada en el repositorio lo impedía: sin `robots.txt` ni `noindex`, cualquier
 * página de obra podía acabar indexada antes del lanzamiento.
 *
 * Esta guarda sostiene las dos piezas y que ninguna página las deshaga:
 *  - `/robots.txt` no deja pasar a ningún rastreador;
 *  - el layout raíz marca todo `noindex, nofollow`, que es lo que respeta un
 *    buscador que llega por un enlace y no por el robots.txt;
 *  - ninguna página o layout declara su propio `robots`, que sustituiría al raíz.
 *
 * Quitar las dos es un punto de la lista de lanzamiento, no un despliegue.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

function walk(dir: string, out: string[]): string[] {
  const entries = readdirSync(join(root, dir), { withFileTypes: true })
  for (let i = 0; i < entries.length; i++) {
    const rel = `${dir}/${entries[i].name}`
    if (entries[i].isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(entries[i].name)) out.push(rel)
  }
  return out
}

async function main() {
  // ---- /robots.txt
  const robotsPath = 'src/app/robots.ts'
  ok('existe src/app/robots.ts', existsSync(join(root, robotsPath)))
  if (existsSync(join(root, robotsPath))) {
    const mod = await import('../src/app/robots')
    const result = mod.default()
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
    const all = rules.filter((r) => r.userAgent === '*' || (Array.isArray(r.userAgent) && r.userAgent.indexOf('*') > -1))
    const disallow = all.length ? all[0].disallow : undefined
    ok('una regla para todos los rastreadores', all.length === 1)
    ok('que no deja pasar nada', disallow === '/' || (Array.isArray(disallow) && disallow.indexOf('/') > -1))
    ok('sin excepciones permitidas', all.length === 1 && !all[0].allow)
    ok('sin sitemap que anunciar', !result.sitemap)
  }

  // ---- noindex en el layout raíz
  const layout = code(read('src/app/layout.tsx'))
  ok('el layout raíz marca noindex, nofollow', /robots: \{ index: false, follow: false \}/.test(layout))

  // ---- ninguna página lo deshace
  const files = walk('src/app', [])
  const overriding: string[] = []
  for (let i = 0; i < files.length; i++) {
    if (files[i] === 'src/app/layout.tsx' || files[i] === robotsPath) continue
    if (/\brobots:/.test(code(read(files[i])))) overriding.push(files[i])
  }
  ok('ninguna otra página o layout declara robots', overriding.length === 0, overriding.join(', '))
}

main().then(() => {
  console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
  process.exit(bad === 0 ? 0 : 1)
})
