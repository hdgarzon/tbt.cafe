'use client'

import { useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { saveAssetLinks, saveCategory, saveDescription, saveTechnique, type WorkFull } from '@/lib/work-data'

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

/** ¿La lista viva ya no es la registrada? Mismo contenido en el mismo orden es la misma. */
function linksDiffer(live: string[], registered: string[] | null): boolean {
  if (!registered) return false
  return live.length !== registered.length || live.some((l, i) => l !== registered[i])
}

/**
 * Los enlaces de la obra — Chains 01, 8.2.
 *
 * La lista viva, editable por el creador mientras tiene la obra. Donde ya no es
 * la que se registró, la original se muestra debajo con su etiqueta: es la que
 * lleva el registro permanente.
 */
function AssetLinks({ work, canEdit, onSaved }: { work: WorkFull; canEdit: boolean; onSaved: () => void }) {
  const { t } = useLocale()
  const live = work.asset_links ?? []
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  if (live.length === 0 && !canEdit && !(work.registered_asset_links ?? []).length) return null

  async function write(next: string[]) {
    setBusy(true)
    setError(false)
    const r = await saveAssetLinks(work.id, next)
    setBusy(false)
    if (r.error) return setError(true)
    setDraft('')
    onSaved()
  }

  const valid = /^https?:\/\/\S+$/.test(draft.trim())

  return (
    <div className="py-4 border-b border-hairline">
      <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder">{t.work.linksHeading}</div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {live.map((link, i) => (
          <li key={`${i}-${link}`} className="flex items-center justify-between gap-3">
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-ink underline decoration-hairline underline-offset-2 truncate">
              {link}
            </a>
            {canEdit && (
              <button
                type="button"
                disabled={busy}
                onClick={() => write(live.filter((_, j) => j !== i))}
                aria-label={t.work.linkRemove}
                className="text-[11px] text-ink-soft hover:text-ink shrink-0"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2 mt-2">
          <input
            type="url"
            inputMode="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://"
            className="flex-1 min-w-0 border border-hairline rounded-lg outline-none px-3 py-2 text-[12.5px] text-ink focus:border-ink"
          />
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => write([...live, draft.trim()])}
            className="text-[11.5px] px-3 rounded-lg border border-ink text-ink disabled:opacity-40"
          >
            {t.work.linkAdd}
          </button>
        </div>
      )}
      {error && <p className="text-[11.5px] text-t-red mt-2">{t.work.linkSaveFailed}</p>}
      {linksDiffer(live, work.registered_asset_links) && (
        <div className="mt-3">
          <div className="text-[10px] text-placeholder">{t.work.linksAsRegistered}</div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {(work.registered_asset_links ?? []).map((link, i) => (
              <li key={`${i}-${link}`} className="text-[11.5px] text-ink-soft truncate">
                {link}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** La grabación del creador — Chains 01, 8.1. Su hash va en el registro. */
function Recording({ work }: { work: WorkFull }) {
  const { t } = useLocale()
  if (!work.audio_video_url) return null
  return (
    <div className="py-4 border-b border-hairline">
      <div className="text-[9.5px] tracking-[0.16em] uppercase text-placeholder mb-2">{t.work.recordingHeading}</div>
      {work.audio_video_type === 'video' ? (
        <video controls preload="metadata" src={work.audio_video_url} className="w-full rounded-[10px] border border-hairline" />
      ) : (
        <audio controls preload="metadata" src={work.audio_video_url} className="w-full" />
      )}
    </div>
  )
}

/**
 * Pestaña Profile de /work/[tbtId] (Build Spec 02, ÍTEM 1) — imagen hero con
 * el control de comercio, about editable, enlace permanente, pasaje de
 * contexto y detalles (serie/categoría/material/creación-sellada).
 *
 * La grabación del creador (el "vision player" del prototipo) se reproduce
 * desde `audio_video_url` (Chains 01, 8.1), y los enlaces de la obra se
 * muestran y, para el creador que la tiene, se editan (8.2).
 */
export function ProfileTab({
  work,
  canEdit,
  canEditLinks,
  heroControl,
  onSaved,
}: {
  work: WorkFull
  canEdit: boolean
  /** Los enlaces: solo el creador mientras tiene la obra (8.2). */
  canEditLinks: boolean
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

      <Recording work={work} />
      <AssetLinks work={work} canEdit={canEditLinks} onSaved={onSaved} />

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
