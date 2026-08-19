'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { fetchEarnings, sumOf, type Earning } from '@/lib/payout-data'
import { ReceiptIcon } from '@/components/Brand'
import { CollectSheet } from '@/components/CollectSheet'

/**
 * /history/payouts — payoutPage del prototipo.
 *
 * La regla que da forma a toda la pantalla (Spec 01 §4.4): lo pendiente se
 * MUESTRA, con por qué está retenido y cuándo libera, pero no se puede
 * seleccionar. El dinero existe; simplemente todavía no es cobrable. Ocultarlo
 * haría pensar que se perdió, y dejarlo seleccionable prometería un cobro que
 * va a fallar.
 */

const plural = (n: number, one: string, many: string) =>
  (n === 1 ? one : many).replace('{n}', String(n))

export default function PayoutsPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Se reinicia en cada recálculo para volver a disparar el destello.
  const [flashKey, setFlashKey] = useState(0)
  const [collecting, setCollecting] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setSignedIn(false)
        setLoading(false)
        return
      }
      const rows = await fetchEarnings(user.id)
      setEarnings(rows)
      // Todo lo cobrable arranca marcado, como en el prototipo: lo normal es
      // cobrarlo entero, y desmarcar es el gesto raro.
      setSelected(new Set(rows.filter((e) => e.state === 'available').map((e) => e.id)))
      setLoading(false)
    })()
  }, [])

  // Cobrado ya salió; no pinta en esta lista, que es sobre lo que se debe.
  const rows = useMemo(() => earnings.filter((e) => e.state !== 'collected'), [earnings])
  const pending = useMemo(() => rows.filter((e) => e.state === 'pending'), [rows])
  const selectedRows = useMemo(() => rows.filter((e) => selected.has(e.id)), [rows, selected])
  const selectedTotal = sumOf(selectedRows)
  const pendingTotal = sumOf(pending)

  function toggle(earning: Earning) {
    if (earning.state !== 'available') return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(earning.id)) next.delete(earning.id)
      else next.add(earning.id)
      return next
    })
    setFlashKey((n) => n + 1)
  }

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>

  if (!signedIn) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">
          ← {t.purchase.home}
        </a>
        <p className="text-[14px] mt-6">{t.myCollections.needSignIn}</p>
      </div>
    )
  }

  return (
    <>
    <div className="px-4 pt-6">
      <a href="/" className="back-link">
        ← {t.purchase.home}
      </a>
      <h1 className="page-title">{t.payouts.title}</h1>
      <div className="text-[11px] text-placeholder mt-1.5">{new Date().toLocaleDateString()}</div>

      {/* Barra de estadísticas + acciones (.txp-bar) */}
      <div className="flex items-center justify-between gap-3 mt-4 mb-1 pb-3 border-b border-hairline">
        <div
          key={flashKey}
          className="animate-stats-flash text-[11.5px] tracking-[0.02em] text-ink"
        >
          <span className="font-medium tabular-nums">{selectedRows.length}</span>{' '}
          <span className="text-ink-soft">{t.payouts.valuedAt}</span>{' '}
          <span className="font-medium tabular-nums">{money(selectedTotal)} USD</span>
          {pending.length > 0 && (
            <div className="text-[11px] text-placeholder mt-1 tracking-normal normal-case">
              {plural(pending.length, t.payouts.settlingLine, t.payouts.settlingLinePlural).replace(
                '{amount}',
                money(pendingTotal)
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => setCollecting(true)}
            className="rounded-lg bg-t-green px-[18px] py-2 text-[10px] font-medium tracking-[0.1em] uppercase text-paper whitespace-nowrap transition-opacity hover:opacity-85 disabled:opacity-40 disabled:cursor-default"
          >
            {t.payouts.collect}
          </button>
          <a
            href="/history/payouts/receipts"
            aria-label={t.payouts.receipts}
            title={t.payouts.receipts}
            className="w-[34px] h-[34px] shrink-0 flex items-center justify-center text-ink-soft hover:text-ink transition-colors"
          >
            <ReceiptIcon />
          </a>
        </div>
      </div>

      {toast && (
        <p className="mt-3 rounded-[10px] border border-hairline bg-paper-warm px-3.5 py-2.5 text-[11.5px] text-ink">
          {toast}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] leading-[1.7] text-placeholder">
          {t.payouts.empty}
        </p>
      ) : (
        <div>
          {rows.map((earning) => {
            const isPending = earning.state === 'pending'
            return (
              <div
                key={earning.id}
                className={`flex items-start gap-3 py-4 border-b border-hairline last:border-b-0 ${
                  isPending ? 'opacity-[.62]' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(earning.id)}
                  disabled={isPending}
                  onChange={() => toggle(earning)}
                  aria-label={earning.title ?? t.payouts.source[earning.source]}
                  className={`w-[18px] h-[18px] mt-[3px] shrink-0 accent-t-green ${
                    isPending ? 'cursor-default' : 'cursor-pointer'
                  }`}
                />

                <div className="min-w-0 flex-1">
                  {earning.tbtId ? (
                    <a
                      href={`/work/${earning.tbtId}`}
                      className="block font-display text-[16px] leading-[1.3] text-ink hover:underline underline-offset-[3px]"
                    >
                      {earning.title}
                    </a>
                  ) : (
                    <span className="block font-display text-[16px] leading-[1.3] text-ink">
                      {earning.title ?? t.payouts.source[earning.source]}
                    </span>
                  )}

                  <div className="flex items-center flex-wrap mt-[5px] text-[10px] text-placeholder">
                    <span>{new Date(earning.createdAt).toLocaleDateString()}</span>
                    {isPending && (
                      <span className="ml-2 inline-block rounded-[20px] border border-hairline bg-paper-warm px-2 py-0.5 text-[9.5px] tracking-[0.06em] text-ink-soft normal-case">
                        {/* Por qué está retenido y cuándo libera — §4.4. Sin fecha
                            cuando la liberación es por evento y no por reloj. */}
                        {earning.holdReason === 'awaiting_counterparty' || !earning.releasesAt
                          ? t.payouts.holdCounterparty
                          : t.payouts.pendingUntil.replace(
                              '{date}',
                              new Date(earning.releasesAt).toLocaleDateString()
                            )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex flex-col items-end gap-1.5 text-right">
                  <span className="text-[12.5px] text-ink whitespace-nowrap tabular-nums">
                    {money(earning.amount)} USD
                  </span>
                  <span className="text-[10px] text-ink-soft">
                    {t.payouts.source[earning.source]}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>

      <CollectSheet
        open={collecting}
        onClose={() => setCollecting(false)}
        earnings={selectedRows}
        onCollected={async (blockId) => {
          setCollecting(false)
          setToast(t.payouts.collectedToast.replace('{id}', blockId))
          // Releer en vez de mutar en memoria: lo cobrado sale de la lista y el
          // resto de estados los decide la base, no esta pantalla.
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (!user) return
          const fresh = await fetchEarnings(user.id)
          setEarnings(fresh)
          setSelected(new Set(fresh.filter((e) => e.state === 'available').map((e) => e.id)))
        }}
      />
    </>
  )
}