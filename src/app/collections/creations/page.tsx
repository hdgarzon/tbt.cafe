'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { fetchCreations, deriveSeries, onlyFeatured, type CollectionWork, type DerivedGroup } from '@/lib/collections-data'
import { WorkCell } from '@/components/WorkCell'
import { PersonalTabs, SeriesDropdown, type SortKey, type FilterKey } from '@/components/PersonalTabs'

/**
 * /collections/creations — Series · Works · Featured (Build Spec 02, ÍTEM 4).
 * Obras que el usuario registró, agrupadas por serie, más su set destacado.
 *
 * Sin sub-línea ESTÁTICA bajo el título (QA #18: "Works you've certified"
 * se removió a propósito) — pero cada pestaña SÍ lleva su propia línea de
 * conteo dinámica ("12 works registered", "3 series"), tal como el
 * prototipo (paintViewWorks/viewSub). No son la misma cosa.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

type Tab = 'series' | 'works' | 'featured'

function sortWorks(works: CollectionWork[], sort: SortKey): CollectionWork[] {
  const arr = [...works]
  if (sort === 'az') return arr.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'oldest') return arr.reverse()
  return arr
}

export default function CreationsPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [works, setWorks] = useState<CollectionWork[]>([])
  const [tab, setTab] = useState<Tab>('series')
  const [seriesFilter, setSeriesFilter] = useState('__all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [filter, setFilter] = useState<FilterKey>('all')

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
      setWorks(await fetchCreations(user.id))
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

  const series: DerivedGroup[] = deriveSeries(works)
  const featured = onlyFeatured(works)
  const worksInSeries = seriesFilter === '__all' ? works : works.filter((w) => w.series_id === seriesFilter)
  const visibleWorks = sortWorks(worksInSeries, sort)

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">
        ← {t.purchase.home}
      </a>
      <h1 className="page-title">{t.menu.creations}</h1>

      <PersonalTabs
        tabs={[
          { key: 'series', label: t.personal.tabSeries },
          { key: 'works', label: t.personal.tabWorks },
          { key: 'featured', label: t.personal.tabFeatured },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <div className="mt-5 pb-8">
        {tab === 'series' && (
          <div className="flex flex-col divide-y divide-hairline">
            {series.length === 0 ? (
              <p className="text-[13px] text-ink-soft py-3">{t.creator.seriesEmpty}</p>
            ) : (
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(series.length, t.myCollections.seriesCount, t.myCollections.seriesCountPlural)}
              </p>
            )}
            {series.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSeriesFilter(s.id)
                  setTab('works')
                }}
                className="flex items-center justify-between py-3.5 text-left hover:bg-paper-warm transition-colors -mx-1 px-1 rounded-lg"
              >
                <span className="text-[14px] font-medium text-ink">{s.name}</span>
                <span className="text-[11.5px] text-ink-soft shrink-0">
                  {(s.count === 1 ? t.creator.seriesWorkCount : t.creator.seriesWorkCountPlural).replace('{n}', String(s.count))}
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === 'works' && (
          <div>
            <SeriesDropdown
              series={series.map((s) => ({ id: s.id, name: s.name }))}
              value={seriesFilter}
              onChange={setSeriesFilter}
              sort={sort}
              onSort={setSort}
              filter={filter}
              onFilter={setFilter}
              showFilter={false}
            />
            {visibleWorks.length === 0 ? (
              <p className="text-[13px] text-ink-soft py-6 text-center">{t.myCollections.creationsEmpty}</p>
            ) : (
              <>
                <p className="text-[12px] text-ink-soft mt-3">
                  {plural(visibleWorks.length, t.myCollections.worksRegisteredCount, t.myCollections.worksRegisteredCountPlural)}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {visibleWorks.map((w) => (
                    <WorkCell key={w.id} tbtId={w.tbt_id} title={w.title} mediaUrl={w.media_url} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'featured' &&
          (featured.length === 0 ? (
            <p className="text-[13px] text-ink-soft py-6 text-center">{t.creator.worksEmpty}</p>
          ) : (
            <>
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(featured.length, t.myCollections.featuredCount, t.myCollections.featuredCountPlural)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {featured.map((w) => (
                  <WorkCell key={w.id} tbtId={w.tbt_id} title={w.title} mediaUrl={w.media_url} />
                ))}
              </div>
            </>
          ))}
      </div>
    </div>
  )
}
