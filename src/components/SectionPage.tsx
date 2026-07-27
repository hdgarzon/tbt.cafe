'use client'

import { useLocale } from '@/i18n/LocaleProvider'

/**
 * Página de sección (Roast · Grind · Brew) — Master Handoff §4.
 *
 * Las tres comparten la misma anatomía: barra de URL canónica, título display,
 * subtítulo en versalitas y la nota que describe qué vive en esa superficie.
 * El contenido real de cada una es trabajo posterior; esto fija la dirección y
 * el encuadre visual.
 */
export function SectionPage({ section }: { section: 'roast' | 'grind' | 'brew' }) {
  const { t } = useLocale()

  const copy = {
    roast: { title: t.sections.roastTitle, sub: t.sections.roastSub, note: t.sections.roastNote },
    grind: { title: t.sections.grindTitle, sub: t.sections.grindSub, note: t.sections.grindNote },
    brew: { title: t.sections.brewTitle, sub: t.sections.brewSub, note: t.sections.brewNote },
  }[section]

  return (
    <div className="px-4 pt-6">
      <div className="urlbar">tbt.cafe/{section}</div>
      <h1 className="page-title">{copy.title}</h1>
      <div className="page-sub">{copy.sub}</div>
      <p className="page-note">{copy.note}</p>
    </div>
  )
}
