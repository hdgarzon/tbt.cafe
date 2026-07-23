'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Código privado — Master Handoff §10.
 * 3-5 caracteres, confirmado dos veces, más frecuencia (siempre / ocasional).
 *
 * El código NUNCA se guarda ni se transmite en claro más allá de esta petición:
 * la API route lo hashea con scrypt y solo persiste el hash.
 */

const MIN_LEN = 3
const MAX_LEN = 5

export function PrivateCodeSheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sesión expirada')

      const res = await fetch('/api/private-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code, frequency: freq }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No pudimos guardar el código')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos guardar el código')
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
          <span className="label-caps">Private code</span>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-ink-soft">×</button>
        </div>

        <div className="px-5 py-6">
          <p className="text-[12px] text-ink-soft leading-relaxed">
            Entre {MIN_LEN} y {MAX_LEN} caracteres. Se pedirá además del código SMS.
          </p>

          <label className="label-caps block mt-5" htmlFor="pc">Code</label>
          <input
            id="pc"
            type="password"
            autoComplete="new-password"
            value={code}
            onChange={(e) => setCode(e.target.value.slice(0, MAX_LEN))}
            placeholder="•••••"
            className="w-full mt-1 py-2 bg-transparent border-b border-hairline text-[16px] tracking-[0.3em] outline-none focus:border-ink transition-colors"
          />

          <label className="label-caps block mt-5" htmlFor="pc2">Confirm</label>
          <input
            id="pc2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.slice(0, MAX_LEN))}
            placeholder="•••••"
            className="w-full mt-1 py-2 bg-transparent border-b border-hairline text-[16px] tracking-[0.3em] outline-none focus:border-ink transition-colors"
          />
          {confirm.length > 0 && !matches && (
            <p className="text-[11px] text-t-red mt-2">Los códigos no coinciden.</p>
          )}

          <div className="label-caps mt-6">Ask me</div>
          <div className="flex gap-2 mt-2">
            {([
              ['always', 'Always'],
              ['occasional', 'Occasionally'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFreq(value)}
                aria-pressed={freq === value}
                className={`px-3 py-1.5 text-[12px] border transition-colors ${
                  freq === value ? 'border-ink text-ink' : 'border-hairline text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && <p className="text-[12px] text-t-red mt-4">{error}</p>}

          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="w-full mt-6 py-3 text-[13px] tracking-[0.1em] uppercase border border-ink transition-colors disabled:border-hairline disabled:text-placeholder enabled:hover:bg-ink enabled:hover:text-paper"
          >
            {busy ? 'Saving…' : 'Save code'}
          </button>

          <p className="text-[11px] text-placeholder mt-4 leading-relaxed">
            Se guarda hasheado, nunca en texto plano. Un código corto es una capa
            de conveniencia, no un segundo factor real.
          </p>
        </div>
      </div>
    </div>
  )
}
