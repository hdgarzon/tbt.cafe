import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * El anillo de foco cede donde el componente ya trae el suyo.
 *
 * Gating Spec 01, ítem 1. Un clic en el buscador dibujaba un anillo cian que
 * el prototipo no tiene. La causa no son capas nativas —Tailwind 3 no las
 * emite— sino ORDEN: `.outline-none` y `:focus-visible` empatan en (0,1,0), y
 * la regla vivía suelta mucho después de `@tailwind utilities`.
 *
 * Metida en `@layer base`, Tailwind la emite antes de las utilidades y el
 * empate lo gana `.outline-none`. Es una propiedad invisible: nada falla al
 * compilar si alguien la saca de la capa, y el anillo vuelve en los 52 campos
 * a la vez. De ahí esta prueba.
 */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const raw = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/*
 * Sin comentarios, y sobre el SELECTOR, no sobre la palabra.
 *
 * La primera versión de esta prueba buscaba `:focus-visible` a secas y la
 * cazó el comentario de arriba que explica por qué la regla está donde está.
 * Es la trampa anotada en CLAUDE.md: se afirma sobre la construcción.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
const RULE = /:focus-visible\s*\{/

/** Recorre las llaves y devuelve el bloque `@layer <name>` completo. */
function layerBody(name: string): string {
  const start = css.indexOf(`@layer ${name} {`)
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  return ''
}

const base = layerBody('base')

{
  ok('existe la capa base', base.length > 0)
  ok('el anillo de foco vive dentro de ella', RULE.test(base),
     'fuera de la capa gana el empate y se dibuja sobre los 52 campos con outline-none')
  ok('y sigue siendo cian', base.includes('outline: 2px solid var(--t-cyan)'))
}

{
  // Cualquier `:focus-visible` que quede fuera de una capa reabre el fallo.
  const suelto = RULE.test(css.replace(base, ''))
  ok('no queda ninguna regla de foco suelta', !suelto,
     'una sola basta para volver a ganar el empate')
}

{
  const utilities = css.indexOf('@tailwind utilities')
  ok('las utilidades se declaran antes', utilities >= 0 && utilities < css.indexOf('@layer base'),
     'es el orden que hace que el empate lo decida la capa y no la línea')
}

{
  // El marcador de exclusión ya existía: no hace falta inventar otro.
  const page = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')
  ok('el buscador cede por llevar outline-none', page.includes('outline-none'),
     'es el marcador que dice «este campo ya tiene su propio foco»')
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
