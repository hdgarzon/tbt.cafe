'use client'

import { useEffect, useState } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'

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
    if (!session) throw new Error('Sesión expirada')
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
      if (!begin.ok) throw new Error(options.error ?? 'No pudimos iniciar el registro')

      // Aquí el navegador invoca Touch ID / Face ID / Windows Hello
      const cred = await startRegistration({ optionsJSON: options })
      setCredential(cred)
      setPhase('choose') // ceremonia OK → elegir modo
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        /NotAllowed|abort/i.test(msg)
          ? 'Cancelaste el registro del dispositivo.'
          : msg || 'No se pudo registrar el dispositivo'
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
      if (!res.ok) throw new Error(json.error ?? 'No pudimos guardar el dispositivo')
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos guardar el dispositivo')
      setPhase('choose')
    }
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />

      <div className="relative bg-paper border-t border-hairline">
        <div className="h-header flex items-center justify-between px-5 border-b border-hairline">
          <span className="label-caps">Biometric sign-in</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-ink-soft">×</button>
        </div>

        <div className="px-5 py-6">
          {phase === 'idle' && (
            <>
              <p className="text-[12px] text-ink-soft leading-relaxed">
                Registra este dispositivo con tu huella o rostro. La biometría
                nunca sale del dispositivo — solo guardamos una clave pública.
                Se suma al código SMS, nunca lo reemplaza como tu identidad.
              </p>
              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}
              <button
                type="button"
                onClick={startEnroll}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink hover:bg-ink hover:text-paper transition-colors"
              >
                Set up
              </button>
            </>
          )}

          {phase === 'prompting' && (
            <p className="text-[14px] text-ink-soft py-4">
              Sigue la indicación de tu dispositivo…
            </p>
          )}

          {(phase === 'choose' || phase === 'saving') && (
            <>
              <p className="text-[13px]">¿Cómo quieres usar el biométrico en este dispositivo?</p>
              <div className="mt-4 flex flex-col gap-3">
                <button
                  type="button"
                  disabled={phase === 'saving'}
                  onClick={() => finishEnroll('quick')}
                  className="text-left border border-hairline hover:border-ink transition-colors p-4 disabled:opacity-50"
                >
                  <div className="text-[14px]">Quick sign-in</div>
                  <div className="text-[12px] text-ink-soft mt-1">
                    Una pulsación te identifica, sin código SMS en este dispositivo.
                  </div>
                </button>
                <button
                  type="button"
                  disabled={phase === 'saving'}
                  onClick={() => finishEnroll('extra')}
                  className="text-left border border-hairline hover:border-ink transition-colors p-4 disabled:opacity-50"
                >
                  <div className="text-[14px]">Extra security layer</div>
                  <div className="text-[12px] text-ink-soft mt-1">
                    Se pide el biométrico además del código SMS.
                  </div>
                </button>
              </div>
              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}
            </>
          )}

          {phase === 'done' && (
            <>
              <p className="text-[14px]">Dispositivo registrado.</p>
              <p className="text-[12px] text-ink-soft mt-2">
                Ya puedes usar el biométrico en este dispositivo.
              </p>
              <button
                type="button"
                onClick={onSaved}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink hover:bg-ink hover:text-paper transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
