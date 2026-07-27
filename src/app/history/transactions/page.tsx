'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, type Dictionary } from '@/i18n/LocaleProvider'

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

export default function TransactionsPage() {
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

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.authHub.loading}</div>
  if (!signedIn) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">← {t.purchase.home}</a>
        <p className="text-[14px] mt-6">{t.myCollections.needSignIn}</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <h1 className="page-title">{t.menu.transactions}</h1>
      <div className="page-sub">{t.myCollections.transactionsSub}</div>

      {transfers.length === 0 ? (
        <p className="page-note">{t.myCollections.transactionsEmpty}</p>
      ) : (
        <div className="mt-2">
          {transfers.map((x) => {
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
