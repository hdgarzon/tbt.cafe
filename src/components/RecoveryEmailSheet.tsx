'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, SheetSuccess, FieldLabel } from '@/components/Sheet'

/**
 * e-Mail — Work Order 01 Step 19, como lo reemplaza el Addendum A.
 *
 * La dirección se pide una vez y se verifica con un código enviado a ella. No
 * hay doble entrada, y nada se guarda en el perfil hasta que el código vuelve
 * correcto (/api/email/verify). Antes esto llamaba a
 * `supabase.auth.updateUser({ email })`, que mandaba un enlace y ataba la
 * dirección a la identidad de auth; y nada marcaba nunca la dirección como
 * verificada.
 */
type Step = 'email' | 'code' | 'done'

async function authed(path: string, body: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('session')
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  return { ok: res.ok, error: json.error }
}

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
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setStep('email')
      setEmail('')
      setCode('')
      setError('')
      setBusy(false)
    }
  }, [open])

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)

  function messageFor(code?: string) {
    if (code === 'too_many') return t.recoveryEmail.errors.tooMany
    if (code === 'email_unavailable' || code === 'send_failed') return t.recoveryEmail.errors.sendFailed
    if (code === 'expired' || code === 'no_pending_code') return t.recoveryEmail.errors.expired
    if (code === 'too_many_attempts') return t.recoveryEmail.errors.tooManyAttempts
    if (code === 'invalid_code') return t.recoveryEmail.errors.invalidCode
    return t.recoveryEmail.errors.sendFailed
  }

  async function send() {
    setError('')
    setBusy(true)
    try {
      const r = await authed('/api/email/begin', { email })
      if (!r.ok) return setError(messageFor(r.error))
      setCode('')
      setStep('code')
    } catch {
      setError(t.recoveryEmail.errors.sendFailed)
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setError('')
    setBusy(true)
    try {
      const r = await authed('/api/email/verify', { code })
      if (!r.ok) return setError(messageFor(r.error))
      setStep('done')
    } catch {
      setError(t.recoveryEmail.errors.sendFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker={t.authHub.recoveryEmail} title={t.recoveryEmail.title}>
      {step === 'done' && (
        <SheetSuccess
          title={t.recoveryEmail.verified}
          sub={email}
          buttonLabel={t.recoveryEmail.done}
          onDone={onSaved}
        />
      )}

      {step === 'email' && (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">{t.recoveryEmail.description}</p>
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
              <p className="text-[11px] leading-[1.4] text-t-red mt-1.5">{t.recoveryEmail.invalidEmail}</p>
            )}
          </div>
          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}
          <SheetButton onClick={send} disabled={!valid || busy}>
            {busy ? t.recoveryEmail.sending : t.recoveryEmail.send}
          </SheetButton>
        </div>
      )}

      {step === 'code' && (
        <div>
          <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">
            {t.recoveryEmail.checkEmailDesc.replace('{email}', email)}
          </p>
          <div className="mt-[22px]">
            <FieldLabel htmlFor="rec-code">{t.recoveryEmail.codeLabel}</FieldLabel>
            <input
              id="rec-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="w-full border border-hairline rounded-xl outline-none px-3.5 py-[13px] text-[18px] tracking-[0.3em] text-ink focus:border-ink transition-colors"
            />
          </div>
          {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}
          <SheetButton onClick={verify} disabled={code.length !== 6 || busy}>
            {busy ? t.recoveryEmail.verifying : t.recoveryEmail.verify}
          </SheetButton>
          <button
            type="button"
            onClick={send}
            disabled={busy}
            className="w-full mt-3 py-1 text-[12px] text-ink-soft underline underline-offset-2 hover:text-ink transition-colors"
          >
            {t.recoveryEmail.resend}
          </button>
        </div>
      )}
    </Sheet>
  )
}
