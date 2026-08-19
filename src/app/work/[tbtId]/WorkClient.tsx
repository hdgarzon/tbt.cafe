'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { TBT_BACKEND_URL } from '@/lib/backend'
import { LadderGate } from '@/components/LadderGate'
import { EmbeddedCheckoutSheet } from '@/components/EmbeddedCheckoutSheet'
import { fetchWorkFull, ownerRole, royaltyOf, type WorkFull } from '@/lib/work-data'
import { makeOffer } from '@/lib/offers-data'
import { quote, money, minPriceFor } from '@/lib/fees'
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
  const [ladderOpen, setLadderOpen] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)

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

  /**
   * Comprar exige biométrico desde $500 y biométrico + 3DS desde $1.000
   * (Spec 01 §5.1). El portón resuelve cuál de los tres casos es y, por debajo
   * del umbral, no aparece.
   *
   * La prueba viaja al backend, que vuelve a derivar lo exigido del precio que
   * él conoce. Este componente decide qué PEDIR; no decide qué se acepta.
   */
  function buy() {
    setMsg('')
    if (!connected) return openAuth()
    setLadderOpen(true)
  }

  async function buyAuthorized(biometricProof: string | null) {
    setLadderOpen(false)
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
        // Checkout embebido (Spec 01 §3.1): el comprador no sale de tbt.cafe.
        body: JSON.stringify({ workId: work!.id, biometricProof, embedded: true }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? t.work.errors.buyFailed)
      // El client_secret monta el formulario aquí mismo. Si el backend no lo
      // mandó, se cae al redirect de siempre en vez de dejar al comprador sin
      // ninguna forma de pagar.
      if (body.clientSecret) {
        setClientSecret(body.clientSecret)
        setBuying(false)
        return
      }
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
    // Piso de regalía fija (Spec 01 §2.2): una oferta por debajo dejaría al
    // vendedor pagando por vender, así que se rechaza indicando el mínimo.
    const floor = minPriceFor(royaltyOf(c))
    if (floor > 0 && amount < floor) {
      return setMsg(t.work.errors.belowFloor.replace('{min}', money(floor)))
    }
    const { error } = await makeOffer(work!.id, amount, c.availability === 'for_sale')
    if (error) return setMsg(t.work.errors.offerFailed)
    setMsg(t.work.offerSent)
    setOffering(false)
    setOfferAmount('')
  }

  // Matriz de comercio del hero (ÍTEM 1): disponibilidad × taking-offers.
  // .wk-act del prototipo — píldora clara con sombra si hay acción (Buy/Offer),
  // píldora oscura estática si es solo una etiqueta (Reserved/Not for sale).
  const wkActLive =
    'inline-flex items-center gap-2 rounded-[22px] px-[18px] py-[11px] bg-paper text-ink text-[11.5px] font-medium tracking-[0.12em] uppercase shadow-[0_3px_16px_rgba(0,0,0,0.34)]'
  const wkActStatic =
    'inline-flex items-center gap-2 rounded-[22px] px-[18px] py-[11px] bg-[rgba(20,19,18,0.72)] text-white border border-white/20 text-[11.5px] font-medium tracking-[0.12em] uppercase'
  let heroControl: ReactNode
  if (c.availability === 'for_sale') {
    heroControl = (
      <button type="button" onClick={buy} disabled={buying} className={`${wkActLive} disabled:opacity-60`}>
        <span className="w-2 h-2 rounded-full bg-[#3EA32C]" />
        {buying ? t.work.starting : t.work.buy}
      </button>
    )
  } else if (c.taking_offers) {
    heroControl = (
      <button type="button" onClick={() => setOffering(true)} className={wkActLive}>
        {t.work.makeOffer}
      </button>
    )
  } else if (c.availability === 'reserved') {
    heroControl = (
      <span className={wkActStatic}>
        <span className="w-2 h-2 rounded-full bg-[#D9922B]" />
        {t.action.reserved}
      </span>
    )
  } else {
    heroControl = <span className={wkActStatic}>{t.action.notForSale}</span>
  }

  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => (typeof window !== 'undefined' && window.history.length > 1 ? window.history.back() : (window.location.href = '/'))}
          className="back-link !pb-0"
        >
          ← {t.creator.back}
        </button>
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

      <div role="tablist" className="flex items-center gap-[22px] border-b border-hairline mt-[22px]">
        {(['profile', 'info', 'history'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`pb-3 text-[11.5px] tracking-[0.16em] uppercase transition-colors ${
              tab === k ? 'text-ink font-semibold' : 'text-placeholder font-normal hover:text-ink-soft'
            }`}
          >
            {t.work[TAB_KEY[k]]}
          </button>
        ))}
        {role && (
          <button
            role="tab"
            aria-selected={tab === 'action'}
            title={t.work.tabAction}
            aria-label={t.work.tabAction}
            onClick={() => setTab('action')}
            className={`flex items-center pb-[7px] ml-0.5 transition-colors ${tab === 'action' ? 'text-t-magenta' : 'text-t-magenta/60 hover:text-t-magenta'}`}
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="12" r="9.2" />
              <path d="M8.6 15.4L12 7.6l3.4 7.8M9.9 13.1h4.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
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
          <div className="w-full max-w-col bg-paper rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-display font-medium text-[18px] text-ink">{t.work.makeOffer}</div>
            <div className="text-[12px] text-ink-soft mt-1">{work.title}</div>
            <p className="text-[11.5px] text-ink-soft mt-2 leading-[1.5]">{t.work.offerHeldNote}</p>

            {c.initial_price != null && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-hairline text-[13px]">
                <span className="text-ink-soft">{t.work.offerLastValue}</span>
                <span className="text-ink">{money(c.initial_price)} USD</span>
              </div>
            )}

            <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-4">
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

            {(() => {
              const v = parseFloat(offerAmount.replace(/[^0-9.]/g, ''))
              if (!isFinite(v) || v <= 0) return null
              const q = quote(v, royaltyOf(c))
              return (
                <div className="mt-3 pt-3 border-t border-hairline">
                  <div className="flex items-center justify-between text-[13px] font-medium">
                    <span className="text-ink">{t.work.offerYouWouldPay}</span>
                    <span className="text-ink">{money(q.buyerTotal)} USD</span>
                  </div>
                  <p className="text-[10.5px] text-placeholder mt-1.5 leading-[1.5]">
                    {t.work.offerRoyaltyNote.replace('{royalty}', money(q.royalty))}
                  </p>
                </div>
              )
            })()}

            <p className="text-[10.5px] text-placeholder mt-3.5 leading-[1.5]">{t.work.offerNotPayment}</p>

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

      {clientSecret && (
        <EmbeddedCheckoutSheet clientSecret={clientSecret} onClose={() => setClientSecret(null)} />
      )}

      <LadderGate
        open={ladderOpen}
        action="purchase"
        amount={c.initial_price ?? null}
        onAuthorized={buyAuthorized}
        onCancel={() => setLadderOpen(false)}
      />
    </div>
  )
}
