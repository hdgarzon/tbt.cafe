'use client'

import { useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { COUNTRIES, DEFAULT_COUNTRY, findCountry, formatNational, toE164, isPlausible, type Country } from '@/lib/countries'

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

  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />

      <div className="relative bg-paper border-t border-hairline">
        <div className="h-header flex items-center justify-between px-5 border-b border-hairline">
          <span className="label-caps">{t.biometricSignIn.title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-ink-soft">×</button>
        </div>

        <div className="px-5 py-6">
          {phase === 'prompting' ? (
            <p className="text-[14px] text-ink-soft py-4">{t.biometric.prompting}</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft leading-relaxed">
                {t.biometricSignIn.description}
              </p>

              <div className="flex items-stretch border-b border-hairline pb-2 mt-5">
                <select
                  value={country.iso}
                  onChange={(e) => { setCountry(findCountry(e.target.value)); setDigits('') }}
                  className="bg-transparent text-[15px] pr-2 outline-none cursor-pointer"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.iso} value={c.iso}>{c.flag} {c.dial}</option>
                  ))}
                </select>
                <span className="w-px bg-hairline mx-3" aria-hidden="true" />
                <input
                  type="tel"
                  inputMode="numeric"
                  value={formatNational(digits, country)}
                  onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
                  placeholder={formatNational('0'.repeat(12), country)}
                  className="flex-1 bg-transparent text-[15px] outline-none"
                />
              </div>

              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}

              <button
                type="button"
                onClick={go}
                disabled={!isPlausible(digits, country)}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
              >
                {t.biometricSignIn.continue}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
