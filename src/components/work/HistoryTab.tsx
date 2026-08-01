'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { money } from '@/lib/fees'
import { fetchOwnershipHistory, type OwnershipEvent } from '@/lib/work-data'

const EVENT_LABEL_KEY: Record<string, 'eventCreation' | 'eventTransfer'> = {
  creation: 'eventCreation',
  transfer: 'eventTransfer',
}

/**
 * Pestaña History de /work/[tbtId] (Build Spec 02, ÍTEM 1) — línea de
 * tiempo hasta el registro, más reciente primero. Cada transacción se anexa
 * aquí (ownership_history es la cadena de procedencia inmutable).
 */
export function HistoryTab({ workId }: { workId: string }) {
  const { t } = useLocale()
  const [events, setEvents] = useState<OwnershipEvent[] | null>(null)

  useEffect(() => {
    fetchOwnershipHistory(workId).then(setEvents)
  }, [workId])

  if (events === null) return <p className="text-[13px] text-ink-soft py-2">{t.work.loading}</p>
  if (events.length === 0) return <p className="text-[13px] text-ink-soft py-2">{t.myCollections.activityEmpty}</p>

  return (
    <div className="flex flex-col">
      {events.map((e, i) => (
        <div key={e.id} className="flex gap-[13px] py-3.5 border-b border-hairline last:border-b-0">
          <div className="flex flex-col items-center pt-[3px]">
            <span className={`w-[9px] h-[9px] rounded-full ${i === 0 ? 'bg-ink' : 'bg-hairline'}`} />
            {i < events.length - 1 && <span className="flex-1 w-px bg-hairline mt-[5px] min-h-[16px]" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[12px] font-medium text-ink">
                {t.myCollections[EVENT_LABEL_KEY[e.event]] ?? e.event}
              </span>
              <span className="text-[10px] text-placeholder shrink-0">{new Date(e.occurred_at).toLocaleDateString()}</span>
            </div>
            {e.actor_label && <div className="text-[12px] text-ink-soft mt-0.5">{e.actor_label}</div>}
            {e.amount != null && (
              <div className="text-[12px] text-ink mt-0.5">
                {money(e.amount)} {e.currency ?? 'USD'}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
