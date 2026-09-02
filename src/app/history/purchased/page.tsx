'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { fetchPurchased, type PurchaseRow } from '@/lib/history-data'
import { LedgerRow } from '@/components/LedgerRow'
import { money } from '@/lib/fees'
import { SignInGate } from '@/components/SignInGate'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

/**
 * /history/purchased — obras que el usuario compró.
 *
 * El espejo de /history/sales. Transactions es la mirada de dinero —qué salió
 * y qué entró—; /collections/acquisitions enseña lo mismo como colección, que
 * es otra pregunta.
 */
export default function PurchasedPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [rows, setRows] = useState<PurchaseRow[]>([])

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
      setRows(await fetchPurchased(user.id))
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
      <h1 className="page-title">{t.menu.purchased}</h1>
      <div className="page-sub">{t.myCollections.salesSub}</div>

      {rows.length === 0 ? (
        <p className="page-note">{t.myCollections.salesEmpty}</p>
      ) : (
        <>
          <p className="text-[12px] text-ink-soft mt-4">
            {plural(rows.length, t.myCollections.entryCount, t.myCollections.entryCountPlural)}
          </p>
          <div className="mt-1">
            {rows.map((r) => (
              <LedgerRow
                key={r.id}
                href={r.tbtId ? `/work/${r.tbtId}` : undefined}
                title={r.title}
                what={t.myCollections.saleRow.replace('{name}', r.sellerName ?? t.work.unknownArtist)}
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
