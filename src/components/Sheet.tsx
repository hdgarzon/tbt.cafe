'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { CloseIcon } from '@/components/Brand'

/**
 * Sheet inferior compartido — portado VERBATIM del prototipo (.auth-scrim /
 * .auth-sheet). Los cinco modales del sistema (auth, recovery email, private
 * code, biometric enroll, biometric sign-in) son instancias de este mismo
 * patrón visual: velo con fade, panel que sube desde abajo con esquinas
 * redondeadas arriba, agarradera, kicker + título display, botón de cierre.
 *
 * `open` monta el sheet CERRADO y lo anima al estado abierto en el siguiente
 * frame — si se monta ya abierto, la transición de transform nunca se ve.
 */
export function Sheet({
  open,
  onClose,
  kicker,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  kicker: string
  title: string
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      const raf = requestAnimationFrame(() => setEntered(true))
      return () => cancelAnimationFrame(raf)
    }
    setEntered(false)
    const timeout = setTimeout(() => setMounted(false), 340)
    return () => clearTimeout(timeout)
  }, [open])

  if (!mounted) return null

  return (
    <div
      className={`absolute inset-0 z-[70] transition-opacity duration-[260ms] ease-out ${
        entered ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{ backgroundColor: 'rgba(20,20,20,0.32)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute left-0 right-0 bottom-0 mx-auto w-full max-w-col bg-paper rounded-t-[18px] px-[22px] pt-2 pb-[30px] max-h-[92vh] overflow-y-auto transition-transform duration-[340ms] ease-[cubic-bezier(.4,0,.15,1)] ${
          entered ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ boxShadow: '0 -18px 50px rgba(0,0,0,0.14)' }}
      >
        <div className="w-[38px] h-1 rounded-full bg-hairline mx-auto mt-2 mb-[18px]" />

        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-soft">
              {kicker}
            </div>
            <h2 className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-1.5">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center rounded-lg text-ink-soft hover:bg-paper-warm hover:text-ink transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mt-[22px]">{children}</div>
      </div>
    </div>
  )
}

/** Paso de éxito compartido — check circular verde + título + sub + botón. */
export function SheetSuccess({
  title,
  sub,
  buttonLabel,
  onDone,
}: {
  title: string
  sub: string
  buttonLabel: string
  onDone: () => void
}) {
  return (
    <div className="text-center pt-3.5 pb-1.5">
      <div className="w-14 h-14 mx-auto mb-5 rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center">
        <svg
          width="26"
          height="26"
          viewBox="0 0 26 26"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 13.5l5 5L21 7.5" />
        </svg>
      </div>
      <h3 className="font-display font-medium text-[26px] leading-[1.08] text-ink">{title}</h3>
      <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft mt-3">{sub}</p>
      <button
        type="button"
        onClick={onDone}
        className="w-full mt-[22px] py-4 text-[12px] tracking-[0.16em] uppercase bg-ink text-paper rounded-xl hover:bg-black transition-colors"
      >
        {buttonLabel}
      </button>
    </div>
  )
}

/** Botón primario de sheet — ink lleno, deshabilitado a opacidad .32. */
export function SheetButton({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="w-full mt-[22px] py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-[opacity,background] disabled:opacity-[.32] disabled:cursor-not-allowed enabled:hover:bg-black"
    >
      {children}
    </button>
  )
}

/** Etiqueta de campo — versalitas, como .field-label del prototipo. */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft"
    >
      {children}
    </label>
  )
}
