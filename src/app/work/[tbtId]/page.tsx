'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { TBT_BACKEND_URL } from '@/lib/backend'
import { fetchWorkFull, ownerRole, type WorkFull } from '@/lib/work-data'
import { makeOffer } from '@/lib/offers-data'
import { WorkActions } from '@/components/WorkActions'
import { ProfileTab } from '@/components/work/ProfileTab'
import { InfoTab } from '@/components/work/InfoTab'
import { HistoryTab } from '@/components/work/HistoryTab'
import { ActionTab } from '@/components/work/ActionTab'

/**
 * /work/[tbtId] — el registro público canónico, cuatro pestañas
 * (Build Spec 02, ÍTEM 1). Profile · Info · History · Action, donde Action
 * solo aparece si el usuario es dueño. El botón Back es CONDICIONAL: una
 * llegada en frío (link compartido, sin historial in-app) no lo muestra —
 * el shell navega con <a> planas (full reload), así que window.history
 * SÍ refleja el historial real del navegador entre páginas.
 *
 * Buy sigue llamando /api/stripe/create-purchase, SIN cambios (ÍTEM 1:
 * "Buy reuses the live Stripe route" — Keep that exact call).
 */

type Tab = 'profile' | 'info' | 'history' | 'action'
const TAB_KEY: Record<'profile' | 'info' | 'history', 'tabProfile' | 'tabInfo' | 'tabHistory'> = {
  profile: 'tabProfile',
  info: 'tabInfo',
  history: 'tabHistory',
}

export default function WorkPage({ params }: { params: { tbtId: string } }) {
  const { t } = useLocale()
  const { connected, openAuth } = useShell()

  const [work, setWork] = useState<WorkFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('profile')
  const [buying, setBuying] = useState(false)
  const [offering, setOffering] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setUserId(user?.id ?? null)
    const w = await fetchWorkFull(params.tbtId)
    if (!w) setNotFound(true)
    setWork(w)
    setLoading(false)
  }, [params.tbtId])

  useEffect(() => {
    load()
  }, [load])

  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  if (loading) return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.work.loading}</div>

  if (notFound || !work) {
    return (
      <div className="px-4 pt-6">
        <div className="urlbar">tbt.cafe/work/{params.tbtId}</div>
        <p className="text-[14px] mt-4">{t.work.notFound}</p>
      </div>
    )
  }

  const role = ownerRole(work, userId)
  const creatorName = work.creator?.public_alias || work.creator?.display_name || t.work.unknownArtist
  const c = work.commerce!
  const shareUrl = `https://tbt.cafe/work/${work.tbt_id}`

  async function buy() {
    setMsg('')
    if (!connected) return openAuth()
    setBuying(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setMsg(t.work.errors.needSignIn)
        setBuying(false)
        return
      }
      const res = await fetch(`${TBT_BACKEND_URL}/api/stripe/create-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workId: work!.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? t.work.errors.buyFailed)
      window.location.href = body.checkoutUrl
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.work.errors.buyFailed)
      setBuying(false)
    }
  }

  async function sendOffer() {
    if (!connected) return openAuth()
    const amount = parseFloat(offerAmount.replace(/[^0-9.]/g, ''))
    if (!isFinite(amount) || amount <= 0) return
    const { error } = await makeOffer(work!.id, amount, c.availability === 'for_sale')
    if (error) return setMsg(t.work.errors.offerFailed)
    setMsg(t.work.offerSent)
    setOffering(false)
    setOfferAmount('')
  }

  // Matriz de comercio del hero (ÍTEM 1): disponibilidad × taking-offers.
  let heroControl: ReactNode
  if (c.availability === 'for_sale') {
    heroControl = (
      <button
        type="button"
        onClick={buy}
        disabled={buying}
        className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-paper text-ink text-[12px] font-semibold shadow-md disabled:opacity-60"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-t-green" />
        {buying ? t.work.starting : t.work.buy}
      </button>
    )
  } else if (c.taking_offers) {
    heroControl = (
      <button
        type="button"
        onClick={() => setOffering(true)}
        className="px-4 py-2.5 rounded-full bg-paper text-ink text-[12px] font-semibold shadow-md"
      >
        {t.work.makeOffer}
      </button>
    )
  } else if (c.availability === 'reserved') {
    heroControl = (
      <span className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-paper text-ink text-[12px] font-semibold shadow-md">
        <span className="w-1.5 h-1.5 rounded-full bg-t-yellow" />
        {t.action.reserved}
      </span>
    )
  } else {
    heroControl = (
      <span className="px-4 py-2.5 rounded-full bg-ink/70 text-paper text-[12px] font-semibold backdrop-blur-sm">
        {t.action.notForSale}
      </span>
    )
  }

  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        {canGoBack ? (
          <button type="button" onClick={() => window.history.back()} className="back-link !pb-0">
            ← {t.purchase.home}
          </button>
        ) : (
          <span />
        )}
        <WorkActions
          favorite={{ type: 'work', id: work.id }}
          curate={{ type: 'work', id: work.id, label: work.title }}
          shareLabel={work.title}
          shareUrl={shareUrl}
        />
      </div>

      <h1 className="page-title mt-3">{work.title}</h1>
      <div className="page-sub normal-case tracking-normal text-[12px] mt-1">
        <a href={`/creator/${work.creator_id}`} className="hover:underline">
          {creatorName}
        </a>
        {work.series && (
          <>
            {' · '}
            <a href={`/creator/${work.creator_id}`} className="hover:underline">
              {work.series.name}
            </a>
          </>
        )}
      </div>

      <div role="tablist" className="flex items-center gap-1 border-b border-hairline mt-4">
        {(['profile', 'info', 'history'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`relative px-3.5 py-3 text-[12px] font-medium transition-colors ${
              tab === k ? 'text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t.work[TAB_KEY[k]]}
            {tab === k && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-ink" />}
          </button>
        ))}
        {role && (
          <button
            role="tab"
            aria-selected={tab === 'action'}
            title={t.work.tabAction}
            aria-label={t.work.tabAction}
            onClick={() => setTab('action')}
            className={`relative px-3.5 py-3 transition-colors ${tab === 'action' ? 'text-t-magenta' : 'text-ink-soft hover:text-t-magenta'}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="12" r="9.2" />
              <path d="M8.6 15.4L12 7.6l3.4 7.8M9.9 13.1h4.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tab === 'action' && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-t-magenta" />}
          </button>
        )}
      </div>

      <div className="mt-5 pb-8">
        {tab === 'profile' && <ProfileTab work={work} canEdit={!!role} heroControl={heroControl} onSaved={load} />}
        {tab === 'info' && <InfoTab work={work} />}
        {tab === 'history' && <HistoryTab workId={work.id} />}
        {tab === 'action' && role && userId && <ActionTab work={work} role={role} userId={userId} onChanged={load} />}
      </div>

      {offering && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setOffering(false)}>
          <div className="w-full max-w-col bg-paper rounded-t-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft">
              {t.work.offerPrompt}
            </label>
            <input
              value={offerAmount}
              onChange={(e) => setOfferAmount(e.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="0"
              className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[16px] outline-none focus:border-ink transition-colors"
            />
            <button
              type="button"
              onClick={sendOffer}
              className="w-full mt-4 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl hover:bg-black transition-colors"
            >
              {t.work.offerSend}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className="fixed left-1/2 bottom-6 -translate-x-1/2 z-50 px-4 py-2.5 bg-ink text-paper text-[12px] rounded-full shadow-lg">
          {msg}
        </p>
      )}
    </div>
  )
}
