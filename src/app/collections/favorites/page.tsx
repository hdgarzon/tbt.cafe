'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { WorkCell } from '@/components/WorkCell'
import { listFavorites, resolveFavorites, type ResolvedFavorites } from '@/lib/favorites-data'
import { PersonalTabs } from '@/components/PersonalTabs'

/**
 * /collections/favorites — Creators · Series · Works (Build Spec 02, ÍTEM 4).
 * Tres tipos de cosa guardada, cada una su propia lista, leídos de la tabla
 * `favorites` real (migración 007). Sin sub-línea bajo el título (QA #18).
 *
 * A diferencia de Creations/Collections, los favoritos no comparten un
 * único creador — el dropdown de series de la pestaña Works no aplica aquí
 * de forma natural, así que esta vista la omite (simplificación deliberada).
 */

type Tab = 'creators' | 'series' | 'works'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

export default function FavoritesPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [data, setData] = useState<ResolvedFavorites>({ creators: [], series: [], works: [] })
  const [tab, setTab] = useState<Tab>('creators')

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
      const rows = await listFavorites()
      setData(await resolveFavorites(rows))
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
      <h1 className="page-title">{t.menu.favorites}</h1>

      <PersonalTabs
        tabs={[
          { key: 'creators', label: t.personal.tabCreators },
          { key: 'series', label: t.personal.tabSeries },
          { key: 'works', label: t.personal.tabWorks },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <div className="mt-5 pb-8">
        {tab === 'creators' &&
          (data.creators.length === 0 ? (
            <p className="text-[13px] text-ink-soft py-6 text-center">{t.myCollections.favoritesEmpty}</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(data.creators.length, t.myCollections.savedCreatorsCount, t.myCollections.savedCreatorsCountPlural)}
              </p>
              <div className="flex flex-col divide-y divide-hairline">
                {data.creators.map((c) => (
                  <a key={c.id} href={`/creator/${c.id}`} className="flex items-center py-3.5 hover:bg-paper-warm transition-colors -mx-1 px-1 rounded-lg">
                    <span className="text-[14px] font-medium text-ink">{c.name}</span>
                  </a>
                ))}
              </div>
            </>
          ))}

        {tab === 'series' &&
          (data.series.length === 0 ? (
            <p className="text-[13px] text-ink-soft py-6 text-center">{t.myCollections.favoritesEmpty}</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(data.series.length, t.myCollections.savedSeriesCount, t.myCollections.savedSeriesCountPlural)}
              </p>
              <div className="flex flex-col divide-y divide-hairline">
                {data.series.map((s) => (
                  <div key={s.id} className="py-3.5">
                    <span className="block text-[14px] font-medium text-ink">{s.name}</span>
                    <span className="block text-[11.5px] text-ink-soft mt-0.5">{s.creatorName}</span>
                  </div>
                ))}
              </div>
            </>
          ))}

        {tab === 'works' &&
          (data.works.length === 0 ? (
            <p className="text-[13px] text-ink-soft py-6 text-center">{t.myCollections.favoritesEmpty}</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(data.works.length, t.myCollections.savedWorksCount, t.myCollections.savedWorksCountPlural)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {data.works.map((w) => (
                  <WorkCell key={w.id} tbtId={w.tbt_id} title={w.title} mediaUrl={w.media_url} />
                ))}
              </div>
            </>
          ))}
      </div>
    </div>
  )
}
