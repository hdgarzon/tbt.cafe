'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { SlideMenu } from '@/components/SlideMenu'
import { StandingSheet } from '@/components/Sheet'
import { SupportPanel } from '@/components/SupportPanel'
import { fetchUnreadCount } from '@/lib/notifications-data'
import { AuthSheet } from '@/components/AuthSheet'
import { BiometricSignInSheet } from '@/components/BiometricSignInSheet'
import { supabase } from '@/lib/supabase'
import { maskPhone, type Country } from '@/lib/countries'
import { maskPhoneE164 } from '@/lib/masking'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Shell de la app — la columna única del prototipo.
 *
 * En el prototipo todo vive en un solo `.app` con el header pegajoso arriba y
 * el pie fijo abajo; las "páginas" son secciones que se muestran u ocultan. En
 * Next esas secciones son rutas reales, así que el shell tiene que envolverlas
 * a todas: si cada página montara su propio header, el estado de sesión y el
 * menú se perderían al navegar.
 *
 * El estado de conexión y los sheets de autenticación viven aquí y se exponen
 * por contexto a las páginas que los necesiten.
 */

type ShellValue = {
  connected: boolean
  /** Teléfono enmascarado de la sesión, para el hub de autenticación. */
  maskedPhone: string | null
  openAuth: () => void
  /** Abre el cajón de menú — el prototipo vuelve al Menú desde /profile. */
  openMenu: () => void
}

const ShellContext = createContext<ShellValue | null>(null)

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell debe usarse dentro de <AppShell>')
  return ctx
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useLocale()
  const [connected, setConnected] = useState(false)
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [authOpen, setAuthOpen] = useState(false)
  const [bioAuthOpen, setBioAuthOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  // Restaurar sesión existente al montar y seguir sus cambios.
  // El teléfono se deriva de la sesión, no sólo de la autenticación en curso:
  // al volver de Stripe la página se recarga y el certificado tiene que poder
  // decir a qué número se envió.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setConnected(true)
        if (data.session.user.phone) setMaskedPhone(maskPhoneE164(data.session.user.phone))
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setConnected(Boolean(session))
      if (!session) setMaskedPhone(null)
      else if (session.user.phone) setMaskedPhone(maskPhoneE164(session.user.phone))
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  /**
   * Sondeo del contador del header. Sin sesión no se pregunta: el feed es
   * personal y la RLS devolvería cero de todas formas.
   *
   * Cada 60s en vez de en tiempo real: es un punto de color, no un chat, y una
   * suscripción abierta por el solo hecho de tener la app abierta cuesta más de
   * lo que ese punto vale.
   */
  useEffect(() => {
    if (!connected) {
      setUnread(0)
      return
    }
    let alive = true
    const read = () => fetchUnreadCount().then((n) => alive && setUnread(n))
    read()
    const id = setInterval(read, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [connected, notifOpen])

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
    setMaskedPhone(maskPhone(digits, country))
  }

  return (
    <ShellContext.Provider
      value={{ connected, maskedPhone, openAuth: () => setAuthOpen(true), openMenu: () => setMenuOpen(true) }}
    >
      <Header
        connected={connected}
        onToggle={handleToggle}
        onMenu={() => setMenuOpen(true)}
        unread={unread}
        onNotifications={() => (connected ? setNotifOpen(true) : setAuthOpen(true))}
      />

      {/* pb-[90px] libera el pie fijo de 30px con aire por debajo */}
      <main className="flex-1 pb-[90px]">{children}</main>

      <Footer />

      <SlideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* El panel cuelga del icono del header, que es su sitio en el
          prototipo. /help sigue existiendo y monta el mismo componente. */}
      {/* Sin cabecera: el prototipo abre con el grip, la X y las pestañas. */}
      <StandingSheet open={notifOpen} onClose={() => setNotifOpen(false)}>
        <SupportPanel compact />
      </StandingSheet>

      <AuthSheet
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
        onSwitchToBiometric={() => {
          setAuthOpen(false)
          setBioAuthOpen(true)
        }}
      />

      <BiometricSignInSheet
        open={bioAuthOpen}
        onClose={() => setBioAuthOpen(false)}
        onAuthenticated={() => setConnected(true)}
      />
    </ShellContext.Provider>
  )
}
