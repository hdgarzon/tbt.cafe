'use client'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { fetchOffersLedger, type OfferRow } from '@/lib/history-data'
import { LedgerRow } from '@/components/LedgerRow'
import { money } from '@/lib/fees'
import { SignInGate } from '@/components/SignInGate'
import { useShell } from '@/components/AppShell'
import { useCountdown } from '@/components/offers/Countdown'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

const STATUS_KEY = {
  open: 'offerStatusOpen',
  accepted: 'offerStatusAccepted',
  declined: 'offerStatusDeclined',
  withdrawn: 'offerStatusWithdrawn',
  expired: 'offerStatusExpired',
  cancelled: 'offerStatusCancelled',
  completed: 'offerStatusCompleted',
} as const

/**
 * El estado de una fila con su reloj (Work Order 02, 4.13): abierta cuenta
 * hasta que vence; aceptada, hasta que vence el pago.
 */
function OfferStatusLine({ row, template }: { row: OfferRow; template: string }) {
  const { t } = useLocale()
  const until = row.status === 'open' ? row.expiresAt : row.status === 'accepted' ? row.paymentDueAt : null
  const left = useCountdown(until)
  const label = t.myCollections[STATUS_KEY[row.status]]
  // La fila hecha trae su propio {status}; la recibida lo lleva al final.
  const text = template.includes('{status}') ? template.replace('{status}', label) : `${template} · ${label}`
  return (
    <>
      {text}
      {until && left && <span className="tabular-nums"> · {left}</span>}
    </>
  )
}

/** /history/offers — ofertas hechas y recibidas (Build Spec 02, ÍTEM 6). */
function OffersLedger() {
  const { t } = useLocale()
  const { openOffer } = useShell()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [rows, setRows] = useState<OfferRow[]>([])
  /**
   * Made y Received son la misma lista mirada desde los dos lados, así que
   * comparten página y se separan con un filtro en la URL. Partirlas en dos
   * rutas habría duplicado la consulta para cambiar un `where`.
   */
  const direction = useSearchParams().get('d')
  const shown = useMemo(
    () => (direction === 'made' || direction === 'received'
      ? rows.filter((r) => r.direction === direction)
      : rows),
    [rows, direction]
  )

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
      setRows(await fetchOffersLedger(user.id))
      setLoading(false)
    })()
  }, [])

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) {
    return <SignInGate message={t.myCollections.needSignIn} />
  }

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">
        ← {t.purchase.home}
      </a>
      <h1 className="page-title">{t.menu.offers}</h1>
      <div className="page-sub">{t.myCollections.offersSub}</div>

      {shown.length === 0 ? (
        <p className="page-note">{t.myCollections.offersEmpty}</p>
      ) : (
        <>
          <p className="text-[12px] text-ink-soft mt-4">
            {plural(shown.length, t.myCollections.entryCount, t.myCollections.entryCountPlural)}
          </p>
          <div className="mt-1">
            {shown.map((r) => (
              <LedgerRow
                key={r.id}
                // Se abre la hoja en el sitio (4.12): responder no saca de aqui.
                onClick={() => openOffer(r.id)}
                title={r.title}
                what={
                  r.direction === 'received' ? (
                    <OfferStatusLine
                      row={r}
                      template={t.myCollections.offerReceivedRow.replace('{name}', r.counterparty ?? t.work.unknownArtist)}
                    />
                  ) : (
                    <OfferStatusLine row={r} template={t.myCollections.offerMadeRow} />
                  )
                }
                amount={`${money(r.amount)} USD`}
                when={new Date(r.when).toLocaleDateString()}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * `useSearchParams` obliga a un límite de Suspense: sin él Next no puede
 * prerenderizar la ruta y el build falla al generarla. El filtro de dirección
 * es lo único que lo necesita, así que el límite envuelve solo esta vista.
 */
export default function OffersPage() {
  return (
    <Suspense fallback={null}>
      <OffersLedger />
    </Suspense>
  )
}
