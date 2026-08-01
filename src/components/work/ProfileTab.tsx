'use client'

import { useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { saveCategory, saveDescription, saveTechnique, type WorkFull } from '@/lib/work-data'

const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)

/** Fila editable in-place — clic para escribir, guarda al perder foco. */
function EditableRow({ value, onSave, canEdit }: { value: string; onSave: (v: string) => void; canEdit: boolean }) {
  const { t } = useLocale()
  if (!canEdit) return <span>{value}</span>
  return (
    <span className="group inline-flex items-center gap-2">
      <span
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => {
          const v = e.currentTarget.textContent?.trim() ?? ''
          if (v && v !== value) onSave(v)
          else e.currentTarget.textContent = value
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
        className="outline-none border-b border-dashed border-hairline focus:border-ink"
      >
        {value}
      </span>
      <span className="text-[10px] text-placeholder opacity-0 group-hover:opacity-100 transition-opacity">
        {t.work.tapToEdit}
      </span>
    </span>
  )
}

/**
 * Pestaña Profile de /work/[tbtId] (Build Spec 02, ÍTEM 1) — imagen hero con
 * el control de comercio, about editable, enlace permanente, pasaje de
 * contexto y detalles (serie/categoría/material/creación-sellada).
 *
 * El "vision player" del prototipo (audio del creador) no tiene columna en
 * el backend real — omitido, no hay dato que reproducir (deferred, como el
 * handle de vanidad).
 */
export function ProfileTab({
  work,
  canEdit,
  heroControl,
  onSaved,
}: {
  work: WorkFull
  canEdit: boolean
  /** Botón/etiqueta de comercio sobre el hero — la página lo resuelve porque dispara el flujo de Buy/Offer. */
  heroControl: React.ReactNode
  onSaved: () => void
}) {
  const { t } = useLocale()

  async function save(fn: (id: string, v: string) => Promise<{ error?: string }>, v: string) {
    await fn(work.id, v)
    onSaved()
  }

  return (
    <div>
      <div
        className="relative w-full aspect-[4/3] rounded-[14px] border border-hairline overflow-hidden bg-paper-warm"
        style={work.media_url ? { backgroundImage: `url(${work.media_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className="absolute bottom-3 right-3">{heroControl}</div>
      </div>

      <div className="py-4 border-b border-hairline">
        <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.work.aboutHeading}</div>
        <p className="font-display text-[16px] leading-[1.55] text-ink mt-1.5">
          {work.description ? (
            <EditableRow
              value={work.description}
              canEdit={canEdit}
              onSave={(v) => save(saveDescription, v)}
            />
          ) : canEdit ? (
            <EditableRow value={t.work.noDescription} canEdit={canEdit} onSave={(v) => save(saveDescription, v)} />
          ) : (
            t.work.noDescription
          )}
        </p>
        <a
          href={`https://tbt.cafe/work/${work.tbt_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 font-mono text-[14.5px] tracking-[0.01em] text-[#9a7b4f] hover:underline"
        >
          tbt.cafe/work/{work.tbt_id}
        </a>
      </div>

      {work.context && (
        <div className="py-4 border-b border-hairline">
          <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.work.context}</div>
          <p className="font-display text-[16px] leading-[1.55] text-ink mt-1.5">{work.context}</p>
        </div>
      )}

      <div className="py-4">
        <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder mb-1">{t.work.details}</div>
        <div className="flex flex-col">
          {work.series && (
            <div className="flex items-baseline justify-between gap-3.5 py-[11px] border-b border-[#F1EFE8]">
              <span className="text-[10px] tracking-[0.13em] uppercase text-placeholder shrink-0">{t.work.series}</span>
              <a href={`/creator/${work.creator_id}`} className="text-[12.5px] text-ink text-right hover:underline">
                {work.series.name}
              </a>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3.5 py-[11px] border-b border-[#F1EFE8]">
            <span className="text-[10px] tracking-[0.13em] uppercase text-placeholder shrink-0">{t.work.category}</span>
            <span className="text-[12.5px] text-ink text-right">
              {work.category ? (
                <EditableRow value={work.category} canEdit={canEdit} onSave={(v) => save(saveCategory, v)} />
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3.5 py-[11px] border-b border-[#F1EFE8]">
            <span className="text-[10px] tracking-[0.13em] uppercase text-placeholder shrink-0">{t.work.material}</span>
            <span className="text-[12.5px] text-ink text-right">
              {work.technique ? (
                <EditableRow value={work.technique} canEdit={canEdit} onSave={(v) => save(saveTechnique, v)} />
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3.5 py-[11px]">
            <span className="text-[10px] tracking-[0.13em] uppercase text-placeholder shrink-0">{t.work.created}</span>
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink text-right">
              {work.certified_at ? new Date(work.certified_at).getFullYear() : '—'}
              <span className="inline-flex items-center gap-1 text-[10px] text-ink-soft">
                <LockIcon />
                {t.work.sealed}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
