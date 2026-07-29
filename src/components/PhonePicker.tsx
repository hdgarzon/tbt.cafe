'use client'

import { useState } from 'react'
import { COUNTRIES, DEFAULT_COUNTRY, findCountry, formatNational, type Country } from '@/lib/countries'
import { CaretIcon } from '@/components/Brand'

/**
 * Selector de teléfono con código de país + formateo en vivo por país — EL
 * MISMO patrón visual que el flujo de autenticación (AuthSheet.tsx), pero
 * extraído a componente reutilizable porque el panel de transferencia
 * (Build Spec 02, ÍTEM 2 / Transfer Companion) necesita DOS de estos —
 * número del destinatario y su confirmación.
 *
 * Expone el número en E.164 (+12035551234) vía onChange, listo para el
 * backend; el país inicial es siempre Colombia (mismo default que el auth).
 */
export function PhonePicker({
  value,
  onChange,
  placeholder,
  id,
}: {
  /** Dígitos nacionales crudos (sin formatear) — controlado por el padre. */
  value: string
  onChange: (e164: string, digits: string) => void
  placeholder?: string
  id?: string
}) {
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY)

  function emit(digits: string, c: Country) {
    onChange(digits ? `${c.dial}${digits}` : '', digits)
  }

  return (
    <div className="flex items-stretch border border-hairline rounded-xl overflow-hidden focus-within:border-ink transition-colors">
      <div className="relative flex items-center gap-[7px] px-3 shrink-0 border-r border-hairline bg-paper-warm">
        <span className="text-[18px] leading-none" aria-hidden="true">
          {country.flag}
        </span>
        <span className="text-[14px] font-medium tracking-[0.02em] text-ink">{country.dial}</span>
        <span className="text-ink-soft shrink-0">
          <CaretIcon />
        </span>
        <select
          id={id ? `${id}-country` : undefined}
          value={country.iso}
          onChange={(e) => {
            const next = findCountry(e.target.value)
            setCountry(next)
            emit('', next)
          }}
          aria-label="Country code"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base"
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {c.flag} {c.iso} {c.dial}
            </option>
          ))}
        </select>
      </div>

      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        value={formatNational(value, country)}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '')
          emit(digits, country)
        }}
        placeholder={placeholder}
        aria-label="Mobile phone number"
        className="flex-1 min-w-0 bg-transparent px-3.5 py-[15px] text-[16px] tracking-[0.02em] text-ink outline-none placeholder:text-placeholder"
      />
    </div>
  )
}
