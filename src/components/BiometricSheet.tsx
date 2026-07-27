'use client'

import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, SheetSuccess } from '@/components/Sheet'

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
  const [mode, setMode] = useState<'quick' | 'extra'>('quick')
  const [error, setError] = useState('')
  // El resultado de la ceremonia WebAuthn se guarda hasta que el usuario elige el modo
  const [credential, setCredential] = useState<unknown>(null)

  useEffect(() => {
    if (!open) {
      setPhase('idle')
      setMode('quick')
      setError('')
      setCredential(null)
    }
  }, [open])

  async function accessToken(): Promise<string> {
    const {
      data: { session },
    } = await supabase.auth.getSession()
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
  async function finishEnroll() {
    setError('')
    setPhase('saving')
    try {
      const token = await accessToken()
      const res = await fetch('/api/webauthn/register/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ credential, bioMode: mode }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? t.biometric.errors.saveFailed)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : t.biometric.errors.saveFailed)
      setPhase('choose')
    }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker={t.authHub.biometricSignIn} title={t.biometric.title}>
      {(phase === 'idle' || phase === 'prompting') && (
        <div>
          <div className="text-center pt-2 pb-1">
            <div className="w-16 h-16 mx-auto mb-1 rounded-full border border-hairline bg-paper-warm text-ink flex items-center justify-center">
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 11c0 3-1 5-2 7" />
                <path d="M8 6.5a6 6 0 0 1 8 5.5c0 1 0 2-.3 3" />
                <path d="M5.5 9A8 8 0 0 1 12 5a8 8 0 0 1 4 1" />
                <path d="M12 11v1c0 4-1 6-2 8" />
                <path d="M15.5 12c0 4-.5 5.5-1.2 7.5" />
              </svg>
            </div>
          </div>

          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft text-center">
            {phase === 'prompting' ? t.biometric.prompting : t.biometric.description}
          </p>

          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3 text-center">{error}</p>}

          <SheetButton onClick={startEnroll} disabled={phase === 'prompting'}>
            {t.biometric.setUp}
          </SheetButton>
        </div>
      )}

      {(phase === 'choose' || phase === 'saving') && (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">
            {t.biometric.chooseMode}
          </p>

          <div className="mt-[22px] flex flex-col gap-3">
            {(
              [
                ['quick', t.biometric.quickTitle, t.biometric.quickDesc],
                ['extra', t.biometric.extraTitle, t.biometric.extraDesc],
              ] as const
            ).map(([value, title, desc]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`text-left rounded-xl border p-4 transition-colors ${
                  mode === value ? 'border-ink bg-paper-warm' : 'border-hairline hover:border-ink'
                }`}
              >
                <div className="text-[14px] font-semibold tracking-[0.01em] text-ink">{title}</div>
                <div className="text-[12px] leading-[1.5] text-ink-soft mt-[5px]">{desc}</div>
              </button>
            ))}
          </div>

          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}

          <SheetButton onClick={finishEnroll} disabled={phase === 'saving'}>
            {t.biometric.chooseSave}
          </SheetButton>
        </div>
      )}

      {phase === 'done' && (
        <SheetSuccess
          title={t.biometric.registered}
          sub={mode === 'quick' ? t.biometric.doneQuick : t.biometric.doneExtra}
          buttonLabel={t.biometric.done}
          onDone={onSaved}
        />
      )}
    </Sheet>
  )
}
