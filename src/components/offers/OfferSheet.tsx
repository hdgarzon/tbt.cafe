'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { StandingSheet } from '@/components/Sheet'
import { money } from '@/lib/fees'
import { fetchOffer, actOnOffer, type OfferDetail } from '@/lib/offers-data'
import { useCountdown } from '@/components/offers/Countdown'

/**
 * La hoja de una oferta — Work Order 02, Stage 4.12.
 *
 * Se abre en el sitio desde el hub (un aviso de oferta, Historial → Ofertas):
 * nadie sale del hub para responder. Quien tiene la obra ve el mensaje entero
 * con Aceptar, Rechazar y una respuesta; quien oferto ve la respuesta y Retirar,
 * o, aceptada, Pagar con la cuenta regresiva. Cada mensaje se puede reportar.
 */
export function OfferSheet({ offerId, onClose }: { offerId: string | null; onClose: () => void }) {
  const { t } = useLocale()
  const [offer, setOffer] = useState<OfferDetail | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [needApproval, setNeedApproval] = useState(false)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [confirmReport, setConfirmReport] = useState<'message' | 'response' | null>(null)
  const [reported, setReported] = useState(false)

  async function load(id: string) {
    const o = await fetchOffer(id)
    setOffer(o)
    if (!o) setMsg(t.transferAccept.errors.respondFailed)
  }

  useEffect(() => {
    setOffer(null)
    setReply('')
    setMsg('')
    setNeedApproval(false)
    setConfirmWithdraw(false)
    setConfirmReport(null)
    setReported(false)
    if (offerId) load(offerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId])

  const expiresIn = useCountdown(offer?.status === 'open' ? offer.expiresAt : null)
  const payIn = useCountdown(offer?.status === 'accepted' ? offer.paymentDueAt : null)

  async function act(action: 'accept' | 'decline' | 'withdraw' | 'cancel' | 'report', which?: 'message' | 'response') {
    if (!offer) return
    setBusy(true)
    setMsg('')
    const r = await actOnOffer(offer.id, action, { reply: reply.trim() || undefined, which })
    setBusy(false)
    if (r.error === 'need_approval') return setNeedApproval(true)
    if (r.error) return setMsg(t.transferAccept.errors.respondFailed)
    if (action === 'report') {
      setConfirmReport(null)
      return setReported(true)
    }
    setConfirmWithdraw(false)
    await load(offer.id)
  }

  const statusLabel = (s: OfferDetail['status']) =>
    ({
      open: t.myCollections.offerStatusOpen,
      accepted: t.myCollections.offerStatusAccepted,
      declined: t.myCollections.offerStatusDeclined,
      withdrawn: t.myCollections.offerStatusWithdrawn,
      expired: t.myCollections.offerStatusExpired,
      cancelled: t.myCollections.offerStatusCancelled,
      completed: t.myCollections.offerStatusCompleted,
    })[s]

  const holder = offer?.role === 'holder'
  const open = offer?.status === 'open' && !offer.suspended
  const accepted = offer?.status === 'accepted'
  const pastDue = accepted && !!offer?.paymentDueAt && new Date(offer.paymentDueAt) <= new Date()

  const primary =
    'w-full rounded-[10px] bg-ink py-3.5 text-[12px] font-medium tracking-[0.08em] uppercase text-paper transition-opacity disabled:opacity-30'
  const secondary =
    'w-full rounded-[10px] border border-ink py-3 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink disabled:opacity-30'
  const line = 'text-[12.5px] leading-[1.6] text-ink-soft'

  let footer: React.ReactNode = null
  if (offer && holder && open) {
    footer = (
      <div className="flex flex-col gap-2">
        <button type="button" disabled={busy} onClick={() => act('accept')} className={primary}>
          {t.offer.accept}
        </button>
        <button type="button" disabled={busy} onClick={() => act('decline')} className={secondary}>
          {t.offer.decline}
        </button>
      </div>
    )
  } else if (offer && holder && pastDue) {
    footer = (
      <button type="button" disabled={busy} onClick={() => act('cancel')} className={secondary}>
        {t.offer.sellerCancel}
      </button>
    )
  } else if (offer && !holder && open) {
    footer = confirmWithdraw ? (
      <button type="button" disabled={busy} onClick={() => act('withdraw')} className={primary}>
        {t.offer.withdraw}
      </button>
    ) : (
      <button type="button" onClick={() => setConfirmWithdraw(true)} className={secondary}>
        {t.offer.withdraw}
      </button>
    )
  } else if (offer && !holder && accepted && offer.payAvailable) {
    footer = (
      <a href={`/work/${offer.work.tbtId}?payOffer=${offer.id}`} className={`${primary} block text-center`}>
        {t.offer.pay.replace('{amount}', money(offer.amount))}
      </a>
    )
  }

  const MessageBlock = ({ text, which, reportable }: { text: string; which: 'message' | 'response'; reportable: boolean }) => (
    <div className="rounded-xl border border-hairline bg-paper-warm px-3.5 py-3">
      <p className="text-[13px] leading-[1.6] text-ink whitespace-pre-wrap break-words">{text}</p>
      {reportable && !reported && (
        <button type="button" onClick={() => setConfirmReport(which)} className="mt-2 text-[10.5px] underline text-ink-soft">
          {t.offer.report}
        </button>
      )}
    </div>
  )

  return (
    <StandingSheet open={!!offerId} onClose={onClose} head={holder ? t.offer.respond : t.menu.offers} footer={footer}>
      {!offer ? (
        <p className={`${line} pb-4`}>{msg || t.authHub.loading}</p>
      ) : (
        <div className="flex flex-col gap-3.5 pb-4">
          <div>
            <a href={`/work/${offer.work.tbtId}`} className="font-display text-[20px] leading-[1.2] text-ink">
              {offer.work.title}
            </a>
            {offer.counterparty && <div className="text-[12px] text-ink-soft mt-1">{offer.counterparty}</div>}
            <div className="text-[18px] text-ink mt-2 tabular-nums">{money(offer.amount)} USD</div>
          </div>

          {open && <p className={line}>{t.offer.expiresIn.replace('{time}', expiresIn)}</p>}
          {accepted && !holder && (
            <p className="text-[13px] leading-[1.6] text-ink">
              {t.offer.acceptedBuyer.replace('{hours}', String(Math.max(0, Math.ceil((new Date(offer.paymentDueAt ?? 0).getTime() - Date.now()) / 3_600_000))))}{' '}
              <span className="tabular-nums">{payIn}</span>
            </p>
          )}
          {accepted && holder && <p className={line}>{statusLabel('accepted')} · <span className="tabular-nums">{payIn}</span></p>}
          {!open && !accepted && <p className={line}>{statusLabel(offer.status)}</p>}

          {/* El mensaje de quien oferto: entero para los dos; lo reporta quien lo recibe. */}
          {offer.message && <MessageBlock text={offer.message} which="message" reportable={holder} />}
          {/* La respuesta de quien tiene la obra: la reporta quien oferto. */}
          {offer.responseMessage && <MessageBlock text={offer.responseMessage} which="response" reportable={!holder} />}

          {confirmReport && (
            <div className="flex items-center justify-between gap-3">
              <span className={line}>{t.offer.reportConfirm}</span>
              <button type="button" disabled={busy} onClick={() => act('report', confirmReport)} className="text-[11px] font-semibold underline text-ink">
                {t.offer.report}
              </button>
            </div>
          )}
          {reported && <p className={line}>{t.offer.reported}</p>}

          {holder && open && (
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t.offer.reply}
              rows={3}
              className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink resize-none"
            />
          )}

          {needApproval && (
            <p className="text-[12.5px] leading-[1.6] text-ink">
              {t.offer.needApproval}{' '}
              <a href="/settings/selling" className="underline">
                {t.work.saleLockedCta}
              </a>
            </p>
          )}

          {confirmWithdraw && <p className={line}>{t.offer.withdrawConfirm.replace('{title}', offer.work.title)}</p>}

          {/* 4.11: lo acordado fuera acaba igual en una transferencia aqui. */}
          <p className="text-[10.5px] leading-[1.55] text-placeholder">{t.offer.elsewhere}</p>
          {msg && <p className="text-[11.5px] text-t-red">{msg}</p>}
        </div>
      )}
    </StandingSheet>
  )
}
