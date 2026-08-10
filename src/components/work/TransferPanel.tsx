'use client'

import { useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { PhonePicker } from '@/components/PhonePicker'
import { transferQuote, money } from '@/lib/fees'
import { createTransfer } from '@/lib/transfer-data'
import { royaltyOf, type WorkFull } from '@/lib/work-data'

/**
 * Panel de transferencia — reemplaza EN SITIO el contenido de la pestaña
 * Action (nunca un modal sobre otro; "← Back to actions" regresa). Pago
 * primero: al enviar, el usuario va a Stripe con el total completo; la
 * tarjeta se AUTORIZA, no se captura, hasta que el recipiente acepta
 * (Transfer & Commerce Companion). El valor recordado en sí NO se cobra.
 */
export function TransferPanel({
  work,
  senderIsCreator,
  onBack,
}: {
  work: WorkFull
  senderIsCreator: boolean
  onBack: () => void
}) {
  const { t } = useLocale()
  const royalty = royaltyOf(work.commerce)

  const [name, setName] = useState('')
  const [phone1, setPhone1] = useState('')
  const [phone2, setPhone2] = useState('')
  const [digits1, setDigits1] = useState('')
  const [digits2, setDigits2] = useState('')
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const numValue = parseFloat(value.replace(/[^0-9.]/g, '')) || 0
  const q = transferQuote(numValue, royalty, senderIsCreator)
  const mismatch = phone1 && phone2 && phone1 !== phone2

  async function submit() {
    setErr('')
    if (!name.trim() || !phone1 || !value.trim()) return setErr(t.transfer.fillAll)
    if (mismatch) return setErr(t.transfer.numbersMismatch)

    setBusy(true)
    const { checkoutUrl, error } = await createTransfer({
      workId: work.id,
      recipientPhone: phone1,
      recipientName: name.trim(),
      value: numValue,
    })
    if (error) {
      setErr(t.transfer.errors?.[error as keyof typeof t.transfer.errors] ?? t.transfer.errors.transferFailed)
      setBusy(false)
      return
    }
    if (checkoutUrl) window.location.href = checkoutUrl
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="back-link">
        ← {t.transfer.backToActions}
      </button>

      <div className="font-display font-medium text-[18px] text-ink">{t.transfer.title}</div>
      <div className="text-[12px] text-ink-soft mt-1">{work.title}</div>

      <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-[18px]">
        {t.transfer.recipientName}
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t.transfer.recipientNamePlaceholder}
        className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors placeholder:text-placeholder"
      />

      <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-3.5">
        {t.transfer.recipientPhone}
      </label>
      <PhonePicker value={digits1} onChange={(e164, d) => { setPhone1(e164); setDigits1(d) }} placeholder="203 555 1234" />

      <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-2.5">
        {t.transfer.confirmPhone}
      </label>
      <PhonePicker value={digits2} onChange={(e164, d) => { setPhone2(e164); setDigits2(d) }} placeholder="203 555 1234" />
      {mismatch && <p className="text-[10.5px] text-t-red mt-1.5">{t.transfer.numbersMismatch}</p>}

      <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-3.5">
        {t.transfer.value}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder={work.commerce?.initial_price ? money(work.commerce.initial_price) : '0'}
          className="flex-1 px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors placeholder:text-placeholder"
        />
        <span className="text-[11px] tracking-[0.1em] text-placeholder">USD</span>
      </div>
      <p className="text-[10.5px] text-placeholder mt-1.5 leading-[1.6]">{t.transfer.valueNote}</p>

      <div className="mt-4 flex flex-col divide-y divide-hairline text-[12.5px]">
        <div className="flex items-center justify-between py-2">
          <span className="text-ink-soft">{t.transfer.recordedValue}</span>
          <span className="text-ink">{money(q.value)} USD</span>
        </div>
        {q.royalty > 0 && (
          <div className="flex items-center justify-between py-2">
            {/* Una regalía fija nunca muestra porcentaje: no aplica ninguno (Spec 01 §2.4). */}
            <span className="text-ink-soft">
              {royalty.type === 'fixed'
                ? t.transfer.creatorRoyaltyFixed
                : t.transfer.creatorRoyalty.replace('{pct}', String(royalty.value))}
            </span>
            <span className="text-ink">{money(q.royalty)}</span>
          </div>
        )}
        <div className="flex items-center justify-between py-2">
          <span className="text-ink-soft">{t.transfer.transferFee}</span>
          <span className="text-ink">{money(q.transferFee)}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-ink-soft">{t.transfer.cardProcessing}</span>
          <span className="text-ink">{money(q.processing)}</span>
        </div>
        <div className="flex items-center justify-between py-2.5 font-medium">
          <span className="text-ink">{t.transfer.totalToAuthorize}</span>
          <span className="text-ink">{money(q.total)} USD</span>
        </div>
      </div>

      <p className="text-[10.5px] text-placeholder mt-2 leading-[1.6]">{t.transfer.authoriseNote}</p>

      {err && <p className="text-[12px] text-t-red text-center mt-3.5">{err}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full mt-[18px] py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-opacity disabled:opacity-60 disabled:cursor-not-allowed enabled:hover:bg-black"
      >
        {busy ? t.transfer.authorizing : t.transfer.payAmountAndSend.replace('{amount}', `${money(q.total)} USD`)}
      </button>
      <p className="text-center text-[10px] text-placeholder mt-2">{t.transfer.securedByStripe}</p>
    </div>
  )
}
