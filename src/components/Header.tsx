'use client'

import { useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { MenuIcon, HeartIcon, ConnectToggle, TbtLogo, NotificationIcon } from '@/components/Brand'

/**
 * Header del shell (Build Spec 01, ÍTEM 1):
 *   Menu · logo TBT · Notificaciones · Heart · toggle de conexión
 *
 * El icono de notificaciones abre el panel de soporte (Spec 04 §5.1) y lleva
 * tres estados: apagado sin sesión, sólido y en calma con sesión, y a color
 * con parpadeo y punto magenta cuando hay algo sin leer.
 *
 * El toggle maneja la autenticación (Master Handoff §7):
 *   desconectado + tap → abre el modal de auth
 *   conectado    + tap → cierra sesión
 *
 * Desconectado el toggle va en gris (#C4C8CC, track y knob); conectado pasa a
 * tinta y el knob se desplaza. El color lo hereda el SVG vía `currentColor`.
 */
export function Header({
  connected = false,
  onToggle,
  onMenu,
  unread = 0,
  onNotifications,
}: {
  connected?: boolean
  onToggle?: () => void
  onMenu?: () => void
  unread?: number
  onNotifications?: () => void
}) {
  const [favorited, setFavorited] = useState(false)
  const { t } = useLocale()

  return (
    <header className="sticky top-0 z-40 h-header bg-paper border-b border-hairline flex items-center gap-[14px] px-4">
      <button
        type="button"
        onClick={onMenu}
        aria-label={t.header.menu}
        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-ink hover:bg-paper-warm transition-colors"
      >
        <MenuIcon />
      </button>

      <a href="/" aria-label="tbt.cafe" className="flex items-center mr-auto">
        <TbtLogo className="block h-[34px] w-auto" />
      </a>

      <button
        type="button"
        onClick={onNotifications}
        aria-label={t.feed.tab}
        className={`relative w-9 h-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-paper-warm transition-colors ${
          !connected ? '' : unread > 0 ? 'notif-active' : 'notif-authed'
        }`}
      >
        <NotificationIcon />
        {connected && unread > 0 && (
          <span className="absolute top-[5px] right-[5px] w-2 h-2 rounded-full bg-t-magenta border-2 border-paper" />
        )}
      </button>

      <button
        type="button"
        onClick={() => setFavorited((v) => !v)}
        aria-label={t.header.favorites}
        aria-pressed={favorited}
        className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-paper-warm transition-colors ${
          favorited ? 'text-t-magenta' : 'text-ink'
        }`}
      >
        <HeartIcon />
      </button>

      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={connected}
        aria-label={connected ? t.header.signOut : t.header.signIn}
        className={`shrink-0 p-1 flex items-center justify-center transition-colors ${
          connected ? 'text-ink' : 'text-[#C4C8CC]'
        }`}
      >
        <ConnectToggle connected={connected} />
      </button>
    </header>
  )
}
