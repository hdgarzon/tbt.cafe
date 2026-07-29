'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { findCreatorBySeg, fetchCreatorWorks, type PublicCreator, type PublicWork } from '@/lib/creator-data'
import { fetchCreatorSeries, type SeriesWithCount } from '@/lib/series-data'
import { WorkActions } from '@/components/WorkActions'
import { PersonalTabs, SeriesDropdown, type SortKey, type FilterKey } from '@/components/PersonalTabs'

/**
 * /creator/[seg] — perfil público, cuatro pestañas (Build Spec 02, ÍTEM 3).
 * Profile · Series · Works · Featured (guante). El encabezado lleva avatar y
 * nombre; los tres íconos de acción van en la fila del Back. "All series" en
 * Works apunta al CREADOR; una serie concreta re-apunta las acciones.
 */

type Tab = 'profile' | 'series' | 'works' | 'featured'

const STATUS_DOT = { for_sale: 'bg-t-green', reserved: 'bg-t-yellow', not_for_sale: 'bg-ink-soft' } as const

function WorkCell({ w }: { w: PublicWork }) {
  return (
    <a
      href={`/work/${w.tbt_id}`}
      className="relative aspect-square rounded-[10px] border border-hairline bg-paper-warm overflow-hidden flex items-center justify-center text-center p-2 font-display text-[13px] text-ink-soft hover:border-ink hover:text-ink transition-colors"
    >
      {w.media_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={w.media_url} alt={w.title} className="w-full h-full object-cover" />
      ) : (
        w.title
      )}
      <span className={`absolute top-2 right-2 w-2 h-2 rounded-full ${STATUS_DOT[w.availability]}`} />
    </a>
  )
}

function applySortFilter(works: PublicWork[], sort: SortKey, filter: FilterKey): PublicWork[] {
  let list = works
  if (filter === 'available') list = list.filter((w) => w.availability === 'for_sale')
  else if (filter === 'reserved') list = list.filter((w) => w.availability === 'reserved')
  else if (filter === 'offers') list = list.filter((w) => w.taking_offers)

  const arr = [...list]
  switch (sort) {
    case 'oldest':
      return arr.reverse()
    case 'az':
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    case 'price-high':
      return arr.sort((a, b) => (b.initial_price ?? 0) - (a.initial_price ?? 0))
    case 'price-low':
      return arr.sort((a, b) => (a.initial_price ?? 0) - (b.initial_price ?? 0))
    default:
      return arr
  }
}

export default function CreatorPage({ params }: { params: { seg: string } }) {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [creator, setCreator] = useState<PublicCreator | null>(null)
  const [works, setWorks] = useState<PublicWork[]>([])
  const [series, setSeries] = useState<SeriesWithCount[]>([])
  const [tab, setTab] = useState<Tab>('profile')
  const [seriesFilter, setSeriesFilter] = useState('__all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [aboutExpanded, setAboutExpanded] = useState(false)

  const load = useCallback(async () => {
    const found = await findCreatorBySeg(params.seg)
    setCreator(found)
    if (found) {
      const [w, s] = await Promise.all([fetchCreatorWorks(found.id), fetchCreatorSeries(found.id)])
      setWorks(w)
      setSeries(s)
    }
    setLoading(false)
  }, [params.seg])

  useEffect(() => {
    load()
  }, [load])

  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.work.loading}</div>

  if (!creator) {
    return (
      <div className="px-4 pt-6">
        <div className="urlbar">tbt.cafe/creator/{params.seg}</div>
        <p className="text-[14px] mt-4">{t.work.notFound}</p>
      </div>
    )
  }

  const seg = creator.public_alias || creator.id
  const name = creator.public_alias || creator.display_name || t.creator.label
  const showAka = creator.public_alias && creator.display_name && creator.public_alias !== creator.display_name

  // "All series" apunta al creador; una serie concreta apunta a la serie.
  const targetIsSeries = tab === 'works' && seriesFilter !== '__all'
  const favoriteTarget = targetIsSeries ? ({ type: 'series', id: seriesFilter } as const) : ({ type: 'creator', id: creator.id } as const)
  const curateTarget = targetIsSeries
    ? { type: 'series' as const, id: seriesFilter, label: series.find((s) => s.id === seriesFilter)?.name ?? '' }
    : { type: 'creator' as const, id: creator.id, label: name }

  const worksInSeries = seriesFilter === '__all' ? works : works.filter((w) => w.series_id === seriesFilter)
  const visibleWorks = applySortFilter(worksInSeries, sort, filter)
  const featuredWorks = works.filter((w) => w.is_featured)

  const registeredCount = works.length
  const registeredLabel = (registeredCount === 1 ? t.creator.registeredCount : t.creator.registeredCountPlural).replace(
    '{n}',
    String(registeredCount)
  )

  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        {canGoBack ? (
          <button type="button" onClick={() => window.history.back()} className="back-link !pb-0">
            ← {t.purchase.home}
          </button>
        ) : (
          <span />
        )}
        <WorkActions favorite={favoriteTarget} curate={curateTarget} shareLabel={name} shareUrl={`https://tbt.cafe/creator/${seg}`} />
      </div>

      <div className="flex items-center gap-3 mt-4">
        <div className="w-14 h-14 rounded-full bg-paper-warm border border-hairline overflow-hidden shrink-0 flex items-center justify-center font-display text-[18px] text-ink-soft">
          {creator.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={creator.avatar_url} alt={name} className="w-full h-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
        <h1 className="page-title !mt-0">{name}</h1>
      </div>

      <PersonalTabs
        tabs={[
          { key: 'profile', label: t.work.tabProfile },
          { key: 'series', label: t.personal.tabSeries },
          { key: 'works', label: t.personal.tabWorks },
          {
            key: 'featured',
            label: t.personal.tabFeatured,
            iconOnly: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9.6 12.6V5.9a1.15 1.15 0 0 1 2.3 0v5.8" />
                <path d="M11.9 11.7V5.1a1.15 1.15 0 0 1 2.3 0v6.6" />
                <path d="M14.2 11.7V6.1a1.15 1.15 0 0 1 2.3 0v6.9" />
                <path d="M9.6 12.1L8.2 10.7a1.2 1.2 0 0 0-1.75 1.62l3.05 3.6v1.9h7.0v-4.9" />
                <rect x="6.5" y="18.6" width="10.8" height="2.6" rx=".6" />
              </svg>
            ),
          },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
      />

      <div className="mt-5 pb-8">
        {tab === 'profile' && (
          <div>
            {creator.bio && (
              <div className="mb-5">
                <p className={`text-[14px] leading-[1.6] text-ink ${aboutExpanded ? '' : 'line-clamp-2'}`}>{creator.bio}</p>
                {creator.bio.length > 100 && (
                  <button type="button" onClick={() => setAboutExpanded((v) => !v)} className="text-[11px] font-medium text-t-cyan mt-1">
                    {aboutExpanded ? t.creator.less : t.creator.more}
                  </button>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11.5px] text-ink-soft">
                  {showAka && (
                    <span>
                      {t.creator.aka}: {creator.display_name}
                    </span>
                  )}
                  {creator.creator_type && (
                    <span>
                      {t.creator.type}: {t.profileCreator[creator.creator_type as 'individual' | 'group' | 'corporation'] ?? creator.creator_type}
                    </span>
                  )}
                </div>
              </div>
            )}

            <a
              href={`https://tbt.cafe/creator/${seg}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center py-2.5 mb-5 rounded-lg bg-paper-warm text-t-cyan text-[12px] font-medium hover:underline"
            >
              tbt.cafe/creator/{seg}
            </a>

            {creator.credentials && (
              <div className="mb-5">
                <div className="label-caps">{t.creator.credentials}</div>
                <p className="text-[13px] leading-[1.6] text-ink-soft mt-1.5">{creator.credentials}</p>
              </div>
            )}

            {(creator.social_website || creator.social_instagram || creator.social_linkedin) && (
              <div className="mb-5">
                <div className="label-caps mb-1.5">{t.creator.social}</div>
                <div className="flex flex-col gap-1">
                  {[creator.social_website, creator.social_instagram, creator.social_linkedin]
                    .filter((v): v is string => !!v)
                    .map((url) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-t-cyan hover:underline truncate">
                        {url}
                      </a>
                    ))}
                </div>
              </div>
            )}

            <p className="text-[12px] text-ink-soft pt-4 border-t border-hairline">{registeredLabel}</p>
          </div>
        )}

        {tab === 'series' && (
          <div className="flex flex-col divide-y divide-hairline">
            {series.length === 0 && <p className="text-[13px] text-ink-soft py-3">{t.creator.seriesEmpty}</p>}
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
                <span>
                  <span className="block text-[14px] font-medium text-ink">{s.name}</span>
                  <span className="block text-[11.5px] text-ink-soft mt-0.5">{name}</span>
                </span>
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
            />
            {visibleWorks.length === 0 ? (
              <p className="text-[13px] text-ink-soft py-6 text-center">{t.creator.worksEmpty}</p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {visibleWorks.map((w) => (
                  <WorkCell key={w.id} w={w} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'featured' && (
          <div>
            {featuredWorks.length === 0 ? (
              <p className="text-[13px] text-ink-soft py-6 text-center">{t.creator.worksEmpty}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {featuredWorks.map((w) => (
                  <WorkCell key={w.id} w={w} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
