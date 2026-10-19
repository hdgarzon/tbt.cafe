'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { fetchEarnings, sumOf, type Earning } from '@/lib/payout-data'
import { ReceiptIcon } from '@/components/Brand'
import { CollectSheet } from '@/components/CollectSheet'
import { SignInGate } from '@/components/SignInGate'
import { DIGITAL_METHODS, planDeliveryDetails, type DeliveryAddress, type DeliveryChoice, type DigitalMethod } from '@/lib/delivery'

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
  const [userId, setUserId] = useState<string | null>(null)

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
      setUserId(user.id)
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
    return <SignInGate message={t.myCollections.needSignIn} />
  }

  return (
    <>
    <div className="px-4 pt-6">
      <a href="/" className="back-link">
        ← {t.purchase.home}
      </a>
      <h1 className="page-title">{t.payouts.title}</h1>
      <div className="text-[11px] text-placeholder mt-1.5">{new Date().toLocaleDateString()}</div>

      {/* Decision 94: las ventas que esperan los datos de entrega de quien vende. */}
      {userId && <DeliveryRequests userId={userId} onSent={(msg) => setToast(msg)} />}

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

type DeliveryRequest = {
  transfer_id: string
  choice: DeliveryChoice
  address: DeliveryAddress | null
  created_at: string
  work: { title: string | null } | { title: string | null }[] | null
}

/**
 * Las ventas que esperan los datos de entrega de quien vende — Work Order 02,
 * Amendment Delivery 01 (decision 94), Stage 7.
 *
 * La RLS de sale_deliveries solo deja leer al comprador y al vendedor de cada
 * venta; aqui se piden las de quien vende. La direccion se ve aqui, con sesion,
 * y no en ningun aviso. Con "entregamelo" en la via de plataforma, la ganancia
 * de la venta espera estos datos (079); darlos la suelta (081).
 *
 * No va detras de DELIVERY_LIVE: solo hay filas si alguna venta las escribio.
 */
function DeliveryRequests({ userId, onSent }: { userId: string; onSent: (msg: string) => void }) {
  const { t } = useLocale()
  const d = t.delivery.details
  const [rows, setRows] = useState<DeliveryRequest[]>([])
  const [carrier, setCarrier] = useState<Record<string, string>>({})
  const [tracking, setTracking] = useState<Record<string, string>>({})
  const [method, setMethod] = useState<Record<string, DigitalMethod>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  const [error, setError] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    supabase
      .from('sale_deliveries')
      .select('transfer_id, choice, address, created_at, work:works(title)')
      .eq('seller_id', userId)
      .is('details_submitted_at', null)
      .neq('choice', 'none')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (alive) setRows((data ?? []) as DeliveryRequest[])
      })
    return () => {
      alive = false
    }
  }, [userId])

  if (rows.length === 0) return null

  async function send(r: DeliveryRequest) {
    const input = { carrier: carrier[r.transfer_id], tracking: tracking[r.transfer_id], method: method[r.transfer_id], note: note[r.transfer_id] }
    const plan = planDeliveryDetails(r.choice, input)
    if (!plan.ok) return setError((e) => ({ ...e, [r.transfer_id]: t.delivery.detailsErrors[plan.error] }))
    setBusy(r.transfer_id)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch('/api/delivery/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ transferId: r.transfer_id, ...input }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = String(json.error ?? 'details_failed')
        return setError((e) => ({ ...e, [r.transfer_id]: (t.delivery.detailsErrors as Record<string, string>)[code] ?? t.delivery.detailsErrors.details_failed }))
      }
      setRows((all) => all.filter((x) => x.transfer_id !== r.transfer_id))
      onSent(d.sent)
    } finally {
      setBusy(null)
    }
  }

  const field = 'w-full rounded-lg border border-hairline bg-paper px-3 py-2.5 text-[13px] text-ink outline-none focus:border-ink'

  return (
    <section className="mt-5 mb-2 rounded-xl border border-hairline p-4">
      <h2 className="text-[13px] font-medium text-ink">{d.title}</h2>
      <div className="mt-3 flex flex-col divide-y divide-hairline">
        {rows.map((r) => {
          const work = Array.isArray(r.work) ? r.work[0] : r.work
          return (
            <div key={r.transfer_id} className="py-3 first:pt-0 last:pb-0">
              <div className="text-[13px] text-ink">{work?.title ?? ''}</div>
              <div className="text-[11.5px] text-ink-soft mt-0.5">
                {r.choice === 'deliver' ? d.choiceDeliver : r.choice === 'collect' ? d.choiceCollect : d.choiceDigital}
              </div>
              {r.choice === 'deliver' && r.address && (
                <address className="not-italic text-[12px] leading-[1.5] text-ink mt-2">
                  {[r.address.name, r.address.line1, r.address.line2, [r.address.postalCode, r.address.city].filter(Boolean).join(' '), r.address.region, r.address.country]
                    .filter(Boolean)
                    .map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                </address>
              )}
              {r.choice === 'deliver' && <p className="text-[11px] text-placeholder mt-1">{d.heldNote}</p>}

              <div className="mt-2.5 flex flex-col gap-2">
                {r.choice === 'deliver' && (
                  <>
                    <input value={carrier[r.transfer_id] ?? ''} onChange={(e) => setCarrier((v) => ({ ...v, [r.transfer_id]: e.target.value }))} placeholder={d.carrier} aria-label={d.carrier} maxLength={200} className={field} />
                    <input value={tracking[r.transfer_id] ?? ''} onChange={(e) => setTracking((v) => ({ ...v, [r.transfer_id]: e.target.value }))} placeholder={d.tracking} aria-label={d.tracking} maxLength={200} className={field} />
                  </>
                )}
                {r.choice === 'digital' && (
                  <>
                    <select value={method[r.transfer_id] ?? ''} onChange={(e) => setMethod((v) => ({ ...v, [r.transfer_id]: e.target.value as DigitalMethod }))} aria-label={d.method} className={field}>
                      <option value="" disabled>
                        {d.method}
                      </option>
                      {DIGITAL_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m === 'download_link' ? d.methodDownloadLink : m === 'file_sent' ? d.methodFileSent : d.methodEmail}
                        </option>
                      ))}
                    </select>
                    <input value={note[r.transfer_id] ?? ''} onChange={(e) => setNote((v) => ({ ...v, [r.transfer_id]: e.target.value }))} placeholder={d.note} aria-label={d.note} maxLength={200} className={field} />
                  </>
                )}
                <button
                  type="button"
                  disabled={busy === r.transfer_id}
                  onClick={() => send(r)}
                  className="w-full rounded-lg bg-ink text-paper py-2.5 text-[12px] font-medium disabled:opacity-40"
                >
                  {r.choice === 'collect' ? d.collectedConfirm : d.submit}
                </button>
                {error[r.transfer_id] && <p className="text-[11px] text-t-red">{error[r.transfer_id]}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
