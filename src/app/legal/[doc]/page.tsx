import { notFound } from 'next/navigation'
import { LEGAL_DOCS, LEGAL_UPDATED, legalDoc } from '@/lib/legal-content'

/**
 * /legal/[doc] — legalPage del prototipo.
 *
 * Las cuatro del pie: About, Terms, Security, Privacy. Son rutas reales y no
 * un modal, porque a un documento legal se enlaza: alguien tiene que poder
 * mandar la URL de los términos sin decir "abre la app y baja del todo".
 *
 * Server component a propósito. No hay nada interactivo y el texto legal es
 * justo lo que conviene que exista en el HTML servido, para que un crawler o
 * un lector sin JavaScript lo vean igual.
 */

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ doc: d.slug }))
}

export default function LegalPage({ params }: { params: { doc: string } }) {
  const doc = legalDoc(params.doc)
  if (!doc) notFound()

  return (
    <div className="px-4 pt-6 pb-10">
      <a href="/" className="back-link">
        ← tbt.cafe
      </a>

      <div className="urlbar">tbt.cafe/legal/{doc.slug}</div>

      <h1 className="page-title">{doc.title}</h1>

      <div className="mt-2 text-[11px] text-placeholder">Last updated {LEGAL_UPDATED}</div>

      {/* La marca de borrador no es decorativa: estos textos están pendientes
          de revisión por abogados, y presentarlos como vigentes sería
          afirmar algo que nadie ha comprobado. */}
      {doc.draft && (
        <p className="mt-3 rounded-[10px] border border-hairline bg-paper-warm px-3.5 py-3 text-[11.5px] leading-[1.55] text-ink-soft">
          <b className="font-medium text-ink">Working draft.</b> Written against what the platform
          actually does, and pending review by counsel before it takes effect.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-4">
        {doc.body.map((block, i) => {
          if (block.kind === 'h') {
            return (
              <h2
                key={i}
                className="font-display font-medium text-[19px] leading-[1.2] text-ink mt-3 first:mt-0"
              >
                {block.text}
              </h2>
            )
          }
          if (block.kind === 'ul') {
            return (
              <ul key={i} className="flex flex-col gap-2 pl-4">
                {block.items.map((item, j) => (
                  <li
                    key={j}
                    className="relative pl-3 text-[13px] leading-[1.65] text-ink-soft before:absolute before:left-0 before:top-[0.7em] before:w-[5px] before:h-px before:bg-placeholder"
                    // El texto trae énfasis (<b>, <i>) del documento original.
                    dangerouslySetInnerHTML={{ __html: item }}
                  />
                ))}
              </ul>
            )
          }
          return (
            <p
              key={i}
              className="text-[13px] leading-[1.65] text-ink-soft"
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          )
        })}
      </div>
    </div>
  )
}
