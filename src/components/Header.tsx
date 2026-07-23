'use client'

import { useState } from 'react'

/**
 * Header del shell (Build Spec 01, ÍTEM 1):
 *   Menu · logo TBT · Heart · toggle de conexión
 *
 * El toggle maneja la autenticación:
 *   desconectado + tap → abre el modal de auth
 *   conectado    + tap → cierra sesión
 * Por defecto arranca desconectado (gris / a la izquierda).
 */
export function Header({
  connected = false,
  onToggle,
  onMenu,
}: {
  connected?: boolean
  onToggle?: () => void
  onMenu?: () => void
}) {
  const [favorited, setFavorited] = useState(false)

  return (
    <header className="h-header flex items-center justify-between px-5 border-b border-hairline">
      {/* Menú */}
      <button
        type="button"
        onClick={onMenu}
        aria-label="Menu"
        className="w-8 h-8 -ml-1 flex flex-col items-center justify-center gap-[5px]"
      >
        <span className="block w-[18px] h-px bg-ink" />
        <span className="block w-[18px] h-px bg-ink" />
      </button>

      {/* Logo */}
      <span className="font-display text-[22px] leading-none tracking-tight select-none">
        tbt
        <span className="text-t-magenta">.</span>
        cafe
      </span>

      <div className="flex items-center gap-3">
        {/* Heart */}
        <button
          type="button"
          onClick={() => setFavorited((v) => !v)}
          aria-label="Favorites"
          aria-pressed={favorited}
          className="w-8 h-8 flex items-center justify-center"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill={favorited ? 'var(--t-magenta)' : 'none'}
            stroke={favorited ? 'var(--t-magenta)' : 'var(--ink)'}
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
          </svg>
        </button>

        {/* Toggle de conexión */}
        <button
          type="button"
          onClick={onToggle}
          role="switch"
          aria-checked={connected}
          aria-label={connected ? 'Sign out' : 'Sign in'}
          className={`relative w-[42px] h-[24px] rounded-full transition-colors duration-200 ${
            connected ? 'bg-ink' : 'bg-hairline'
          }`}
        >
          <span
            className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-paper shadow-sm transition-[left] duration-200 ${
              connected ? 'left-[21px]' : 'left-[3px]'
            }`}
          />
        </button>
      </div>
    </header>
  )
}
