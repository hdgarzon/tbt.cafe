'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { SignInGate } from '@/components/SignInGate'

/**
 * La página del enlace — Work Order 01 Step 17, a Title Specification 02 §4 h.
 *
 * Es todo el producto de la entrega: el SMS y el e-Mail solo traen este
 * enlace. Muestra el título animado a todo color (WebP) y deja descargar el
 * GIF, que es lo que el titular guarda, y el PNG del cuadro cero.
 *
 * Se abre con la autenticación del propio titular; la URL no lleva token.
 * Dura 30 días desde la emisión y se abre cuantas veces se quiera en ese plazo.
 */

type Payload = {
  status: 'ready' | 'rendering' | 'expired'
  title_number: string
  work_title: string | null
  tbt_id: string | null
  link_expires_at: string | null
  superseded_by: string | null
  urls?: { view: string; gif: string; png: string }
}

type State =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'notFound' }
  | { kind: 'error' }
  | { kind: 'loaded'; data: Payload }

export default function TitleLinkPage(props: { params: Promise<{ number: string }> }) {
  const { number } = use(props.params)
  const { t, locale } = useLocale()
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setState({ kind: 'signedOut' })
      return
    }
    const res = await fetch(`/api/titles/${encodeURIComponent(number)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    })
    if (res.status === 401) return setState({ kind: 'signedOut' })
    if (res.status === 404) return setState({ kind: 'notFound' })
    if (res.status === 200 || res.status === 202 || res.status === 410) {
      return setState({ kind: 'loaded', data: (await res.json()) as Payload })
    }
    setState({ kind: 'error' })
  }, [number])

  useEffect(() => {
    load()
  }, [load])

  if (state.kind === 'loading') return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.titleLink.loading}</div>
  if (state.kind === 'signedOut') return <SignInGate message={t.titleLink.needAuth} onSignedIn={load} />
  if (state.kind === 'notFound' || state.kind === 'error') {
    return (
      <div className="px-4 pt-6">
        <p className="text-[14px]">{state.kind === 'notFound' ? t.titleLink.notFound : t.titleLink.error}</p>
      </div>
    )
  }

  const d = state.data
  const until = d.link_expires_at
    ? new Date(d.link_expires_at).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
    : ''

  return (
    <div className="px-4 pt-6 pb-10">
      <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft">{t.titleLink.kicker}</div>
      <h1 className="text-[22px] mt-1 text-ink">{d.work_title ?? d.title_number}</h1>
      <div className="text-[12.5px] text-ink-soft mt-1">{t.titleLink.number.replace('{number}', d.title_number)}</div>

      {d.superseded_by && (
        <p className="text-[12.5px] leading-[1.55] text-ink-soft mt-4 border border-hairline rounded-xl p-3">
          {t.titleLink.superseded.replace('{number}', d.superseded_by)}
        </p>
      )}

      {d.status === 'expired' && <p className="text-[14px] leading-[1.55] mt-6">{t.titleLink.expired}</p>}

      {d.status === 'rendering' && <p className="text-[14px] leading-[1.55] mt-6">{t.titleLink.rendering}</p>}

      {d.status === 'ready' && d.urls && (
        <>
          {/* El título a todo color; el GIF es lo que se descarga (Spec 02 §4 h). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.urls.view} alt={t.titleLink.alt.replace('{number}', d.title_number)} className="w-full mt-5 rounded-lg" />
          <div className="flex gap-2 mt-4">
            <a href={d.urls.gif} className="flex-1 text-center rounded-xl bg-ink text-paper py-3 text-[13px] font-medium">
              {t.titleLink.downloadGif}
            </a>
            <a href={d.urls.png} className="flex-1 text-center rounded-xl border border-hairline py-3 text-[13px] font-medium text-ink">
              {t.titleLink.downloadPng}
            </a>
          </div>
          <p className="text-[12px] text-ink-soft mt-3">{t.titleLink.availableUntil.replace('{date}', until)}</p>
        </>
      )}

      {d.tbt_id && (
        <a href={`/work/${d.tbt_id}`} className="block text-[12.5px] text-ink underline underline-offset-2 mt-6">
          {t.titleLink.workPage}
        </a>
      )}
    </div>
  )
}
