'use client'

import { useState, type ReactNode } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { CaretIcon } from '@/components/Brand'

export type PersonalTab = { key: string; label: string; iconOnly?: ReactNode }

/**
 * Barra de pestañas compartida (Build Spec 02, ÍTEM 3/4) — el mismo marco de
 * Creators/Series/Works (o Series/Works/Featured) que usan /creator/[seg] y
 * las tres vistas personales (Favorites/Collections/Creations). Una pestaña
 * puede ser icon-only (Featured, el guante).
 */
export function PersonalTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: PersonalTab[]
  active: string
  onChange: (key: string) => void
}) {
  // Estilo .cr-tab del prototipo: versalitas con tracking, sin subrayado — el
  // peso y la tinta (no una línea) marcan la pestaña activa, ya que la barra
  // ya se apoya en un hairline. Compartido por /creator y las vistas personales.
  return (
    <div role="tablist" className="flex items-center gap-[22px] border-b border-hairline mt-[22px]">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          title={tab.iconOnly ? tab.label : undefined}
          aria-label={tab.iconOnly ? tab.label : undefined}
          onClick={() => onChange(tab.key)}
          className={
            tab.iconOnly
              ? `flex items-center pb-[7px] ml-1.5 transition-colors ${
                  active === tab.key ? 'text-ink' : 'text-placeholder hover:text-ink-soft'
                }`
              : `pb-3 text-[11.5px] tracking-[0.16em] uppercase transition-colors ${
                  active === tab.key ? 'text-ink font-semibold' : 'text-placeholder font-normal hover:text-ink-soft'
                }`
          }
        >
          {tab.iconOnly ?? tab.label}
        </button>
      ))}
    </div>
  )
}

export type SeriesOption = { id: string; name: string }
export type SortKey = 'recent' | 'oldest' | 'price-high' | 'price-low' | 'az'
export type FilterKey = 'all' | 'available' | 'reserved' | 'offers'

/**
 * Barra "Series" + dropdown (default "All series") + sort/filter — sobre el
 * grid en CADA pestaña Works del sistema (creador, favoritos, colecciones,
 * creaciones). Series y Creators/Featured NUNCA muestran esto — la lista
 * misma es el contenido (ÍTEM 3).
 */
export function SeriesDropdown({
  series,
  value,
  onChange,
  sort,
  onSort,
  filter,
  onFilter,
  showFilter = true,
}: {
  series: SeriesOption[]
  value: string
  onChange: (id: string) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  filter: FilterKey
  onFilter: (f: FilterKey) => void
  showFilter?: boolean
}) {
  const { t } = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)

  const sorts: [SortKey, string][] = [
    ['recent', t.personal.sortNewest],
    ['oldest', t.personal.sortOldest],
    ['price-high', t.personal.sortPriceHigh],
    ['price-low', t.personal.sortPriceLow],
    ['az', t.personal.sortAz],
  ]
  const filters: [FilterKey, string][] = [
    ['all', t.personal.filterAll],
    ['available', t.personal.filterAvailable],
    ['reserved', t.personal.filterReserved],
    ['offers', t.personal.filterOffers],
  ]

  return (
    <div className="flex items-center gap-2.5 mt-4">
      <span className="text-[11px] font-medium tracking-[0.1em] uppercase text-ink-soft shrink-0">
        {t.personal.seriesLabel}
      </span>

      <div className="relative flex-1 min-w-0">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t.personal.seriesLabel}
          className="w-full appearance-none border border-hairline rounded-lg bg-paper px-3 py-2 pr-8 text-[13px] text-ink outline-none focus:border-ink transition-colors cursor-pointer"
        >
          <option value="__all">{t.personal.allSeries}</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft">
          <CaretIcon />
        </span>
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title={t.personal.sort}
          aria-label={t.personal.sortAria}
          aria-haspopup="true"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-hairline text-ink-soft hover:text-ink transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5h18l-7 8v6l-4 2v-8z" />
          </svg>
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+6px)] z-20 w-52 bg-paper border border-hairline rounded-xl shadow-lg py-1.5"
            >
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium tracking-[0.14em] uppercase text-ink-soft">
                {t.personal.sort}
              </div>
              {sorts.map(([k, label]) => (
                <button
                  key={k}
                  role="menuitem"
                  onClick={() => {
                    onSort(k)
                    setMenuOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-[13px] text-left hover:bg-paper-warm transition-colors ${
                    sort === k ? 'text-ink font-medium' : 'text-ink-soft'
                  }`}
                >
                  {label}
                  {sort === k && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              {showFilter && (
                <>
                  <div className="px-3 pt-2.5 pb-1 text-[10px] font-medium tracking-[0.14em] uppercase text-ink-soft border-t border-hairline mt-1.5">
                    {t.personal.show}
                  </div>
                  {filters.map(([k, label]) => (
                    <button
                      key={k}
                      role="menuitem"
                      onClick={() => {
                        onFilter(k)
                        setMenuOpen(false)
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-[13px] text-left hover:bg-paper-warm transition-colors ${
                        filter === k ? 'text-ink font-medium' : 'text-ink-soft'
                      }`}
                    >
                      {label}
                      {filter === k && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
