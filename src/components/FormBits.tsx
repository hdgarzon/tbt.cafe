'use client'

import { useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Primitivas de formulario compartidas por los perfiles.
 * Estética del sistema: hairlines, sin cajas, etiquetas en versalitas.
 *
 * Category/Save labels son idénticos entre creator y collector profiles en
 * los 4 diccionarios, así que estos componentes leen de t.profileCreator
 * directamente en vez de recibirlos por props — evita duplicar el hilo de
 * traducción en cada call site.
 */

type Liveness = 'idle' | 'checking' | 'live' | 'unreachable'

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
      : urlState === 'bad'
        ? 'border-t-red'
        : 'border-hairline focus:border-ink'

  return (
    <label className="block">
      <span className="label-caps">{label}</span>
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
        className={`w-full mt-1 py-2 bg-transparent border-b text-[15px] outline-none transition-colors ${borderClass}`}
      />
      {urlState === 'bad' && touched && (
        <span className="text-[11px] text-t-red block">
          {t.profileCreator.urlDomainError.replace('{domain}', urlDomain ?? '')}
        </span>
      )}
      {urlState === 'ok' && liveness !== 'idle' && (
        <span
          className={`text-[11px] block ${
            liveness === 'live' ? 'text-t-green' : liveness === 'unreachable' ? 'text-t-red' : 'text-placeholder'
          }`}
        >
          {liveness === 'checking' && t.profileCreator.checkingLink}
          {liveness === 'live' && t.profileCreator.linkLive}
          {liveness === 'unreachable' && t.profileCreator.linkUnreachable}
        </span>
      )}
      {hint && <span className="text-[11px] text-placeholder block mt-1">{hint}</span>}
    </label>
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
    <label className="block">
      <span className="label-caps">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full mt-1 py-2 bg-transparent border-b border-hairline text-[15px] outline-none focus:border-ink transition-colors resize-none"
      />
    </label>
  )
}

export type Category = 'individual' | 'group' | 'corporation'

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
      <span className="label-caps">{t.profileCreator.category}</span>
      <div className="flex gap-2 mt-2">
        {opts.map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            aria-pressed={value === val}
            className={`px-3 py-1.5 text-[12px] border transition-colors ${
              value === val ? 'border-ink text-ink' : 'border-hairline text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
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
      {error && <p className="text-[12px] text-t-red mb-3">{error}</p>}
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="w-full py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
      >
        {busy ? t.profileCreator.saving : saved ? t.profileCreator.saved : t.profileCreator.save}
      </button>
    </div>
  )
}
