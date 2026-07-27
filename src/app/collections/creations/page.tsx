'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale, type Dictionary } from '@/i18n/LocaleProvider'

/**
 * /collections/creations — obras que el usuario ha certificado, propias.
 * A diferencia de /creator/[seg] (público, solo publicadas y certificadas),
 * aquí se ven TODAS las propias — incluidos borradores — porque es su panel.
 */

type Work = {
  id: string
  tbt_id: string
  title: string
  status: 'draft' | 'certified' | 'transferred' | 'archived'
  media_url: string | null
}

const STATUS_KEY: Record<Work['status'], keyof Dictionary['myCollections']> = {
  draft: 'statusDraft',
  certified: 'statusCertified',
  transferred: 'statusTransferred',
  archived: 'statusArchived',
}

export default function CreationsPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [works, setWorks] = useState<Work[]>([])

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
      const { data } = await supabase
        .from('works')
        .select('id, tbt_id, title, status, media_url')
        .eq('creator_id', user.id)
        .order('created_at', { ascending: false })
      setWorks(data ?? [])
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
      <h1 className="page-title">{t.menu.creations}</h1>
      <div className="page-sub">{t.myCollections.creationsSub}</div>

      {works.length === 0 ? (
        <p className="page-note">{t.myCollections.creationsEmpty}</p>
      ) : (
        <div className="mt-[22px] grid grid-cols-2 gap-3">
          {works.map((w) => (
            <a
              key={w.id}
              href={`/work/${w.tbt_id}`}
              className="relative aspect-square rounded-[10px] border border-hairline bg-paper-warm overflow-hidden flex items-center justify-center text-center p-2 font-display text-[14px] text-ink-soft hover:border-ink hover:text-ink transition-colors"
            >
              {w.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.media_url} alt={w.title} className="w-full h-full object-cover" />
              ) : (
                w.title
              )}
              <span className="absolute top-1.5 left-1.5 text-[9px] font-semibold tracking-[0.08em] uppercase bg-paper/90 text-ink px-1.5 py-0.5 rounded-full border border-hairline">
                {t.myCollections[STATUS_KEY[w.status]]}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
