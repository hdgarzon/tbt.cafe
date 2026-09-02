'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { StandingSheet } from '@/components/Sheet'
import { supabase } from '@/lib/supabase'
import {
  fetchCurations,
  saveCuration,
  type Curation,
  type CurationTargetType,
} from '@/lib/curation-data'

export type CurationTarget = {
  type: CurationTargetType
  id: string
  label: string
}

const AXES = ['technique', 'color', 'meaning'] as const
type Axis = (typeof AXES)[number]

/**
 * Modal de curación (Build Spec 02, ÍTEM 5) — el "critique" renombrado.
 * Reachable desde el ícono de ojo en creador, serie, featured y obra. Tres
 * ejes de 1 a 5 mostrados como número plano ("3 of 5"), texto libre
 * obligatorio, pública o privada.
 *
 * Va en `StandingSheet`, no en `Sheet`: .crit-card del prototipo lleva la
 * altura de pie —`calc(100dvh - header)` con el cuerpo scrolleando dentro—,
 * igual que .share-card, de la que hereda. Estaba en el sheet compacto de
 * autenticación, así que crecía y encogía según cuántas curaciones hubiera.
 *
 * El kicker y el título van DENTRO de la franja scrolleable, no fijos: en
 * .crit-card la tarjeta entera scrollea y solo el botón de cierre queda
 * anclado, por ser `position:absolute`.
 */
export function CurationModal({
  open,
  onClose,
  target,
}: {
  open: boolean
  onClose: () => void
  target: CurationTarget | null
}) {
  const { t } = useLocale()
  const { openAuth } = useShell()
  const [list, setList] = useState<Curation[]>([])
  const [adding, setAdding] = useState(false)
  const [scores, setScores] = useState<Partial<Record<Axis, number>>>({})
  const [body, setBody] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !target) return
    setAdding(false)
    setScores({})
    setBody('')
    setIsPublic(true)
    setMsg('')
    fetchCurations(target.type, target.id).then(setList)

    /*
     * La puerta va AL ABRIR, no al publicar — Gating Spec 01, ítem 4.
     *
     * Antes se comprobaba dentro del envío: la persona puntuaba técnica, color
     * y significado, escribía su curación, elegía pública o privada, pulsaba
     * Publicar, y SOLO ENTONCES se le pedía entrar. Todo lo escrito seguía en
     * pantalla y nada se había guardado.
     *
     * El sheet se abre ENCIMA y el modal no se cierra: al terminar, las notas y
     * el texto siguen ahí. Cerrarlo obligaría a hacer el trabajo dos veces, que
     * es peor que el defecto.
     */
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) openAuth()
    })
    // `openAuth` es estable — cuelga del shell, no de este render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target])

  if (!open || !target) return null

  const whatLabel = {
    creator: t.curation.whatCreator,
    series: t.curation.whatSeries,
    work: t.curation.whatWork,
    featured: t.curation.whatFeatured,
  }[target.type]

  const avg =
    list.length > 0
      ? list.reduce((s, c) => s + ((c.technique ?? 0) + (c.color ?? 0) + (c.meaning ?? 0)) / 3, 0) / list.length
      : 0

  async function submit() {
    setMsg('')
    const {
      data: { user },
    } = await supabase.auth.getUser()
    /*
     * El respaldo, para la sesión que caduca con el formulario abierto — que es
     * justo cuando `resume` más importa: reanuda ESTE envío con lo escrito.
     */
    if (!user) return openAuth({ resume: submit })
    if (!body.trim()) return setMsg(t.curation.writeFirst)
    if (AXES.some((a) => !scores[a])) return setMsg(t.curation.rateFirst)

    setBusy(true)
    const { error } = await saveCuration({
      targetType: target!.type,
      targetId: target!.id,
      technique: scores.technique!,
      color: scores.color!,
      meaning: scores.meaning!,
      body: body.trim(),
      isPublic,
    })
    setBusy(false)
    if (error) return setMsg(error)

    setMsg(isPublic ? t.curation.posted : t.curation.savedPrivately)
    setAdding(false)
    setBody('')
    setScores({})
    fetchCurations(target!.type, target!.id).then(setList)
  }

  return (
    <StandingSheet open={open} onClose={onClose} labelledBy="curation-title">
      <div className="pb-8">
        <div className="text-[10px] font-semibold tracking-[0.22em] uppercase text-ink-soft pr-10">
          {t.curation.kicker.replace('{what}', whatLabel)}
        </div>
        <h2
          id="curation-title"
          className="font-display font-medium text-[30px] leading-[1.08] text-ink mt-1.5 mb-[22px] pr-10"
        >
          {target.label}
        </h2>

        {list.length > 0 && (
          <div className="flex items-baseline gap-2 pb-4 mb-1 border-b border-hairline">
            <span className="font-display text-[26px] leading-none text-ink">{avg.toFixed(1)}</span>
            <span className="text-[11px] text-ink-soft">
              {(list.length === 1 ? t.curation.average : t.curation.averagePlural).replace('{n}', String(list.length))}
            </span>
          </div>
        )}

        {list.length === 0 && !adding && <p className="text-[13px] text-ink-soft py-2">{t.curation.empty}</p>}

        <div className="flex flex-col gap-4 py-1">
          {list.map((c) => (
            <div key={c.id} className="pb-4 border-b border-hairline last:border-0">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-ink">{c.author_name}</span>
                <span className="text-[11px] text-ink-soft">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                <span className="text-[11px] text-ink-soft">
                  {t.curation.axisTechnique}: {t.curation.scoreOf5.replace('{n}', String(c.technique))}
                </span>
                <span className="text-[11px] text-ink-soft">
                  {t.curation.axisColor}: {t.curation.scoreOf5.replace('{n}', String(c.color))}
                </span>
                <span className="text-[11px] text-ink-soft">
                  {t.curation.axisMeaning}: {t.curation.scoreOf5.replace('{n}', String(c.meaning))}
                </span>
              </div>
              <p className="text-[13.5px] leading-[1.5] text-ink mt-2">{c.body}</p>
            </div>
          ))}
        </div>

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full mt-2 py-3.5 text-[12px] font-semibold tracking-[0.14em] uppercase border border-hairline rounded-xl text-ink hover:border-ink transition-colors"
          >
            {t.curation.addYours}
          </button>
        )}

        {adding && (
          <div className="mt-2">
            {AXES.map((axis) => (
              <div key={axis} className="mb-4">
                <div className="text-[11px] font-medium tracking-[0.1em] uppercase text-ink-soft mb-2">
                  {axis === 'technique' && t.curation.axisTechnique}
                  {axis === 'color' && t.curation.axisColor}
                  {axis === 'meaning' && t.curation.axisMeaning}
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-label={`${v} of 5`}
                      onClick={() => setScores((s) => ({ ...s, [axis]: v }))}
                      className={`w-8 h-8 rounded-full border-[1.5px] text-[12px] transition-colors ${
                        (scores[axis] ?? 0) >= v
                          ? 'bg-ink border-ink text-paper'
                          : 'border-hairline text-ink-soft hover:border-ink'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-4">
              {t.curation.yourCuration}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t.curation.textPlaceholder}
              rows={4}
              className="w-full rounded-[11px] border border-hairline bg-paper px-[13px] py-[13px] text-[13.5px] leading-[1.55] text-ink outline-none focus:border-ink transition-colors resize-none placeholder:text-placeholder"
            />

            <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-4">
              {t.curation.whoCanSee}
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`text-left px-3.5 py-3 rounded-xl border-[1.5px] transition-colors ${
                  isPublic ? 'border-ink bg-paper-warm' : 'border-hairline'
                }`}
              >
                <div className="text-[13px] font-semibold text-ink">{t.curation.public}</div>
                <div className="text-[11px] text-ink-soft mt-0.5">{t.curation.publicHint}</div>
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`text-left px-3.5 py-3 rounded-xl border-[1.5px] transition-colors ${
                  !isPublic ? 'border-ink bg-paper-warm' : 'border-hairline'
                }`}
              >
                <div className="text-[13px] font-semibold text-ink">{t.curation.private}</div>
                <div className="text-[11px] text-ink-soft mt-0.5">{t.curation.privateHint}</div>
              </button>
            </div>

            {msg && <p className="text-[12px] text-t-red text-center mt-3.5">{msg}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="w-full mt-[18px] py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-opacity disabled:opacity-60 disabled:cursor-not-allowed enabled:hover:bg-black"
            >
              {t.curation.post}
            </button>
          </div>
        )}
      </div>
    </StandingSheet>
  )
}
