'use client'

import { useEffect, useState } from 'react'
import { locales, localeMeta, type Locale } from '@/i18n/config'
import { useLocale } from '@/i18n/LocaleProvider'
import { CloseIcon, CaretIcon } from '@/components/Brand'

/**
 * Menú deslizable en acordeón (Build Spec 01, ÍTEM 1).
 * Entradas: Collections · Profile · Brew TBT · Settings · History
 *
 * El cajón ocupa el ancho completo de la columna bloqueada, no una franja
 * parcial: en un móvil el menú tapa la pantalla entera.
 *
 * Language es un selector INLINE (bandera + código de 2 letras) dentro del
 * submenú de Settings, no una página, y exige confirmación antes de aplicar
 * (Master Handoff §6).
 *
 * locale/setLocale vienen del LocaleProvider compartido (root layout), no de
 * props — así la elección de idioma persiste al navegar entre páginas.
 */

type Row =
  | { kind: 'link'; key: string; label: string; href: string }
  | { kind: 'group'; key: string; label: string; children: { label: string; href: string }[] }
  | { kind: 'settings'; key: string; label: string }

export function SlideMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale, t, setLocale } = useLocale()
  const [expanded, setExpanded] = useState<string | null>(null)

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Al cerrar el menú, replegar el acordeón
  useEffect(() => {
    if (!open) setExpanded(null)
  }, [open])

  /** Cambio de idioma con paso de confirmación — exigido por el spec. */
  function handleLocaleChange(next: Locale) {
    if (next === locale) return
    const message = t.menu.switchTo.replace('{lang}', localeMeta[next].name)
    if (window.confirm(message)) setLocale(next)
  }

  const rows: Row[] = [
    {
      kind: 'group',
      key: 'collections',
      label: t.menu.collections,
      children: [
        { label: t.menu.favorites, href: '/collections/favorites' },
        { label: t.menu.creations, href: '/collections/creations' },
        { label: t.menu.acquisitions, href: '/collections/acquisitions' },
      ],
    },
    { kind: 'link', key: 'profile', label: t.menu.profile, href: '/profile' },
    { kind: 'link', key: 'brew', label: t.menu.brewTbt, href: '/brew' },
    { kind: 'settings', key: 'settings', label: t.menu.settings },
    {
      kind: 'group',
      key: 'history',
      label: t.menu.history,
      children: [
        { label: t.menu.transactions, href: '/history/transactions' },
        { label: t.menu.activity, href: '/history/activity' },
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
      {/* Velo */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-[rgba(20,20,20,0.28)] transition-opacity duration-[280ms] ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Cajón — ancho completo de la columna */}
      <nav
        aria-label={t.header.menu}
        aria-hidden={!open}
        className={`absolute top-0 left-0 z-[60] w-full max-w-col h-full bg-paper flex flex-col overflow-y-auto transition-transform duration-[320ms] ease-[cubic-bezier(.4,0,.15,1)] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-header shrink-0 flex items-center justify-between px-4 border-b border-hairline">
          <span className="text-[12px] font-semibold tracking-[0.22em] uppercase text-ink">
            {t.header.menu}
          </span>
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
          {rows.map((row) => {
            if (row.kind === 'link') {
              return (
                <a key={row.key} href={row.href} className={rowClass}>
                  <span className={labelClass}>{row.label}</span>
                  {/* El signo se reserva pero se oculta: mantiene alineadas todas las filas */}
                  <span className={`${signClass} invisible`}>+</span>
                </a>
              )
            }

            const isOpen = expanded === row.key

            return (
              <div key={row.key}>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : row.key)}
                  aria-expanded={isOpen}
                  className={rowClass}
                >
                  <span className={labelClass}>{row.label}</span>
                  <span className={signClass}>{isOpen ? '–' : '+'}</span>
                </button>

                <div
                  className={`overflow-hidden bg-paper-warm transition-[max-height] duration-300 ease-in-out ${
                    isOpen ? 'max-h-[260px] border-b border-hairline' : 'max-h-0'
                  }`}
                >
                  {row.kind === 'group' &&
                    row.children.map((child, i) => (
                      <a
                        key={child.href}
                        href={child.href}
                        className={`${subItemClass} ${i > 0 ? 'border-t border-hairline' : ''}`}
                      >
                        {child.label}
                      </a>
                    ))}

                  {row.kind === 'settings' && (
                    <>
                      <a href="/settings/authentication" className={subItemClass}>
                        {t.menu.authentication}
                      </a>

                      {/* Language — chip bandera + código, con <select> nativo encima */}
                      <div
                        className={`${subItemClass} border-t border-hairline flex items-center justify-between cursor-default`}
                      >
                        <span>{t.menu.language}</span>
                        <div className="relative flex items-center gap-1.5 px-[9px] py-[5px] border border-hairline rounded-lg bg-paper cursor-pointer hover:border-ink transition-colors">
                          <span className="text-[15px] leading-none" aria-hidden="true">
                            {localeMeta[locale].flag}
                          </span>
                          <span className="text-[11px] font-semibold tracking-[0.1em] text-ink">
                            {localeMeta[locale].code}
                          </span>
                          <span className="text-ink-soft shrink-0">
                            <CaretIcon />
                          </span>
                          <select
                            value={locale}
                            onChange={(e) => handleLocaleChange(e.target.value as Locale)}
                            aria-label={t.menu.language}
                            /* text-base evita el zoom automático de iOS al enfocar */
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

                      <a
                        href="/settings/notifications"
                        className={`${subItemClass} border-t border-hairline`}
                      >
                        {t.menu.notifications}
                      </a>
                    </>
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
