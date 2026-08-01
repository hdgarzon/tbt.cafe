'use client'

import { useState, type ReactNode } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'

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
          <button type="button" onClick={onBack} className="flex items-center gap-[5px] py-0.5 text-[11px] font-medium tracking-[0.14em] uppercase text-ink-soft hover:text-ink transition-colors">
            <span className="text-[16px] leading-none">‹</span>
            {backLabel}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center rounded-full border border-hairline text-[15px] leading-none text-ink hover:bg-paper-warm hover:border-ink transition-colors"
        >
          ✕
        </button>
      </div>

      {progressPct != null && (
        <div className="h-[3px] bg-hairline mx-4 rounded-full overflow-hidden shrink-0">
          <div className="h-full bg-t-magenta transition-[width] duration-300 ease-out" style={{ width: `${progressPct}%` }} />
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

/**
 * Título de paso con su etiqueta de obligatoriedad — titleReq()/titleOpt() del
 * prototipo: el display serif a la izquierda y "✦ Required" (o "(optional)")
 * alineado a la línea base, a la derecha.
 */
export function BrewTitle({ children, required, optional }: { children: ReactNode; required?: boolean; optional?: string }) {
  const { t } = useLocale()
  return (
    <div className="flex items-baseline justify-between gap-2.5 pr-1">
      <div className="font-display font-medium text-[27px] leading-[1.08] text-ink">{children}</div>
      {required && (
        <span className="inline-flex items-center gap-[5px] mr-0.5 text-[10px] font-medium tracking-[0.14em] uppercase text-ink-soft whitespace-nowrap">
          <span className="text-t-magenta text-[12px]">✦</span>
          {t.brew.required}
        </span>
      )}
      {optional && <span className="text-[11px] text-placeholder whitespace-nowrap">{optional}</span>}
    </div>
  )
}

/**
 * Ícono ⓘ que despliega una nota (cb-info + cb-tip del prototipo). El texto
 * vive donde se usa, así que la nota se muestra debajo del bloque contenedor.
 */
export function BrewInfo({ tip }: { tip: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center justify-center w-[15px] h-[15px] ml-[5px] align-[1px] rounded-full border border-placeholder text-ink-soft font-serif italic text-[9px] leading-none hover:border-ink hover:text-ink transition-colors"
      >
        i
      </button>
      {open && (
        <span className="block normal-case tracking-normal font-normal mt-2 rounded-[10px] border border-hairline bg-paper-warm px-3 py-2.5 text-[11px] leading-[1.5] text-ink-soft">
          {tip}
        </span>
      )}
    </>
  )
}

export function BrewLabel({
  children,
  required,
  info,
}: {
  children: ReactNode
  required?: boolean
  /** Nota opcional desplegable con el ícono ⓘ, como en el prototipo. */
  info?: string
}) {
  return (
    <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft">
      {children}
      {required && <span className="text-t-magenta ml-1">✦</span>}
      {info && <BrewInfo tip={info} />}
    </label>
  )
}

export function BrewInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return (
    <input
      {...rest}
      className={`w-full p-3.5 border border-hairline rounded-xl text-[15px] outline-none focus:border-ink transition-colors placeholder:text-placeholder ${className ?? ''}`}
    />
  )
}

export function BrewSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props
  return (
    <select
      {...rest}
      className={`w-full p-3.5 pr-9 border border-hairline rounded-xl text-[15px] outline-none focus:border-ink transition-colors bg-white appearance-none cursor-pointer bg-[length:12px_8px] bg-no-repeat bg-[right_14px_center] bg-[image:var(--cb-caret)] ${className ?? ''}`}
    >
      {children}
    </select>
  )
}
