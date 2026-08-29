import { readFileSync } from 'fs'
import { join } from 'path'

/** El retorno del checkout tiene que existir. Guarda de regresión. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const route = read('src/app/api/stripe/create-checkout/route.ts')

// ---- la causa
{
  // `origin` a secas es un global del navegador. En Node lanza ReferenceError,
  // el catch de al lado lo vuelve `false`, y ninguna url del llamante se honra.
  ok('no compara contra el global inexistente', !/[^.\w]origin\s*&&/.test(route))
  ok('compara contra el origen de la app', route.includes('appOrigin'))

  // Sin `@ts-expect-error`: TypeScript ACEPTA `origin`, porque el tsconfig
  // incluye la libreria "dom" que lo declara. Que compile y no exista es
  // exactamente como el fallo llego a produccion.
  let threw = false
  try {
    void origin
  } catch {
    threw = true
  }
  ok('compila, y aun asi en este runtime `origin` no existe', threw)
}

// ---- el respaldo
{
  // Sobre la INTERPOLACION, no sobre el texto: el comentario del arreglo
  // nombra esa ruta justamente para explicar por que ya no se usa.
  ok('ningún respaldo apunta a la ruta inexistente', !route.includes('}/payment/'))
  ok('una registración vuelve a /brew', route.includes('/brew?workId='))
}

// ---- la cabecera del llamante no decide a dónde vuelve Stripe
{
  ok(
    'no se fía de la cabecera Origin',
    !/headers\.get\(['"]origin['"]\)/i.test(route),
    'la elige quien llama: aceptarla dejaría redirigir Stripe a otro sitio'
  )
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
