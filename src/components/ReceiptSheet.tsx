'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'

/**
 * Un recibo — Work Order 02, Stage 9. Diseño del prototipo: hoja inferior con
 * la clase de recibo, el titulo, filas clave-valor y una fila de total.
 *
 * Lee /api/receipts, que arma las filas desde lo guardado (0.9c). Aqui solo se
 * traducen las etiquetas y se formatea: ninguna cifra se calcula en el cliente.
 */

export type ReceiptKind = 'purchase' | 'sale' | 'transfer' | 'royalty' | 'registration'
type Row = { label: string; value: string | number | null; format: 'money' | 'text' | 'date' | 'mono'; total?: boolean; params?: Record<string, string> }

export function ReceiptSheet({ kind, id, onClose }: { kind: ReceiptKind; id: string; onClose: () => void }) {
  const { t, locale } = useLocale()
  const [data, setData] = useState<{ title: string; rows: Row[] } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return setFailed(true)
      const res = await fetch(`/api/receipts?kind=${kind}&id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) return setFailed(true)
      setData(await res.json())
    })()
  }, [kind, id])

  const labels = t.receipt as Record<string, string>
  const dateOf = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(locale) : '—')
  const label = (r: Row) => {
    let text = labels[r.label] ?? r.label
    if (r.params?.date) text = text.replace('{date}', dateOf(r.params.date))
    if (r.params?.type) text = `${text} (${r.params.type})`
    return text
  }
  const value = (r: Row) => {
    if (r.value == null) return ''
    if (r.format === 'money') return `${money(Number(r.value))} USD`
    if (r.format === 'date') return dateOf(String(r.value))
    return String(r.value)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="w-full max-w-col bg-paper rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] tracking-[0.16em] uppercase text-ink-soft">{labels[kind]}</div>
            <div className="font-display font-medium text-[18px] text-ink mt-1">{data?.title ?? ''}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink text-[18px] leading-none">
            ×
          </button>
        </div>
        {failed && <p className="text-[12px] text-t-red mt-4">{t.work.errors.buyFailed}</p>}
        {!data && !failed && <p className="text-[12px] text-ink-soft mt-4">{t.authHub.loading}</p>}
        {data && (
          <div className="mt-4">
            {data.rows.map((r, i) => (
              <div
                key={`${r.label}-${i}`}
                className={`flex items-baseline justify-between gap-3 py-2 text-[12.5px] ${r.total ? 'border-t border-ink mt-1 pt-2.5 font-medium text-ink' : 'border-b border-[#F1EFE8] text-ink-soft'}`}
              >
                <span>{label(r)}</span>
                <span className={`text-right ${r.total ? 'text-ink' : 'text-ink'} ${r.format === 'mono' ? 'font-mono text-[11px]' : ''}`}>{value(r)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
