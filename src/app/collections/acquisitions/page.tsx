'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import {
  fetchCollections,
  deriveCreators,
  deriveSeries,
  fetchOwnershipTotals,
  type CollectionWork,
  type DerivedGroup,
} from '@/lib/collections-data'
import { WorkCell } from '@/components/WorkCell'
import { PersonalTabs, SeriesDropdown, type SortKey, type FilterKey } from '@/components/PersonalTabs'

/**
 * /collections/acquisitions — Creators · Series · Works (Build Spec 02,
 * ÍTEM 4). Un solo conjunto poseído visto de tres formas; Creators y Series
 * se DERIVAN de las obras y muestran propiedad parcial honestamente
 * ("2 of 3 works held") en vez de fingir el catálogo completo.
 */

type Tab = 'creators' | 'series' | 'works'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', String(n))

function sortWorks(works: CollectionWork[], sort: SortKey): CollectionWork[] {
  const arr = [...works]
  if (sort === 'az') return arr.sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'oldest') return arr.reverse()
  return arr
}

export default function AcquisitionsPage() {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [signedIn, setSignedIn] = useState(true)
  const [works, setWorks] = useState<CollectionWork[]>([])
  const [creatorTotals, setCreatorTotals] = useState<Map<string, number>>(new Map())
  const [seriesTotals, setSeriesTotals] = useState<Map<string, number>>(new Map())
  const [tab, setTab] = useState<Tab>('creators')
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
      const w = await fetchCollections(user.id)
      setWorks(w)
      const creators = deriveCreators(w)
      const series = deriveSeries(w)
      const { creatorTotals: ct, seriesTotals: st } = await fetchOwnershipTotals(
        creators.map((c) => c.id),
        series.map((s) => s.id)
      )
      setCreatorTotals(ct)
      setSeriesTotals(st)
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

  const creators: DerivedGroup[] = deriveCreators(works)
  const series: DerivedGroup[] = deriveSeries(works)
  const worksInSeries = seriesFilter === '__all' ? works : works.filter((w) => w.series_id === seriesFilter)
  const visibleWorks = sortWorks(worksInSeries, sort)

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">
        ← {t.purchase.home}
      </a>
      <h1 className="page-title">{t.menu.acquisitions}</h1>

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
        {tab === 'creators' && (
          <div className="flex flex-col divide-y divide-hairline">
            {creators.length === 0 ? (
              <p className="text-[13px] text-ink-soft py-3">{t.myCollections.acquisitionsEmpty}</p>
            ) : (
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(creators.length, t.myCollections.creatorsHeldCount, t.myCollections.creatorsHeldCountPlural)}
              </p>
            )}
            {creators.map((c) => {
              const total = creatorTotals.get(c.id) ?? c.count
              return (
                <a key={c.id} href={`/creator/${c.id}`} className="flex items-center justify-between py-3.5 hover:bg-paper-warm transition-colors -mx-1 px-1 rounded-lg">
                  <span className="text-[14px] font-medium text-ink">{c.name}</span>
                  <span className="text-[11.5px] text-ink-soft shrink-0">
                    {t.myCollections.partialHeld.replace('{owned}', String(c.count)).replace('{total}', String(total))}
                  </span>
                </a>
              )
            })}
          </div>
        )}

        {tab === 'series' && (
          <div className="flex flex-col divide-y divide-hairline">
            {series.length === 0 ? (
              <p className="text-[13px] text-ink-soft py-3">{t.creator.seriesEmpty}</p>
            ) : (
              <p className="text-[12px] text-ink-soft pb-2">
                {plural(series.length, t.myCollections.seriesRepresentedCount, t.myCollections.seriesRepresentedCountPlural)}
              </p>
            )}
            {series.map((s) => {
              const total = seriesTotals.get(s.id) ?? s.count
              return (
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
                    {t.myCollections.partialHeld.replace('{owned}', String(s.count)).replace('{total}', String(total))}
                  </span>
                </button>
              )
            })}
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
              <p className="text-[13px] text-ink-soft py-6 text-center">{t.myCollections.acquisitionsEmpty}</p>
            ) : (
              <>
                <p className="text-[12px] text-ink-soft mt-3">
                  {plural(visibleWorks.length, t.myCollections.worksAcquiredCount, t.myCollections.worksAcquiredCountPlural)}
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
      </div>
    </div>
  )
}
