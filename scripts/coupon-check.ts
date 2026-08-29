import { readFileSync } from 'fs'
import { join } from 'path'
import { describePromotionCode, type PromotionCodeLike } from '../src/lib/coupons'

/** El cupón sale de Stripe y de ningún otro sitio. Prueba primero. */

let bad = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (!cond) bad++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail && !cond ? ` — ${detail}` : ''}`)
}

type CouponShape = NonNullable<PromotionCodeLike['coupon']>

const promo = (
  over: Partial<PromotionCodeLike> = {},
  coupon: Partial<CouponShape> = {}
): PromotionCodeLike => ({
  code: 'CAFE20',
  active: true,
  coupon: { valid: true, percent_off: 20, amount_off: null, ...coupon },
  ...over,
})
// El punto y coma no sobra: sin el, el bloque de abajo se lee como el cuerpo
// de una flecha y `({ ... })` pasa a ser una lista de parametros.
;

// ---- traducción del descuento
{
  const d = describePromotionCode(promo())
  ok('porcentaje: tipo y valor', d?.type === 'percentage' && d.value === 20)

  const f = describePromotionCode(promo({}, { percent_off: null, amount_off: 300 }))
  ok('importe fijo: centavos a dólares', f?.type === 'fixed' && f.value === 3)

  const c = describePromotionCode(promo({}, { percent_off: null, amount_off: 850 }))
  ok('importe fijo con centavos sueltos', c?.value === 8.5)

  const full = describePromotionCode(promo({}, { percent_off: 100 }))
  ok('el 100% se describe como 100', full?.type === 'percentage' && full.value === 100)
}

// ---- el código que vuelve es el de Stripe, no el que se tecleó
{
  const d = describePromotionCode(promo({ code: 'CAFE20' }))
  ok('devuelve el código tal como lo guarda Stripe', d?.code === 'CAFE20')
}

// ---- lo que no se puede cobrar, no se puede anunciar
{
  ok('promoción desactivada', describePromotionCode(promo({ active: false })) === null)
  ok('cupón agotado o vencido', describePromotionCode(promo({}, { valid: false })) === null)
  ok('promoción sin cupón', describePromotionCode(promo({ coupon: null })) === null)
  ok('sin descuento de ninguna clase', describePromotionCode(promo({}, { percent_off: null, amount_off: null })) === null)
  ok('nada que describir', describePromotionCode(null) === null && describePromotionCode(undefined) === null)
}

// ---- un descuento de cero no es un descuento
{
  ok('0% no se anuncia', describePromotionCode(promo({}, { percent_off: 0 })) === null)
  ok('$0 no se anuncia', describePromotionCode(promo({}, { percent_off: null, amount_off: 0 })) === null)
}

// ---- LA GUARDA: una sola lista de cupones
{
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  const route = read('src/app/api/validate-coupon/route.ts')
  const lib = read('src/lib/coupons.ts')

  ok('la ruta no consulta la hoja', !route.includes("from '@/lib/google-sheets'"))
  ok('la ruta resuelve contra Stripe', route.includes('promotionCodes.list'))
  ok('la ruta expande el cupón', route.includes("expand: ['data.promotion.coupon']"))
  ok('el módulo no habla con Google', !lib.includes("from 'googleapis'"))

  const pkg = JSON.parse(read('package.json'))
  ok('googleapis ya no es dependencia', !('googleapis' in (pkg.dependencies ?? {})))
}

console.log(bad === 0 ? '\ntodo en orden' : `\n${bad} fallo(s)`)
process.exit(bad === 0 ? 0 : 1)
