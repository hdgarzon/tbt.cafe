'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, SheetSuccess, FieldLabel } from '@/components/Sheet'

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
      const {
        data: { user },
      } = await supabase.auth.getUser()
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

  return (
    <Sheet open={open} onClose={onClose} kicker={t.authHub.recoveryEmail} title={t.recoveryEmail.title}>
      {sent ? (
        <SheetSuccess
          title={t.recoveryEmail.checkEmail}
          sub={t.recoveryEmail.checkEmailDesc.replace('{email}', email)}
          buttonLabel={t.recoveryEmail.done}
          onDone={onSaved}
        />
      ) : (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">
            {t.recoveryEmail.description}
          </p>

          <div className="mt-[22px]">
            <FieldLabel htmlFor="rec-email">{t.recoveryEmail.emailLabel}</FieldLabel>
            <input
              id="rec-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              placeholder="you@example.com"
              className="w-full border border-hairline rounded-xl outline-none px-3.5 py-[13px] text-[15px] tracking-[0.01em] text-ink focus:border-ink transition-colors"
            />
            {email.length > 0 && !valid && (
              <p className="text-[11px] leading-[1.4] text-t-red mt-1.5">
                {t.recoveryEmail.invalidEmail}
              </p>
            )}
          </div>

          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}

          <SheetButton onClick={send} disabled={!valid || busy}>
            {busy ? t.recoveryEmail.sending : t.recoveryEmail.send}
          </SheetButton>
        </div>
      )}
    </Sheet>
  )
}
