'use client'

import type { ReactNode } from 'react'

/**
 * Envoltorio compartido del wizard de Cold Brew (prototipo: chrome()/top()).
 * El prototipo lo monta como sheet flotante sobre la página que estaba
 * abierta; aquí es su propia ruta (/brew), así que el "grip" superior es
 * decorativo y el back/close navegan de verdad en vez de cerrar un overlay.
 */
export function BrewChrome({
  onBack,
  backLabel,
  onClose,
  progressPct,
  dock,
  children,
}: {
  onBack?: () => void
  backLabel?: string
  onClose: () => void
  /** 0-100, o undefined para ocultar la barra (gate/chooser). */
  progressPct?: number
  dock?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col min-h-[calc(100vh-var(--header-h)-var(--footer-h))]">
      <div className="w-9 h-1 rounded-full bg-hairline mx-auto mt-2 mb-1 shrink-0" />

      <div className="flex items-center justify-between px-4 py-2 shrink-0">
        {onBack ? (
          <button type="button" onClick={onBack} className="flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink transition-colors -ml-1 px-1 py-1">
            <span className="text-[17px] leading-none">‹</span>
            {backLabel}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-soft hover:bg-paper-warm hover:text-ink transition-colors"
        >
          ✕
        </button>
      </div>

      {progressPct != null && (
        <div className="h-[3px] bg-hairline mx-4 rounded-full overflow-hidden shrink-0">
          <div className="h-full bg-ink transition-[width] duration-300 ease-out" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      <div className="flex-1 px-4 pt-4 pb-6">{children}</div>

      {dock && <div className="sticky bottom-0 bg-paper border-t border-hairline px-4 py-3 shrink-0">{dock}</div>}
    </div>
  )
}

export function BrewButton({
  children,
  onClick,
  disabled,
  ghost,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  ghost?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        ghost
          ? 'w-full py-4 text-[12px] font-semibold tracking-[0.16em] uppercase border border-hairline text-ink rounded-xl transition-colors disabled:opacity-60 enabled:hover:border-ink'
          : 'w-full py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-opacity disabled:opacity-60 disabled:cursor-not-allowed enabled:hover:bg-black'
      }
    >
      {children}
    </button>
  )
}

export function BrewLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft">
      {children}
      {required && <span className="text-t-magenta ml-1">✦</span>}
    </label>
  )
}

export function BrewInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return (
    <input
      {...rest}
      className={`w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors placeholder:text-placeholder ${className ?? ''}`}
    />
  )
}

export function BrewSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props
  return (
    <select
      {...rest}
      className={`w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors bg-paper appearance-none cursor-pointer ${className ?? ''}`}
    >
      {children}
    </select>
  )
}
