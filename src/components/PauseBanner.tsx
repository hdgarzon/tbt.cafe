'use client'

import { useLocale } from '@/i18n/LocaleProvider'
import { useRules } from '@/lib/rules-public'
import type { Locale4, PauseKey } from '@/lib/rules-shape'

/**
 * Los interruptores de pausa encendidos — Work Order 02, Stage 11.1.
 *
 * Un aviso por interruptor, con su mensaje de configuracion en el idioma de
 * quien mira. La accion pausada lo vuelve a decir donde se intenta; esto avisa
 * antes de intentarla. Sin reglas cargadas no se pinta nada.
 */
const ORDER: PauseKey[] = ['registration', 'selling', 'offers', 'transfers', 'payouts']

export function PauseBanner() {
  const { locale } = useLocale()
  const rules = useRules()
  if (!rules) return null
  const pauses = rules.pauses
  const on = ORDER.filter((k) => pauses[k].on)
  if (!on.length) return null
  const lang = (['en', 'es', 'pt', 'fr'].indexOf(locale) !== -1 ? locale : 'en') as keyof Locale4
  return (
    <div role="status" className="bg-paper-warm border-b border-hairline px-4 py-2.5 flex flex-col gap-1">
      {on.map((k) => (
        <p key={k} className="text-[12px] leading-[1.5] text-ink">
          {pauses[k].message[lang] || pauses[k].message.en}
        </p>
      ))}
    </div>
  )
}
