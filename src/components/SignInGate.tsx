'use client'

import { useShell } from '@/components/AppShell'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Una página cerrada que ofrece la manera de entrar.
 *
 * Gating Spec 01, ítems 3C y 6. Veintiuna pantallas —el historial entero, los
 * dos perfiles, las tres colecciones, los tres ajustes— escribían una frase y
 * paraban. La frase es correcta y ya está traducida a los cuatro idiomas; lo
 * que falta debajo es el botón.
 *
 * «Una frase sin acción es un callejón sin salida con una explicación.»
 *
 * El menú lateral ya lo hace bien: su estado cerrado dice «esto es tuyo en
 * cuanto entres, toca cualquiera para conectarte», y tocar lleva a
 * autenticación. Las páginas a las que lleva deberían comportarse igual en vez
 * de volver a plantear el problema.
 *
 * QUE HACE `onSignedIn`
 *
 * Estas páginas comprueban la sesión UNA VEZ al montar, dentro de un efecto.
 * Que `connected` cambie no las vuelve a cargar, así que sin esto la persona se
 * autentica y se queda mirando la misma frase. Se le pasa el cargador de la
 * página y `openAuth` lo vuelve a correr al terminar.
 */
export function SignInGate({
  message,
  onSignedIn,
  backHref = '/',
}: {
  /** La frase que la página ya tenía. No se cambia el texto, se le añade salida. */
  message: string
  /** El cargador de la página, para que al volver muestre lo que venía a ver. */
  onSignedIn?: () => void
  backHref?: string
}) {
  const { t } = useLocale()
  const { openAuth } = useShell()

  return (
    <div className="px-4 pt-6">
      <a href={backHref} className="back-link">
        ← {t.purchase.home}
      </a>

      <p className="text-[14px] mt-6">{message}</p>

      <button
        type="button"
        onClick={() => openAuth({ resume: onSignedIn })}
        className="mt-4 px-4 py-2.5 rounded-xl bg-ink text-paper text-[11px] font-semibold tracking-[0.14em] uppercase"
      >
        {t.header.signIn}
      </button>
    </div>
  )
}
