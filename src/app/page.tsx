'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { SearchIcon, CloseIcon } from '@/components/Brand'
import { useShell } from '@/components/AppShell'
import { useLocale } from '@/i18n/LocaleProvider'
import { searchCatalog, type SearchHit } from '@/lib/creator-data'

/**
 * Home (Build Spec 01, ÍTEMS 1 y 4).
 * Roast · Grind · Brew como tres cajas iguales, más búsqueda en vivo sobre
 * creadores y obras REALES (Supabase compartido con el backend de Forms) —
 * antes esto pegaba contra un catálogo de simulación fijo (Picasso, Monet…)
 * que nunca mostraba las obras que un usuario había certificado de verdad.
 *
 * Idioma: viene del LocaleProvider compartido (root layout) — detección de
 * navigator.language con fallback inglés, persistente al navegar.
 */

export default function HomePage() {
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const { connected } = useShell()
  const { t } = useLocale()

  const boxes = [
    { key: 'roast', label: t.home.roast, href: '/roast' },
    { key: 'grind', label: t.home.grind, href: '/grind' },
    { key: 'brew', label: t.home.brew, href: '/brew' },
  ]

  // Búsqueda en vivo, debounced 250ms para no golpear Supabase en cada tecla
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    const id = setTimeout(() => {
      searchCatalog(q)
        .then(setHits)
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  // El banner sólo aplica al usuario recién autenticado
  const showWelcome = connected && !welcomeDismissed
  const searchCollapsed = searchFocused || query.length > 0

  return (
    <div className="px-4 pt-5">
      {showWelcome && (
          <div className="relative mb-[22px] rounded-[14px] border border-hairline bg-paper-warm px-5 pt-5 pb-[22px]">
            <button
              type="button"
              onClick={() => setWelcomeDismissed(true)}
              aria-label={t.home.dismiss}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-[7px] text-ink-soft hover:bg-[#efeae1] hover:text-ink transition-colors"
            >
              <CloseIcon size={15} />
            </button>

            <div className="text-[9.5px] font-semibold tracking-[0.22em] uppercase text-t-magenta">
              {t.home.welcomeKicker}
            </div>
            <div className="font-display font-medium text-[26px] leading-[1.1] text-ink mt-2">
              {t.home.welcomeTitle}
            </div>
            <p className="text-[13px] leading-[1.62] tracking-[0.005em] text-ink-soft mt-3">
              <WelcomeBody
                template={t.home.welcomeBody}
                roast={
                  <a
                    href="/roast"
                    className="text-ink font-medium underline underline-offset-2 hover:text-t-cyan"
                  >
                    {t.home.welcomeRoast}
                  </a>
                }
                profile={
                  <a
                    href="/profile"
                    className="text-ink font-medium underline underline-offset-2 hover:text-t-cyan"
                  >
                    {t.home.welcomeProfile}
                  </a>
                }
              />
            </p>
          </div>
        )}

        {/* Roast · Grind · Brew — tres cajas iguales, lado a lado */}
        <div className="flex gap-[10px]">
          {boxes.map((b) => (
            <a
              key={b.key}
              href={b.href}
              className="flex-1 h-24 rounded-xl border border-hairline bg-paper flex flex-col items-center justify-center gap-[5px] px-1.5 py-2.5 text-center transition-[border-color,transform] duration-[180ms] hover:border-ink hover:-translate-y-0.5"
            >
              <span className="font-display font-medium text-[20px] leading-none text-ink">
                {b.label}
              </span>
            </a>
          ))}
        </div>

        {/* Búsqueda Hermès: lupa + campo sobre un hairline, sin caja.
            La lupa se retira al enfocar o al haber texto. */}
        <div className="mt-[26px] flex items-center gap-[10px] border-b border-ink pt-1.5 pb-2.5 px-0.5">
          <SearchIcon
            className={`text-ink shrink-0 overflow-hidden transition-[opacity,width,margin] duration-150 ${
              searchCollapsed ? 'opacity-0 w-0 m-0' : 'opacity-100'
            }`}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label={t.search.ariaLabel}
            autoComplete="off"
            className="flex-1 bg-transparent border-none outline-none p-0 text-[14px] tracking-[0.06em] text-ink"
          />
        </div>

        {/* Resultados en vivo */}
        <div className="mt-1" role="listbox" aria-label={t.search.resultsAriaLabel}>
          {query.trim() && !searching && hits.length === 0 && (
            <div className="py-3.5 px-0.5 text-[12px] tracking-[0.03em] text-ink-soft">
              {t.search.noResults.replace('{q}', query.trim())}
            </div>
          )}

          {hits.map((h) => {
            const crumb =
              h.kind === 'creator'
                ? t.creator.label
                : [t.search.work, h.seriesName, h.creatorName].filter(Boolean).join(' │ ')
            return (
              <a
                key={`${h.kind}-${h.href}-${h.name}`}
                href={h.href}
                role="option"
                aria-selected="false"
                className="flex items-center gap-3 w-full text-left py-2.5 px-0.5 border-b border-hairline hover:bg-paper-warm transition-colors"
              >
                <SearchThumb hit={h} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium tracking-[0.02em] text-ink truncate">
                    {h.name}
                  </span>
                  <span className="block text-[10px] tracking-[0.16em] uppercase text-ink-soft mt-[3px] truncate">
                    {crumb}
                  </span>
                </span>
              </a>
            )
          })}
      </div>
    </div>
  )
}

/** Iniciales de un nombre, para el monograma cuando no hay avatar (máx. 2 palabras). */
function monogram(name: string): string {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** Avatar/miniatura de un resultado de búsqueda — imagen, o un placeholder fiel al demo. */
function SearchThumb({ hit }: { hit: SearchHit }) {
  const isCreator = hit.kind === 'creator'
  const shape = isCreator ? 'rounded-full' : 'rounded-lg'

  if (hit.avatarUrl) {
    return (
      <span className={`w-10 h-10 shrink-0 border border-hairline bg-paper-warm overflow-hidden ${shape}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hit.avatarUrl} alt="" className="w-full h-full object-cover" />
      </span>
    )
  }

  if (isCreator) {
    return (
      <span
        className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center"
        style={{
          background: `hsl(${hit.hue}, 34%, 94%)`,
          border: `1px solid hsl(${hit.hue}, 28%, 86%)`,
        }}
      >
        <span
          className="font-sans text-[12.5px] font-medium tracking-[0.04em]"
          style={{ color: `hsl(${hit.hue}, 32%, 38%)` }}
        >
          {monogram(hit.name)}
        </span>
      </span>
    )
  }

  return (
    <span className="w-10 h-10 shrink-0 rounded-lg border border-hairline bg-paper-warm flex items-center justify-center">
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-placeholder"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.4" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </span>
  )
}

/**
 * Interpola {roast} y {profile} del cuerpo del banner con enlaces reales.
 * El texto va traducido y el orden de los marcadores cambia entre idiomas, así
 * que se parte la plantilla en vez de concatenar.
 */
function WelcomeBody({
  template,
  roast,
  profile,
}: {
  template: string
  roast: ReactNode
  profile: ReactNode
}) {
  const parts = template.split(/(\{roast\}|\{profile\})/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part === '{roast}') return <span key={i}>{roast}</span>
        if (part === '{profile}') return <span key={i}>{profile}</span>
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
