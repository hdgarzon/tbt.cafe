'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { TransferPanel } from '@/components/work/TransferPanel'
import { money } from '@/lib/fees'
import {
  saveAvailability,
  saveTakingOffers,
  savePrice,
  saveRoyalty,
  saveFeatured,
  type WorkFull,
  type Availability,
} from '@/lib/work-data'
import { pendingTransferFor, cancelTransfer, type Transfer } from '@/lib/transfer-data'

const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

const maskPhone = (e164: string) => (e164.length > 4 ? `${e164.slice(0, -4).replace(/\d/g, '•')}${e164.slice(-4)}` : e164)

/**
 * Pestaña Action de /work/[tbtId] (Build Spec 02, ÍTEM 2) — SOLO visible
 * para el dueño (creador o coleccionista actual). Orden: Transferir arriba ·
 * Disponibilidad + ofertas en una fila · Precio y regalía lado a lado ·
 * Destacar (una línea) · Qué no cambia. La regalía se bloquea
 * permanentemente en la primera venta — enforced server-side, ver
 * work-data.ts saveRoyalty y migración 008.
 */
export function ActionTab({
  work,
  role,
  userId,
  onChanged,
}: {
  work: WorkFull
  role: 'creator' | 'collector'
  userId: string
  onChanged: () => void
}) {
  const { t } = useLocale()
  const c = work.commerce!
  const hasSold = role === 'collector' // cambió de manos → regalía bloqueada
  const royaltyLocked = c.royalty_locked || hasSold

  const [transferring, setTransferring] = useState(false)
  const [pending, setPending] = useState<Transfer | null>(null)
  const [availability, setAvailability] = useState<Availability>(c.availability)
  const [takingOffers, setTakingOffers] = useState(c.taking_offers)
  const [price, setPrice] = useState(c.initial_price ? money(c.initial_price) : '')
  // Una regalía fija es un monto, no un porcentaje: el control rotulado `%`
  // no puede editarla sin convertirla en otra cosa.
  const royaltyIsFixed = c.royalty_type === 'fixed'
  const [royalty, setRoyalty] = useState(String(c.royalty_value))
  const [featured, setFeatured] = useState(work.is_featured)
  const [remaining, setRemaining] = useState('')
  const [toast, setToast] = useState('')

  useEffect(() => {
    pendingTransferFor(work.id, userId).then(setPending)
  }, [work.id, userId])

  // Cuenta regresiva de 24h sobre la transferencia pendiente.
  useEffect(() => {
    if (!pending?.authorized_at) return
    const started = new Date(pending.authorized_at).getTime()
    const expires = started + 24 * 3600 * 1000
    const tick = () => {
      const left = Math.max(0, expires - Date.now())
      const h = Math.floor(left / 3_600_000)
      const m = Math.floor((left % 3_600_000) / 60_000)
      const s = Math.floor((left % 60_000) / 1000)
      setRemaining(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [pending?.authorized_at])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 1800)
  }

  async function onCancel() {
    if (!pending) return
    const { error } = await cancelTransfer(pending.id)
    if (error) return flash(t.transfer.errors?.[error as keyof typeof t.transfer.errors] ?? error)
    setPending(null)
    onChanged()
  }

  if (transferring) {
    return (
      <TransferPanel
        work={work}
        senderIsCreator={role === 'creator'}
        onBack={() => {
          setTransferring(false)
          pendingTransferFor(work.id, userId).then(setPending)
        }}
      />
    )
  }

  return (
    <div>
      {pending ? (
        <div className="pb-5 mb-5 border-b border-hairline">
          <div className="label-caps">{t.action.transferInProgress}</div>
          <div className="mt-2 p-3.5 bg-paper-warm rounded-xl">
            <div className="text-[13px] font-medium text-ink">
              {t.action.awaiting.replace('{name}', pending.new_owner_name ?? '')}
            </div>
            <p className="text-[12px] text-ink-soft mt-1 leading-[1.5]">
              {t.action.pendingBody
                .replace('{phone}', maskPhone(pending.new_owner_phone ?? ''))
                .replace('{clock}', remaining || '24:00:00')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-full mt-3 py-3 text-[12px] font-semibold tracking-[0.1em] uppercase text-t-red border border-t-red/30 rounded-xl hover:bg-t-red/5 transition-colors"
          >
            {t.action.cancelTransfer}
          </button>
        </div>
      ) : (
        <div className="pb-5 mb-5 border-b border-hairline">
          <button
            type="button"
            onClick={() => setTransferring(true)}
            className="w-full py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl hover:bg-black transition-colors"
          >
            {t.action.transferThisWork}
          </button>
        </div>
      )}

      <div className="pb-5 mb-5 border-b border-hairline">
        <div className="label-caps mb-2">{t.action.availability}</div>
        <div className="flex items-center gap-3">
          <select
            value={availability}
            onChange={async (e) => {
              const next = e.target.value as Availability
              setAvailability(next)
              const { error } = await saveAvailability(work.id, next)
              if (error) return flash(error)
              flash(t.action.availability)
              onChanged()
            }}
            className="flex-1 appearance-none border border-hairline rounded-lg bg-paper px-3 py-2.5 text-[13px] text-ink outline-none focus:border-ink transition-colors cursor-pointer"
          >
            <option value="for_sale">{t.action.forSale}</option>
            <option value="reserved">{t.action.reserved}</option>
            <option value="not_for_sale">{t.action.notForSale}</option>
          </select>
          <button
            type="button"
            onClick={async () => {
              const next = !takingOffers
              setTakingOffers(next)
              const { error } = await saveTakingOffers(work.id, next)
              if (error) return flash(error)
              onChanged()
            }}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-[12px] font-medium transition-colors shrink-0 ${
              takingOffers ? 'border-ink bg-paper-warm text-ink' : 'border-hairline text-ink-soft'
            }`}
          >
            <span
              className={`w-3.5 h-3.5 rounded-[4px] border-[1.5px] flex items-center justify-center ${
                takingOffers ? 'bg-ink border-ink' : 'border-ink-soft'
              }`}
            >
              {takingOffers && (
                <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 6l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2" />
                </svg>
              )}
            </span>
            {t.action.takingOffers}
          </button>
        </div>
      </div>

      <div className="pb-5 mb-5 border-b border-hairline">
        <div className="label-caps mb-2">{t.action.priceRoyalty}</div>
        <div className="flex gap-3">
          <div className="flex-1 flex items-center gap-1.5">
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={async () => {
                const n = parseFloat(price.replace(/[^0-9.]/g, ''))
                if (!isFinite(n)) return
                setPrice(money(n))
                const { error } = await savePrice(work.id, n)
                if (error) return flash(error)
                flash(t.action.priceRoyalty)
                onChanged()
              }}
              inputMode="decimal"
              className="flex-1 min-w-0 px-3 py-2.5 border border-hairline rounded-lg text-[13px] outline-none focus:border-ink transition-colors"
            />
            <span className="text-[10px] tracking-[0.1em] text-placeholder">USD</span>
          </div>
          <div className="flex-1 flex items-center gap-1.5">
            <input
              value={royalty}
              disabled={royaltyLocked || royaltyIsFixed}
              onChange={(e) => setRoyalty(e.target.value)}
              onBlur={async () => {
                const n = parseFloat(royalty)
                if (!isFinite(n) || n < 0 || n > 50) return
                const { error } = await saveRoyalty(work.id, n, royaltyLocked)
                if (error) return flash(t.action.errors.royaltyLocked)
                flash(t.action.priceRoyalty)
                onChanged()
              }}
              inputMode="decimal"
              className="flex-1 min-w-0 px-3 py-2.5 border border-hairline rounded-lg text-[13px] outline-none focus:border-ink transition-colors disabled:opacity-50"
            />
            <span className="text-[10px] tracking-[0.1em] text-placeholder">
              {royaltyIsFixed ? 'USD' : '%'}
            </span>
          </div>
        </div>
        <p className="text-[10.5px] text-placeholder mt-1.5 leading-[1.6] flex items-center gap-1">
          {royaltyLocked && <LockIcon />}
          {royaltyIsFixed
            ? t.action.royaltyIsFixed.replace('{amount}', money(c.royalty_value))
            : royaltyLocked
            ? hasSold
              ? t.action.royaltyLockedAtFirstSale
              : t.action.royaltyLockedBy.replace('{name}', work.creator?.public_alias || work.creator?.display_name || '')
            : t.action.royaltyLocksAtFirstSale}
        </p>
      </div>

      <button
        type="button"
        onClick={async () => {
          const next = !featured
          setFeatured(next)
          const { error } = await saveFeatured(work.id, next)
          if (error) return flash(error)
          onChanged()
        }}
        className="flex items-center gap-2.5 py-2.5"
      >
        <span
          className={`w-4 h-4 rounded-[5px] border-[1.5px] flex items-center justify-center ${
            featured ? 'bg-ink border-ink' : 'border-ink-soft'
          }`}
        >
          {featured && (
            <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 6l3 3 5-6" fill="none" stroke="#fff" strokeWidth="2" />
            </svg>
          )}
        </span>
        <span className="text-[13px] text-ink">{t.action.addToFeatured}</span>
      </button>

      <div className="mt-5 pt-5 border-t border-hairline">
        <div className="label-caps">{t.action.whatCantChange}</div>
        <p className="text-[12px] leading-[1.6] text-ink-soft mt-2">{t.action.whatCantChangeBody}</p>
      </div>

      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 px-4 py-2.5 bg-ink text-paper text-[12px] rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
