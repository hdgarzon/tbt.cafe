'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { resolveLocale, isLocale, type Locale } from '@/i18n/config'
import en from '@/i18n/messages/en.json'
import es from '@/i18n/messages/es.json'
import pt from '@/i18n/messages/pt.json'
import fr from '@/i18n/messages/fr.json'

/**
 * Estado de idioma compartido por toda la app — Build Spec 01, ÍTEM 3.
 *
 * Antes de esto, cada página detectaba su propio idioma de forma
 * independiente: elegir español en el menú y navegar a otra página perdía la
 * elección, contradiciendo "aplica inmediatamente en TODA superficie"
 * (Master Handoff §6). Un solo provider en el layout raíz resuelve el estado
 * COMPARTIDO — pero el shell usa <a> planas (no next/link), así que cada
 * navegación es un reload completo del documento, y el estado en memoria
 * por sí solo NO sobrevive a eso. Por eso el override manual también se
 * persiste en localStorage: es lo que realmente lo hace sobrevivir a
 * cualquier navegación, recarga o pestaña nueva.
 *
 * Prioridad de resolución (Master Handoff §6, "override gana sobre el
 * navegador"): 1) override guardado en localStorage, 2) navigator.language,
 * 3) fallback inglés.
 *
 * SEAM: cuando haya sesión activa, este mismo override también debería
 * escribirse en profiles.language_override (migración 001) para que
 * sobreviva entre dispositivos, no solo en este navegador. Ver
 * src/app/settings/authentication para el patrón de sesión ya usado.
 */

const STORAGE_KEY = 'tbt-cafe-locale-override'

const dictionaries = { en, es, pt, fr } as const
export type Dictionary = typeof en

type LocaleContextValue = {
  locale: Locale
  t: Dictionary
  setLocale: (l: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && isLocale(stored)) {
      setLocaleState(stored)
    } else {
      setLocaleState(resolveLocale(navigator.language))
    }
  }, [])

  function setLocale(l: Locale) {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }

  return (
    <LocaleContext.Provider value={{ locale, t: dictionaries[locale], setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}

/**
 * Resuelve una clave con puntos contra el diccionario — 'payouts.method.usdc'.
 *
 * Casi toda la app indexa el diccionario directamente (`t.payouts.title`), que
 * es mejor porque TypeScript lo verifica. Esto es para el caso en que la clave
 * viene de la BASE DE DATOS y no del código: el registro de métodos de payout
 * guarda claves i18n en sus filas (Spec 02 §3.2), justamente para que añadir
 * Pix sea una fila y no un despliegue. Ahí el compilador no puede ayudar.
 *
 * Devuelve el `fallback` si la clave no existe. Una clave rota tiene que
 * degradar a algo legible, no pintar 'payouts.method.pix' en la pantalla de
 * cobro de alguien.
 */
export function translateKey(t: Dictionary, path: string, fallback = ''): string {
  const value = path
    .split('.')
    .reduce<unknown>((node, part) => {
      if (node && typeof node === 'object' && part in node) {
        return (node as Record<string, unknown>)[part]
      }
      return undefined
    }, t)

  return typeof value === 'string' ? value : fallback
}
