'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { SearchIcon, CloseIcon } from '@/components/Brand'
import { useShell } from '@/components/AppShell'
import { useLocale } from '@/i18n/LocaleProvider'
import {
  SIMULATED_CREATORS,
  SIMULATED_COLLECTIONS,
  SIMULATED_PIECES,
  creatorSeg,
  toCollectionSlug,
} from '@/lib/creator-routing'

/**
 * Home (Build Spec 01, ÍTEMS 1 y 4).
 * Roast · Grind · Brew como tres cajas iguales, más búsqueda en vivo sobre
 * creadores, colecciones y obras.
 *
 * Idioma: viene del LocaleProvider compartido (root layout) — detección de
 * navigator.language con fallback inglés, persistente al navegar.
 */

type Hit = {
  kind: 'creator' | 'collection' | 'work'
  name: string
  meta: string
  glyph: string
  href: string
}

export default function HomePage() {
  const [query, setQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)
  const { connected } = useShell()
  const { t } = useLocale()

  const boxes = [
    { key: 'roast', label: t.home.roast, href: '/roast' },
    { key: 'grind', label: t.home.grind, href: '/grind' },
    { key: 'brew', label: t.home.brew, href: '/brew' },
  ]

  /** Búsqueda en vivo: creadores primero, luego colecciones, luego obras. */
  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const creators: Hit[] = SIMULATED_CREATORS.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.handle ?? '').includes(q)
    ).map((c) => ({
      kind: 'creator',
      name: c.name,
      meta: `${t.search.works.replace('{n}', String(c.works.length))} · /creator/${creatorSeg(c)}`,
      glyph: '⬤',
      href: `/creator/${creatorSeg(c)}`,
    }))

    const collections: Hit[] = SIMULATED_COLLECTIONS.filter((c) =>
      c.name.toLowerCase().includes(q)
    ).map((c) => ({
      kind: 'collection',
      name: c.name,
      meta: `${t.search.collection} · ${c.creator.name}`,
      glyph: '◫',
      href: `/creator/${creatorSeg(c.creator)}/${toCollectionSlug(c.name)}`,
    }))

    const works: Hit[] = SIMULATED_PIECES.filter((p) =>
      p.title.toLowerCase().includes(q)
    ).map((p) => ({
      kind: 'work',
      name: p.title,
      meta: `${t.search.work} · ${p.creator.name}`,
      glyph: '▦',
      href: `/work/${p.tbtId}`,
    }))

    return [...creators, ...collections, ...works]
  }, [query, t])

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
            placeholder={t.home.searchPlaceholder}
            aria-label={t.home.searchPlaceholder}
            autoComplete="off"
            className="flex-1 bg-transparent border-none outline-none p-0 text-[14px] tracking-[0.06em] text-ink"
          />
        </div>

        {/* Resultados en vivo */}
        <div className="mt-1" role="listbox" aria-label={t.home.searchPlaceholder}>
          {query.trim() && hits.length === 0 && (
            <div className="py-3.5 px-0.5 text-[12px] tracking-[0.03em] text-ink-soft">
              {t.search.noResults.replace('{q}', query.trim())}
            </div>
          )}

          {hits.map((h) => (
            <a
              key={`${h.kind}-${h.href}-${h.name}`}
              href={h.href}
              role="option"
              aria-selected="false"
              className="flex items-center gap-3 w-full text-left py-3 px-0.5 border-b border-hairline hover:bg-paper-warm transition-colors"
            >
              <span
                className={`w-10 h-10 shrink-0 border border-hairline bg-paper-warm flex items-center justify-center overflow-hidden ${
                  h.kind === 'creator' ? 'rounded-full' : 'rounded-lg'
                }`}
              >
                <span className="font-display text-[16px] text-ink-soft" aria-hidden="true">
                  {h.glyph}
                </span>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-medium tracking-[0.02em] text-ink truncate">
                  {h.name}
                </span>
                <span className="block text-[10px] tracking-[0.16em] uppercase text-ink-soft mt-[3px]">
                  {h.meta}
                </span>
              </span>
            </a>
          ))}
      </div>
    </div>
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
