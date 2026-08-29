'use client'

import { useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { FieldLabel } from '@/components/Sheet'
import { CaretIcon } from '@/components/Brand'

/**
 * Primitivas de formulario compartidas por los perfiles — portadas VERBATIM
 * del prototipo (.pf-input / .pf-select / .pf-textarea / .pf-save): bordeadas,
 * redondeadas, con fondo paper, no el estilo hairline-underline de otras
 * superficies del sistema. Esta es la estética específica de los formularios
 * largos (perfil de creador/coleccionista, notificaciones).
 *
 * Category/Save labels son idénticos entre creator y collector profiles en
 * los 4 diccionarios, así que estos componentes leen de t.profileCreator
 * directamente en vez de recibirlos por props — evita duplicar el hilo de
 * traducción en cada call site.
 */

type Liveness = 'idle' | 'checking' | 'live' | 'unreachable'

const inputBase =
  'w-full rounded-[11px] border outline-none bg-paper px-[13px] py-[13px] text-[15px] tracking-[0.01em] text-ink transition-colors'

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  urlDomain,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  /** Si se pasa, valida formato URL y que apunte a ese dominio (§14). */
  urlDomain?: string
  hint?: string
}) {
  const { t } = useLocale()
  const [touched, setTouched] = useState(false)
  const [liveness, setLiveness] = useState<Liveness>('idle')

  // Validación de URL: formato + dominio esperado (§14)
  let urlState: 'ok' | 'bad' | null = null
  if (urlDomain && value.trim()) {
    try {
      const u = new URL(value)
      urlState = u.hostname.includes(urlDomain) ? 'ok' : 'bad'
    } catch {
      urlState = 'bad'
    }
  }

  /**
   * Liveness (§14): "cannot be done in-browser — CORS blocks it. Seam:
   * checkUrlReachable(v) against a backend fetch endpoint." Solo se dispara
   * al perder foco con formato+dominio ya válidos, para no golpear la ruta
   * en cada tecla.
   */
  async function checkLiveness() {
    if (urlState !== 'ok') {
      setLiveness('idle')
      return
    }
    setLiveness('checking')
    try {
      const res = await fetch('/api/check-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      })
      const body = await res.json()
      setLiveness(body.reachable ? 'live' : 'unreachable')
    } catch {
      setLiveness('unreachable')
    }
  }

  const borderClass =
    urlState === 'ok'
      ? 'border-t-green'
      : urlState === 'bad' && touched
        ? 'border-t-red'
        : 'border-hairline focus:border-ink'

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={type}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setLiveness('idle')
        }}
        onBlur={() => {
          setTouched(true)
          if (urlDomain) checkLiveness()
        }}
        placeholder={placeholder}
        className={`${inputBase} ${borderClass}`}
      />
      {urlDomain && (
        <div className="min-h-[13px] mt-1.5 text-[11px] leading-[1.4]">
          {urlState === 'bad' && touched && (
            <span className="text-t-red">
              {t.profileCreator.urlDomainError.replace('{domain}', urlDomain)}
            </span>
          )}
          {urlState === 'ok' && liveness !== 'idle' && (
            <span
              className={
                liveness === 'live'
                  ? 'text-t-green'
                  : liveness === 'unreachable'
                    ? 'text-t-red'
                    : 'text-placeholder'
              }
            >
              {liveness === 'checking' && t.profileCreator.checkingLink}
              {liveness === 'live' && t.profileCreator.linkLive}
              {liveness === 'unreachable' && t.profileCreator.linkUnreachable}
            </span>
          )}
        </div>
      )}
      {hint && <p className="text-[11px] leading-[1.5] text-ink-soft mt-[7px]">{hint}</p>}
    </div>
  )
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={`${inputBase} border-hairline focus:border-ink resize-y min-h-[88px] leading-[1.5]`}
      />
    </div>
  )
}

export type Category = 'individual' | 'group' | 'corporation'

/** Selector de categoría — <select> nativo, igual al prototipo (no una picker de botones). */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: Category
  onChange: (c: Category) => void
}) {
  const { t } = useLocale()
  const opts: [Category, string][] = [
    ['individual', t.profileCreator.individual],
    ['group', t.profileCreator.group],
    ['corporation', t.profileCreator.corporation],
  ]
  return (
    <div>
      <FieldLabel>{t.profileCreator.category}</FieldLabel>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as Category)}
          className={`${inputBase} border-hairline focus:border-ink appearance-none pr-9 cursor-pointer`}
        >
          {opts.map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-ink-soft">
          <CaretIcon />
        </span>
      </div>
    </div>
  )
}

export function SaveBar({
  onSave,
  busy,
  saved,
  error,
}: {
  onSave: () => void
  busy: boolean
  saved: boolean
  error?: string
}) {
  const { t } = useLocale()
  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="w-full mt-2 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-[opacity,background] disabled:opacity-60 disabled:cursor-not-allowed enabled:hover:bg-black"
      >
        {busy ? t.profileCreator.saving : t.profileCreator.save}
      </button>
      <p className="text-[12px] text-t-green text-center mt-3.5 min-h-[16px] tracking-[0.02em]">
        {error ? <span className="text-t-red">{error}</span> : saved ? t.profileCreator.saved : ''}
      </p>
    </div>
  )
}

/**
 * Fila sec-block del prototipo — label en versalitas, valor grande, píldora de
 * estado y acción a la derecha.
 *
 * Vivía dentro de /settings/authentication. Payouts necesita exactamente la
 * misma fila, así que sube aquí: dos copias de un componente de diseño se
 * separan a la primera corrección que se haga solo en una.
 */
export function SecBlock({
  label,
  value,
  tag,
  action,
  onAction,
  hint,
  busy,
}: {
  label: string
  value: string
  tag: { label: string; verified: boolean }
  /** Sin accion no se pinta boton: hay estados que no piden nada de nadie. */
  action?: string
  onAction?: () => void
  hint?: string
  busy?: boolean
}) {
  return (
    <div className="py-[18px] border-b border-hairline first:pt-1">
      <div className="flex items-start justify-between gap-3.5">
        <div className="min-w-0">
          <div className="text-[10px] font-medium tracking-[0.16em] uppercase text-ink-soft">{label}</div>
          <div className="text-[16px] text-ink mt-[7px] tracking-[0.04em] truncate">{value}</div>
          <span
            className={`inline-block mt-[9px] text-[9px] font-semibold tracking-[0.12em] uppercase px-2 py-[3px] rounded-full border ${
              tag.verified ? 'text-t-green border-t-green' : 'text-ink-soft border-hairline'
            }`}
          >
            {tag.label}
          </span>
        </div>
        {action && onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={busy}
            className="shrink-0 mt-0.5 rounded-[9px] border border-ink px-4 py-[9px] text-[10px] font-semibold tracking-[0.12em] uppercase text-ink transition-colors hover:bg-ink hover:text-paper disabled:opacity-40"
          >
            {action}
          </button>
        )}
      </div>
      {hint && <p className="text-[11.5px] leading-[1.55] text-ink-soft mt-3">{hint}</p>}
    </div>
  )
}
