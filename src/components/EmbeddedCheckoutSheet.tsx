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
 */
import { useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import { useLocale } from '@/i18n/LocaleProvider'

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

/** Una sola instancia por carga de página: loadStripe no debe llamarse en cada render. */
const stripePromise = publishableKey ? loadStripe(publishableKey) : null

export function EmbeddedCheckoutSheet({
  clientSecret,
  onClose,
}: {
  clientSecret: string
  onClose: () => void
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
