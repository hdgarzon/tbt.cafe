import { readFileSync } from 'fs'
import { join } from 'path'

/** Lo que se acuña en cadena no se inventa. Guarda de la cadena entera. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const ctx = read('src/app/api/generate-context/route.ts')
const complete = read('src/app/api/complete-tbt/route.ts')
const nft = read('src/lib/solana/nft.ts')

// ---- el origen: sin proveedor, no se fabrica una medicion
{
  // Sobre el RETURN, no sobre el texto: el comentario del arreglo cita el
  // valor viejo justamente para explicar por que ya no se devuelve.
  ok('no devuelve un clima inventado', !ctx.includes("return '20"))
  ok('no devuelve una frase en lugar de una medición', !ctx.includes("return 'Clima"))
  ok('sin clave, devuelve vacío', /if \(!apiKey\) return ''/.test(ctx))
}

// ---- el tramo intermedio: un vacío no se guarda como si fuera un dato
{
  ok(
    'complete-tbt omite el clima ausente',
    complete.includes('contextData.weather ? { conditions: contextData.weather } : null')
  )
}

// ---- el final: lo que no hay, no se acuña
{
  ok('el NFT solo lleva el atributo si hay clima', /if \(work\.creationWeather\)/.test(nft))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
