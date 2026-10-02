'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { LadderGate } from '@/components/LadderGate'
import { EmbeddedCheckoutSheet } from '@/components/EmbeddedCheckoutSheet'
import { fetchWorkFull, ownerRole, royaltyOf, type WorkFull } from '@/lib/work-data'
import { makeOffer, fetchOfferContext, fetchOffer } from '@/lib/offers-data'
import { durationsFor, DEFAULT_DURATION } from '@/lib/offers'
import { saleQuote, money, minPriceFor } from '@/lib/fees'
import { WorkActions } from '@/components/WorkActions'
import { ProfileTab } from '@/components/work/ProfileTab'
import { InfoTab } from '@/components/work/InfoTab'
import { HistoryTab } from '@/components/work/HistoryTab'
import { ActionTab } from '@/components/work/ActionTab'
import { useRules } from '@/lib/rules-public'

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

export default function WorkPage({ params, scannedAt = null }: { params: { tbtId: string }; scannedAt?: string | null }) {
  const { t } = useLocale()
  // Tarifas y piso de configuracion (Work Order 02, 1.2). Sin reglas no se
  // muestra ni se decide un precio.
  const rules = useRules()
  const { connected, openAuth } = useShell()

  const [work, setWork] = useState<WorkFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('profile')
  const [buying, setBuying] = useState(false)
  const [offering, setOffering] = useState(false)
  const [offerAmount, setOfferAmount] = useState('')
  const [offerDuration, setOfferDuration] = useState<number | null>(null)
  const [offerMessage, setOfferMessage] = useState('')
  // Lo que se avisa antes de ofertar (4.2) y si la obra esta congelada (4.13).
  const [offerCtx, setOfferCtx] = useState<{ holderApproved: boolean; holderCovered: boolean; frozenUntil: string | null } | null>(null)
  const [msg, setMsg] = useState('')
  const [ladderOpen, setLadderOpen] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [checkoutAccount, setCheckoutAccount] = useState<string | null>(null)
  /*
   * La hoja antes del cargo (Work Order 02, 0.8): la pregunta del nombre, la
   * linea del estado de cuenta y, en la primera compra, la de los Terms. Lo que
   * se paga: el precio de lista, o el monto de la oferta aceptada.
   */
  const [prepay, setPrepay] = useState<{ amount: number } | null>(null)
  const [purchaseCtx, setPurchaseCtx] = useState<{ firstPurchase: boolean; path: 'direct' | 'platform'; sellerName: string | null } | null>(null)
  const [holderNamed, setHolderNamed] = useState(false)
  const [payAmount, setPayAmount] = useState<number | null>(null)

  async function openPrepay(amount: number, workId: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return openAuth()
    const res = await fetch(`/api/purchase/context?workId=${encodeURIComponent(workId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const ctx = await res.json().catch(() => null)
    if (!res.ok || !ctx) return setMsg(t.work.errors.buyFailed)
    setPurchaseCtx({ firstPurchase: ctx.firstPurchase, path: ctx.path, sellerName: ctx.sellerName })
    // 0.8a: preseleccionado por el interruptor de anonimato.
    setHolderNamed(ctx.nameByDefault === true)
    setPrepay({ amount })
  }

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setUserId(user?.id ?? null)
    const w = await fetchWorkFull(params.tbtId)
    if (!w) setNotFound(true)
    setWork(w)
    if (w) setOfferCtx(await fetchOfferContext(w.id))
    // Desde la hoja de la oferta: pagar la oferta aceptada (0.8a).
    const payOffer = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('payOffer') : null
    if (w && payOffer && user) {
      const offer = await fetchOffer(payOffer)
      if (offer && offer.payAvailable) await openPrepay(offer.amount, w.id)
    }
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
  // Una obra bonded nombra al creador declarado, nunca a quien la registró (Step 20).
  const bonded = work.registered_as === 'collector'
  const creatorName = bonded
    ? work.bonded?.unattributed
      ? t.collector.unattributed
      : work.bonded?.name || t.work.unknownArtist
    : work.creator?.public_alias || work.creator?.display_name || t.work.unknownArtist
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
    openPrepay(c.initial_price ?? 0, work!.id)
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
      const res = await fetch('/api/stripe/create-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        // Checkout embebido (Spec 01 §3.1): el comprador no sale de tbt.cafe.
        body: JSON.stringify({ workId: work!.id, biometricProof, embedded: true, holderNamed }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? t.work.errors.buyFailed)
      // El client_secret monta el formulario aquí mismo. Si el backend no lo
      // mandó, se cae al redirect de siempre en vez de dejar al comprador sin
      // ninguna forma de pagar.
      if (body.clientSecret) {
        setCheckoutAccount(body.stripeAccount ?? null)
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
    // Piso de regalía fija (D-8): por debajo se rechaza diciendo el mínimo.
    if (!rules) return
    const floor = minPriceFor(royaltyOf(c), rules)
    if (floor > 0 && amount < floor) {
      return setMsg(t.offer.belowFloor.replace('{amount}', money(floor)))
    }
    const { error, floor: serverFloor } = await makeOffer(work!.id, amount, c.availability === 'for_sale', {
      durationHours: offerDuration ?? undefined,
      message: offerMessage.trim() || undefined,
    })
    if (error === 'below_floor' && serverFloor) return setMsg(t.offer.belowFloor.replace('{amount}', money(serverFloor)))
    if (error) return setMsg(t.work.errors.offerFailed)
    setMsg(t.work.offerSent)
    setOffering(false)
    setOfferAmount('')
    setOfferMessage('')
  }

  // Matriz de comercio del hero (ÍTEM 1): disponibilidad × taking-offers.
  // .wk-act del prototipo — píldora clara con sombra si hay acción (Buy/Offer),
  // píldora oscura estática si es solo una etiqueta (Reserved/Not for sale).
  const wkActLive =
    'inline-flex items-center gap-2 rounded-[22px] px-[18px] py-[11px] bg-paper text-ink text-[11.5px] font-medium tracking-[0.12em] uppercase shadow-[0_3px_16px_rgba(0,0,0,0.34)]'
  const wkActStatic =
    'inline-flex items-center gap-2 rounded-[22px] px-[18px] py-[11px] bg-[rgba(20,19,18,0.72)] text-white border border-white/20 text-[11.5px] font-medium tracking-[0.12em] uppercase'
  let heroControl: ReactNode
  if (offerCtx?.frozenUntil) {
    // 4.13: una oferta aceptada espera el pago; la obra esta en espera.
    heroControl = (
      <span className={wkActStatic}>
        <span className="w-2 h-2 rounded-full bg-[#D9922B]" />
        {t.work.frozen.replace('{date}', new Date(offerCtx.frozenUntil).toLocaleDateString())}
      </span>
    )
  } else if (c.availability === 'for_sale') {
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
        {bonded ? (
          <span>{creatorName}</span>
        ) : (
          <a href={`/creator/${work.creator_id}`} className="hover:underline">
            {creatorName}
          </a>
        )}
        {work.series && !bonded && (
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
        {tab === 'profile' && (
          <ProfileTab
            work={work}
            canEdit={!!role}
            // Chains 01, 8.2: los enlaces, solo el creador mientras tiene la obra.
            canEditLinks={!!userId && work.creator_id === userId && work.current_owner_id === userId}
            heroControl={heroControl}
            onSaved={load}
          />
        )}
        {tab === 'info' && <InfoTab work={work} scannedAt={scannedAt} />}
        {tab === 'history' && <HistoryTab workId={work.id} tbtId={work.tbt_id} />}
        {tab === 'action' && role && userId && <ActionTab work={work} role={role} userId={userId} onChanged={load} />}
      </div>

      {offering && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setOffering(false)}>
          <div className="w-full max-w-col bg-paper rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-display font-medium text-[18px] text-ink">{t.offer.title}</div>
            <div className="text-[12px] text-ink-soft mt-1">{work.title}</div>
            <p className="text-[11.5px] text-ink-soft mt-2 leading-[1.5]">{t.work.offerHeldNote}</p>

            {c.initial_price != null && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-hairline text-[13px]">
                <span className="text-ink-soft">{t.work.offerLastValue}</span>
                <span className="text-ink">{money(c.initial_price)} USD</span>
              </div>
            )}

            {/* 4.2: S-2 si quien la tiene no esta aprobado; si su pais no tiene cobro, la linea simple. */}
            {offerCtx && !offerCtx.holderCovered && (
              <p className="text-[11.5px] text-ink mt-3 leading-[1.5]">{t.offer.notCovered}</p>
            )}
            {offerCtx && offerCtx.holderCovered && !offerCtx.holderApproved && (
              <p className="text-[11.5px] text-ink mt-3 leading-[1.5]">{t.offer.unapproved}</p>
            )}

            <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-4">
              {t.offer.amount}
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
              if (!isFinite(v) || v <= 0 || !rules) return null
              // Lo que paga el comprador no depende de la via de cobro.
              const q = saleQuote({ price: v, royalty: royaltyOf(c), path: 'platform' }, rules)
              return (
                <div className="mt-3 pt-3 border-t border-hairline">
                  <div className="flex items-center justify-between text-[13px] font-medium">
                    <span className="text-ink">{t.work.offerYouWouldPay}</span>
                    <span className="text-ink">{money(q.buyerTotal)} USD</span>
                  </div>
                  <p className="text-[10.5px] text-placeholder mt-1.5 leading-[1.5]">
                    {t.work.offerRoyaltyNote.replace('{royalty}', money(q.royaltyGross))}
                  </p>
                </div>
              )
            })()}

            {rules && (
              <>
                <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-4" htmlFor="offer-duration">
                  {t.offer.duration}
                </label>
                <select
                  id="offer-duration"
                  value={offerDuration ?? Math.min(DEFAULT_DURATION, rules.offers.maxHours)}
                  onChange={(e) => setOfferDuration(Number(e.target.value))}
                  className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] bg-white"
                >
                  {durationsFor(rules).map((h) => (
                    <option key={h} value={h}>
                      {t.offer.hours.replace('{hours}', String(h))}
                    </option>
                  ))}
                </select>

                <label className="block mb-[9px] text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft mt-4" htmlFor="offer-message">
                  {t.offer.message}
                </label>
                <textarea
                  id="offer-message"
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value.slice(0, rules.offers.messageMax))}
                  maxLength={rules.offers.messageMax}
                  rows={3}
                  className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink resize-none"
                />
              </>
            )}

            <p className="text-[10.5px] text-placeholder mt-3.5 leading-[1.5]">{t.work.offerNotPayment}</p>
            {/* 4.11 */}
            <p className="text-[10.5px] text-placeholder mt-1.5 leading-[1.5]">{t.offer.elsewhere}</p>

            <button
              type="button"
              onClick={sendOffer}
              className="w-full mt-4 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl hover:bg-black transition-colors"
            >
              {t.offer.send}
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
        <EmbeddedCheckoutSheet
          clientSecret={clientSecret}
          stripeAccount={checkoutAccount}
          onClose={() => setClientSecret(null)}
          // Sin "para quién": en una compra el destinatario es quien está
          // pagando. El prototipo sí lo muestra porque allí el comprador acaba
          // de escribir sus datos de coleccionista y la línea se los confirma;
          // aquí no hay nada que confirmar, y decirle su propio nombre a quien
          // compra no añade nada.
          recap={{
            what: work.title,
            amount: rules ? `${money(saleQuote({ price: payAmount ?? c.initial_price ?? 0, royalty: royaltyOf(c), path: purchaseCtx?.path ?? 'platform' }, rules).buyerTotal)} USD` : '—',
          }}
        />
      )}

      {prepay && purchaseCtx && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setPrepay(null)}>
          <div className="w-full max-w-col bg-paper rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-display font-medium text-[18px] text-ink">{work.title}</div>
            {rules && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-hairline text-[13px] font-medium">
                <span className="text-ink">{t.work.offerYouWouldPay}</span>
                <span className="text-ink">
                  {money(saleQuote({ price: prepay.amount, royalty: royaltyOf(c), path: purchaseCtx.path }, rules).buyerTotal)} USD
                </span>
              </div>
            )}
            {/* 0.8a: el nombre en el registro permanente, con su nota. */}
            <label className="flex items-start gap-2.5 mt-5 mb-2 text-[13px] text-ink">
              <input type="checkbox" checked={holderNamed} onChange={(e) => setHolderNamed(e.target.checked)} className="mt-1" />
              <span>{t.holder.nameQuestion}</span>
            </label>
            <p className="text-[11px] leading-[1.5] text-ink-soft pl-6">{t.holder.nameNote}</p>
            {/* 0.8c: el nombre del estado de cuenta. */}
            <p className="text-[11.5px] text-ink-soft mt-4">
              {purchaseCtx.path === 'direct' && purchaseCtx.sellerName
                ? t.purchase.statementSeller.replace('{seller}', purchaseCtx.sellerName)
                : t.purchase.statementPlatform}
            </p>
            {/* 0.8b: solo en la primera compra, sin casilla. */}
            {purchaseCtx.firstPurchase && (
              <p className="text-[11.5px] text-ink-soft mt-2">
                {t.purchase.terms.split('{terms}')[0]}
                <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="underline">
                  {t.purchase.termsLink}
                </a>
                {t.purchase.terms.split('{terms}')[1] ?? ''}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setPayAmount(prepay.amount)
                setPrepay(null)
                setLadderOpen(true)
              }}
              className="mt-5 w-full rounded-xl bg-ink text-paper py-3 text-[13px] font-medium"
            >
              {t.work.buy}
            </button>
          </div>
        </div>
      )}

      <LadderGate
        open={ladderOpen}
        action="purchase"
        amount={payAmount ?? c.initial_price ?? null}
        onAuthorized={buyAuthorized}
        onCancel={() => setLadderOpen(false)}
      />
    </div>
  )
}
