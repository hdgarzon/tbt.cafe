'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

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
      if (!user) throw new Error('Sesión expirada')

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
      setError(e instanceof Error ? e.message : 'No pudimos enviar la confirmación')
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
          <span className="label-caps">Recovery email</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-ink-soft">×</button>
        </div>

        <div className="px-5 py-6">
          {sent ? (
            <>
              <p className="text-[14px]">Revisa tu correo.</p>
              <p className="text-[12px] text-ink-soft mt-2 leading-relaxed">
                Enviamos un enlace de confirmación a <span className="text-ink">{email}</span>.
                Al abrirlo, el email queda verificado y podrás usarlo para recuperar
                tu cuenta si pierdes el teléfono.
              </p>
              <button
                type="button"
                onClick={onSaved}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink hover:bg-ink hover:text-paper transition-colors"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft leading-relaxed">
                Sirve para recuperar la cuenta si pierdes el teléfono, y como
                confirmación adicional.
              </p>

              <label className="label-caps block mt-5" htmlFor="rec-email">Email</label>
              <input
                id="rec-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                placeholder="tu@correo.com"
                className="w-full mt-1 py-2 bg-transparent border-b border-hairline text-[15px] outline-none focus:border-ink transition-colors"
              />
              {email.length > 0 && !valid && (
                <p className="text-[11px] text-t-red mt-2">Correo inválido.</p>
              )}

              {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}

              <button
                type="button"
                onClick={send}
                disabled={!valid || busy}
                className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
              >
                {busy ? 'Sending…' : 'Send confirmation'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
