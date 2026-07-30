'use client'

import { useEffect, useState } from 'react'
import { locales, localeMeta, type Locale } from '@/i18n/config'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { CloseIcon, CaretIcon } from '@/components/Brand'

/**
 * Menú deslizable en acordeón (Build Spec 02, ÍTEM 6 — reemplaza la
 * estructura de Build Spec 01). Tres secciones, cada una auth-gated: tocar
 * el encabezado de una sección sin sesión abre autenticación en vez de
 * expandir. "Acquisitions" pasa a llamarse "Collections" en la UI (la ruta
 * /collections/acquisitions no cambia); "History"/"Activity" desaparecen —
 * Transactions cubre el mismo terreno.
 *
 * TRANSACTIONS: cinco vistas reales — Brews/Offers/Royalties/Sales leen de
 * history-data.ts (derivadas de works/offers/ownership_history/transfers,
 * ninguna simulada); Transfers sigue en su propia página ya existente
 * (/history/transactions), construida en una fase anterior.
 *
 * Language sigue siendo un selector INLINE dentro de Settings, con
 * confirmación antes de aplicar (Master Handoff §6). locale/setLocale vienen
 * del LocaleProvider compartido, no de props.
 */

type Child = { label: string; href: string }
type Group = { key: string; label: string; children: Child[]; hasLanguage?: boolean }

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
      key: 'settings',
      label: t.menu.settings,
      hasLanguage: true,
      children: [
        { label: t.menu.authentication, href: '/settings/authentication' },
        { label: t.menu.notifications, href: '/settings/notifications' },
        { label: t.menu.profile, href: '/profile' },
      ],
    },
    {
      key: 'transactions',
      label: t.menu.transactions,
      children: [
        { label: t.menu.brews, href: '/history/brews' },
        { label: t.menu.offers, href: '/history/offers' },
        { label: t.menu.royalties, href: '/history/royalties' },
        { label: t.menu.transfers, href: '/history/transactions' },
        { label: t.menu.sales, href: '/history/sales' },
      ],
    },
  ]

  const rowClass =
    'w-full flex items-center justify-between px-[22px] py-5 text-left border-b border-hairline hover:bg-paper-warm transition-colors'
  const labelClass = 'text-[13px] font-medium tracking-[0.18em] uppercase text-ink'
  const signClass = 'text-[18px] font-normal leading-none text-ink-soft w-4 text-center'
  const subItemClass =
    'block w-full text-left px-[22px] pl-[34px] py-[15px] text-[13px] tracking-[0.05em] text-ink-soft hover:text-ink transition-colors'

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
            <p className="mx-[22px] mt-1 mb-3.5 px-3.5 py-2.5 bg-paper-warm border border-hairline rounded-[10px] text-[11px] leading-[1.6] text-ink-soft">
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
                  <span className={connected ? signClass : `${signClass} opacity-35`}>{connected && isOpen ? '–' : '+'}</span>
                </button>

                <div
                  className={`overflow-hidden bg-paper-warm transition-[max-height] duration-300 ease-in-out ${
                    isOpen ? 'max-h-[320px] border-b border-hairline' : 'max-h-0'
                  }`}
                >
                  {group.children.map((child, i) => (
                    <a key={child.label} href={child.href} className={`${subItemClass} ${i > 0 ? 'border-t border-hairline' : ''}`}>
                      {child.label}
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

        <div className="shrink-0 bg-paper-warm border-t border-hairline p-[22px] flex flex-col gap-0.5">
          <span className="text-[11px] tracking-[0.05em] text-ink-soft">{t.menu.footNote1}</span>
          <span className="text-[11px] tracking-[0.05em] text-ink-soft">{t.menu.footNote2}</span>
        </div>
      </nav>
    </>
  )
}
