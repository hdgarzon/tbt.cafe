'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, type Dictionary } from '@/i18n/LocaleProvider'

/**
 * /history/activity — cadena de procedencia (`ownership_history`) para las
 * obras del usuario. Esa tabla es de lectura pública (RLS) y escritura solo
 * service-role — es el registro inmutable real, no una simulación.
 */

type Event = {
  id: string
  work_id: string
  event_type: 'creation' | 'transfer'
  previous_owner_name: string | null
  price: number | null
  currency: string | null
  created_at: string
}

const EVENT_KEY: Record<Event['event_type'], keyof Dictionary['myCollections']> = {
  creation: 'eventCreation',
  transfer: 'eventTransfer',
}

export default function ActivityPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [events, setEvents] = useState<Event[]>([])
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

      const { data: rows } = await supabase
        .from('ownership_history')
        .select('id, work_id, event_type, previous_owner_name, price, currency, created_at')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })

      const list = rows ?? []
      setEvents(list)

      const workIds = Array.from(new Set(list.map((e) => e.work_id)))
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
      <h1 className="page-title">{t.menu.history}</h1>
      <div className="page-sub">{t.myCollections.activitySub}</div>

      {events.length === 0 ? (
        <p className="page-note">{t.myCollections.activityEmpty}</p>
      ) : (
        <div className="mt-2">
          {events.map((e) => (
            <a
              key={e.id}
              href={workTbtIds[e.work_id] ? `/work/${workTbtIds[e.work_id]}` : undefined}
              className="flex items-start justify-between gap-3 py-4 border-b border-hairline hover:bg-paper-warm transition-colors -mx-1 px-1"
            >
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-ink truncate">
                  {workTitles[e.work_id] ?? e.work_id}
                </div>
                <div className="text-[11.5px] text-ink-soft mt-1">
                  {new Date(e.created_at).toLocaleDateString()}
                  {e.price ? ` · ${e.currency ?? ''} ${e.price.toLocaleString()}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-[9px] font-semibold tracking-[0.12em] uppercase text-ink-soft border border-hairline rounded-full px-2 py-[3px] mt-0.5">
                {t.myCollections[EVENT_KEY[e.event_type]]}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
