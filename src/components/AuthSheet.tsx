'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  findCountry,
  formatNational,
  isPlausible,
  toE164,
  type Country,
} from '@/lib/countries'

/**
 * Flujo de autenticación por OTP telefónico (Master Handoff §7, Build Spec ÍTEM 4).
 *
 * Reutiliza el backend existente sin endpoints nuevos:
 *   enviar    → supabase.auth.signInWithOtp({ phone })   [Twilio entrega el SMS]
 *   verificar → supabase.auth.verifyOtp({ phone, token })
 *
 * En la primera verificación exitosa el backend genera el creator_uuid y crea
 * la wallet custodial (claves cifradas AES-256-GCM). El usuario nunca ve cripto;
 * el front solo dispara la autenticación.
 *
 * NOTA sobre la longitud del OTP: el prototipo especifica 4 dígitos, pero este
 * proyecto de Supabase está configurado para enviar códigos de 8 (verificado
 * con un SMS real). Como la longitud es configurable por proyecto, en vez de
 * fijar un número exacto se acepta un rango — mismo criterio que ya usa el
 * AuthModal de la app en producción (maxLength 8, habilita desde 6). Así un
 * cambio de configuración no rompe el login.
 */
const OTP_MIN_LEN = 6
const OTP_MAX_LEN = 8
const RESEND_SECONDS = 30

type Step = 'phone' | 'verify'

export function AuthSheet({
  open,
  onClose,
  onAuthenticated,
}: {
  open: boolean
  onClose: () => void
  onAuthenticated: (phoneDigits: string, country: Country) => void
}) {
  const [step, setStep] = useState<Step>('phone')
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY)
  const [digits, setDigits] = useState('')
  const [terms, setTerms] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const otpRef = useRef<HTMLInputElement>(null)

  // Reiniciar todo al cerrar
  useEffect(() => {
    if (!open) {
      setStep('phone')
      setDigits('')
      setOtp('')
      setTerms(false)
      setError('')
      setBusy(false)
      setCountdown(0)
    }
  }, [open])

  // Cuenta regresiva del reenvío
  useEffect(() => {
    if (countdown <= 0) return
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [countdown])

  useEffect(() => {
    if (step === 'verify') otpRef.current?.focus()
  }, [step])

  const canSend = isPlausible(digits, country) && terms && !busy

  async function sendOtp() {
    setError('')
    setBusy(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: toE164(digits, country),
        options: { shouldCreateUser: true },
      })
      if (error) throw error
      setStep('verify')
      setCountdown(RESEND_SECONDS)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos enviar el código')
    } finally {
      setBusy(false)
    }
  }

  async function verifyOtp() {
    setError('')
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: toE164(digits, country),
        token: otp,
        type: 'sms',
      })
      if (error) throw error
      if (data.session) {
        onAuthenticated(digits, country)
        onClose()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg.includes('expired')
          ? 'El código expiró. Pide uno nuevo.'
          : msg.includes('invalid') || msg.includes('Token')
            ? 'Código incorrecto. Revísalo e intenta de nuevo.'
            : msg || 'No pudimos verificar el código'
      )
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />

      <div className="relative bg-paper border-t border-hairline">
        <div className="h-header flex items-center justify-between px-5 border-b border-hairline">
          <span className="label-caps">
            {step === 'phone' ? 'Sign in' : 'Verify'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[20px] leading-none text-ink-soft"
          >
            ×
          </button>
        </div>

        {step === 'phone' ? (
          <div className="px-5 py-6">
            {/* Selector de país a la IZQUIERDA + número a la derecha */}
            <div className="flex items-stretch border-b border-hairline pb-2">
              <label className="sr-only" htmlFor="country">Country</label>
              <select
                id="country"
                value={country.iso}
                onChange={(e) => {
                  setCountry(findCountry(e.target.value))
                  setDigits('')
                }}
                className="bg-transparent text-[15px] pr-2 outline-none cursor-pointer"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.iso} value={c.iso}>
                    {c.flag} {c.dial}
                  </option>
                ))}
              </select>

              <span className="w-px bg-hairline mx-3" aria-hidden="true" />

              <label className="sr-only" htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={formatNational(digits, country)}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
                placeholder={formatNational('0'.repeat(12), country)}
                className="flex-1 bg-transparent text-[15px] outline-none"
              />
            </div>

            {/* Gate de términos */}
            <div className="flex items-start gap-3 mt-5">
              <button
                type="button"
                role="checkbox"
                aria-checked={terms}
                onClick={() => setTerms((v) => !v)}
                className={`w-[16px] h-[16px] mt-[2px] border flex-shrink-0 flex items-center justify-center transition-colors ${
                  terms ? 'bg-ink border-ink' : 'border-hairline'
                }`}
              >
                {terms && (
                  <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2 6l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2" />
                  </svg>
                )}
              </button>
              <p className="text-[12px] leading-relaxed text-ink-soft">
                I agree to the{' '}
                <a href="/terms" className="text-ink underline underline-offset-2">Terms of Service</a>{' '}
                and{' '}
                <a href="/privacy" className="text-ink underline underline-offset-2">Privacy Policy</a>.
              </p>
            </div>

            {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}

            <button
              type="button"
              onClick={sendOtp}
              disabled={!canSend}
              className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </div>
        ) : (
          <div className="px-5 py-6">
            <p className="text-[13px] text-ink-soft">
              Code sent to{' '}
              <span className="text-ink">
                {country.dial} {formatNational(digits, country)}
              </span>
            </p>

            <label className="sr-only" htmlFor="otp">Verification code</label>
            <input
              id="otp"
              ref={otpRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_MAX_LEN))}
              placeholder={'0'.repeat(OTP_MAX_LEN)}
              className="w-full mt-4 py-2 bg-transparent border-b border-hairline text-[26px] tracking-[0.5em] font-mono outline-none focus:border-ink transition-colors"
            />

            {error && <p className="text-[12px] text-t-red mt-3">{error}</p>}

            {/* change number | resend code */}
            <div className="flex items-center gap-3 mt-4 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  setStep('phone')
                  setOtp('')
                  setError('')
                }}
                className="text-ink-soft underline underline-offset-2"
              >
                change number
              </button>
              <span className="text-hairline">|</span>
              <button
                type="button"
                onClick={sendOtp}
                disabled={countdown > 0 || busy}
                className="text-ink-soft underline underline-offset-2 disabled:no-underline disabled:text-placeholder"
              >
                {countdown > 0 ? `resend code (${countdown}s)` : 'resend code'}
              </button>
            </div>

            <button
              type="button"
              onClick={verifyOtp}
              disabled={otp.length < OTP_MIN_LEN || busy}
              className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
