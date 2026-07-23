'use client'

import { useEffect, useState } from 'react'
import { locales, localeMeta, type Locale } from '@/i18n/config'

/**
 * Menú deslizable en acordeón (Build Spec 01, ÍTEM 1).
 * Entradas: Collections · Profile · Brew TBT · Settings · History
 * Settings despliega: Authentication / Language / Notifications
 *
 * Language es un selector INLINE (bandera + código de 2 letras), no una página,
 * y exige un paso de confirmación antes de aplicar (Master Handoff §6).
 */

type MenuProps = {
  open: boolean
  onClose: () => void
  locale: Locale
  onLocaleChange: (l: Locale) => void
}

export function SlideMenu({ open, onClose, locale, onLocaleChange }: MenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null)

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Al cerrar el menú, descartar cualquier cambio de idioma sin confirmar
  useEffect(() => {
    if (!open) {
      setPendingLocale(null)
      setSettingsOpen(false)
    }
  }, [open])

  const items = [
    { key: 'collections', label: 'Collections', href: '/collections' },
    { key: 'profile', label: 'Profile', href: '/profile' },
    { key: 'brew', label: 'Brew TBT', href: '/brew' },
  ]

  return (
    <div
      className={`absolute inset-0 z-20 ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Velo */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-ink transition-opacity duration-200 ${
          open ? 'opacity-20' : 'opacity-0'
        }`}
      />

      {/* Panel — se desliza dentro de la columna bloqueada */}
      <nav
        className={`absolute inset-y-0 left-0 w-[300px] bg-paper border-r border-hairline transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-header flex items-center px-5 border-b border-hairline">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="text-[20px] leading-none text-ink-soft"
          >
            ×
          </button>
        </div>

        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.key} className="border-b border-hairline">
              <a
                href={it.href}
                className="block px-5 py-4 text-[15px] hover:bg-paper-warm transition-colors"
              >
                {it.label}
              </a>
            </li>
          ))}

          {/* Settings — acordeón con +/− */}
          <li className="border-b border-hairline">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              className="w-full flex items-center justify-between px-5 py-4 text-[15px] hover:bg-paper-warm transition-colors"
            >
              <span>Settings</span>
              <span className="text-ink-soft text-[16px] leading-none tabular-nums">
                {settingsOpen ? '−' : '+'}
              </span>
            </button>

            {settingsOpen && (
              <div className="bg-paper-warm border-t border-hairline">
                <a
                  href="/settings/authentication"
                  className="block px-5 py-3 pl-8 text-[14px] border-b border-hairline"
                >
                  Authentication
                </a>

                {/* Language — selector inline con confirmación */}
                <div className="px-5 py-3 pl-8 border-b border-hairline">
                  <div className="label-caps mb-2">Language</div>
                  <div className="flex gap-2">
                    {locales.map((l) => {
                      const meta = localeMeta[l]
                      const isActive = l === locale
                      const isPending = l === pendingLocale
                      return (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setPendingLocale(isActive ? null : l)}
                          aria-pressed={isActive}
                          className={`flex items-center gap-1 px-2 py-1 text-[12px] border transition-colors ${
                            isActive
                              ? 'border-ink text-ink'
                              : isPending
                                ? 'border-t-magenta text-t-magenta'
                                : 'border-hairline text-ink-soft'
                          }`}
                        >
                          <span aria-hidden="true">{meta.flag}</span>
                          {meta.code}
                        </button>
                      )
                    })}
                  </div>

                  {/* Paso de confirmación — exigido por el spec */}
                  {pendingLocale && (
                    <div className="mt-3 flex items-center gap-3">
                      <span className="text-[12px] text-ink-soft">
                        Switch to {localeMeta[pendingLocale].name}?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onLocaleChange(pendingLocale)
                          setPendingLocale(null)
                        }}
                        className="text-[12px] text-t-magenta underline underline-offset-2"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingLocale(null)}
                        className="text-[12px] text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                <a
                  href="/settings/notifications"
                  className="block px-5 py-3 pl-8 text-[14px]"
                >
                  Notifications
                </a>
              </div>
            )}
          </li>

          <li className="border-b border-hairline">
            <a
              href="/history"
              className="block px-5 py-4 text-[15px] hover:bg-paper-warm transition-colors"
            >
              History
            </a>
          </li>
        </ul>
      </nav>
    </div>
  )
}
