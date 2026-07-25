'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Email de recuperación — Master Handoff §9.
 *
 * Implementación: se usa `supabase.auth.updateUser({ email })`, que envía un
 * correo de confirmación y adjunta el email a la MISMA cuenta al confirmarlo.
 * Es lo correcto para el caso "perdí el teléfono": el email queda como una
 * identidad de auth real y sirve para recuperar de verdad, no como un dato
 * suelto en una tabla.
 *
 * La sesión por teléfono NO se ve afectada.
 */
export function RecoveryEmailSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) {
      setEmail('')
      setError('')
      setBusy(false)
      setSent(false)
    }
  }, [open])

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)

  async function send() {
    setError('')
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session expired')

      // 1. Dispara el correo de confirmación de Supabase
      const { error: updErr } = await supabase.auth.updateUser({ email })
      if (updErr) throw updErr

      // 2. Guarda el email en el perfil como NO verificado. Pasará a verificado
      //    cuando el usuario confirme desde el correo.
      const { error: profErr } = await supabase
        .from('profiles')
        .update({ recovery_email: email, recovery_email_verified: false })
        .eq('id', user.id)
      if (profErr) throw profErr

      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t.recoveryEmail.errors.sendFailed)
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
          <span className="label-caps">{t.recoveryEmail.title}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-ink-soft">×</button>
        </div>

        <div className="px-5 py-6">
          {sent ? (
            <>
              <p className="text-[14px]">{t.recoveryEmail.checkEmail}</p>
              <p className="text-[12px] text-ink-soft mt-2 leading-relaxed">
                {t.recoveryEmail.checkEmailDesc.replace('{email}', email)}
              </p>
              <button
                type="button"
                onClick={onSaved}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink hover:bg-ink hover:text-paper transition-colors"
              >
                {t.recoveryEmail.done}
              </button>
            </>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft leading-relaxed">
                {t.recoveryEmail.description}
              </p>

              <label className="label-caps block mt-5" htmlFor="rec-email">{t.recoveryEmail.emailLabel}</label>
              <input
                id="rec-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                placeholder="you@email.com"
                className="w-full mt-1 py-2 bg-transparent border-b border-hairline text-[15px] outline-none focus:border-ink transition-colors"
              />
              {email.length > 0 && !valid && (
                <p className="text-[11px] text-t-red mt-2">{t.recoveryEmail.invalidEmail}</p>
              )}

              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}

              <button
                type="button"
                onClick={send}
                disabled={!valid || busy}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
              >
                {busy ? t.recoveryEmail.sending : t.recoveryEmail.send}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
