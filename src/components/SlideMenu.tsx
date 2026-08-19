'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMenuCounts, sectionTotal, EMPTY_COUNTS, type MenuCounts } from '@/lib/menu-counts'
import { locales, localeMeta, type Locale } from '@/i18n/config'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { CloseIcon, CaretIcon } from '@/components/Brand'

/**
 * Menú deslizable en acordeón — las CINCO secciones del prototipo.
 *
 * Ofertas y Transferencias son secciones propias, no hijas de Transactions:
 * en el prototipo cada una tiene su encabezado y su contador, porque son
 * cosas que le pasan a uno y no consultas que uno va a hacer.
 *
 * Cada sección va auth-gated: tocar su encabezado sin sesión abre
 * autenticación en vez de expandir.
 *
 * "Acquisitions" se llama "Collections" en la UI; la ruta
 * /collections/acquisitions no cambia.
 *
 * Made/Received y In/Out comparten página con un filtro en la URL: son la
 * misma lista mirada desde los dos lados, y partirla en dos rutas habría
 * duplicado la consulta para cambiar un `where`.
 *
 * Language sigue siendo un selector INLINE dentro de Settings, con
 * confirmación antes de aplicar (Master Handoff §6). locale/setLocale vienen
 * del LocaleProvider compartido, no de props.
 */

type Child = { label: string; href: string; count?: number; accent?: boolean }
type Group = { key: string; label: string; children: Child[]; hasLanguage?: boolean; count?: number }

/**
 * Píldora de conteo. En cero no se pinta: una píldora permanente con un número
 * que nunca cambia deja de mirarse.
 *
 * La de sección va en tinta; la de subítem en hairline, más callada. La de
 * Payouts va en verde, como en el prototipo — es la única que significa dinero
 * cobrable, y merece leerse distinto del resto.
 */
function CountPill({ n, tone }: { n: number; tone: 'section' | 'sub' | 'payout' }) {
  if (!n) return null
  if (tone === 'section') {
    return (
      <span className="ml-auto mr-2.5 min-w-5 h-5 px-1.5 rounded-[10px] bg-ink text-white text-[10px] font-semibold leading-5 text-center tabular-nums">
        {n}
      </span>
    )
  }
  return (
    <span
      className={`shrink-0 mr-3 min-w-[18px] h-[18px] px-[5px] rounded-[9px] text-[10px] font-medium leading-[18px] text-center tabular-nums ${
        tone === 'payout' ? 'bg-t-green text-white' : 'bg-hairline text-ink-soft'
      }`}
    >
      {n}
    </span>
  )
}

/** Candado — junto a la etiqueta de sección cuando no hay sesión (prototipo: .m-lock). */
const LockIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="inline-block ml-[7px] -mb-px text-placeholder"
    aria-hidden="true"
  >
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

export function SlideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, t, setLocale } = useLocale()
  const { connected, openAuth } = useShell()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [counts, setCounts] = useState<MenuCounts>(EMPTY_COUNTS)

  // Los conteos se leen al abrir el cajón, no al montar: sin abrirlo nadie los
  // ve, y son nueve consultas.
  useEffect(() => {
    if (!open || !connected) return
    let alive = true
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      fetchMenuCounts(data.user.id).then((c) => alive && setCounts(c))
    })
    return () => {
      alive = false
    }
  }, [open, connected])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) setExpanded(null)
  }, [open])

  function handleLocaleChange(next: Locale) {
    if (next === locale) return
    const message = t.menu.switchTo.replace('{lang}', localeMeta[next].name)
    if (window.confirm(message)) setLocale(next)
  }

  function toggle(key: string) {
    if (!connected) {
      onClose()
      openAuth()
      return
    }
    setExpanded((cur) => (cur === key ? null : key))
  }

  const groups: Group[] = [
    {
      key: 'tbts',
      label: t.menu.tbts,
      children: [
        { label: t.menu.brewTbt, href: '/brew' },
        { label: t.menu.favorites, href: '/collections/favorites' },
        { label: t.menu.creations, href: '/collections/creations' },
        { label: t.menu.collections, href: '/collections/acquisitions' },
      ],
    },
    {
      key: 'offers',
      label: t.menu.offers,
      count: sectionTotal(counts.offersMade, counts.offersReceived),
      children: [
        { label: t.menu.offersMade, href: '/history/offers?d=made', count: counts.offersMade },
        { label: t.menu.offersReceived, href: '/history/offers?d=received', count: counts.offersReceived },
      ],
    },
    {
      key: 'transfers',
      label: t.menu.transfers,
      count: sectionTotal(counts.transfersIn, counts.transfersOut),
      children: [
        { label: t.menu.transfersIn, href: '/history/transactions?d=in', count: counts.transfersIn },
        { label: t.menu.transfersOut, href: '/history/transactions?d=out', count: counts.transfersOut },
      ],
    },
    {
      key: 'transactions',
      label: t.menu.transactions,
      count: sectionTotal(
        counts.payouts,
        counts.brews,
        counts.royalties,
        counts.purchased,
        counts.sales
      ),
      children: [
        // Payouts primero y en verde: es lo que un vendedor viene a buscar,
        // y lo único de esta lista que significa dinero cobrable.
        { label: t.menu.payouts, href: '/history/payouts', count: counts.payouts, accent: true },
        { label: t.menu.brews, href: '/history/brews', count: counts.brews },
        { label: t.menu.royalties, href: '/history/royalties', count: counts.royalties },
        { label: t.menu.purchased, href: '/history/purchased', count: counts.purchased },
        { label: t.menu.sales, href: '/history/sales', count: counts.sales },
      ],
    },
    {
      key: 'settings',
      label: t.menu.settings,
      hasLanguage: true,
      // Orden del prototipo. Help no está en su menú —cuelga del icono de
      // notificaciones— pero se conserva: es la única puerta con URL propia.
      children: [
        { label: t.menu.profile, href: '/profile' },
        { label: t.menu.authentication, href: '/settings/authentication' },
        { label: t.menu.payouts, href: '/settings/payouts' },
        { label: t.menu.notifications, href: '/settings/notifications' },
        { label: t.menu.help, href: '/help' },
      ],
    },
  ]

  const rowClass =
    'w-full flex items-center justify-between px-[22px] py-5 text-left border-b border-hairline hover:bg-paper-warm transition-colors'
  const labelClass = 'text-[13px] font-medium tracking-[0.18em] uppercase text-ink'
  const signClass = 'text-[18px] font-normal leading-none text-ink-soft w-4 text-center'
  const subItemClass =
    'flex items-center w-full text-left px-[22px] pl-[34px] py-[15px] text-[13px] tracking-[0.05em] text-ink-soft hover:text-ink transition-colors'

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-[rgba(20,20,20,0.28)] transition-opacity duration-[280ms] ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      <nav
        aria-label={t.header.menu}
        aria-hidden={!open}
        className={`absolute top-0 left-0 z-[60] w-full max-w-col h-full bg-paper flex flex-col overflow-y-auto transition-transform duration-[320ms] ease-[cubic-bezier(.4,0,.15,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-header shrink-0 flex items-center justify-between px-4 border-b border-hairline">
          <span className="text-[12px] font-semibold tracking-[0.22em] uppercase text-ink">{t.header.menu}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.menu.cancel}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-ink hover:bg-paper-warm transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 py-2">
          {!connected && (
            <p className="mt-1 mb-3.5 px-[13px] py-[11px] bg-paper-warm border border-hairline rounded-[10px] text-[11px] leading-[1.6] text-ink-soft">
              {t.menu.lockedNote} <b className="font-medium text-ink">{t.menu.lockedNoteBold}</b>
            </p>
          )}
          {groups.map((group) => {
            const isOpen = connected && expanded === group.key
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  aria-expanded={isOpen}
                  aria-disabled={!connected}
                  className={rowClass}
                >
                  <span className={connected ? labelClass : `${labelClass} !text-placeholder`}>
                    {group.label}
                    {!connected && <LockIcon />}
                  </span>
                  {connected && <CountPill n={group.count ?? 0} tone="section" />}
                  <span className={connected ? signClass : `${signClass} opacity-35`}>{connected && isOpen ? '–' : '+'}</span>
                </button>

                <div
                  className={`overflow-hidden bg-paper-warm transition-[max-height] duration-300 ease-in-out ${
                    // El prototipo topa en 320px, que le bastaba para cinco
                    // filas. Settings ya lleva seis —Payouts entró y Help
                    // sigue ahí, aunque el prototipo no la tenga en el menú— y
                    // medía 311px: nueve de margen, que una traducción más
                    // larga se come. El tope solo recorta, así que subirlo no
                    // cambia nada en los submenús cortos.
                    isOpen ? 'max-h-[400px] border-b border-hairline' : 'max-h-0'
                  }`}
                >
                  {group.children.map((child, i) => (
                    <a key={child.label} href={child.href} className={`${subItemClass} ${i > 0 ? 'border-t border-hairline' : ''}`}>
                      {/* La píldora va escrita ANTES que la etiqueta, no
                          reordenada por flex. El prototipo lo comenta: `order`
                          deja de hacer nada en cuanto una regla posterior
                          devuelva el subítem a `display:block`. */}
                      <CountPill n={child.count ?? 0} tone={child.accent ? 'payout' : 'sub'} />
                      <span className={`flex-1 ${child.accent && child.count ? 'text-t-green font-medium' : ''}`}>
                        {child.label}
                      </span>
                    </a>
                  ))}

                  {group.hasLanguage && (
                    <div className={`${subItemClass} border-t border-hairline flex items-center justify-between cursor-default`}>
                      <span>{t.menu.language}</span>
                      <div className="relative flex items-center gap-1.5 px-[9px] py-[5px] border border-hairline rounded-lg bg-paper cursor-pointer hover:border-ink transition-colors">
                        <span className="text-[15px] leading-none" aria-hidden="true">
                          {localeMeta[locale].flag}
                        </span>
                        <span className="text-[11px] font-semibold tracking-[0.1em] text-ink">{localeMeta[locale].code}</span>
                        <span className="text-ink-soft shrink-0">
                          <CaretIcon />
                        </span>
                        <select
                          value={locale}
                          onChange={(e) => handleLocaleChange(e.target.value as Locale)}
                          aria-label={t.menu.language}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-base"
                        >
                          {locales.map((l) => (
                            <option key={l} value={l}>
                              {localeMeta[l].flag} {localeMeta[l].code}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </nav>
    </>
  )
}
