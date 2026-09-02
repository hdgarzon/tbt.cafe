'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useLocale, type Dictionary } from '@/i18n/LocaleProvider'
import { SignInGate } from '@/components/SignInGate'

/**
 * /history/transactions — transferencias enviadas o recibidas
 * (`transfers`, RLS restringida a from_owner_id/to_owner_id propios).
 */

type Transfer = {
  id: string
  work_id: string
  from_owner_id: string
  to_owner_id: string
  sale_price: number | null
  status: 'pending' | 'payment_pending' | 'completed' | 'cancelled'
  initiated_at: string
  completed_at: string | null
}

const STATUS_KEY: Partial<Record<Transfer['status'], keyof Dictionary['myCollections']>> = {
  completed: 'transferStatusCompleted',
  pending: 'transferStatusPending',
  payment_pending: 'transferStatusPending',
  cancelled: 'transferStatusCancelled',
}

function TransfersLedger() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [userId, setUserId] = useState('')
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [workTitles, setWorkTitles] = useState<Record<string, string>>({})
  const [workTbtIds, setWorkTbtIds] = useState<Record<string, string>>({})

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

      const { data: rows } = await supabase
        .from('transfers')
        .select('id, work_id, from_owner_id, to_owner_id, sale_price, status, initiated_at, completed_at')
        .or(`from_owner_id.eq.${user.id},to_owner_id.eq.${user.id}`)
        .order('initiated_at', { ascending: false })

      const list = rows ?? []
      setTransfers(list)

      const workIds = Array.from(new Set(list.map((x) => x.work_id)))
      if (workIds.length) {
        const { data: works } = await supabase.from('works').select('id, title, tbt_id').in('id', workIds)
        const titles: Record<string, string> = {}
        const tbtIds: Record<string, string> = {}
        for (const w of works ?? []) {
          titles[w.id] = w.title
          tbtIds[w.id] = w.tbt_id
        }
        setWorkTitles(titles)
        setWorkTbtIds(tbtIds)
      }

      setLoading(false)
    })()
  }, [])

  /**
   * In y Out son la misma lista mirada desde los dos lados: la consulta ya
   * trae ambas direcciones con un `or`, así que separarlas es un filtro en la
   * URL y no una segunda ruta.
   */
  const direction = useSearchParams().get('d')
  const shown = useMemo(
    () =>
      direction === 'in'
        ? transfers.filter((x) => x.to_owner_id === userId)
        : direction === 'out'
          ? transfers.filter((x) => x.from_owner_id === userId)
          : transfers,
    [transfers, direction, userId]
  )

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) {


    return <SignInGate message={t.myCollections.needSignIn} />
  }

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <h1 className="page-title">{t.menu.transactions}</h1>
      <div className="page-sub">{t.myCollections.transactionsSub}</div>

      {shown.length === 0 ? (
        <p className="page-note">{t.myCollections.transactionsEmpty}</p>
      ) : (
        <div className="mt-2">
          {shown.map((x) => {
            const outgoing = x.from_owner_id === userId
            return (
              <a
                key={x.id}
                href={workTbtIds[x.work_id] ? `/work/${workTbtIds[x.work_id]}` : undefined}
                className="flex items-start justify-between gap-3 py-4 border-b border-hairline hover:bg-paper-warm transition-colors -mx-1 px-1"
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-ink truncate">
                    {workTitles[x.work_id] ?? x.work_id}
                  </div>
                  <div className="text-[11.5px] text-ink-soft mt-1">
                    {outgoing ? t.myCollections.transferTo : t.myCollections.transferFrom} ·{' '}
                    {new Date(x.initiated_at).toLocaleDateString()}
                    {x.sale_price ? ` · $${x.sale_price.toLocaleString()}` : ''}
                  </div>
                </div>
                <span className="shrink-0 text-[9px] font-semibold tracking-[0.12em] uppercase text-ink-soft border border-hairline rounded-full px-2 py-[3px] mt-0.5">
                  {STATUS_KEY[x.status] ? t.myCollections[STATUS_KEY[x.status]!] : x.status}
                </span>
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * `useSearchParams` obliga a un límite de Suspense: sin él Next no puede
 * prerenderizar la ruta y el build falla al generarla. El filtro de dirección
 * es lo único que lo necesita, así que el límite envuelve solo esta vista.
 */
export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransfersLedger />
    </Suspense>
  )
}
