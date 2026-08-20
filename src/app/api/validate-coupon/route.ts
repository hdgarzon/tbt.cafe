import { NextRequest, NextResponse } from 'next/server'
import { validateCouponCode } from '@/lib/google-sheets'
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

    const { code, workId } = await request.json()

    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    // Optional: Check if workId exists and belongs to user (security)
    // For now we just validate the code

    // TBT dev coupon — only active outside production
    if (!isProduction && code.trim().toUpperCase() === 'TBT') {
      return NextResponse.json({
        valid: true,
        code: 'TBT',
        type: 'percentage',
        value: 100,
        isActive: true,
      })
    }

    const result: any = await validateCouponCode(code)

    if (!result.valid) {
      return NextResponse.json({ valid: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      valid: true,
      code: result.code,
      type: result.type,
      value: result.value,
      isActive: result.isActive
    })

  } catch (error: any) {
    console.error('Error in validate-coupon:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
