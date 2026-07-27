'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { TBT_BACKEND_URL } from '@/lib/backend'

/**
 * /work/[tbtId] — página pública canónica de una obra (Build Spec 01, ÍTEM 2
 * "REUSE — EXISTING WORK PAGE BACKEND").
 *
 * El botón Buy llama /api/stripe/create-purchase en el backend existente
 * (hdgarzon/tbt) — una ruta NUEVA y separada allá, no una que reutilice
 * create-checkout, para no arriesgar los flujos de pago que ya están en
 * producción. Ver el comentario de esa ruta para el detalle completo.
 *
 * Modelo de cobro: igual que /transferir hoy — se cobra $8 (tarifa de
 * plataforma) + regalía del artista vía Stripe. El precio de la obra se
 * acuerda FUERA de la plataforma entre comprador y vendedor; no hay
 * infraestructura de payout para que la plataforma retenga y reparta el
 * precio completo. Por eso el copy de abajo lo deja explícito.
 */

type Work = {
  id: string
  tbt_id: string
  title: string
  description: string | null
  category: string | null
  technique: string | null
  media_url: string | null
  status: string
  certified_at: string | null
  mint_address: string | null
  current_owner_id: string
  creator: { public_alias: string | null; display_name: string | null } | null
  commerce: { initial_price: number | null; currency: string; is_for_sale: boolean } | null
}

export default function WorkPage({ params }: { params: { tbtId: string } }) {
  const { t } = useLocale()
  const [work, setWork] = useState<Work | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState('')

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUserId(user?.id ?? null)

      const { data, error } = await supabase
        .from('works')
        .select(
          'id, tbt_id, title, description, category, technique, media_url, status, certified_at, mint_address, current_owner_id, creator:profiles!works_creator_id_fkey(public_alias, display_name), commerce:work_commerce(initial_price, currency, is_for_sale)'
        )
        .eq('tbt_id', params.tbtId)
        .single()

      if (error || !data) {
        setNotFound(true)
      } else {
        const creator = Array.isArray(data.creator) ? data.creator[0] : data.creator
        const commerce = Array.isArray(data.commerce) ? data.commerce[0] : data.commerce
        setWork({ ...data, creator: creator ?? null, commerce: commerce ?? null } as Work)
      }
      setLoading(false)
    })()
  }, [params.tbtId])

  async function buy() {
    if (!work) return
    setBuyError('')
    setBuying(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setBuyError(t.work.errors.needSignIn)
        setBuying(false)
        return
      }

      const res = await fetch(`${TBT_BACKEND_URL}/api/stripe/create-purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ workId: work.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? t.work.errors.buyFailed)

      window.location.href = body.checkoutUrl
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : t.work.errors.buyFailed)
      setBuying(false)
    }
  }

  if (loading) {
    return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.work.loading}</div>
  }

  if (notFound || !work) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">← {t.purchase.home}</a>
        <div className="urlbar">tbt.cafe/work/{params.tbtId}</div>
        <p className="text-[14px] mt-4">{t.work.notFound}</p>
      </div>
    )
  }

  const creatorName = work.creator?.public_alias || work.creator?.display_name || 'Unknown Artist'
  const forSale = !!work.commerce?.is_for_sale && !!work.commerce?.initial_price
  const isOwner = userId === work.current_owner_id

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <div className="urlbar">tbt.cafe/work/{work.tbt_id}</div>

      {work.media_url && (
        <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-paper-warm border border-hairline mb-5">
          <Image src={work.media_url} alt={work.title} fill className="object-cover" unoptimized />
        </div>
      )}

      <h1 className="page-title">{work.title}</h1>
      <div className="page-sub">
        {t.work.creator} · {creatorName}
      </div>

      {(work.category || work.technique) && (
        <p className="text-[13px] text-ink-soft mt-2">
          {work.category}
          {work.technique ? ` · ${work.technique}` : ''}
        </p>
      )}

      {work.description && (
        <div className="mt-5 pt-5 border-t border-hairline">
          <div className="label-caps">{t.work.about}</div>
          <p className="text-[14px] leading-relaxed text-ink-soft mt-2">{work.description}</p>
        </div>
      )}

      <div className="mt-5 pt-5 border-t border-hairline">
        <div className="label-caps">{t.work.certified}</div>
        <p className="text-[14px] mt-2">
          {work.certified_at ? new Date(work.certified_at).toLocaleDateString() : t.work.pending}
        </p>
        {work.mint_address && (
          <a
            href={`https://solscan.io/token/${work.mint_address}`}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-t-magenta underline underline-offset-2 mt-2 inline-block"
          >
            {t.work.viewOnSolana}
          </a>
        )}
      </div>

      {/* Comprar */}
      {forSale && !isOwner && (
        <div className="mt-6 pt-6 border-t border-hairline">
          <div className="label-caps">{t.work.price}</div>
          <p className="font-display font-medium text-[26px] mt-1.5 text-ink">
            {work.commerce?.currency} {work.commerce?.initial_price?.toLocaleString()}
          </p>
          <p className="text-[11px] leading-relaxed text-placeholder mt-2">{t.work.buyDisclaimer}</p>

          {buyError && <p className="text-[11.5px] leading-[1.5] text-t-red mt-3">{buyError}</p>}

          <button
            type="button"
            onClick={buy}
            disabled={buying}
            className="w-full mt-4 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl transition-[opacity,background] disabled:opacity-60 disabled:cursor-not-allowed enabled:hover:bg-black"
          >
            {buying ? t.work.starting : t.work.buy}
          </button>
        </div>
      )}

      {isOwner && (
        <p className="text-[12px] text-ink-soft mt-6 pt-6 border-t border-hairline">{t.work.youOwnThis}</p>
      )}

      <div className="pb-6" />
    </div>
  )
}
