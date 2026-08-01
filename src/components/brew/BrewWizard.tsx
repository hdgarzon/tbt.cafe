'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { supabase } from '@/lib/supabase'
import { BrewChrome, BrewTitle, BrewInfo, BrewButton, BrewLabel, BrewInput, BrewSelect } from '@/components/brew/BrewChrome'
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
 * Fuera de alcance: Espresso, el flujo conversacional (ver el chooser).
 * Todo lo demás llama al backend real: escaneo de originalidad, generación
 * de contexto con IA, Stripe y minteo en Solana. Donde el prototipo simula
 * (el reproductor de "Your Vision", la caja "Demo · preview a result" del
 * escaneo) aquí se hace de verdad o simplemente no se copia.
 */

type Step =
  | 'loading'
  | 'gate'
  | 'chooser'
  | 'work1'
  | 'work2'
  | 'work3'
  | 'comm1'
  | 'comm2'
  | 'ctx1'
  | 'ctx2'
  | 'ctx3'
  | 'payment'
  | 'minting'
  | 'registered'

// progFill() del prototipo: cada fase ocupa un cuarto de la barra y cada
// sub-paso avanza sub/(n+1) dentro de su cuarto — nunca arranca en cero.
const STEP_PROGRESS: Record<Step, number> = {
  loading: 0,
  gate: 0,
  chooser: 0,
  work1: 6,
  work2: 13,
  work3: 19,
  comm1: 33,
  comm2: 42,
  ctx1: 56,
  ctx2: 63,
  ctx3: 69,
  payment: 88,
  minting: 94,
  registered: 100,
}

const CATEGORY_KEYS = [
  'painting', 'sculpture', 'digitalArt', 'photography', 'illustration', 'script',
  'music', 'video', 'mixedMedia', 'printmaking', 'ceramics', 'textile', 'nft', 'other',
] as const

const CURRENCIES = ['USD', 'EUR', 'COP', 'MXN']

// Umbrales REALES del backend (tbt-image/similarity): ≥0.75 avisa, ≥0.9 bloquea.
// El prototipo dibuja la línea en 60% porque su escaneo es simulado.
const PASS_LINE = 75

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

  // Your Vision (grabación opcional de audio/vídeo)
  const [visionFile, setVisionFile] = useState<File | null>(null)
  const [visionKind, setVisionKind] = useState<'audio' | 'video' | null>(null)
  const [visionUrl, setVisionUrl] = useState('')
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  /** Valor que sube en el medidor mientras aterriza el resultado real. */
  const [scanAnim, setScanAnim] = useState(0)
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
  /** Ya resolvimos una sesión válida y colocamos el paso inicial. */
  const resolvedRef = useRef(false)

  useEffect(() => {
    ;(async () => {
      // `connected` cambia de false a true al restaurarse la sesión, lo que
      // vuelve a disparar este efecto; sin esta guarda reiniciaría el asistente
      // encima de lo que el creador ya llevaba escrito.
      if (resolvedRef.current) return
      // Hay que preguntarle a Supabase, NO a `connected`: el shell arranca en
      // false y solo pasa a true cuando termina de restaurar la sesión, así
      // que decidir con él abría el modal a un usuario ya autenticado.
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        // wireBrew() de tbt-espresso.html: sin pantalla intermedia — sin sesión
        // se abre la autenticación real y, al lograrse, `connected` cambia,
        // este efecto se vuelve a ejecutar y continúa el flujo.
        openAuth()
        return
      }
      resolvedRef.current = true
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

  // Al salir del asistente hay que soltar micrófono/cámara y el objeto URL:
  // dejar la pista viva mantiene el indicador de grabación del sistema encendido.
  useEffect(() => {
    return () => {
      if (recStopTimerRef.current) clearTimeout(recStopTimerRef.current)
      const mr = recorderRef.current
      if (mr && mr.state !== 'inactive') mr.stop()
      mr?.stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  useEffect(() => {
    return () => {
      if (visionUrl) URL.revokeObjectURL(visionUrl)
    }
  }, [visionUrl])

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
    setStep('work3')
  }

  // ---- Your Vision --------------------------------------------------------
  /** Graba con MediaRecorder; el prototipo tope en 1 minuto, igual aquí. */
  async function startRecording(kind: 'audio' | 'video') {
    setMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'video' ? { audio: true, video: true } : { audio: true }
      )
      const mr = new MediaRecorder(stream)
      const chunks: BlobPart[] = []
      mr.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      mr.onstop = () => {
        const type = mr.mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm')
        const blob = new Blob(chunks, { type })
        const ext = type.includes('mp4') ? 'mp4' : 'webm'
        setVisionFile(new File([blob], `vision.${ext}`, { type }))
        setVisionKind(kind)
        setVisionUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach((tr) => tr.stop())
      }
      recorderRef.current = mr
      mr.start()
      setRecording(true)
      recStopTimerRef.current = setTimeout(stopRecording, 60_000)
    } catch {
      setMsg(t.brew.errors.recordFailed)
    }
  }

  function stopRecording() {
    if (recStopTimerRef.current) clearTimeout(recStopTimerRef.current)
    const mr = recorderRef.current
    if (mr && mr.state !== 'inactive') mr.stop()
    setRecording(false)
  }

  function discardVision() {
    if (visionUrl) URL.revokeObjectURL(visionUrl)
    setVisionFile(null)
    setVisionKind(null)
    setVisionUrl('')
  }

  // ---- Commercial / Protection --------------------------------------------
  function submitComm1() {
    setStep('comm2')
  }

  async function runScan() {
    if (!imageFile) return
    setScanState('scanning')
    setScanAnim(0)
    const result = await runSimilarityScan(imageFile)
    const score = 'score' in result && result.score != null ? Math.round(result.score * 100) : 0
    const status = result.status === 'skipped' ? 'clear' : result.status
    // El medidor sube hasta el puntaje real con la misma curva del prototipo
    // (ease-out ~1.4s) y recién ahí se muestra el veredicto.
    await new Promise<void>((resolve) => {
      const dur = 1400
      const start = performance.now()
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / dur)
        setScanAnim(Math.round((1 - Math.pow(1 - p, 2)) * score))
        if (p < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    setScanScore(score)
    setScanState(status)
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
      audioVideoFile: visionFile,
      audioVideoType: visionKind,
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
      <BrewChrome onBack={backTo('chooser')} backLabel={t.creator.back} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={submitWork1}>{t.brew.next}</BrewButton>}>
        <BrewTitle required>{t.brew.workTitle}</BrewTitle>

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
            <BrewLabel info={t.brew.tipDimensions}>{t.brew.fieldDimensions}</BrewLabel>
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
          <BrewLabel info={t.brew.tipSeries}>{t.brew.fieldSeries}</BrewLabel>
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
        backLabel={t.creator.back}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={submitWork2}>{t.brew.next}</BrewButton>}
      >
        <BrewTitle required>{t.brew.imageTitle}</BrewTitle>
        <p className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.imageSub}</p>

        {imagePreview ? (
          <div
            className="mt-[18px] w-full aspect-[4/3] rounded-[14px] border border-hairline bg-paper-warm bg-cover bg-center"
            style={{ backgroundImage: `url(${imagePreview})` }}
          />
        ) : (
          <div className="mt-[18px] w-full aspect-[4/3] rounded-[14px] border border-dashed border-hairline bg-paper-warm flex flex-col items-center justify-center gap-2 text-center">
            <span className="text-[26px] leading-none text-placeholder">▣</span>
            <span className="text-[12px] text-ink-soft">{t.brew.imageEmptyTitle}</span>
            <span className="text-[11px] text-placeholder">{t.brew.imageEmptyHint}</span>
          </div>
        )}

        <div className="flex gap-2.5 mt-3">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1 flex flex-col items-center justify-center gap-1.5 border border-ink bg-white rounded-xl px-2.5 py-3.5"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="text-[12px] font-medium text-ink">{t.brew.takePhoto}</span>
          </button>
          <label className="flex-1 flex flex-col items-center justify-center gap-1.5 border border-hairline bg-paper-warm rounded-xl px-2.5 py-3.5 cursor-pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-soft" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
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
            {t.brew.assetAnchors} <span className="normal-case tracking-normal font-normal text-placeholder">· {t.brew.assetAnchorsHint}</span>
            <BrewInfo tip={t.brew.tipAssetAnchors} />
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

  if (step === 'work3') {
    return (
      <BrewChrome
        onBack={backTo('work2')}
        backLabel={t.creator.back}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={() => setStep('comm1')}>{t.brew.continue}</BrewButton>}
      >
        <BrewTitle optional={t.brew.visionOptional}>{t.brew.visionTitle}</BrewTitle>
        <p className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.visionSub}</p>

        {visionUrl ? (
          <div className="mt-4 rounded-xl border border-hairline p-3">
            {visionKind === 'video' ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={visionUrl} controls className="w-full rounded-lg bg-black" />
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio src={visionUrl} controls className="w-full" />
            )}
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[10px] text-placeholder">
                {visionKind === 'video' ? t.brew.visionVideoClip : t.brew.visionAudioClip}
              </span>
              <button type="button" onClick={discardVision} className="text-[11px] text-ink-soft hover:text-ink transition-colors">
                ↺ {t.brew.visionReRecord}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-[14px] border border-hairline bg-paper-warm px-5 py-[22px] flex flex-col items-center gap-4">
            {recording ? (
              <>
                <button
                  type="button"
                  onClick={stopRecording}
                  aria-label={t.brew.visionStop}
                  className="w-14 h-14 rounded-full border border-t-red bg-white flex items-center justify-center"
                >
                  <span className="block w-4 h-4 rounded-[3px] bg-t-red" />
                </button>
                <div className="text-[11px] text-ink-soft">{t.brew.visionRecording}</div>
              </>
            ) : (
              <>
                <div className="flex gap-5">
                  <button
                    type="button"
                    onClick={() => startRecording('audio')}
                    aria-label={t.brew.visionTitle}
                    className="w-14 h-14 rounded-full border border-ink bg-white flex items-center justify-center"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="text-ink" aria-hidden="true">
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => startRecording('video')}
                    aria-label={t.brew.visionVideoClip}
                    className="w-14 h-14 rounded-full border border-ink bg-white flex items-center justify-center"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-ink" aria-hidden="true">
                      <rect x="2" y="6" width="13" height="12" rx="2" />
                      <path d="M22 8l-7 4 7 4V8z" />
                    </svg>
                  </button>
                </div>
                <div className="text-[11px] text-ink-soft text-center">{t.brew.visionHint}</div>
              </>
            )}
          </div>
        )}

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
        onBack={backTo('work3')}
        backLabel={t.creator.back}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={submitComm1}>{t.brew.next}</BrewButton>}
      >
        <BrewTitle required>{t.brew.valueTitle}</BrewTitle>
        <div className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.valueSub}<BrewInfo tip={t.brew.tipValue} /></div>

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
          <BrewLabel info={t.brew.tipRoyalty}>{t.brew.royalty}</BrewLabel>
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
        backLabel={t.creator.back}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={<BrewButton onClick={submitComm2} disabled={scanState === 'blocked'}>{scanState === 'blocked' ? t.brew.blocked : t.brew.continue}</BrewButton>}
      >
        <div className="font-display font-medium text-[27px] leading-[1.08] text-ink">{t.brew.protectionTitle}</div>
        <div className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.protectionSub}<BrewInfo tip={t.brew.tipProtection} /></div>

        <div className="mt-5">
          {scanState === 'idle' && (
            /* El prototipo añade aquí una caja "Demo · preview a result" con
               Pass/Soft match/Block: es un atajo del demo para ver los tres
               finales sin backend. Aquí el escaneo es real, así que no va. */
            <div className="border border-hairline rounded-2xl px-6 py-[30px] text-center">
              <div className="text-[30px] leading-none text-placeholder">🛡</div>
              <div className="h-5" />
              <button
                type="button"
                onClick={runScan}
                className="inline-flex items-center justify-center px-[26px] py-3 bg-ink text-paper rounded-xl text-[12px] font-semibold tracking-[0.16em] uppercase enabled:hover:bg-black transition-opacity"
              >
                {t.brew.runScan}
              </button>
            </div>
          )}
          {scanState === 'scanning' && (
            <div className="border border-hairline rounded-2xl px-[18px] py-[22px] text-center">
              <div className="text-[11px] uppercase tracking-[0.14em] text-ink-soft mb-4">{t.brew.scanning}</div>
              <div className="relative h-[74px] flex items-end justify-center gap-[3px]">
                {Array.from({ length: 11 }, (_, i) => (
                  <span key={i} className="cb-bar" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </div>
              {/* Medidor: verde hasta la línea de aprobación, rojo después */}
              <div
                className="relative mt-5 h-2 rounded"
                style={{ background: `linear-gradient(90deg,#eef6ec 0%,#eef6ec ${PASS_LINE}%,#fdf0ec ${PASS_LINE}%,#fdf0ec 100%)` }}
              >
                <div className="absolute -top-[5px] -bottom-[5px] w-0.5 bg-ink rounded-sm" style={{ left: `${PASS_LINE}%` }} />
                <div
                  className="absolute left-0 top-0 bottom-0 rounded bg-t-navy opacity-85"
                  style={{ width: `${scanAnim}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5 text-[9px] text-placeholder">
                <span>0%</span>
                <span>{t.brew.scanPassLine.replace('{n}', String(PASS_LINE))}</span>
                <span>100%</span>
              </div>
              <div className={`font-display text-[26px] mt-3.5 ${scanAnim >= PASS_LINE ? 'text-t-red' : 'text-ink'}`}>
                {scanAnim}%
              </div>
            </div>
          )}
          {scanState === 'clear' && (
            <div className="border border-hairline rounded-2xl px-4 py-6 text-center">
              <div className="w-[52px] h-[52px] mx-auto mb-3.5 rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center text-[24px]">
                ✓
              </div>
              <div className="font-display text-[20px] text-ink">{t.brew.scanCleanTitle}</div>
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
      <BrewChrome onBack={backTo('comm2')} backLabel={t.creator.back} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={() => setStep('ctx2')} disabled={momentLoading}>{t.brew.next}</BrewButton>}>
        <BrewTitle required>{t.brew.momentTitle}</BrewTitle>
        <div className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.momentSub}<BrewInfo tip={t.brew.tipMoment} /></div>

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
      <BrewChrome onBack={backTo('ctx1')} backLabel={t.creator.back} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={() => setStep('ctx3')}>{t.brew.continue}</BrewButton>}>
        <div className="font-display font-medium text-[27px] leading-[1.08] text-ink">{t.brew.contextTitle}</div>
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
      <BrewChrome onBack={backTo('ctx2')} backLabel={t.creator.back} onClose={close} progressPct={STEP_PROGRESS[step]}>
        <div className="font-display font-medium text-[27px] leading-[1.08] text-ink">{t.brew.sealTitle}</div>
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
