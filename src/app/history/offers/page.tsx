'use client'

import { useEffect, useMemo, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { fetchOffersLedger, type OfferRow } from '@/lib/history-data'
import { LedgerRow } from '@/components/LedgerRow'
import { money } from '@/lib/fees'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

const STATUS_KEY = {
  open: 'offerStatusOpen',
  accepted: 'offerStatusAccepted',
  declined: 'offerStatusDeclined',
  withdrawn: 'offerStatusWithdrawn',
  expired: 'offerStatusExpired',
} as const

/** /history/offers — ofertas hechas y recibidas (Build Spec 02, ÍTEM 6). */
function OffersLedger() {
  const { t } = useLocale()
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
                href={r.tbtId ? `/work/${r.tbtId}` : undefined}
                title={r.title}
                what={
                  r.direction === 'received'
                    ? t.myCollections.offerReceivedRow.replace('{name}', r.counterparty ?? t.work.unknownArtist)
                    : t.myCollections.offerMadeRow.replace('{status}', t.myCollections[STATUS_KEY[r.status]])
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
