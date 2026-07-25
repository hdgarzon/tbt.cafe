'use client'

import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Enrolamiento biométrico — companion doc §2.
 * Flujo: Set up → el dispositivo pide huella/rostro → al pasar, el usuario
 * elige cómo se usará en ESTE dispositivo (quick | extra) → se guarda.
 *
 * quick = una pulsación reemplaza el OTP en este dispositivo.
 * extra = se exige el biométrico ADEMÁS del OTP.
 */
type Phase = 'idle' | 'prompting' | 'choose' | 'saving' | 'done'

export function BiometricSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  // El resultado de la ceremonia WebAuthn se guarda hasta que el usuario elige el modo
  const [credential, setCredential] = useState<unknown>(null)

  useEffect(() => {
    if (!open) {
      setPhase('idle')
      setError('')
      setCredential(null)
    }
  }, [open])

  async function accessToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Session expired')
    return session.access_token
  }

  // Paso 1: pedir opciones al servidor y disparar el prompt del dispositivo
  async function startEnroll() {
    setError('')
    setPhase('prompting')
    try {
      const token = await accessToken()
      const begin = await fetch('/api/webauthn/register/begin', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const options = await begin.json()
      if (!begin.ok) throw new Error(options.error ?? t.biometric.errors.enrollFailed)

      // Aquí el navegador invoca Touch ID / Face ID / Windows Hello
      const cred = await startRegistration({ optionsJSON: options })
      setCredential(cred)
      setPhase('choose') // ceremonia OK → elegir modo
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        /NotAllowed|abort/i.test(msg) ? t.biometric.errors.cancelled : msg || t.biometric.errors.enrollFailed
      )
      setPhase('idle')
    }
  }

  // Paso 2: con el modo elegido, verificar y guardar en el servidor
  async function finishEnroll(bioMode: 'quick' | 'extra') {
    setError('')
    setPhase('saving')
    try {
      const token = await accessToken()
      const res = await fetch('/api/webauthn/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credential, bioMode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? t.biometric.errors.saveFailed)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.biometric.errors.saveFailed)
      setPhase('choose')
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />

      <div className="relative bg-paper border-t border-hairline">
        <div className="h-header flex items-center justify-between px-5 border-b border-hairline">
          <span className="label-caps">{t.biometric.title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-ink-soft">×</button>
        </div>

        <div className="px-5 py-6">
          {phase === 'idle' && (
            <>
              <p className="text-[12px] text-ink-soft leading-relaxed">
                {t.biometric.description}
              </p>
              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}
              <button
                type="button"
                onClick={startEnroll}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink hover:bg-ink hover:text-paper transition-colors"
              >
                {t.biometric.setUp}
              </button>
            </>
          )}

          {phase === 'prompting' && (
            <p className="text-[14px] text-ink-soft py-4">
              {t.biometric.prompting}
            </p>
          )}

          {(phase === 'choose' || phase === 'saving') && (
            <>
              <p className="text-[13px]">{t.biometric.chooseMode}</p>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  disabled={phase === 'saving'}
                  onClick={() => finishEnroll('quick')}
                  className="text-left border border-hairline hover:border-ink transition-colors p-4 disabled:opacity-50"
                >
                  <div className="text-[14px]">{t.biometric.quickTitle}</div>
                  <div className="text-[12px] text-ink-soft mt-1">
                    {t.biometric.quickDesc}
                  </div>
                </button>
                <button
                  type="button"
                  disabled={phase === 'saving'}
                  onClick={() => finishEnroll('extra')}
                  className="text-left border border-hairline hover:border-ink transition-colors p-4 disabled:opacity-50"
                >
                  <div className="text-[14px]">{t.biometric.extraTitle}</div>
                  <div className="text-[12px] text-ink-soft mt-1">
                    {t.biometric.extraDesc}
                  </div>
                </button>
              </div>
              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}
            </>
          )}

          {phase === 'done' && (
            <>
              <p className="text-[14px]">{t.biometric.registered}</p>
              <p className="text-[12px] text-ink-soft mt-2">
                {t.biometric.registeredDesc}
              </p>
              <button
                type="button"
                onClick={onSaved}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink hover:bg-ink hover:text-paper transition-colors"
              >
                {t.biometric.done}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
