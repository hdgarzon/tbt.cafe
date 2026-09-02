'use client'

import { useEffect, useState } from 'react'
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
  const [shareMsg, setShareMsg] = useState(false)

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

  async function onShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareLabel, url: shareUrl })
        return
      } catch {
        // user cancelled the native sheet — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareMsg(true)
      setTimeout(() => setShareMsg(false), 1600)
    } catch {
      // clipboard unavailable — nothing more we can do silently
    }
  }

  const curationTarget: CurationTarget = { type: curate.type, id: curate.id, label: curate.label }

  return (
    <div className="flex items-center gap-1.5">
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

      <button
        type="button"
        onClick={onShare}
        title={shareMsg ? t.actions.shareCopied : t.actions.share}
        aria-label={t.actions.share}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-ink-soft hover:text-ink transition-colors"
      >
        <ShareIcon />
      </button>

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
