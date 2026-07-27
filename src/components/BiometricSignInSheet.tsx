'use client'

import { useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, FieldLabel } from '@/components/Sheet'
import { CaretIcon } from '@/components/Brand'
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  findCountry,
  formatNational,
  toE164,
  isPlausible,
  type Country,
} from '@/lib/countries'

/**
 * Quick sign-in biométrico — companion doc §5.3, camino quick.
 *
 * Alternativa al OTP: el usuario da su teléfono (para ubicar sus credenciales
 * sin tener sesión aún), el dispositivo pide Touch ID / Face ID, y si la
 * aserción es válida, el servidor acuña una sesión real que este componente
 * adopta con setSession(). Ningún OTP de por medio en este camino.
 */
type Phase = 'phone' | 'prompting' | 'error'

export function BiometricSignInSheet({
  open,
  onClose,
  onAuthenticated,
}: {
  open: boolean
  onClose: () => void
  onAuthenticated: () => void
}) {
  const { t } = useLocale()
  const [phase, setPhase] = useState<Phase>('phone')
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY)
  const [digits, setDigits] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setPhase('phone')
      setDigits('')
      setError('')
    }
  }, [open])

  async function go() {
    setError('')
    setPhase('prompting')
    try {
      const phone = toE164(digits, country)

      const begin = await fetch('/api/webauthn/auth/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const beginBody = await begin.json()
      if (!begin.ok) throw new Error(beginBody.error ?? t.biometricSignIn.errors.needSignIn)

      // Dispara Touch ID / Face ID / Windows Hello
      const credential = await startAuthentication({ optionsJSON: beginBody.options })

      const finish = await fetch('/api/webauthn/auth/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: beginBody.userId, credential }),
      })
      const finishBody = await finish.json()
      if (!finish.ok) throw new Error(finishBody.error ?? t.biometricSignIn.errors.failed)

      // Adoptar la sesión acuñada por el servidor
      const { error: setErr } = await supabase.auth.setSession({
        access_token: finishBody.access_token,
        refresh_token: finishBody.refresh_token,
      })
      if (setErr) throw setErr

      onAuthenticated()
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        /NotAllowed|abort/i.test(msg) ? t.biometricSignIn.errors.cancelled : msg || t.biometricSignIn.errors.failed
      )
      setPhase('error')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker={t.authHub.biometricSignIn} title={t.biometricSignIn.title}>
      {phase === 'prompting' ? (
        <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft py-4 text-center">
          {t.biometric.prompting}
        </p>
      ) : (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">
            {t.biometricSignIn.description}
          </p>

          <div className="mt-[22px]">
            <FieldLabel htmlFor="bio-phone">{t.auth.phoneLabel}</FieldLabel>
            <div className="flex items-stretch border border-hairline rounded-xl overflow-hidden focus-within:border-ink transition-colors">
              <div className="relative flex items-center gap-[7px] px-3 shrink-0 border-r border-hairline bg-paper-warm">
                <span className="text-[18px] leading-none" aria-hidden="true">
                  {country.flag}
                </span>
                <span className="text-[14px] font-medium tracking-[0.02em] text-ink">
                  {country.dial}
                </span>
                <span className="text-ink-soft shrink-0">
                  <CaretIcon />
                </span>
                <select
                  value={country.iso}
                  onChange={(e) => {
                    setCountry(findCountry(e.target.value))
                    setDigits('')
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
                id="bio-phone"
                type="tel"
                inputMode="numeric"
                value={formatNational(digits, country)}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
                placeholder={t.auth.phonePlaceholder}
                className="flex-1 min-w-0 bg-transparent px-3.5 py-[15px] text-[16px] tracking-[0.02em] text-ink outline-none"
              />
            </div>
          </div>

          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}

          <SheetButton onClick={go} disabled={!isPlausible(digits, country)}>
            {t.biometricSignIn.continue}
          </SheetButton>
        </div>
      )}
    </Sheet>
  )
}
