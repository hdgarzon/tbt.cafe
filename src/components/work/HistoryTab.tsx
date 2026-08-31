'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import {
  fetchOwnershipHistory,
  fetchLedger,
  type OwnershipEvent,
  type Ledger,
  type LedgerEntry,
} from '@/lib/work-data'

const EVENT_LABEL_KEY: Record<string, 'eventCreation' | 'eventTransfer'> = {
  creation: 'eventCreation',
  transfer: 'eventTransfer',
}

/** Los primeros y últimos caracteres. Un hash entero no cabe y no se lee. */
function short(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10.5px] text-ink-soft hover:text-ink transition-colors underline decoration-hairline underline-offset-2"
    >
      {children}
    </a>
  )
}

/**
 * El ancla, en voz baja.
 *
 * El spec es explícito: «Pending anchors: quiet. A word, not a warning. It
 * resolves on its own and the reader should not be alarmed by a normal state.»
 * Por eso pendiente se dice en gris y sin icono, y solo el fallo — que sí es
 * excepcional — se distingue.
 */
function Anchor({ anchor, t }: { anchor: LedgerEntry['anchor']; t: ReturnType<typeof useLocale>['t'] }) {
  if (!anchor) return null

  if (anchor.status === 'confirmed' && anchor.blockHeight) {
    return (
      <span className="text-[10.5px] text-ink-soft font-mono">
        {t.work.anchorConfirmed.replace('{height}', String(anchor.blockHeight))}
      </span>
    )
  }
  if (anchor.status === 'failed') {
    return <span className="text-[10.5px] text-t-red">{t.work.anchorFailed}</span>
  }
  return <span className="text-[10.5px] text-placeholder">{t.work.anchorPending}</span>
}

/** Los enlaces de un registro: Arweave, la prueba, y en su caso Solana. */
function RecordLinks({
  entry,
  mintAddress,
  t,
}: {
  entry: LedgerEntry
  mintAddress?: string | null
  t: ReturnType<typeof useLocale>['t']
}) {
  if (!entry.recordUri && !entry.recordHash) return null

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet'
  const cluster = network === 'mainnet-beta' ? '' : `?cluster=${network}`

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
      {entry.recordUri && (
        <ExternalLink href={entry.recordUri}>{t.work.linkArweave}</ExternalLink>
      )}
      {mintAddress && (
        <ExternalLink href={`https://explorer.solana.com/address/${mintAddress}${cluster}`}>
          {t.work.linkSolana}
        </ExternalLink>
      )}
      {/* La descarga solo donde hay ancla confirmada: una prueba pendiente aún
          no demuestra nada que un tercero pueda comprobar. */}
      {entry.recordHash && entry.anchor?.status === 'confirmed' && (
        <ExternalLink href={`/api/chain/ots/${entry.recordHash}`}>{t.work.linkOts}</ExternalLink>
      )}
      <Anchor anchor={entry.anchor} t={t} />
    </div>
  )
}

/**
 * Pestaña History de /work/[tbtId] — la línea de tiempo, y bajo cada evento el
 * registro que lo publica.
 *
 * Chain Spec 01, Item 10 Change A: «This is the surface where the promise is
 * visibly kept». Un evento sin registro se muestra igual, sin disculpas: las
 * obras anteriores a la cadena existen y su historia sigue siendo cierta.
 *
 * Monoespaciada para todo identificador y hash; sobriedad en lo demás.
 */
export function HistoryTab({ workId, tbtId }: { workId: string; tbtId: string }) {
  const { t } = useLocale()
  const [events, setEvents] = useState<OwnershipEvent[] | null>(null)
  const [ledger, setLedger] = useState<Ledger | null>(null)

  useEffect(() => {
    fetchOwnershipHistory(workId).then(setEvents)
    fetchLedger(tbtId).then(setLedger)
  }, [workId, tbtId])

  if (events === null) return <p className="text-[13px] text-ink-soft py-2">{t.work.loading}</p>
  if (events.length === 0) return <p className="text-[13px] text-ink-soft py-2">{t.myCollections.activityEmpty}</p>

  const bySequence = new Map((ledger?.provenance ?? []).map((p) => [p.id, p]))
  const registration = ledger?.registration ?? null

  return (
    <div className="flex flex-col">
      {events.map((e, i) => {
        const record = bySequence.get(e.id)
        return (
          <div key={e.id} className="flex gap-[13px] py-3.5 border-b border-hairline">
            <div className="flex flex-col items-center pt-[3px]">
              <span className={`w-[9px] h-[9px] rounded-full ${i === 0 ? 'bg-ink' : 'bg-hairline'}`} />
              <span className="flex-1 w-px bg-hairline mt-[5px] min-h-[16px]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2.5">
                <span className="text-[12px] font-medium text-ink">
                  {record?.transferType === 'gift'
                    ? t.work.eventGift
                    : record?.event === 'transfer'
                      ? t.work.eventSale
                      : (t.myCollections[EVENT_LABEL_KEY[e.event]] ?? e.event)}
                </span>
                <span className="text-[10px] text-placeholder shrink-0">
                  {new Date(e.occurred_at).toLocaleDateString()}
                </span>
              </div>
              {e.actor_label && <div className="text-[12px] text-ink-soft mt-0.5">{e.actor_label}</div>}
              {e.amount != null && (
                <div className="text-[12px] text-ink mt-0.5">
                  {money(e.amount)} {e.currency ?? 'USD'}
                </div>
              )}
              {record && <RecordLinks entry={record} t={t} />}
            </div>
          </div>
        )
      })}

      {/* ── La registración: el sello, y el origen de la cadena ───────────── */}
      <div className="flex gap-[13px] py-3.5">
        <div className="flex flex-col items-center pt-[3px]">
          <span className="w-[9px] h-[9px] rounded-full border border-ink bg-paper" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2.5">
            <span className="text-[12px] font-medium text-ink">{t.work.ledgerRegistration}</span>
            {registration?.occurredAt && (
              <span className="text-[10px] text-placeholder shrink-0">
                {new Date(registration.occurredAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {registration ? (
            <>
              {registration.recordHash && (
                <div className="text-[10.5px] text-ink-soft font-mono mt-0.5 truncate">
                  {short(registration.recordHash, 12, 8)}
                </div>
              )}
              <RecordLinks entry={registration} mintAddress={ledger?.mintAddress} t={t} />
            </>
          ) : (
            /* Sin registro publicado. Se dice sin adornos: la obra es anterior
               a la cadena, no está rota. */
            <p className="text-[11.5px] text-placeholder mt-1">{t.work.ledgerNoChain}</p>
          )}
        </div>
      </div>

      {registration && (
        <p className="text-[11px] leading-[1.55] text-ink-soft border-t border-hairline pt-3 mt-1">
          {t.work.verifyNote}
          {(ledger?.provenance ?? []).concat(registration).some((e) => e.anchor?.status === 'pending') && (
            <span className="block mt-1 text-placeholder">{t.work.anchorNote}</span>
          )}
        </p>
      )}
    </div>
  )
}
