'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { money } from '@/lib/fees'
import { fetchTransferForAccept, respondTransfer, type TransferForAccept } from '@/lib/transfer-data'

/**
 * /transfer/accept/[transferId] — el lado del RECIPIENTE (Transfer & Commerce
 * Companion). Llega por link de SMS; puede no tener cuenta todavía, así que
 * esta vista crea autenticación inline antes de aceptar/rechazar. El
 * certificado y la llave privada se entregan por MMS al aceptar — NUNCA en
 * pantalla (screenshot risk), así que esta pantalla solo confirma que se
 * envió, no lo muestra.
 */
export default function TransferAcceptPage({ params }: { params: { transferId: string } }) {
  const { t } = useLocale()
  const { connected, openAuth } = useShell()

  const [loading, setLoading] = useState(true)
  const [transfer, setTransfer] = useState<TransferForAccept | null>(null)
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const [outcome, setOutcome] = useState<'accepted' | 'rejected' | 'lapsed' | 'error' | null>(null)
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    fetchTransferForAccept(params.transferId).then((t) => {
      setTransfer(t)
      setLoading(false)
    })
  }, [params.transferId])

  async function respond(action: 'accept' | 'reject') {
    if (!connected) return openAuth()
    setBusy(action)
    const { error } = await respondTransfer(params.transferId, action)
    setBusy(null)
    if (error === 'lapsed') return setOutcome('lapsed')
    if (error) {
      setErrMsg(t.transferAccept.errors?.[error as keyof typeof t.transferAccept.errors] ?? t.transferAccept.errors.respondFailed)
      return setOutcome('error')
    }
    setOutcome(action === 'accept' ? 'accepted' : 'rejected')
  }

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.transferAccept.loading}</div>

  if (!transfer) {
    return (
      <div className="px-4 pt-8 text-center">
        <p className="text-[14px] text-ink">{t.transferAccept.notFound}</p>
      </div>
    )
  }

  if (outcome === 'accepted') {
    return (
      <div className="px-4 pt-10 text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13.5l5 5L21 7.5" />
          </svg>
        </div>
        <h1 className="font-display font-medium text-[26px] text-ink">{t.transferAccept.acceptedTitle}</h1>
        <p className="text-[13px] leading-[1.6] text-ink-soft mt-3 px-4">{t.transferAccept.acceptedBody}</p>
        <a href="/" className="inline-block mt-6 text-[12px] font-semibold tracking-[0.14em] uppercase text-ink">
          {t.transferAccept.done}
        </a>
      </div>
    )
  }

  if (outcome === 'rejected') {
    return (
      <div className="px-4 pt-10 text-center">
        <h1 className="font-display font-medium text-[24px] text-ink">{t.transferAccept.rejectedTitle}</h1>
        <p className="text-[13px] leading-[1.6] text-ink-soft mt-3 px-4">{t.transferAccept.rejectedBody}</p>
      </div>
    )
  }

  if (outcome === 'lapsed' || transfer.status === 'lapsed') {
    return (
      <div className="px-4 pt-10 text-center">
        <h1 className="font-display font-medium text-[24px] text-ink">{t.transferAccept.lapsedTitle}</h1>
        <p className="text-[13px] leading-[1.6] text-ink-soft mt-3 px-4">{t.transferAccept.lapsedBody}</p>
      </div>
    )
  }

  if (transfer.status !== 'pending' && transfer.status !== 'authorizing') {
    return (
      <div className="px-4 pt-10 text-center">
        <h1 className="font-display font-medium text-[24px] text-ink">{t.transferAccept.alreadyResolvedTitle}</h1>
        <p className="text-[13px] leading-[1.6] text-ink-soft mt-3 px-4">{t.transferAccept.alreadyResolvedBody}</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-8">
      <div className="text-center">
        <div className="label-caps">{t.transferAccept.kicker}</div>
        {transfer.workMediaUrl && (
          <div
            className="w-40 h-40 mx-auto mt-4 rounded-2xl bg-paper-warm border border-hairline overflow-hidden bg-cover bg-center"
            style={{ backgroundImage: `url(${transfer.workMediaUrl})` }}
          />
        )}
        <h1 className="font-display font-medium text-[22px] text-ink mt-4 px-2">
          {t.transferAccept.title.replace('{sender}', transfer.senderName ?? '')}
        </h1>
        <div className="text-[14px] text-ink-soft mt-1">{transfer.workTitle}</div>
        {transfer.value != null && (
          <div className="flex items-center justify-center gap-1.5 mt-3 text-[13px]">
            <span className="text-ink-soft">{t.transferAccept.value}</span>
            <span className="font-medium text-ink">
              {money(transfer.value)} {transfer.currency}
            </span>
          </div>
        )}
      </div>

      {!connected ? (
        <div className="mt-8 text-center">
          <p className="text-[13px] text-ink-soft px-4">{t.transferAccept.needSignInBody}</p>
          <button
            type="button"
            onClick={openAuth}
            className="w-full mt-5 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl hover:bg-black transition-colors"
          >
            {t.transferAccept.needSignInTitle}
          </button>
        </div>
      ) : (
        <div className="mt-8">
          {errMsg && <p className="text-[12px] text-t-red text-center mb-3">{errMsg}</p>}
          <button
            type="button"
            onClick={() => respond('accept')}
            disabled={busy !== null}
            className="w-full py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-opacity disabled:opacity-60 enabled:hover:bg-black"
          >
            {busy === 'accept' ? t.transferAccept.accepting : t.transferAccept.accept}
          </button>
          <button
            type="button"
            onClick={() => respond('reject')}
            disabled={busy !== null}
            className="w-full mt-2.5 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase border border-hairline text-ink-soft rounded-xl transition-opacity disabled:opacity-60 enabled:hover:border-ink enabled:hover:text-ink"
          >
            {busy === 'reject' ? t.transferAccept.rejecting : t.transferAccept.reject}
          </button>
        </div>
      )}
    </div>
  )
}
