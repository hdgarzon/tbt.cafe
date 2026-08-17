'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { Sheet, SheetButton, FieldLabel } from '@/components/Sheet'

/**
 * Código privado — Master Handoff §10.
 * 3-5 caracteres, confirmado dos veces, más frecuencia (siempre / ocasional).
 *
 * El código NUNCA se guarda ni se transmite en claro más allá de esta petición:
 * la API route lo hashea con scrypt y solo persiste el hash.
 */

import { PRIVATE_CODE_MIN as MIN_LEN, PRIVATE_CODE_MAX as MAX_LEN } from '@/lib/private-code-rules'

export function PrivateCodeSheet({
  open,
  onClose,
  onSaved,
  emailVerified = false,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** Cambia la nota de pie: con email verificado se ofrece como recuperación real. */
  emailVerified?: boolean
}) {
  const { t } = useLocale()
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [freq, setFreq] = useState<'always' | 'occasional'>('always')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setCode('')
      setConfirm('')
      setFreq('always')
      setError('')
      setBusy(false)
    }
  }, [open])

  const lengthOk = code.length >= MIN_LEN && code.length <= MAX_LEN
  const matches = code.length > 0 && code === confirm
  const canSave = lengthOk && matches && !busy

  async function save() {
    setError('')
    setBusy(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) throw new Error('Session expired')

      const res = await fetch('/api/private-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code, frequency: freq }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? t.privateCode.errors.saveFailed)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t.privateCode.errors.saveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} kicker={t.authHub.privateCode} title={t.privateCode.title}>
      <p className="text-[12.5px] leading-[1.6] tracking-[0.01em] text-ink-soft">
        {t.privateCode.description.replace('{min}', String(MIN_LEN)).replace('{max}', String(MAX_LEN))}
      </p>

      <div className="mt-[22px]">
        <FieldLabel htmlFor="pc">{t.privateCode.codeLabel}</FieldLabel>
        <input
          id="pc"
          type="password"
          autoComplete="new-password"
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, MAX_LEN))}
          placeholder={`${MIN_LEN}–${MAX_LEN} characters`}
          className="w-full border border-hairline rounded-xl outline-none px-3.5 py-[13px] text-[15px] tracking-[0.3em] text-ink focus:border-ink transition-colors"
        />
      </div>

      <div className="mt-[18px]">
        <FieldLabel htmlFor="pc2">{t.privateCode.confirmLabel}</FieldLabel>
        <input
          id="pc2"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.slice(0, MAX_LEN))}
          placeholder="Re-enter code"
          className="w-full border border-hairline rounded-xl outline-none px-3.5 py-[13px] text-[15px] tracking-[0.3em] text-ink focus:border-ink transition-colors"
        />
        {confirm.length > 0 && !matches && (
          <p className="text-[11px] leading-[1.4] text-t-red mt-1.5">{t.privateCode.mismatch}</p>
        )}
      </div>

      <div className="mt-[22px]">
        <FieldLabel>{t.privateCode.freqLabel}</FieldLabel>
        <div className="flex gap-[10px]">
          {(
            [
              ['always', t.privateCode.always],
              ['occasional', t.privateCode.occasional],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFreq(value)}
              aria-pressed={freq === value}
              className={`flex-1 rounded-xl border px-3.5 py-[13px] text-[13px] font-medium tracking-[0.02em] transition-colors ${
                freq === value ? 'border-ink text-ink bg-paper-warm' : 'border-hairline text-ink-soft hover:border-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{error}</p>}

      <SheetButton onClick={save} disabled={!canSave}>
        {busy ? t.privateCode.saving : t.privateCode.save}
      </SheetButton>

      <p className="text-[11px] leading-[1.5] text-ink-soft mt-4 text-center">
        {emailVerified ? t.privateCode.pcResetNote : t.privateCode.pcResetNoteNoEmail}
      </p>
    </Sheet>
  )
}
