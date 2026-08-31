'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { supabase } from '@/lib/supabase'
import { BrewChrome, BrewTitle, BrewInfo, BrewButton, BrewLabel, BrewInput, BrewSelect } from '@/components/brew/BrewChrome'
import { EspressoFlow, type EspressoResult } from '@/components/brew/EspressoFlow'
import { ContextEditor } from '@/components/brew/ContextEditor'
import { fetchCoveredStatus, type CoveredStatus } from '@/lib/covered-data'
import { EmbeddedCheckoutSheet } from '@/components/EmbeddedCheckoutSheet'
import { money, FEE } from '@/lib/fees'
import type { SeriesWithCount } from '@/lib/series-data'
import type { ChainImageChoice } from '@/lib/chain/publish-image'
import {
  fetchDraftForResume,
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
  | 'espresso'
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
  espresso: 25,
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
  const { connected, openAuth, maskedPhone } = useShell()
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
  /*
   * Que copia de la obra llega a Arweave — Chain Spec 01, Item 10.
   *
   * `null` significa «todavia sin tocar», y entonces manda la visibilidad: una
   * obra publica propone la miniatura que pide el spec por legibilidad, y una
   * privada no propone nada. Publicar la miniatura de una obra que su creador
   * marco privada seria deshacer esa decision en un sitio que no se puede
   * borrar. En cuanto la persona elige, su eleccion manda.
   */
  const [chainImage, setChainImage] = useState<ChainImageChoice | null>(null)
  const chainImageChoice: ChainImageChoice = chainImage ?? (isPublished ? 'thumbnail' : 'none')
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
  const [headlines, setHeadlines] = useState('')
  const [markets, setMarkets] = useState('')
  const [aiSummary, setAiSummary] = useState('')
  const [editedSummary, setEditedSummary] = useState('')
  const [momentLoading, setMomentLoading] = useState(false)
  const [adjust, setAdjust] = useState('')
  const [sealHolding, setSealHolding] = useState(0) // 0..1
  const sealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Registration
  const [workId, setWorkId] = useState<string | null>(null)
  const [promoOpen, setPromoOpen] = useState(false)
  const [promoCode, setPromoCode] = useState('')
  const [promoMsg, setPromoMsg] = useState('')
  const [promoDiscount, setPromoDiscount] = useState<{ type: 'percentage' | 'fixed'; value: number } | null>(null)
  /** Fin real de la ventana de pago (epoch ms), guardado con el borrador.
      Un contador local se reiniciaría al volver de Stripe; esto no. */
  const [payDeadline, setPayDeadline] = useState<number | null>(null)
  const [payLeft, setPayLeft] = useState(600)
  const [covered, setCovered] = useState<CoveredStatus | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [mintSteps, setMintSteps] = useState(1)
  const [result, setResult] = useState<{ tbtId: string; title: string; solscanUrl: string } | null>(null)
  /** Ya resolvimos una sesión válida y colocamos el paso inicial. */
  const resolvedRef = useRef(false)
  const resumedRef = useRef(false)
  /**
   * Certificar es caro y NO es idempotente: mintea, envía el certificado,
   * descuenta la asignación cubierta y notifica. Se dispara una sola vez por
   * obra.
   *
   * Hace falta aquí y no en el efecto porque la guarda de aquel se pone después
   * de un `await`: cuando `connected` pasa de false a true el efecto vuelve a
   * correr, y las dos invocaciones pasan el control antes de que ninguna lo
   * marque. Eso mandaba dos certificados y dos avisos por un solo registro.
   */
  const mintingRef = useRef<string | null>(null)

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
        setProfile(await fetchCreatorProfile(user.id))
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

  useEffect(() => {
    if (step !== 'payment' || payDeadline == null) return
    const tick = () => setPayLeft(Math.max(0, Math.round((payDeadline - Date.now()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [step, payDeadline])

  // Asignación cubierta del creador (Spec 01 §1.5). Se consulta al llegar al
  // paso de pago; quien decide de verdad es complete-tbt.
  useEffect(() => {
    if (step !== 'payment' || !userId || covered) return
    fetchCoveredStatus(userId).then(setCovered)
  }, [step, userId, covered])

  // Al volver de Stripe la página se recarga y solo sobrevive el workId de la
  // URL: se relee el borrador para que el vencimiento, la tarjeta de pago y un
  // eventual resellado tengan los datos reales y no una pantalla vacía.
  useEffect(() => {
    if (step !== 'payment' || !workId || resumedRef.current) return
    resumedRef.current = true
    fetchDraftForResume(workId).then((d) => {
      if (!d) return
      if (d.windowEndsAt) setPayDeadline(d.windowEndsAt)
      if (!title) {
        setTitle(d.title)
        // La categoría se guarda como etiqueta traducida, no como clave.
        const key = CATEGORY_KEYS.find((k) => t.brew.categories[k] === d.category)
        if (key) setCategory(key)
        setImagePreview(d.imageUrl)
        setMarketPrice(d.marketPrice)
        setCurrency(d.currency)
        setRoyaltyType(d.royaltyType)
        setRoyaltyValue(d.royaltyValue)
        setLocation(d.location)
      }
    })
  }, [step, workId, title, t.brew.categories])

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
    // (ease-out ~1.4s). requestAnimationFrame NO corre con la pestaña en
    // segundo plano — y alguien que cambia de app mientras espera volvería a
    // un escaneo colgado en 0% para siempre. Por eso el veredicto también sale
    // por temporizador: la animación es cosmética, el resultado no depende de ella.
    const dur = 1400
    await new Promise<void>((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        setScanAnim(score)
        resolve()
      }
      const start = performance.now()
      const tick = (now: number) => {
        if (done) return
        const p = Math.min(1, (now - start) / dur)
        setScanAnim(Math.round((1 - Math.pow(1 - p, 2)) * score))
        if (p < 1) requestAnimationFrame(tick)
        else finish()
      }
      requestAnimationFrame(tick)
      setTimeout(finish, dur + 200)
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
  async function loadMoment(override?: { title?: string; category?: string; material?: string }) {
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
      workTitle: override?.title ?? title,
      workCategory: override?.category ?? t.brew.categories[category],
      workMaterial: override?.material ?? material ?? undefined,
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
      adjust: adjust.trim() || undefined,
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
      chainImage: chainImageChoice,
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
      headlines: headlines.trim() || null,
      markets: markets.trim() || null,
      aiSummary,
      userEditedSummary: editedSummary !== aiSummary ? editedSummary : null,
    })
    setBusy(false)
    if (error || !id) {
      setMsg(t.brew.errors.draftFailed)
      return
    }
    setWorkId(id)
    setPayDeadline(Date.now() + 10 * 60 * 1000)
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
    // El mensaje sale del cupón, no de una constante. Estaba fijo en "50% off"
    // para cualquier descuento parcial, así que un cupón del 20% también
    // anunciaba un 50%.
    if (result.type === 'percentage' && (result.value ?? 0) >= 100) {
      setPromoMsg(t.brew.promoFullCoverage)
    } else if (result.type === 'fixed') {
      setPromoMsg(t.brew.promoAppliedFixed.replace('{value}', money(result.value ?? 0)))
    } else {
      setPromoMsg(t.brew.promoApplied.replace('{value}', `${result.value ?? 0}%`))
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
      `${origin}/brew?workId=${workId}&status=cancel`,
      covered?.isCovered ?? false
    )
    if (result.error) {
      setBusy(false)
      // create-checkout rechaza con 409 si el sello venció (hdgarzon/tbt#6).
      if (result.error === 'payment_window_expired') {
        setPayLeft(0)
        setPayDeadline(Date.now())
        return
      }
      // Un código que Stripe no acepta se dice, en vez de cobrar el importe
      // completo en silencio después de haberlo anunciado.
      if (result.error === 'invalid_coupon') {
        setPromoMsg(t.brew.promoNotAccepted)
        setPromoDiscount(null)
        return
      }
      setMsg(t.brew.errors.checkoutFailed)
      return
    }
    if (result.free) {
      setStep('minting')
      runMintSteps(workId)
      return
    }
    // Embebido: el formulario se monta aquí mismo. Solo se cae al redirect si
    // el backend no devolvió client_secret (despliegue viejo).
    if (result.clientSecret) {
      setClientSecret(result.clientSecret)
      setBusy(false)
      return
    }
    if (result.checkoutUrl) window.location.href = result.checkoutUrl
  }

  function runMintSteps(id: string, sessionId?: string) {
    if (mintingRef.current === id) return
    mintingRef.current = id
    setMintSteps(1)
    const iv = setInterval(() => {
      setMintSteps((s) => (s < 4 ? s + 1 : s))
    }, 700)
    completeTbt(id, undefined, sessionId).then((res) => {
      clearInterval(iv)
      setMintSteps(4)
      setTimeout(() => {
        if ('error' in res) {
          // Falló: se libera para que el creador pueda reintentar.
          mintingRef.current = null
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
          onClick={() => setStep('espresso')}
          className="block w-full text-left border border-hairline rounded-2xl p-4 mt-3 hover:border-ink transition-colors"
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

  if (step === 'espresso') {
    return (
      <EspressoFlow
        onBack={backTo('chooser')}
        onClose={close}
        creatorAlias={profile?.public_alias || profile?.legal_name || ''}
        creatorBio={profile?.bio ?? undefined}
        creatorType={profile?.creator_type ?? 'individual'}
        defaultCategory={t.brew.categories[category]}
        onComplete={(r: EspressoResult) => {
          // Espresso recoge los MISMOS datos; se vuelcan en el estado de Cold
          // Brew y se entrega en el Seal (phase 5 sub 3 del prototipo).
          setImageFile(r.imageFile)
          setImagePreview(URL.createObjectURL(r.imageFile))
          setTitle(r.title)
          setAboutWork(r.aboutWork)
          setCreatedDate(r.createdDate)
          setAssetLinks(r.assetLinks.length ? r.assetLinks : [''])
          setMarketPrice(r.marketPrice)
          setCurrency(r.currency)
          setRoyaltyType(r.royaltyType)
          setRoyaltyValue(r.royaltyValue)
          setScanState(r.scanState)
          setScanScore(r.scanScore)
          if (r.material) setMaterial(r.material)
          // Espresso ya redactó el Contexto en el hilo, así que entrega en el
          // Seal, como en el prototipo (CB.toSeal), sin repetir esas pantallas.
          setLocation(r.location)
          setWeather(r.weather)
          setAiSummary(r.aiSummary)
          setEditedSummary(r.aiSummary)
          setStep('ctx3')
        }}
      />
    )
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
          {/* Las tarjetas de resultado entran con un desvanecido corto — el
              escaneo termina de golpe y una tarjeta que aparece seca se lee
              como un salto. */}
          {scanState === 'clear' && (
            <div className="animate-cb-fade border border-hairline rounded-2xl px-4 py-6 text-center">
              <div className="w-[52px] h-[52px] mx-auto mb-3.5 rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center text-[24px]">
                ✓
              </div>
              <div className="font-display text-[20px] text-ink">{t.brew.scanCleanTitle}</div>
              <p className="text-[12px] text-ink-soft mt-1.5">{t.brew.scanCleanBody.replace('{score}', String(scanScore))}</p>
            </div>
          )}
          {(scanState === 'warning' || scanState === 'blocked') && (
            <div className={`animate-cb-fade border rounded-2xl p-4 ${scanState === 'blocked' ? 'border-t-red/40 bg-t-red/5' : 'border-hairline'}`}>
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
            {/* Titulares y Mercados: el prototipo los marca "live soon" — no hay
                feed conectado. Van vacíos y editables en vez de con el texto de
                ejemplo del demo: esto se sella en un certificado permanente y
                no vamos a inventar noticias en el registro de nadie. */}
            {(
              [
                ['◈', t.brew.headlines, headlines, setHeadlines],
                ['↗', t.brew.markets, markets, setMarkets],
              ] as [string, string, string, (v: string) => void][]
            ).map(([icon, label, value, setValue]) => (
              <div key={label} className="flex items-start gap-2.5 p-3.5 border-t border-hairline">
                <span className="text-[15px] w-5 text-center shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] uppercase tracking-[0.1em] text-ink-soft">{label}</span>
                    <span className="text-[9px] uppercase tracking-[0.14em] text-ink-soft border border-hairline rounded-[20px] px-2 py-[3px]">
                      {t.brew.liveSoon}
                    </span>
                  </div>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => setValue(e.currentTarget.textContent ?? '')}
                    className="font-display text-[15px] leading-[1.5] text-ink outline-none empty:before:content-[attr(data-ph)] empty:before:text-placeholder"
                    data-ph={t.brew.feedPending}
                  >
                    {value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10.5px] text-placeholder mt-2">{t.brew.momentHint}</p>

        {/* "Tell me what to adjust" del prototipo — reescribe el Contexto vía
            generate-context, que ya acepta la instrucción (hdgarzon/tbt#5). */}
        <div className="mt-4">
          <textarea
            value={adjust}
            onChange={(ev) => setAdjust(ev.target.value)}
            placeholder={t.brew.adjustPlaceholder}
            rows={2}
            className="w-full p-3.5 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors resize-none placeholder:text-placeholder"
          />
          {adjust.trim() && (
            <button
              type="button"
              onClick={regenerateContext}
              disabled={momentLoading}
              className="mt-2 px-4 py-2 border border-ink rounded-lg text-[11px] font-semibold tracking-[0.1em] uppercase text-ink disabled:opacity-60"
            >
              {momentLoading ? t.brew.momentLoading : t.brew.adjustApply}
            </button>
          )}
        </div>

        {msg && <p className="text-[12px] text-t-red mt-3.5">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'ctx2') {
    return (
      <BrewChrome onBack={backTo('ctx1')} backLabel={t.creator.back} onClose={close} progressPct={STEP_PROGRESS[step]} dock={<BrewButton onClick={() => setStep('ctx3')}>{t.brew.continue}</BrewButton>}>
        <BrewTitle required>{t.brew.contextTitle}</BrewTitle>
        <p className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.contextSub}</p>

        <div className="flex items-center gap-[7px] mt-4 mb-2">
          <span className="text-t-magenta text-[14px] leading-none">✦</span>
          <span className="text-[9px] tracking-[0.16em] uppercase text-placeholder">{t.brew.contextGenerated}</span>
          <button
            type="button"
            onClick={regenerateContext}
            disabled={momentLoading}
            className="ml-auto flex items-center gap-1 text-[11px] text-ink-soft hover:text-ink transition-colors disabled:opacity-60"
          >
            <span className="text-[13px] leading-none">↻</span>
            {t.brew.regenerate}
          </button>
        </div>
        <ContextEditor
          value={editedSummary}
          onChange={setEditedSummary}
          className="w-full min-h-[250px] border border-hairline rounded-[14px] p-4 font-display text-[15.5px] leading-[1.66] text-ink outline-none focus:border-ink transition-colors bg-[#FCFBFA] overflow-y-auto"
        />
        <div className="flex gap-3 mt-[9px] text-[10px] text-placeholder">
          <span>
            <span className="text-t-navy font-semibold">#</span> {t.brew.tagToConnect}
          </span>
          <span>
            <span className="text-t-navy">🔗</span> {t.brew.pasteLink}
          </span>
        </div>
      </BrewChrome>
    )
  }

  if (step === 'ctx3') {
    // El demo ancla "lugar · fecha"; la fecha es la de hoy, cuando se sella.
    const sealDate = new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    return (
      <BrewChrome onBack={backTo('ctx2')} backLabel={t.creator.back} onClose={close} progressPct={STEP_PROGRESS[step]}>
        <BrewTitle required>{t.brew.sealTitle}</BrewTitle>
        <p className="text-[12px] leading-[1.62] text-ink-soft mt-2">{t.brew.sealSub}</p>

        <div className="border border-hairline rounded-2xl p-3.5 mt-4">
          {[
            [t.brew.sealCreator, profile?.public_alias || profile?.legal_name || ''],
            [t.brew.sealWork, title],
            [
              t.brew.sealValue,
              marketPrice
                ? `${money(parseFloat(marketPrice) || 0)} ${currency}${
                    royaltyType === 'percentage' ? ` · ${royaltyValue}%` : royaltyType === 'fixed' ? ` · ${money(parseFloat(royaltyValue) || 0)}` : ''
                  }`
                : '—',
            ],
            [t.brew.sealAnchored, [location, sealDate].filter(Boolean).join(' · ')],
          ].map(([k, v], i) => (
            <div key={k} className={`flex items-start justify-between gap-3 py-1.5 text-[12.5px] ${i > 0 ? 'border-t border-hairline' : ''}`}>
              <span className="text-ink-soft shrink-0">{k}</span>
              <span className="text-ink text-right">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <BrewLabel info={t.brew.chainImageTip}>{t.brew.chainImageLabel}</BrewLabel>
          <BrewSelect
            value={chainImageChoice}
            onChange={(e) => setChainImage(e.target.value as ChainImageChoice)}
          >
            <option value="none">{t.brew.chainImageNone}</option>
            <option value="thumbnail">{t.brew.chainImageThumbnail}</option>
            <option value="full">{t.brew.chainImageFull}</option>
          </BrewSelect>
          <p className="text-[11.5px] leading-[1.55] text-ink-soft mt-2">
            {chainImageChoice === 'none'
              ? t.brew.chainImageNoteNone
              : chainImageChoice === 'thumbnail'
                ? t.brew.chainImageNoteThumbnail
                : t.brew.chainImageNoteFull}
          </p>
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
              {sealHolding >= 1 ? (
                <span className="text-[24px] leading-none text-t-green">✓</span>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-ink" aria-hidden="true">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              )}
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
                {sealHolding >= 1 ? t.brew.sealed : t.brew.holdToSeal}
              </span>
            </div>
          </button>
          <p className="text-[11px] text-placeholder mt-3.5">{t.brew.pressAndHold}</p>
        </div>

        <div className="flex items-start gap-2 border border-hairline rounded-[10px] bg-paper-warm px-3 py-[11px] mt-5">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-ink-soft mt-px shrink-0" aria-hidden="true">
            <path d="M12 11v5" /><path d="M8 11a4 4 0 0 1 8 0v3" /><path d="M5 12a7 7 0 0 1 14 0v4" />
            <path d="M8.5 19.5c.6-1 .9-2.2.9-3.5" />
          </svg>
          <div className="text-[11.5px] leading-[1.55] text-ink-soft">
            {t.brew.sealBiometricNote}{' '}
            <a href="/settings/authentication" className="text-ink underline">
              {t.brew.sealBiometricLink}
            </a>{' '}
            {t.brew.sealBiometricTail}
          </div>
        </div>

        {msg && <p className="text-[12px] text-t-red mt-4 text-center">{msg}</p>}
      </BrewChrome>
    )
  }

  if (step === 'payment') {
    const price = 8
    return (
      <>
      {clientSecret && (
        <EmbeddedCheckoutSheet
          clientSecret={clientSecret}
          onClose={() => setClientSecret(null)}
          // Un registro no cambia de manos: no hay "para quién".
          recap={{ what: t.recap.registration, amount: `${money(FEE.service)} USD` }}
        />
      )}
      <BrewChrome
        onBack={backTo('ctx3')}
        backLabel={t.creator.back}
        onClose={close}
        progressPct={STEP_PROGRESS[step]}
        dock={
          payLeft <= 0 ? (
            // Vencido: no hay un botón de pago que el backend vaya a aceptar.
            // Volver a sellar recaptura los anclajes y abre una ventana nueva.
            <BrewButton onClick={() => setStep('ctx3')}>{t.brew.sealAgain}</BrewButton>
          ) : (
          <div>
            <BrewButton onClick={pay} disabled={busy}>
              {!(promoDiscount?.type === 'percentage' && promoDiscount.value >= 100) && !covered?.isCovered && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="inline-block mr-1.5 -mt-0.5" aria-hidden="true">
                  <rect x="4" y="10" width="16" height="11" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              )}
              {/* Una cubierta nunca se presenta como $0 (Spec 01 §1.5): la
                  tarifa ya está arriba, tachada y asumida. Un cupón del 100%
                  sí es cero de verdad, y conserva su etiqueta. */}
              {covered?.isCovered
                ? t.brew.registerCovered
                : promoDiscount?.type === 'percentage' && promoDiscount.value >= 100
                  ? t.brew.registerFree
                  : t.brew.payToRegister.replace('{amount}', `$${price}`)}
            </BrewButton>
            {!covered?.isCovered && (
              <p className="text-center text-[10px] text-placeholder mt-2.5">{t.brew.securedByStripe}</p>
            )}
          </div>
          )
        }
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="font-display font-medium text-[25px] leading-[1.08] text-ink">{t.brew.registerTitle}</div>
          <div
            className={`flex items-center gap-1.5 shrink-0 border rounded-[20px] px-[11px] py-[5px] ${
              payLeft <= 60 ? 'border-t-red text-t-red' : 'border-hairline text-ink'
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
            </svg>
            <span className="text-[12px] font-medium tabular-nums">
              {Math.floor(payLeft / 60)}:{String(payLeft % 60).padStart(2, '0')}
            </span>
          </div>
        </div>
        <p className="text-[12px] leading-[1.62] text-ink-soft mt-2">
          {payLeft > 0 ? t.brew.registerSub : t.brew.windowLapsed}
        </p>

        {covered?.isCovered && (
          <div className="mt-3.5 border border-t-green/30 bg-t-green/[0.06] rounded-xl px-3.5 py-2.5 text-[11.5px] leading-[1.55] text-ink">
            {/* `remaining` incluye la de ahora; el texto habla de las que
                quedan DESPUÉS de esta. */}
            {(() => {
              const afterThis = Math.max(0, covered.remaining - 1)
              if (afterThis === 0) return t.brew.coveredNoteLast
              return (afterThis === 1 ? t.brew.coveredNoteOne : t.brew.coveredNote).replace(
                '{n}',
                String(afterThis)
              )
            })()}
          </div>
        )}

        <div className="border border-hairline rounded-2xl mt-4 p-3.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-paper-warm shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-ink">{title}</div>
              <div className="text-[10.5px] text-ink-soft">
                {t.brew.categories[category]} · {t.brew.sealedTag}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-t-green shrink-0" aria-hidden="true">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
          <div className="flex items-center justify-between pt-3 mt-3 border-t border-hairline">
            <div>
              <div className="text-[12.5px] text-ink">{t.brew.registrationFee}</div>
              <div className="text-[10px] text-placeholder mt-0.5">{t.brew.registrationFeeNote}</div>
            </div>
            {/* La tarifa SIEMPRE se muestra (Spec 01 §1.5): decir el valor y
                asumirlo se lee como generosidad; mostrar $0 se lee como que no
                vale nada. */}
            <div className="text-right">
              <div
                className={`font-display text-[18px] ${
                  covered?.isCovered ? 'line-through text-placeholder' : 'text-ink'
                }`}
              >
                ${price.toFixed(2)}
              </div>
              {covered?.isCovered && (
                <div className="text-[10px] font-medium text-t-green mt-0.5">{t.brew.coveredByTbt}</div>
              )}
            </div>
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
      </>
    )
  }

  if (step === 'minting') {
    const steps = [t.brew.stepPaymentConfirmed, t.brew.stepMinting, t.brew.stepCertificate, t.brew.stepSending]
    return (
      <BrewChrome onClose={close} progressPct={STEP_PROGRESS[step]}>
        <div className="text-center pt-4">
          <div className="font-display font-medium text-[22px] text-ink">{t.brew.mintingTitle}</div>
          <p className="text-[13px] text-ink-soft mt-2">{t.brew.mintingSub}</p>
          <div className="w-16 h-16 mx-auto mt-7 border-2 border-hairline border-t-t-navy rounded-full animate-cb-spin" />
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
      /* p7 del prototipo: sin barra de progreso y sin volver — el registro ya
         es definitivo, no hay a dónde regresar. */
      <BrewChrome onClose={close}>
        <div className="text-center pt-0.5">
          <div className="w-[54px] h-[54px] mx-auto rounded-full border-[1.5px] border-t-green text-t-green flex items-center justify-center text-[26px] mb-2.5">
            ✓
          </div>
          <div className="font-display font-medium text-[26px] leading-[1.08] text-ink">{t.brew.registeredTitle}</div>
          <p className="text-[12px] leading-[1.62] text-ink-soft mt-2 px-1.5">{t.brew.registeredBodyFull}</p>
        </div>

        <div className="max-w-[250px] mx-auto mt-3">
          <div className="border border-hairline rounded-[14px] bg-paper-warm px-4 py-[15px] text-center">
            <div className="text-[24px] leading-none">✉</div>
            <div className="text-[12px] font-medium text-ink mt-1.5">
              {t.brew.certSentTo} {maskedPhone ?? ''}
            </div>
            <div className="text-[10px] leading-[1.5] text-placeholder mt-1.5">{t.brew.certKeyInside}</div>
            <a
              href="/settings/notifications"
              className="inline-block mt-2.5 text-[11px] text-ink-soft underline underline-offset-2"
            >
              {t.brew.didntReceive}
            </a>
          </div>
        </div>

        <div className="mt-3">
          <div className="text-[9px] tracking-[0.16em] uppercase text-placeholder text-center mb-2">
            {t.brew.worksLivesHere}
          </div>
          <a
            href={`/work/${result.tbtId}`}
            className="flex items-center justify-center gap-2 border border-ink rounded-xl bg-paper-warm p-3.5"
          >
            <span className="font-display text-[16px] text-ink">tbt.cafe/work/{result.tbtId}</span>
            <span className="text-[14px] text-ink-soft">↗</span>
          </a>

          <div className="flex items-center gap-2.5 pt-2.5 px-0.5 text-[12px] text-ink-soft">
            <span className="text-t-green text-[14px] leading-none">✓</span>
            <span>{t.brew.registeredOn}</span>
            <a
              href={result.solscanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-t-navy underline underline-offset-2"
            >
              <svg width="13" height="11" viewBox="0 0 24 20" fill="none" aria-hidden="true" className="shrink-0">
                <defs>
                  <linearGradient id="solbc" x1="0" y1="0" x2="24" y2="20">
                    <stop offset="0" stopColor="#9945FF" />
                    <stop offset="1" stopColor="#14F195" />
                  </linearGradient>
                </defs>
                <path d="M4 15.5l3-3h13l-3 3H4z" fill="url(#solbc)" />
                <path d="M4 4.5l3 3h13l-3-3H4z" fill="url(#solbc)" />
                <path d="M20 10l-3-3H4l3 3h13z" fill="url(#solbc)" />
              </svg>
              {t.brew.solanaBlockchain}
            </a>
          </div>

          <a
            href={result.solscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 mt-2.5 border border-hairline rounded-[10px] p-[11px] text-ink"
          >
            <span className="text-[12px] tracking-[0.04em]">{t.brew.verifyOnChain}</span>
            <span className="text-[13px] text-ink-soft">↗</span>
          </a>
          <div className="text-center text-[10px] text-placeholder mt-1.5">{t.brew.verifyOnChainNote}</div>
        </div>

        <a href={`/work/${result.tbtId}`} className="block mt-[18px]">
          <BrewButton>{t.brew.viewWork}</BrewButton>
        </a>
      </BrewChrome>
    )
  }

  return null
}
