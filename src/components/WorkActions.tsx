'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { HeartIcon, CurateIcon, ShareIcon } from '@/components/Brand'
import { isFavorited, toggleFavorite, type FavoriteTargetType } from '@/lib/favorites-data'
import { countCurations, type CurationTargetType } from '@/lib/curation-data'
import { CurationModal, type CurationTarget } from '@/components/CurationModal'

/**
 * Fila de íconos favorito · curar · compartir — vive en la fila del botón
 * Back, arriba del título (Build Spec 02, ÍTEMS 1/3/4). Actúa sobre lo que
 * sea que la pestaña abierta esté mostrando: por eso recibe el target ya
 * resuelto por el padre en vez de calcularlo — "All series" en el creador
 * apunta al creador, una serie concreta re-apunta las acciones (ÍTEM 3).
 *
 * `favorite` es opcional: la pestaña Featured no tiene favorito propio, solo
 * curación + compartir.
 */
export function WorkActions({
  favorite,
  curate,
  shareLabel,
  shareUrl,
}: {
  favorite?: { type: FavoriteTargetType; id: string } | null
  curate: { type: CurationTargetType; id: string; label: string }
  shareLabel: string
  shareUrl: string
}) {
  const { t } = useLocale()
  const { openAuth } = useShell()
  const [saved, setSaved] = useState(false)
  const [curationCount, setCurationCount] = useState(0)
  const [curating, setCurating] = useState(false)
  /**
   * Estados del share, honestos — Update Package 01, N7.
   *  · idle: sin mensaje.
   *  · copied: el portapapeles acepto, se muestra "Link copied".
   *  · failed: la API existe pero rechazo, se muestra "Couldn't copy" con
   *    estilo distinto (no un exito con otro texto).
   *  · select: no hay clipboard API — se pinta un input readonly con la URL
   *    seleccionada y la instruccion "Select and copy". El usuario copia a mano.
   * Todo revierte a idle a los 1.8 s salvo `select`, que se queda hasta que
   * el usuario cierre el modo tocando fuera o volviendo a pulsar Share.
   */
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed' | 'select'>('idle')
  const selectRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (favorite) isFavorited(favorite.type, favorite.id).then(setSaved)
    else setSaved(false)
  }, [favorite?.type, favorite?.id])

  useEffect(() => {
    countCurations(curate.type, curate.id).then(setCurationCount)
  }, [curate.type, curate.id])

  async function onFavorite() {
    if (!favorite) return
    const result = await toggleFavorite(favorite.type, favorite.id)

    /*
     * Sin sesión no se calla: se ofrece la manera de entrar y se REANUDA.
     *
     * `resume` vuelve a correr esta misma función cuando la autenticación
     * termina, así que el toque que hizo la persona es el toque que cuenta.
     * Pedirle que se autentique y luego que vuelva a buscar la obra sería una
     * segunda negativa con mejores modales (Gating Spec 01, ítem 3).
     */
    if (typeof result === 'object') return openAuth({ resume: onFavorite })
    setSaved(result)
  }

  function flash(state: 'copied' | 'failed') {
    setShareState(state)
    setTimeout(() => setShareState((s) => (s === state ? 'idle' : s)), 1800)
  }

  async function onShare() {
    if (shareState === 'select') {
      setShareState('idle')
      return
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: shareLabel, url: shareUrl })
        return
      } catch {
        // user cancelled the native sheet — fall through to clipboard
      }
    }
    if (!navigator.clipboard) {
      // Sin API — se muestra el enlace en un input y se selecciona todo.
      // El foco y el select van en un useEffect al montar el input.
      setShareState('select')
      return
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      flash('copied')
    } catch {
      // Existe la API pero fue rechazada — permission denied, iframe, o
      // contexto no-seguro. Se dice, no se traga.
      flash('failed')
    }
  }

  useEffect(() => {
    if (shareState === 'select' && selectRef.current) {
      selectRef.current.focus()
      selectRef.current.select()
    }
  }, [shareState])

  const curationTarget: CurationTarget = { type: curate.type, id: curate.id, label: curate.label }

  return (
    <div className="relative flex items-center gap-1.5">
      {favorite && (
        <button
          type="button"
          onClick={onFavorite}
          title={saved ? t.actions.unfavorite : t.actions.favorite}
          aria-label={saved ? t.actions.unfavorite : t.actions.favorite}
          aria-pressed={saved}
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
            saved ? 'text-t-magenta' : 'text-ink-soft hover:text-ink'
          }`}
        >
          <HeartIcon />
        </button>
      )}

      <button
        type="button"
        onClick={() => setCurating(true)}
        title={curationCount ? undefined : t.actions.leaveFirst}
        aria-label={t.actions.curate}
        className="relative w-8 h-8 flex items-center justify-center rounded-lg text-ink-soft hover:text-ink transition-colors"
      >
        <CurateIcon />
        {curationCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-ink text-paper text-[9px] leading-[15px] text-center">
            {curationCount}
          </span>
        )}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={onShare}
          title={
            shareState === 'copied'
              ? t.actions.shareCopied
              : shareState === 'failed'
                ? t.actions.shareFailed
                : t.actions.share
          }
          aria-label={t.actions.share}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-soft hover:text-ink transition-colors"
        >
          <ShareIcon />
        </button>

        {/* Toast breve para copied / failed. Estilos distintos: el exito
            hereda tinta suave; el rechazo va en magenta para leerse como algo
            que no salio. */}
        {(shareState === 'copied' || shareState === 'failed') && (
          <span
            role="status"
            className={`absolute top-full right-0 mt-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[10.5px] font-medium tracking-[0.04em] ${
              shareState === 'copied'
                ? 'border-hairline bg-paper-warm text-ink'
                : 'border-t-magenta bg-paper text-t-magenta'
            }`}
          >
            {shareState === 'copied' ? t.actions.shareCopied : t.actions.shareFailed}
          </span>
        )}
      </div>

      {/* Modo "seleccionar y copiar" — sin clipboard API, se muestra la URL
          en un input readonly ya seleccionado, con la instruccion en voz alta. */}
      {shareState === 'select' && (
        <div className="absolute inset-x-0 top-full mt-2 z-10 mx-4 rounded-lg border border-hairline bg-paper p-2.5 shadow-sm">
          <div className="mb-1.5 text-[10.5px] font-medium tracking-[0.14em] uppercase text-ink-soft">
            {t.actions.shareSelect}
          </div>
          <input
            ref={selectRef}
            type="text"
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-hairline bg-paper-warm px-2.5 py-2 text-[12px] text-ink outline-none focus:border-ink"
          />
        </div>
      )}

      <CurationModal
        open={curating}
        onClose={() => {
          setCurating(false)
          countCurations(curate.type, curate.id).then(setCurationCount)
        }}
        target={curationTarget}
      />
    </div>
  )
}
