'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Reclamar una obra ya registrada — Work Order 01 Step 20.
 *
 * Aparece cuando el escaneo bloquea el registro. Abre un ticket HR-#### de la
 * categoría `claim` (Update Package 01 §2); una persona lo lee y el titular
 * actual no recibe aviso automático. El escaneo y la obra con la que coincidió
 * los añade el servidor a partir del escaneo guardado.
 */
export function ClaimForm({ scanId }: { scanId: string | null }) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ref, setRef] = useState<string | null>(null)

  if (!scanId) return null

  async function send() {
    if (!text.trim()) {
      setError(t.claim.bodyRequired)
      return
    }
    setBusy(true)
    setError('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) throw new Error('session')
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ scanId, body: text }),
      })
      const json = (await res.json().catch(() => ({}))) as { ref?: string }
      if (!res.ok || !json.ref) throw new Error('claim')
      setRef(json.ref)
    } catch {
      setError(t.claim.failed)
    } finally {
      setBusy(false)
    }
  }

  if (ref) {
    return (
      <div className="mt-4 border border-hairline rounded-xl p-3 bg-paper">
        <div className="text-[13px] font-medium text-ink">{t.claim.sentTitle}</div>
        <p className="text-[12px] text-ink-soft mt-1 leading-[1.5]">{t.claim.sentBody.replace('{ref}', ref)}</p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-ink py-2.5 text-[13px] font-medium text-ink"
      >
        {t.claim.file}
      </button>
    )
  }

  return (
    <div className="mt-4">
      <p className="text-[12px] text-ink-soft leading-[1.5]">{t.claim.sub}</p>
      <label htmlFor="claim-body" className="block text-[11px] uppercase tracking-[0.1em] text-ink-soft mt-3 mb-1.5">
        {t.claim.bodyLabel}
      </label>
      <textarea
        id="claim-body"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.claim.bodyPlaceholder}
        className={`w-full border rounded-xl outline-none px-3 py-2.5 text-[13.5px] text-ink bg-paper focus:border-ink ${
          error ? 'border-t-red' : 'border-hairline'
        }`}
      />
      <p className="text-[11.5px] text-ink-soft mt-1.5 leading-[1.5]">{t.claim.note}</p>
      {error && <p className="text-[11.5px] text-t-red mt-1.5">{error}</p>}
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-ink text-paper py-3 text-[13px] font-medium disabled:opacity-50"
      >
        {t.claim.send}
      </button>
    </div>
  )
}
