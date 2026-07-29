'use client'

import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import type { WorkFull } from '@/lib/work-data'

const STATUS_LABEL_KEY = { for_sale: 'forSale', reserved: 'reserved', not_for_sale: 'notForSale' } as const
const STATUS_DOT = { for_sale: 'bg-t-green', reserved: 'bg-t-yellow', not_for_sale: 'bg-ink-soft' } as const

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex items-center justify-between py-2.5 text-[13px]">
    <span className="text-ink-soft">{k}</span>
    <span className="text-ink text-right">{v}</span>
  </div>
)

const SolanaMark = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="solg" x1="0" y1="0" x2="24" y2="24">
        <stop offset="0" stopColor="#9945FF" />
        <stop offset="1" stopColor="#14F195" />
      </linearGradient>
    </defs>
    <rect width="24" height="24" rx="6" fill="url(#solg)" />
    <path d="M6 8.5h9l2-1.5H8l-2 1.5zM6 12.75h9l2-1.5H8l-2 1.5zM6 17h9l2-1.5H8L6 17z" fill="#fff" />
  </svg>
)

/**
 * Pestaña Info de /work/[tbtId] (Build Spec 02, ÍTEM 1). Orden FIJO:
 * Value → Blockchain → Protection — el registro en cadena es el punto del
 * producto, va antes que la protección (cambió tarde en el prototipo, fácil
 * de invertir por error).
 */
export function InfoTab({ work }: { work: WorkFull }) {
  const { t } = useLocale()
  const c = work.commerce!
  const price = c.initial_price != null ? `${money(c.initial_price)} USD` : '—'
  const explorerUrl = work.mint_address
    ? `https://explorer.solana.com/address/${work.mint_address}${process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'devnet' ? '?cluster=devnet' : ''}`
    : null

  return (
    <div>
      <div className="pb-5 mb-5 border-b border-hairline">
        <div className="label-caps">{t.info.value}</div>
        <div className="font-display text-[26px] leading-tight text-ink mt-2">{price}</div>
        <div className="flex flex-col divide-y divide-hairline mt-1">
          <Row
            k={t.info.status}
            v={
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.availability]}`} />
                {t.action[STATUS_LABEL_KEY[c.availability]]}
              </span>
            }
          />
          <Row k={t.info.offers} v={c.taking_offers ? t.info.openToOffers : t.info.notTakingOffers} />
          <Row k={t.info.royalty} v={`${c.royalty_pct}% · ${t.info.deducted}`} />
          <Row k={t.info.currentOwner} v={work.creator?.public_alias || work.creator?.display_name || t.work.unknownArtist} />
          <Row k={t.info.initialPrice} v={price} />
        </div>
      </div>

      <div className="pb-5 mb-5 border-b border-hairline">
        <div className="label-caps">{t.info.blockchain}</div>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 mt-2.5 p-3 border border-hairline rounded-xl hover:border-ink transition-colors"
          >
            <SolanaMark />
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-ink">{t.info.registeredOnSolana}</span>
              <span className="block text-[11px] text-ink-soft truncate">{work.mint_address}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17L17 7M17 7H9M17 7v8" />
            </svg>
          </a>
        ) : (
          <p className="text-[13px] text-ink-soft mt-2.5">{t.work.pending}</p>
        )}
        <div className="flex flex-col divide-y divide-hairline mt-1">
          <Row k={t.info.tbtId} v={<span className="font-mono">{work.tbt_id}</span>} />
          <Row k={t.info.registered} v={work.certified_at ? new Date(work.certified_at).toLocaleString() : '—'} />
          <Row k={t.info.record} v={t.info.immutable} />
        </div>
      </div>

      <div>
        <div className="label-caps">{t.info.protection}</div>
        <div className="flex items-start gap-2.5 mt-2.5">
          <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-t-green/15 text-t-green flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <span className="text-[13px] text-ink">
            <b className="font-medium">{t.info.scanPassed}</b>
            <span className="block text-[12px] text-ink-soft mt-0.5">{t.info.scanDetail}</span>
          </span>
        </div>
        <div className="flex flex-col divide-y divide-hairline mt-2.5">
          <Row k={t.info.imageFingerprint} v={<span className="font-mono">{work.id.slice(0, 4)}…{work.id.slice(-4)}</span>} />
          <Row k={t.info.scanned} v={work.certified_at ? new Date(work.certified_at).toLocaleDateString() : '—'} />
        </div>
      </div>
    </div>
  )
}
