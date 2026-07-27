'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * /collections/acquisitions — obras que el usuario posee pero NO creó
 * (current_owner_id = yo, creator_id ≠ yo): lo que compró o recibió.
 */

type Work = {
  id: string
  tbt_id: string
  title: string
  media_url: string | null
  creator: { display_name: string | null; public_alias: string | null } | null
}

export default function AcquisitionsPage() {
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
        .select(
          'id, tbt_id, title, media_url, creator:profiles!works_creator_id_fkey(display_name, public_alias)'
        )
        .eq('current_owner_id', user.id)
        .neq('creator_id', user.id)
        .order('created_at', { ascending: false })

      const rows = (data ?? []).map((w) => ({
        ...w,
        creator: Array.isArray(w.creator) ? w.creator[0] ?? null : w.creator,
      }))
      setWorks(rows)
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
      <h1 className="page-title">{t.menu.acquisitions}</h1>
      <div className="page-sub">{t.myCollections.acquisitionsSub}</div>

      {works.length === 0 ? (
        <p className="page-note">{t.myCollections.acquisitionsEmpty}</p>
      ) : (
        <div className="mt-[22px] grid grid-cols-2 gap-3">
          {works.map((w) => (
            <a
              key={w.id}
              href={`/work/${w.tbt_id}`}
              className="rounded-[10px] border border-hairline bg-paper-warm overflow-hidden transition-colors hover:border-ink group"
            >
              <div className="aspect-square flex items-center justify-center text-center p-2 font-display text-[14px] text-ink-soft group-hover:text-ink">
                {w.media_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.media_url} alt={w.title} className="w-full h-full object-cover" />
                ) : (
                  w.title
                )}
              </div>
              <div className="px-2 py-1.5 border-t border-hairline text-[10px] tracking-[0.1em] uppercase text-ink-soft truncate">
                {w.creator?.public_alias || w.creator?.display_name || '—'}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
