'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { supabase } from '@/lib/supabase'
import { BrewChrome, BrewButton, BrewLabel, BrewInput, BrewSelect } from '@/components/brew/BrewChrome'
import { money } from '@/lib/fees'
import type { SeriesWithCount } from '@/lib/series-data'
import {
  fetchCreatorProfile,
  isCreatorProfileComplete,
  fetchSeriesOptions,
  runSimilarityScan,
  generateContext,
  createDraftWork,
  startRegistration,
  completeTbt,
  validateCoupon,
  type CreatorProfileRow,
  type RoyaltyChoice,
} from '@/lib/brew-data'

/**
 * Cold Brew — el flujo de certificación paso a paso (tbt-espresso.html,
 * chooser → p3..p7). Reemplaza el stub de /brew (Build Spec 01).
 *
 * Deliberadamente fuera de esta pasada: "Your Vision" (grabación de audio/
 * video opcional del prototipo) y Espresso (el flujo conversacional — ver
 * el chooser). Todo lo demás llama al backend real, retocado para CORS en
 * esta misma sesión: escaneo de originalidad, generación de contexto con
 * IA, Stripe, minteo en Solana.
 */

type Step =
  | 'loading'
  | 'gate'
  | 'chooser'
  | 'work1'
  | 'work2'
  | 'comm1'
  | 'comm2'
  | 'ctx1'
  | 'ctx2'
  | 'ctx3'
  | 'payment'
  | 'minting'
  | 'registered'

const STEP_PROGRESS: Record<Step, number> = {
  loading: 0,
  gate: 0,
  chooser: 0,
  work1: 12,
  work2: 22,
  comm1: 37,
  comm2: 45,
  ctx1: 58,
  ctx2: 66,
  ctx3: 74,
  payment: 90,
  minting: 96,
  registered: 100,
}

const CATEGORY_KEYS = [
  'painting', 'sculpture', 'digitalArt', 'photography', 'illustration', 'script',
  'music', 'video', 'mixedMedia', 'printmaking', 'ceramics', 'textile', 'nft', 'other',
] as const

const CURRENCIES = ['USD', 'EUR', 'COP', 'MXN']

type ScanState = 'idle' | 'scanning' | 'clear' | 'warning' | 'blocked'
type Declaration = 'original' | 'derivative' | 'authorized_edition'

export function BrewWizard() {
  const { t } = useLocale()
  const { connected, openAuth } = useShell()
  const params = useSearchParams()

  const [step, setStep] = useState<Step>('loading')
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<CreatorProfileRow | null>(null)
  const [series, setSeries] = useState<SeriesWithCount[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  // Work
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<(typeof CATEGORY_KEYS)[number]>('digitalArt')
  const [material, setMaterial] = useState('')
  const [dimensions, setDimensions] = useState('')
  const [createdDate, setCreatedDate] = useState('')
  const [isPublished, setIsPublished] = useState(true)
  const [seriesChoice, setSeriesChoice] = useState('__new')
  const [newSeriesName, setNewSeriesName] = useState('')

  // Image
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [aboutWork, setAboutWork] = useState('')
  const [assetLinks, setAssetLinks] = useState<string[]>([''])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Value
  const [marketPrice, setMarketPrice] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [royaltyType, setRoyaltyType] = useState<RoyaltyChoice>('percentage')
  const [royaltyValue, setRoyaltyValue] = useState('10')

  // Protection
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [scanScore, setScanScore] = useState(0)
  const [declaration, setDeclaration] = useState<Declaration>('original')

  // Context
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [location, setLocation] = useState('')
  const [weather, setWeather] = useState('')
  const [aiSummary, setAiSummary] = useState('')
  const [editedSummary, setEditedSummary] = useState('')
  const [momentLoading, setMomentLoading] = useState(false)
  const [sealHolding, setSealHolding] = useState(0) // 0..1
  const sealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Registration
  const [workId, setWorkId] = useState<string | null>(null)
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promoMsg, setPromoMsg] = useState('')
  const [promoDiscount, setPromoDiscount] = useState<{ type: 'percentage' | 'fixed'; value: number } | null>(null)
  const [mintSteps, setMintSteps] = useState(1)
  const [result, setResult] = useState<{ tbtId: string; title: string; solscanUrl: string } | null>(null)

  useEffect(() => {
    if (!connected) {
      // tbt-espresso.html's wireBrew(): no intermediate "sign in" screen —
      // hitting Brew unauthenticated opens the real auth flow immediately,
      // and resumes here (this effect re-runs) once it succeeds.
      openAuth()
      return
    }
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      // Back from Stripe (create-checkout's successUrl points here): resume
      // straight into minting instead of the normal gate/chooser/work flow.
      const returningWorkId = params.get('workId')
      const status = params.get('status')
      if (returningWorkId && status === 'success') {
        setWorkId(returningWorkId)
        setStep('minting')
        runMintSteps(returningWorkId, params.get('session_id') ?? undefined)
        return
      }
      if (returningWorkId && status === 'cancel') {
        setWorkId(returningWorkId)
        setStep('payment')
        return
      }

      const p = await fetchCreatorProfile(user.id)
      setProfile(p)
      if (!isCreatorProfileComplete(p)) {
        setStep('gate')
        return
      }
      setSeries(await fetchSeriesOptions(user.id))
      setStep('chooser')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  useEffect(() => {
    return () => URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  function close() {
    window.location.href = '/'
  }

  function pickImage(file: File | undefined) {
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  // ---- The Work ----------------------------------------------------------
  function submitWork1() {
    if (!title.trim()) return setMsg(t.brew.errors.titleRequired)
    if (!category) return setMsg(t.brew.errors.categoryRequired)
    setMsg('')
    setStep('work2')
  }

  async function submitWork2() {
    if (!imageFile) return setMsg(t.brew.errors.imageRequired)
    setMsg('')
    setStep('comm1')
  }

  // ---- Commercial / Protection --------------------------------------------
  function submitComm1() {
    setStep('comm2')
  }

  async function runScan() {
    if (!imageFile) return
    setScanState('scanning')
    const result = await runSimilarityScan(imageFile)
    const score = 'score' in result && result.score != null ? Math.round(result.score * 100) : 0
    setScanScore(score)
    setScanState(result.status === 'skipped' ? 'clear' : result.status)
  }

  function submitComm2() {
    if (scanState === 'blocked') return
    setStep('ctx1')
    loadMoment()
  }

  // ---- Context --------------------------------------------------------------
  async function loadMoment() {
    setMomentLoading(true)
    let lat: number | undefined
    let lng: number | undefined
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
      setCoords({ lat, lng })
    } catch {
      // no geolocation — the backend still returns a summary, just without location/weather
    }

    const result = await generateContext({
      creatorAlias: profile?.public_alias || profile?.legal_name || '',
      creatorBio: profile?.bio ?? undefined,
      creatorType: profile?.creator_type ?? 'individual',
      workTitle: title,
      workCategory: t.brew.categories[category],
      workMaterial: material || undefined,
      lat,
      lng,
    })
    setMomentLoading(false)
    if ('error' in result) return setMsg(t.brew.errors.contextFailed)
    setLocation(result.location)
    setWeather(result.weather)
    setAiSummary(result.summary)
    setEditedSummary(result.summary)
  }

  async function regenerateContext() {
    setMomentLoading(true)
    const result = await generateContext({
      creatorAlias: profile?.public_alias || profile?.legal_name || '',
      creatorBio: profile?.bio ?? undefined,
      creatorType: profile?.creator_type ?? 'individual',
      workTitle: title,
      workCategory: t.brew.categories[category],
      workMaterial: material || undefined,
      lat: coords?.lat,
      lng: coords?.lng,
    })
    setMomentLoading(false)
    if ('error' in result) return setMsg(t.brew.errors.contextFailed)
    setAiSummary(result.summary)
    setEditedSummary(result.summary)
  }

  function startSeal() {
    if (sealTimerRef.current) clearInterval(sealTimerRef.current)
    sealTimerRef.current = setInterval(() => {
      setSealHolding((p) => {
        const next = Math.min(1, p + 0.03)
        if (next >= 1) {
          if (sealTimerRef.current) clearInterval(sealTimerRef.current)
          setTimeout(() => submitSeal(), 500)
        }
        return next
      })
    }, 26)
  }
  function cancelSeal() {
    if (sealTimerRef.current) clearInterval(sealTimerRef.current)
    sealTimerRef.current = setInterval(() => {
      setSealHolding((p) => {
        const next = Math.max(0, p - 0.08)
        if (next <= 0 && sealTimerRef.current) clearInterval(sealTimerRef.current)
        return next
      })
    }, 20)
  }

  async function submitSeal() {
    if (!userId || !profile || !imageFile) return
    setBusy(true)
    setMsg('')
    const { workId: id, error } = await createDraftWork(userId, profile, {
      title,
      category: t.brew.categories[category],
      material,
      dimensions,
      createdDate,
      isPublished,
      seriesId: seriesChoice === '__new' ? null : seriesChoice,
      newSeriesName: seriesChoice === '__new' ? newSeriesName || 'Series 1' : null,
      imageFile,
      aboutWork,
      assetLinks,
      audioVideoFile: null,
      audioVideoType: null,
      marketPrice: parseFloat(marketPrice.replace(/[^0-9.]/g, '')) || 0,
      currency,
      royaltyType,
      royaltyValue: parseFloat(royaltyValue) || 0,
      originalityDeclaration: declaration,
      derivativeReference: null,
      location,
      coordinates: coords,
      weather,
      aiSummary,
      userEditedSummary: editedSummary !== aiSummary ? editedSummary : null,
    })
    setBusy(false)
    if (error || !id) {
      setMsg(t.brew.errors.draftFailed)
      return
    }
    setWorkId(id)
    setStep('payment')
  }

  // ---- Payment ----------------------------------------------------------
  async function applyPromo() {
    setPromoMsg('')
    const code = promoCode.trim().toUpperCase()
    if (!code) return
    const result = await validateCoupon(code)
    if (!result.valid) {
      setPromoMsg(t.brew.promoInvalid)
      setPromoDiscount(null)
      return
    }
    if (result.type === 'percentage' && (result.value ?? 0) >= 100) {
      setPromoMsg(t.brew.promoFullCoverage)
    } else {
      setPromoMsg(t.brew.promoHalfOff)
    }
    setPromoDiscount({ type: result.type!, value: result.value ?? 0 })
  }

  async function pay() {
    if (!workId) return
    setBusy(true)
    setMsg('')
    const origin = window.location.origin
    const result = await startRegistration(
      workId,
      promoDiscount ? promoCode.trim() : undefined,
      `${origin}/brew?workId=${workId}&status=success&session_id={CHECKOUT_SESSION_ID}`,
      `${origin}/brew?workId=${workId}&status=cancel`
    )
    if (result.error) {
      setBusy(false)
      setMsg(t.brew.errors.checkoutFailed)
      return
    }
    if (result.free) {
      setStep('minting')
      runMintSteps(workId)
      return
    }
    if (result.checkoutUrl) window.location.href = result.checkoutUrl
  }

  function runMintSteps(id: string, sessionId?: string) {
    setMintSteps(1)
    const iv = setInterval(() => {
      setMintSteps((s) => (s < 4 ? s + 1 : s))
    }, 700)
    completeTbt(id, undefined, sessionId).then((res) => {
      clearInterval(iv)
      setMintSteps(4)
      setTimeout(() => {
        if ('error' in res) {
          setMsg(t.brew.errors.completeFailed)
          setStep('payment')
          return
        }
        setResult({ tbtId: res.tbtId, title: res.workTitle, solscanUrl: res.solscanUrl })
        setStep('registered')
      }, 500)
    })
  }

  // ---- Render ----------------------------------------------------------

  if (step === 'loading') {
    // Also what's behind the auth modal while unauthenticated — the effect
    // above opens it immediately and this stays put until it resolves.
    return <div className="px-4 pt-8 text-[13px] text-ink-soft text-center">{t.work.loading}</div>
  }

  if (step === 'gate') {
    return (
      <BrewChrome onClose={close} progressPct={undefined}>
        <div className="text-center pt-4">
          <div className="w-14 h-14 rounded-full bg-paper-warm border border-hairline flex items-center justify-center mx-auto mb-4 text-[24px]">
            👤
          </div>
          <div className="font-display font-medium text-[22px] text-ink">{t.brew.gateTitle}</div>
          <p className="text-[13px] text-ink-soft mt-2.5 px-2">{t.brew.gateBody}</p>
          <a href="/profile/creator" className="block mt-6">
            <BrewButton>{t.brew.gateCta}</BrewButton>
          </a>
          <button type="button" onClick={close} className="w-full mt-2.5 py-3 text-[12px] text-ink-soft">
            {t.brew.gateNotNow}
          </button>
        </div>
      </BrewChrome>
    )
  }

  if (step === 'chooser') {
    return (
      <BrewChrome onClose={close} progressPct={undefined}>
        <div className="font-display font-medium text-[24px] text-ink">{t.brew.chooserTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1.5">{t.brew.chooserSub}</p>

        <button
          type="button"
          onClick={() => setStep('work1')}
          className="block w-full text-left border border-hairline rounded-2xl p-4 mt-5 hover:border-ink transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-[19px] text-ink">{t.brew.coldBrewName}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] border border-hairline rounded-full px-2.5 py-1 text-ink-soft">
              {t.brew.coldBrewBadge}
            </span>
          </div>
          <p className="text-[12.5px] text-ink-soft mt-1">{t.brew.coldBrewSub}</p>
        </button>

        <button
          type="button"
          onClick={() => setMsg(t.brew.espressoComingSoon)}
          className="block w-full text-left border border-hairline rounded-2xl p-4 mt-3 opacity-60"
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-[19px] text-ink">{t.brew.espressoName}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] border border-hairline rounded-full px-2.5 py-1 text-ink-soft">
              {t.brew.espressoBadge}
            </span>
          </div>
          <p className="text-[12.5px] text-ink-soft mt-1">{t.brew.espressoSub}</p>
        </button>

        {msg && <p className="text-[12px] text-ink-soft text-center mt-4">{msg}</p>}
      </BrewChrome>
    )
  }

  // ---- Cold Brew phases ----
  const backTo = (s: Step) => () => {
    setMsg('')
    setStep(s)
  }

  if (step === 'work1') {
    return (
      <BrewChrome onBack={backTo('chooser')} backLabel={t.brew.chooserTitle} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={submitWork1}>{t.brew.next}</BrewButton>}>
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.workTitle}</div>

        <div className="mt-4">
          <BrewLabel required>{t.brew.fieldTitle}</BrewLabel>
          <BrewInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.brew.fieldTitlePlaceholder} />
        </div>

        <div className="mt-3.5">
          <BrewLabel required>{t.brew.fieldCategory}</BrewLabel>
          <BrewSelect value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {t.brew.categories[k]}
              </option>
            ))}
          </BrewSelect>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3.5">
          <div>
            <BrewLabel>{t.brew.fieldMaterial}</BrewLabel>
            <BrewInput value={material} onChange={(e) => setMaterial(e.target.value)} placeholder={t.brew.fieldMaterialPlaceholder} />
          </div>
          <div>
            <BrewLabel>{t.brew.fieldDimensions}</BrewLabel>
            <BrewInput value={dimensions} onChange={(e) => setDimensions(e.target.value)} placeholder={t.brew.fieldDimensionsPlaceholder} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3.5">
          <div>
            <BrewLabel>{t.brew.fieldCreated}</BrewLabel>
            <BrewInput type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} />
          </div>
          <div>
            <BrewLabel>{t.brew.fieldVisibility}</BrewLabel>
            <BrewSelect value={isPublished ? 'published' : 'private'} onChange={(e) => setIsPublished(e.target.value === 'published')}>
              <option value="published">{t.brew.visibilityPublished}</option>
              <option value="private">{t.brew.visibilityPrivate}</option>
            </BrewSelect>
          </div>
        </div>

        <div className="mt-3.5">
          <BrewLabel>{t.brew.fieldSeries}</BrewLabel>
          <BrewSelect value={seriesChoice} onChange={(e) => setSeriesChoice(e.target.value)}>
            {series.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new">{t.brew.seriesAllNew}</option>
          </BrewSelect>
          {seriesChoice === '__new' && (
            <BrewInput
              className="mt-2"
              value={newSeriesName}
              onChange={(e) => setNewSeriesName(e.target.value)}
              placeholder={t.brew.seriesNewPlaceholder}
            />
          )}
        </div>

        {msg && <p className="text-[12px] text-t-red mt-3.5">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'work2') {
    return (
      <BrewChrome
        onBack={backTo('work1')}
        backLabel={t.brew.workTitle}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={submitWork2}>{t.brew.continue}</BrewButton>}
      >
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.imageTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1">{t.brew.imageSub}</p>

        <div
          className="mt-4 w-full aspect-square rounded-2xl border border-hairline bg-paper-warm bg-cover bg-center flex items-center justify-center"
          style={imagePreview ? { backgroundImage: `url(${imagePreview})` } : undefined}
        >
          {!imagePreview && <span className="text-[13px] text-placeholder">{t.brew.imageTitle}</span>}
        </div>

        <div className="flex gap-2.5 mt-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-1.5 border border-ink rounded-xl py-3.5"
          >
            <span className="text-[12px] font-medium text-ink">{t.brew.takePhoto}</span>
          </button>
          <label className="flex-1 flex flex-col items-center gap-1.5 border border-hairline bg-paper-warm rounded-xl py-3.5 cursor-pointer">
            <span className="text-[12px] text-ink-soft">{t.brew.chooseFile}</span>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
          </label>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => pickImage(e.target.files?.[0])}
          />
        </div>

        <div className="mt-4">
          <BrewLabel>{t.brew.aboutWork}</BrewLabel>
          <textarea
            value={aboutWork}
            onChange={(e) => setAboutWork(e.target.value)}
            placeholder={t.brew.aboutWorkPlaceholder}
            rows={3}
            className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors resize-none placeholder:text-placeholder"
          />
        </div>

        <div className="mt-4">
          <BrewLabel>
            {t.brew.assetAnchors} <span className="normal-case tracking-normal text-placeholder">· {t.brew.assetAnchorsHint}</span>
          </BrewLabel>
          {assetLinks.map((link, i) => (
            <BrewInput
              key={i}
              type="url"
              value={link}
              onChange={(e) => setAssetLinks((links) => links.map((l, idx) => (idx === i ? e.target.value : l)))}
              placeholder={t.brew.assetAnchorsPlaceholder}
              className="mb-2"
            />
          ))}
          {assetLinks.length < 5 && (
            <button type="button" onClick={() => setAssetLinks((l) => [...l, ''])} className="text-[12px] text-ink-soft flex items-center gap-1">
              <span className="text-[15px] leading-none">+</span>
              {t.brew.addAnotherLink}
            </button>
          )}
        </div>

        {msg && <p className="text-[12px] text-t-red mt-3.5">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'comm1') {
    const royaltyOpts: [RoyaltyChoice, string][] = [
      ['none', t.brew.royaltyNone],
      ['percentage', t.brew.royaltyPercentage],
      ['fixed', t.brew.royaltyFixed],
    ]
    return (
      <BrewChrome
        onBack={backTo('work2')}
        backLabel={t.brew.imageTitle}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={submitComm1}>{t.brew.next}</BrewButton>}
      >
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.valueTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1">{t.brew.valueSub}</p>

        <div className="grid gap-3 mt-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <div>
            <BrewLabel>{t.brew.marketPrice}</BrewLabel>
            <BrewInput value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} inputMode="decimal" placeholder="0" />
          </div>
          <div>
            <BrewLabel>{t.brew.currency}</BrewLabel>
            <BrewSelect value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </BrewSelect>
          </div>
        </div>

        <div className="mt-4">
          <BrewLabel>{t.brew.royalty}</BrewLabel>
          <div className="flex gap-2">
            {royaltyOpts.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRoyaltyType(k)}
                className={`flex-1 py-2.5 rounded-xl border text-[13px] transition-colors ${
                  royaltyType === k ? 'border-ink bg-paper-warm text-ink' : 'border-hairline text-ink-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {royaltyType === 'percentage' && (
            <div className="flex items-center gap-2.5 mt-3">
              <BrewInput
                value={royaltyValue}
                onChange={(e) => setRoyaltyValue(e.target.value)}
                inputMode="decimal"
                className="w-20 text-right"
              />
              <span className="text-[13px] text-ink-soft">{t.brew.royaltyPctSuffix}</span>
            </div>
          )}
          {royaltyType === 'fixed' && (
            <div className="mt-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
                <div>
                  <BrewLabel>{t.brew.royaltyFixedAmount}</BrewLabel>
                  <BrewInput value={royaltyValue} onChange={(e) => setRoyaltyValue(e.target.value)} inputMode="decimal" className="text-right" />
                </div>
              </div>
              <p className="text-[11.5px] text-ink-soft mt-1.5">{t.brew.royaltyFixedNote}</p>
            </div>
          )}
        </div>
      </BrewChrome>
    )
  }

  if (step === 'comm2') {
    return (
      <BrewChrome
        onBack={backTo('comm1')}
        backLabel={t.brew.valueTitle}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={submitComm2} disabled={scanState === 'blocked'}>{scanState === 'blocked' ? t.brew.blocked : t.brew.continue}</BrewButton>}
      >
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.protectionTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1">{t.brew.protectionSub}</p>

        <div className="mt-5">
          {scanState === 'idle' && (
            <div className="border border-hairline rounded-2xl p-7 text-center">
              <BrewButton onClick={runScan}>{t.brew.runScan}</BrewButton>
            </div>
          )}
          {scanState === 'scanning' && (
            <div className="border border-hairline rounded-2xl p-7 text-center">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink-soft mb-4">{t.brew.scanning}</div>
              <div className="w-10 h-10 mx-auto border-2 border-hairline border-t-ink rounded-full animate-spin" />
            </div>
          )}
          {scanState === 'clear' && (
            <div className="border border-t-green/40 bg-t-green/5 rounded-2xl p-5 text-center">
              <div className="w-11 h-11 mx-auto rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center text-[20px] mb-3">
                ✓
              </div>
              <div className="font-display text-[18px] text-ink">{t.brew.scanCleanTitle}</div>
              <p className="text-[12px] text-ink-soft mt-1.5">{t.brew.scanCleanBody.replace('{score}', String(scanScore))}</p>
            </div>
          )}
          {(scanState === 'warning' || scanState === 'blocked') && (
            <div className={`border rounded-2xl p-4 ${scanState === 'blocked' ? 'border-t-red/40 bg-t-red/5' : 'border-hairline'}`}>
              <div className="text-[13px] font-medium text-ink">
                {scanState === 'blocked' ? t.brew.scanBlockTitle : t.brew.scanWarnTitle}
              </div>
              <p className="text-[12px] text-ink-soft mt-1.5 leading-[1.5]">
                {(scanState === 'blocked' ? t.brew.scanBlockBody : t.brew.scanWarnBody).replace('{score}', String(scanScore))}
              </p>
              {scanState === 'warning' && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.1em] text-ink-soft mb-2">{t.brew.declareRelationship}</div>
                  {(
                    [
                      ['original', t.brew.declareOriginal, t.brew.declareOriginalSub],
                      ['derivative', t.brew.declareDerivative, t.brew.declareDerivativeSub],
                      ['authorized_edition', t.brew.declareEdition, t.brew.declareEditionSub],
                    ] as [Declaration, string, string][]
                  ).map(([k, label, sub]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setDeclaration(k)}
                      className={`block w-full text-left border rounded-xl p-3 mb-2 transition-colors ${
                        declaration === k ? 'border-ink bg-paper-warm' : 'border-hairline bg-paper'
                      }`}
                    >
                      <div className="text-[13px] font-medium text-ink">{label}</div>
                      <div className="text-[11.5px] text-ink-soft mt-0.5">{sub}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </BrewChrome>
    )
  }

  if (step === 'ctx1') {
    return (
      <BrewChrome onBack={backTo('comm2')} backLabel={t.brew.protectionTitle} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={() => setStep('ctx2')} disabled={momentLoading}>{t.brew.next}</BrewButton>}>
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.momentTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1">{t.brew.momentSub}</p>

        {momentLoading ? (
          <p className="text-[13px] text-ink-soft mt-6 text-center">{t.brew.momentLoading}</p>
        ) : (
          <div className="mt-4 border border-hairline rounded-2xl overflow-hidden">
            <div className="flex items-start gap-2.5 p-3.5">
              <span className="text-[15px] w-5 text-center shrink-0">⌖</span>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft mb-1">{t.brew.timeAndPlace}</div>
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => setLocation(e.currentTarget.textContent ?? '')}
                  className="font-display text-[15px] text-ink outline-none"
                >
                  {location}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2.5 p-3.5 border-t border-hairline">
              <span className="text-[15px] w-5 text-center shrink-0">☀</span>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-ink-soft mb-1">{t.brew.weather}</div>
                <div
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => setWeather(e.currentTarget.textContent ?? '')}
                  className="font-display text-[15px] text-ink outline-none"
                >
                  {weather}
                </div>
              </div>
            </div>
          </div>
        )}
        <p className="text-[10.5px] text-placeholder mt-2">{t.brew.momentHint}</p>

        {msg && <p className="text-[12px] text-t-red mt-3.5">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'ctx2') {
    return (
      <BrewChrome onBack={backTo('ctx1')} backLabel={t.brew.momentTitle} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={() => setStep('ctx3')}>{t.brew.continue}</BrewButton>}>
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.contextTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1">{t.brew.contextSub}</p>

        <div className="flex items-center gap-1.5 mt-4 mb-2">
          <span className="text-[11px] text-ink-soft">✦ {t.brew.contextGenerated}</span>
          <button type="button" onClick={regenerateContext} disabled={momentLoading} className="ml-auto text-[11px] text-ink-soft flex items-center gap-1">
            ↺ {t.brew.regenerate}
          </button>
        </div>
        <textarea
          value={editedSummary}
          onChange={(e) => setEditedSummary(e.target.value)}
          rows={10}
          className="w-full border border-hairline rounded-2xl p-4 font-display text-[15px] leading-[1.6] text-ink outline-none focus:border-ink transition-colors bg-[#FCFBFA] resize-none"
        />
      </BrewChrome>
    )
  }

  if (step === 'ctx3') {
    return (
      <BrewChrome onBack={backTo('ctx2')} backLabel={t.brew.contextTitle} onClose={close} progressPct={STEP_PROGRESS[step]}>
        <div className="font-display font-medium text-[20px] text-ink">{t.brew.sealTitle}</div>
        <p className="text-[13px] text-ink-soft mt-1">{t.brew.sealSub}</p>

        <div className="border border-hairline rounded-2xl p-3.5 mt-4">
          {[
            [t.brew.sealCreator, profile?.public_alias || profile?.legal_name || ''],
            [t.brew.sealWork, title],
            [t.brew.sealValue, marketPrice ? `${money(parseFloat(marketPrice) || 0)} ${currency}` : '—'],
            [t.brew.sealAnchored, location],
          ].map(([k, v], i) => (
            <div key={k} className={`flex items-start justify-between gap-3 py-1.5 text-[12.5px] ${i > 0 ? 'border-t border-hairline' : ''}`}>
              <span className="text-ink-soft shrink-0">{k}</span>
              <span className="text-ink text-right">{v}</span>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <button
            type="button"
            onMouseDown={startSeal}
            onMouseUp={cancelSeal}
            onMouseLeave={cancelSeal}
            onTouchStart={(e) => {
              e.preventDefault()
              startSeal()
            }}
            onTouchEnd={(e) => {
              e.preventDefault()
              cancelSeal()
            }}
            disabled={busy}
            className="relative w-[120px] h-[120px] mx-auto"
          >
            <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
              <circle cx="60" cy="60" r="53" fill="none" stroke="var(--hairline)" strokeWidth="3" />
              <circle
                cx="60"
                cy="60"
                r="53"
                fill="none"
                stroke={sealHolding >= 1 ? 'var(--t-green)' : 'var(--t-navy)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={333}
                strokeDashoffset={333 * (1 - sealHolding)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              <span className="text-[24px]">{sealHolding >= 1 ? '✓' : '🔒'}</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                {sealHolding >= 1 ? t.brew.sealed : t.brew.holdToSeal}
              </span>
            </div>
          </button>
          <p className="text-[11px] text-placeholder mt-3.5">{t.brew.pressAndHold}</p>
        </div>

        {msg && <p className="text-[12px] text-t-red mt-4 text-center">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'payment') {
    const price = 8
    return (
      <BrewChrome
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={
          <div>
            <BrewButton onClick={pay} disabled={busy}>
              {promoDiscount?.type === 'percentage' && promoDiscount.value >= 100
                ? t.brew.registerFree
                : t.brew.payToRegister.replace('{amount}', `$${price}`)}
            </BrewButton>
            <p className="text-center text-[10px] text-placeholder mt-2.5">{t.brew.securedByStripe}</p>
          </div>
        }
      >
        <div className="font-display font-medium text-[22px] text-ink">{t.brew.registerTitle}</div>
        <p className="text-[13px] text-ink-soft mt-2">{t.brew.registerSub}</p>

        <div className="border border-hairline rounded-2xl mt-4 p-3.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-paper-warm shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-ink">{title}</div>
              <div className="text-[10.5px] text-ink-soft">{t.brew.categories[category]}</div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-hairline">
            <div>
              <div className="text-[12.5px] text-ink">{t.brew.registrationFee}</div>
              <div className="text-[10px] text-placeholder mt-0.5">{t.brew.registrationFeeNote}</div>
            </div>
            <div className="font-display text-[18px] text-ink">${price.toFixed(2)}</div>
          </div>
        </div>

        <button type="button" onClick={() => setPromoOpen((v) => !v)} className="text-[11.5px] text-ink-soft mt-3.5">
          {t.brew.promoToggle}
        </button>
        {promoOpen && (
          <div className="mt-2.5">
            <div className="flex gap-2">
              <BrewInput
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder={t.brew.promoPlaceholder}
                className="flex-1 uppercase tracking-[0.05em]"
              />
              <button type="button" onClick={applyPromo} className="px-4.5 border border-ink bg-ink text-paper rounded-xl text-[11px] uppercase tracking-[0.08em]">
                {t.brew.promoApply}
              </button>
            </div>
            {promoMsg && (
              <p className={`text-[11px] mt-2 ${promoDiscount ? 'text-t-green' : 'text-t-red'}`}>{promoMsg}</p>
            )}
          </div>
        )}

        {msg && <p className="text-[12px] text-t-red mt-4">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'minting') {
    const steps = [t.brew.stepPaymentConfirmed, t.brew.stepMinting, t.brew.stepCertificate, t.brew.stepSending]
    return (
      <BrewChrome onClose={close} progressPct={STEP_PROGRESS[step]}>
        <div className="text-center pt-4">
          <div className="font-display font-medium text-[22px] text-ink">{t.brew.mintingTitle}</div>
          <p className="text-[13px] text-ink-soft mt-2">{t.brew.mintingSub}</p>
          <div className="w-16 h-16 mx-auto mt-7 border-2 border-hairline border-t-t-navy rounded-full animate-spin" />
          <div className="mt-6 text-left max-w-[220px] mx-auto">
            {steps.map((s, i) => {
              const state = i < mintSteps - 1 ? 'done' : i === mintSteps - 1 ? 'active' : 'pending'
              return (
                <div key={s} className={`flex items-center gap-2.5 py-1.5 ${state === 'pending' ? 'opacity-40' : ''}`}>
                  <span
                    className={`text-[13px] ${state === 'done' ? 'text-t-green' : state === 'active' ? 'text-t-navy' : 'text-placeholder'}`}
                  >
                    {state === 'done' ? '✓' : '○'}
                  </span>
                  <span className="text-[12.5px] text-ink">{s}</span>
                </div>
              )
            })}
          </div>
        </div>
      </BrewChrome>
    )
  }

  if (step === 'registered' && result) {
    return (
      <BrewChrome onClose={close} progressPct={100}>
        <div className="text-center pt-4">
          <div className="w-14 h-14 mx-auto rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center text-[26px] mb-3">
            ✓
          </div>
          <div className="font-display font-medium text-[26px] text-ink">{t.brew.registeredTitle}</div>
          <p className="text-[13px] text-ink-soft mt-2 px-4">{t.brew.registeredBody.replace('{title}', result.title)}</p>
          <a href={`/work/${result.tbtId}`} className="block mt-6">
            <BrewButton>{t.brew.viewCertificate}</BrewButton>
          </a>
          <button type="button" onClick={close} className="w-full mt-2.5 py-3 text-[12px] text-ink-soft">
            {t.brew.done}
          </button>
        </div>
      </BrewChrome>
    )
  }

  return null
}
