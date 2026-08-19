'use client'

/**
 * Checkout embebido — Backend Spec 01 §3.1.
 *
 * El cliente no sale de tbt.cafe. Los datos de la tarjeta se escriben dentro
 * del iframe de Stripe: nunca tocan nuestros servidores ni los puede leer
 * nuestro JavaScript, así que la validación PCI sigue siendo la más simple.
 *
 * Dos cosas que el redirect no tenía que resolver y aquí sí:
 *
 *  - Los estados de error (rechazo, fondos insuficientes, tarjeta vencida) se
 *    pintan en nuestra UI. Antes los mostraba la página de Stripe.
 *  - El 3D Secure ocurre dentro del iframe; Stripe lo resuelve antes de
 *    redirigir a `return_url`. Un checkout embebido que no lo contemple deja
 *    fallar en silencio las tarjetas que lo exigen — es el error de integración
 *    más común, y por eso el retorno se maneja por `return_url` y no por un
 *    callback nuestro.
 *
 * El sello "Secured by Stripe" se mantiene, como pide el spec.
 *
 * La LÍNEA DE RECAP (§1A, paso 1) va encima del formulario: qué, para quién y
 * cuánto, en un renglón. Es la única parte del patrón de pago que nos toca —
 * el selector de Apple Pay / Google Pay / tarjeta lo dibuja Stripe dentro del
 * iframe, y lo hace consciente del dispositivo, que es justo lo que pide la
 * nota de producción del spec: nunca un Apple Pay gris en Android.
 *
 * El importe que se muestra aquí tiene que ser el MISMO que se cobra (§1A.1).
 * Por eso llega ya resuelto desde quien crea la sesión, en vez de recalcularse
 * en la pantalla: derivarlo dos veces es exactamente cómo nació el bug que el
 * spec deja registrado.
 */
import { useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import { useLocale } from '@/i18n/LocaleProvider'

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

/** Una sola instancia por carga de página: loadStripe no debe llamarse en cada render. */
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

export type PaymentRecap = {
  /** Qué se está pagando: el título de la obra, o el concepto. */
  what: string
  /** Para quién queda. Se omite cuando no aplica, como en un registro. */
  forWhom?: string
  /** Cuánto, ya formateado y ya resuelto — no se recalcula aquí. */
  amount: string
}

export function EmbeddedCheckoutSheet({
  clientSecret,
  onClose,
  recap,
}: {
  clientSecret: string
  onClose: () => void
  recap?: PaymentRecap
}) {
  const { t } = useLocale()
  const options = useMemo(() => ({ clientSecret }), [clientSecret])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-paper">
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft hover:text-ink transition-colors"
        >
          ‹ {t.creator.back}
        </button>
        <span className="text-[10px] text-placeholder">{t.brew.securedByStripe}</span>
      </div>

      {recap && (
        <div className="shrink-0 px-4 pt-3">
          <div className="rounded-[10px] border border-hairline bg-paper-warm px-[13px] py-[11px] text-[11.5px] leading-[1.55] text-ink-soft">
            <span className="font-medium text-ink">{recap.what}</span>
            {recap.forWhom && (
              <>
                <span className="mx-1.5 text-placeholder">·</span>
                <span>
                  {t.recap.willBelongTo} {recap.forWhom}
                </span>
              </>
            )}
            <span className="mx-1.5 text-placeholder">·</span>
            <span className="font-medium text-ink whitespace-nowrap">{recap.amount}</span>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {stripePromise ? (
          <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        ) : (
          // Sin clave publicable no hay formulario que montar. Se dice, en vez
          // de dejar un panel en blanco.
          <p className="px-4 py-8 text-[12.5px] text-t-red text-center">{t.brew.errors.checkoutFailed}</p>
        )}
      </div>
    </div>
  )
}
