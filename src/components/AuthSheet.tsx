'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, SheetSuccess, FieldLabel } from '@/components/Sheet'
import { CaretIcon } from '@/components/Brand'
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
 *
 * El título del sheet permanece "Authenticate" durante los tres pasos, igual
 * que el prototipo — solo el contenido del cuerpo cambia.
 */
const OTP_MIN_LEN = 6
const OTP_MAX_LEN = 8
const RESEND_SECONDS = 30

type Step = 'phone' | 'verify' | 'success'

export function AuthSheet({
  open,
  onClose,
  onAuthenticated,
  onSwitchToBiometric,
}: {
  open: boolean
  onClose: () => void
  onAuthenticated: (phoneDigits: string, country: Country) => void
  /** Ofrece "Sign in with biometrics" en el paso de teléfono, si el dispositivo lo soporta. */
  onSwitchToBiometric?: () => void
}) {
  const { t } = useLocale()
  const [step, setStep] = useState<Step>('phone')
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY)
  const [digits, setDigits] = useState('')
  const [terms, setTerms] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [bioAvailable, setBioAvailable] = useState(false)
  const otpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof PublicKeyCredential === 'undefined') return
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setBioAvailable)
      .catch(() => setBioAvailable(false))
  }, [])

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
      setError(e instanceof Error ? e.message : t.auth.errors.sendFailed)
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
        setStep('success')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg.includes('expired')
          ? t.auth.errors.expired
          : msg.includes('invalid') || msg.includes('Token')
            ? t.auth.errors.invalid
            : msg || t.auth.errors.verifyFailed
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker={t.auth.authKicker} title={t.auth.authTitle}>
      {step === 'phone' && (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">
            {t.auth.phoneIntro}
          </p>

          <div className="mt-[22px]">
            <FieldLabel htmlFor="phone">{t.auth.phoneLabel}</FieldLabel>

            {/* Selector de país como píldora (bandera+dial) a la izquierda, número a la derecha */}
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
                  id="country"
                  value={country.iso}
                  onChange={(e) => {
                    setCountry(findCountry(e.target.value))
                    setDigits('')
                  }}
                  aria-label="Country code"
                  /* text-base evita el zoom automático de iOS al enfocar */
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
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={formatNational(digits, country)}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, ''))}
                placeholder={t.auth.phonePlaceholder}
                aria-label="Mobile phone number"
                className="flex-1 min-w-0 bg-transparent px-3.5 py-[15px] text-[16px] tracking-[0.02em] text-ink outline-none"
              />
            </div>
          </div>

          {/* Gate de términos */}
          <div className="flex items-start gap-[10px] mt-[18px]">
            <button
              type="button"
              role="checkbox"
              aria-checked={terms}
              onClick={() => setTerms((v) => !v)}
              className={`w-[18px] h-[18px] mt-px shrink-0 rounded-[5px] border-[1.5px] flex items-center justify-center transition-colors ${
                terms ? 'bg-ink border-ink' : 'border-ink-soft hover:border-ink'
              }`}
            >
              {terms && (
                <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 6l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2" />
                </svg>
              )}
            </button>
            <p className="text-[11.5px] leading-[1.55] tracking-[0.01em] text-ink-soft">
              {t.auth.termsPrefix}{' '}
              <a href="/terms" className="text-ink underline underline-offset-2 hover:text-t-cyan">
                {t.auth.termsOfService}
              </a>{' '}
              {t.auth.termsAnd}{' '}
              <a href="/privacy" className="text-ink underline underline-offset-2 hover:text-t-cyan">
                {t.auth.privacyPolicy}
              </a>
              .
            </p>
          </div>

          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}

          <SheetButton onClick={sendOtp} disabled={!canSend}>
            {busy ? t.auth.sending : t.auth.sendCode}
          </SheetButton>

          {bioAvailable && onSwitchToBiometric && (
            <button
              type="button"
              onClick={onSwitchToBiometric}
              className="w-full mt-3 py-1 text-[12px] text-ink-soft underline underline-offset-2 hover:text-ink transition-colors"
            >
              {t.auth.bioInstead}
            </button>
          )}
        </div>
      )}

      {step === 'verify' && (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft mb-1">
            {t.auth.codeSentTo}{' '}
            <b className="text-ink font-medium">
              {country.dial} {formatNational(digits, country)}
            </b>
            .
          </p>

          <FieldLabel htmlFor="otp">{t.auth.codeLabel}</FieldLabel>
          <input
            id="otp"
            ref={otpRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_MAX_LEN))}
            placeholder={'•'.repeat(OTP_MAX_LEN)}
            aria-label="Verification code"
            className="w-full border border-hairline rounded-xl outline-none py-4 px-3.5 text-[22px] font-medium tracking-[0.42em] text-center text-ink focus:border-ink transition-colors"
          />

          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}

          <SheetButton onClick={verifyOtp} disabled={otp.length < OTP_MIN_LEN || busy}>
            {busy ? t.auth.verifying : t.auth.verifyBtn}
          </SheetButton>

          {/* change number | resend code */}
          <div className="flex items-center justify-center gap-[14px] mt-5">
            <button
              type="button"
              onClick={() => {
                setStep('phone')
                setOtp('')
                setError('')
              }}
              className="text-[10px] font-bold tracking-[0.14em] uppercase text-ink hover:opacity-70 transition-opacity"
            >
              {t.auth.changeNumber}
            </button>
            <span className="w-px h-3 bg-hairline shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={sendOtp}
              disabled={countdown > 0 || busy}
              className="text-[10px] font-bold tracking-[0.14em] uppercase text-ink disabled:text-ink-soft disabled:opacity-60 hover:opacity-70 transition-opacity"
            >
              {countdown > 0 ? t.auth.resendCodeIn.replace('{s}', String(countdown)) : t.auth.resendCode}
            </button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <SheetSuccess
          title={t.auth.successTitle}
          sub={t.auth.successSub}
          buttonLabel={t.auth.doneBtn}
          onDone={onClose}
        />
      )}
    </Sheet>
  )
}
