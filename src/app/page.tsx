'use client'

import { useEffect, useState } from 'react'
import { Header } from '@/components/Header'
import { SlideMenu } from '@/components/SlideMenu'
import { AuthSheet } from '@/components/AuthSheet'
import { supabase } from '@/lib/supabase'
import { maskPhone, type Country } from '@/lib/countries'
import { resolveLocale, type Locale } from '@/i18n/config'
import en from '@/i18n/messages/en.json'
import es from '@/i18n/messages/es.json'
import pt from '@/i18n/messages/pt.json'
import fr from '@/i18n/messages/fr.json'

const dictionaries = { en, es, pt, fr } as const

/**
 * Home (Build Spec 01, ÍTEMS 1 y 4).
 * Roast (aprender) · Grind (descubrir) · Brew (crear) + búsqueda en vivo.
 *
 * Idioma: se detecta de navigator.language al montar; si no hay soporte cae a
 * inglés. Un override manual gana sobre la detección del navegador. En
 * producción ese override se persistirá en el perfil de Supabase.
 */
export default function HomePage() {
  const [connected, setConnected] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [locale, setLocale] = useState<Locale>('en')

  // Detección de idioma del navegador (fallback inglés)
  useEffect(() => {
    setLocale(resolveLocale(navigator.language))
  }, [])

  // Restaurar sesión existente al montar
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setConnected(true)
    })
  }, [])

  /**
   * El toggle del header maneja la autenticación (Master Handoff §7):
   * desconectado + tap → abre el sheet de auth
   * conectado + tap    → cierra sesión
   */
  async function handleToggle() {
    if (connected) {
      await supabase.auth.signOut()
      setConnected(false)
      setMaskedPhone(null)
    } else {
      setAuthOpen(true)
    }
  }

  function handleAuthenticated(digits: string, country: Country) {
    setConnected(true)
    // El número enmascarado alimenta el hub de autenticación (Master Handoff §8)
    setMaskedPhone(maskPhone(digits, country))
  }

  const t = dictionaries[locale]

  const sections = [
    { key: 'roast', title: t.home.roast, sub: t.home.roastSub, href: '/roast' },
    { key: 'grind', title: t.home.grind, sub: t.home.grindSub, href: '/grind' },
    { key: 'brew', title: t.home.brew, sub: t.home.brewSub, href: '/brew' },
  ]

  return (
    <div className="relative flex-1 flex flex-col">
      <Header
        connected={connected}
        onToggle={handleToggle}
        onMenu={() => setMenuOpen(true)}
      />

      <main className="flex-1 flex flex-col">
        {/* Búsqueda */}
        <div className="px-5 py-4 border-b border-hairline">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.home.searchPlaceholder}
            className="w-full bg-transparent text-[14px] py-1 outline-none"
          />
        </div>

        {/* Roast · Grind · Brew — separados por hairlines, sin cajas */}
        <nav className="flex-1 flex flex-col">
          {sections.map((s) => (
            <a
              key={s.key}
              href={s.href}
              className="flex-1 flex flex-col justify-center px-5 py-10 border-b border-hairline transition-colors hover:bg-paper-warm"
            >
              <span className="font-display text-[38px] leading-none">
                {s.title}
              </span>
              <span className="label-caps mt-2">{s.sub}</span>
            </a>
          ))}
        </nav>
      </main>

      {/* Footer fijo de 30px */}
      <footer className="h-footer flex items-center justify-center bg-ink">
        <span className="text-[10px] tracking-[0.14em] uppercase text-paper/70">
          {t.footer.credit}
        </span>
      </footer>

      <SlideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        locale={locale}
        onLocaleChange={setLocale}
      />

      <AuthSheet
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
      />
    </div>
  )
}
