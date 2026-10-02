'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { fetchBrews, type BrewRow } from '@/lib/history-data'
import { LedgerRow } from '@/components/LedgerRow'
import { ReceiptSheet } from '@/components/ReceiptSheet'
import { money } from '@/lib/fees'
import { SignInGate } from '@/components/SignInGate'
import { useRules } from '@/lib/rules-public'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

/** /history/brews — obras que el usuario certificó, con su tarifa de $8 (Build Spec 02, ÍTEM 6). */
export default function BrewsPage() {
  const { t } = useLocale()
  // La tarifa es de configuracion (Work Order 02, 1.4).
  const rules = useRules()
  const [loading, setLoading] = useState(true)
  // Stage 9: cada fila abre su recibo.
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(true)
  const [rows, setRows] = useState<BrewRow[]>([])

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
      setRows(await fetchBrews(user.id))
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
      <h1 className="page-title">{t.menu.brews}</h1>
      <div className="page-sub">{t.myCollections.brewsSub}</div>

      {rows.length === 0 ? (
        <p className="page-note">{t.myCollections.brewsEmpty.replace('{fee}', rules ? money(rules.fees.registration) : '—')}</p>
      ) : (
        <>
          <p className="text-[12px] text-ink-soft mt-4">
            {plural(rows.length, t.myCollections.entryCount, t.myCollections.entryCountPlural)}
          </p>
          <div className="mt-1">
            {rows.map((r) => (
              <LedgerRow
                key={r.id}
                onClick={() => setReceiptId(r.id)}
                title={r.title}
                what={t.myCollections.brewRow.replace('{fee}', `$${money(r.fee)}`)}
                amount="—"
                when={new Date(r.when).toLocaleDateString()}
              />
            ))}
          </div>
        </>
      )}
      {receiptId && <ReceiptSheet kind="registration" id={receiptId} onClose={() => setReceiptId(null)} />}
    </div>
  )
}
