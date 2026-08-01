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

/** Iniciales (máx. 2 palabras) para el avatar monograma cuando no hay foto. */
function monogram(name: string): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/**
 * Normaliza un valor social. El flujo viejo de Forms guardó algunos handles
 * como arrays JSON en texto (p. ej. `["@panda"]`) que se mostraban crudos;
 * esto los desenvuelve a `@panda` de forma defensiva, sin depender de una
 * migración de datos.
 */
function cleanSocial(raw: string | null): string | null {
  if (!raw) return null
  let v = raw.trim()
  if (v.startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) v = parsed.filter(Boolean).map(String).join(', ')
      else v = String(parsed)
    } catch {
      v = v.replace(/^\[|\]$/g, '').replace(/"/g, '').trim()
    }
  }
  v = v.replace(/^"|"$/g, '').trim()
  return v || null
}

/** Texto compacto del pill social — sin protocolo ni barra final. */
function socialDisplay(v: string): string {
  return v.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/** Resuelve un href navegable por red social a partir de un handle o URL. */
function socialHref(kind: 'website' | 'instagram' | 'linkedin', v: string): string {
  if (/^https?:\/\//i.test(v)) return v
  const handle = v.replace(/^@/, '').trim()
  if (kind === 'instagram') return `https://instagram.com/${handle}`
  if (kind === 'linkedin') return `https://linkedin.com/in/${handle}`
  return `https://${v}`
}

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

  // "N obras en M series" — M = series distintas entre las obras (como seriesOf
  // del prototipo), no todas las filas de series (algunas pueden estar vacías).
  const worksCount = works.length
  const seriesCount = new Set(works.map((w) => w.series_id).filter(Boolean)).size
  const registeredLabel =
    seriesCount === 0
      ? // obras sin serie asignada (flujo viejo de Forms): "N obras", sin "en 0 series"
        (worksCount === 1 ? t.creator.seriesWorkCount : t.creator.seriesWorkCountPlural).replace('{n}', String(worksCount))
      : (worksCount === 1 ? t.creator.registeredWork : t.creator.registeredWorks)
          .replace('{works}', String(worksCount))
          .replace('{series}', String(seriesCount))

  const socials = (
    [
      { kind: 'website', label: t.creator.linkWebsite, value: cleanSocial(creator.social_website) },
      { kind: 'instagram', label: t.creator.linkInstagram, value: cleanSocial(creator.social_instagram) },
      { kind: 'linkedin', label: t.creator.linkLinkedin, value: cleanSocial(creator.social_linkedin) },
    ] as const
  ).filter((s): s is { kind: 'website' | 'instagram' | 'linkedin'; label: string; value: string } => !!s.value)

  const hasAbout = !!creator.bio || showAka || !!creator.creator_type

  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => (typeof window !== 'undefined' && window.history.length > 1 ? window.history.back() : (window.location.href = '/'))}
          className="back-link !pb-0"
        >
          ← {t.creator.back}
        </button>
        <WorkActions favorite={favoriteTarget} curate={curateTarget} shareLabel={name} shareUrl={`https://tbt.cafe/creator/${seg}`} />
      </div>

      <div className="flex items-center gap-3.5 mt-4">
        <div className="w-[60px] h-[60px] rounded-full bg-paper-warm border border-hairline overflow-hidden shrink-0 flex items-center justify-center font-sans text-[17px] font-medium text-placeholder">
          {creator.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={creator.avatar_url} alt={name} className="w-full h-full object-cover" />
          ) : (
            monogram(name)
          )}
        </div>
        <div className="min-w-0">
          <h1 className="page-title !mt-0">{name}</h1>
          <div className="text-[11px] tracking-[0.14em] uppercase text-ink-soft mt-1">{t.creator.label}</div>
        </div>
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
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <div className="divide-y divide-hairline">
            {hasAbout && (
              <div className="py-[13px]">
                <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.creator.about}</div>
                {creator.bio && (
                  <div className="mt-1.5">
                    <p className={`font-display text-[16px] leading-[1.5] text-ink ${aboutExpanded ? '' : 'line-clamp-2'}`}>
                      {creator.bio}
                    </p>
                    {creator.bio.length > 100 && (
                      <button
                        type="button"
                        onClick={() => setAboutExpanded((v) => !v)}
                        className="text-[10px] tracking-[0.14em] uppercase text-t-navy mt-1.5"
                      >
                        {aboutExpanded ? t.creator.less : t.creator.more}
                      </button>
                    )}
                  </div>
                )}
                {(showAka || creator.creator_type) && (
                  <div className="flex items-baseline flex-wrap mt-[13px] pt-3 border-t border-hairline">
                    {showAka && (
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="text-[9px] tracking-[0.13em] uppercase text-placeholder">{t.creator.aka}</span>
                        <span className="text-[12px] text-ink leading-[1.4]">{creator.display_name}</span>
                      </span>
                    )}
                    {showAka && creator.creator_type && <span className="text-[11px] text-hairline mx-[9px]">│</span>}
                    {creator.creator_type && (
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="text-[9px] tracking-[0.13em] uppercase text-placeholder">{t.creator.type}</span>
                        <span className="text-[12px] text-ink leading-[1.4]">
                          {t.profileCreator[creator.creator_type as 'individual' | 'group' | 'corporation'] ?? creator.creator_type}
                        </span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="py-[13px]">
              <a
                href={`https://tbt.cafe/creator/${seg}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block font-mono text-[14.5px] tracking-[0.01em] text-[#9a7b4f] hover:underline"
              >
                tbt.cafe/creator/{seg}
              </a>
            </div>

            {creator.credentials && (
              <div className="py-[13px]">
                <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.creator.credentials}</div>
                <p className="text-[12.5px] leading-[1.6] text-ink mt-1.5">{creator.credentials}</p>
              </div>
            )}

            {socials.length > 0 && (
              <div className="py-[13px]">
                <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.creator.socialProof}</div>
                <div className="flex flex-wrap gap-2 mt-[7px]">
                  {socials.map((s) => (
                    <a
                      key={s.kind}
                      href={socialHref(s.kind, s.value)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 border border-hairline rounded-[20px] px-3 py-1.5 text-[11px] text-ink-soft hover:border-ink-soft hover:text-ink transition-colors"
                    >
                      {s.label} · {socialDisplay(s.value)}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="py-[13px]">
              <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.creator.registeredOnTbt}</div>
              <p className="font-display text-[16px] leading-[1.5] text-ink mt-1.5">{registeredLabel}</p>
            </div>
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
