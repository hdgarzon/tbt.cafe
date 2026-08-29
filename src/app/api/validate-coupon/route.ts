import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { describePromotionCode } from '@/lib/coupons'
import { isProduction, assertServerEnv } from '@/lib/app-env'
import { authenticate } from '@/lib/route-auth'


export async function POST(request: NextRequest) {

  try {
    /**
     * El despliegue tiene que estar completo antes de tocar dinero.
     *
     * En el backend esto lo garantizaba un `throw` al importar `app-env`, que
     * tumbaba el build entero cuando faltaba una variable. Aqui la comprobacion
     * es explicita y vive DENTRO del try: falla esta ruta, con la lista exacta
     * de lo que falta y en la forma de error que la ruta ya devuelve, y el
     * resto del despliegue sigue en pie.
     */
    assertServerEnv()

    /**
     * Con sesion, porque ahora esto pregunta por promociones reales.
     *
     * Abierta, la ruta deja probar codigos uno a uno contra la cuenta de
     * Stripe hasta dar con uno que exista. El creador ya tiene sesion cuando
     * llega al pago —el borrador es suyo—, asi que exigirla no cierra ningun
     * camino legitimo.
     */
    const auth = await authenticate(request)
    if (!auth.ok) {
      return NextResponse.json(auth.body, { status: auth.status })
    }

    const { code } = await request.json()

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    const normalized = code.trim().toUpperCase()

    /**
     * El unico codigo que certifica sin pasar por Stripe, y solo fuera de
     * produccion. `complete-tbt` repite esta misma condicion del lado del
     * servidor, que es quien de verdad la hace cumplir: lo que se responda
     * aqui no basta para saltarse el cobro.
     */
    if (!isProduction && normalized === 'TBT') {
      return NextResponse.json({
        valid: true,
        code: 'TBT',
        type: 'percentage',
        value: 100,
        bypass: true,
      })
    }

    /**
     * `expand` no es opcional: sin el, el cupon llega como identificador y no
     * hay descuento que leer, asi que todos los codigos saldrian invalidos.
     */
    const found = await stripe.promotionCodes.list({
      code: normalized,
      active: true,
      limit: 1,
      expand: ['data.promotion.coupon'],
    })

    const promo = found.data[0]
    const coupon = promo && typeof promo.promotion.coupon === 'object' ? promo.promotion.coupon : null
    const discount = describePromotionCode(
      promo ? { code: promo.code, active: promo.active, coupon } : null
    )

    if (!discount) {
      return NextResponse.json({ valid: false, error: 'invalid_coupon' }, { status: 400 })
    }

    return NextResponse.json({ valid: true, ...discount })

  } catch (error) {
    /**
     * El detalle va al log, no a la respuesta. Devolver el mensaje de la
     * excepcion tal cual publicaba el error interno de un proveedor de pagos.
     */
    console.error('[validate-coupon] no se pudo validar el cupon:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
