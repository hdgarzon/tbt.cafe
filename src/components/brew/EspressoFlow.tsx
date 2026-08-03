'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { BrewChrome, BrewButton } from '@/components/brew/BrewChrome'
import { ContextEditor } from '@/components/brew/ContextEditor'
import { runSimilarityScan, describeImage, extractFields, generateContext } from '@/lib/brew-data'

/**
 * Espresso — la vía rápida del chooser (tbt-espresso.html).
 *
 * Una entrevista corta, por voz o escrita, que recoge LOS MISMOS datos que
 * Cold Brew y entrega en el Seal. La imagen va primero a propósito: se lee
 * con /api/tbt-image/describe para dejar de preguntar lo que ya se puede ver.
 *
 * Las respuestas libres se estructuran en /api/espresso/extract (Gemini). Si
 * la extracción falla, los campos quedan VACÍOS y el creador los escribe: la
 * pantalla de revisión —no la transcripción— es la fuente de verdad, y esto
 * termina en un certificado permanente.
 */

export type EspressoResult = {
  imageFile: File
  title: string
  aboutWork: string
  createdDate: string
  assetLinks: string[]
  category: string | null
  material: string | null
  marketPrice: string
  currency: string
  royaltyType: 'none' | 'percentage' | 'fixed'
  royaltyValue: string
  scanState: 'clear' | 'warning' | 'blocked'
  scanScore: number
  location: string
  weather: string
  aiSummary: string
}

type Stage = 'image' | 'confirmImage' | 'scan' | 'work' | 'value' | 'context' | 'review'
type Turn = { from: 'bot' | 'me'; text: string }

/** El reconocimiento de voz no está tipado en lib.dom; sólo lo que usamos. */
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

function getRecognition(lang: string): Recognition | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => Recognition)
    | undefined
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = lang
  r.interimResults = false
  r.continuous = false
  return r
}

export function EspressoFlow({
  onBack,
  onClose,
  onComplete,
  creatorAlias,
  creatorBio,
  creatorType,
  defaultCategory,
}: {
  onBack: () => void
  onClose: () => void
  onComplete: (r: EspressoResult) => void
  /** generate-context exige alias, título y categoría: sin ellos responde 400. */
  creatorAlias: string
  creatorBio?: string
  creatorType: 'individual' | 'group' | 'corporation'
  defaultCategory: string
}) {
  const { t, locale } = useLocale()
  const e = t.espresso

  const [stage, setStage] = useState<Stage>('image')
  const [turns, setTurns] = useState<Turn[]>([{ from: 'bot', text: e.askImage }])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [note, setNote] = useState('')

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [material, setMaterial] = useState<string | null>(null)
  const [scanState, setScanState] = useState<EspressoResult['scanState']>('clear')
  const [scanScore, setScanScore] = useState(0)

  const [work, setWork] = useState({ title: '', aboutWork: '', createdDate: '', assetLinks: [] as string[] })
  const [location, setLocation] = useState('')
  const [weather, setWeather] = useState('')
  const [contextText, setContextText] = useState('')
  const [value, setValue] = useState({
    marketPrice: '',
    currency: 'USD',
    royaltyType: 'none' as EspressoResult['royaltyType'],
    royaltyValue: '',
  })

  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<Recognition | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, stage])

  useEffect(() => {
    return () => {
      recRef.current?.stop()
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl])

  const say = (text: string) => setTurns((v) => [...v, { from: 'bot', text }])
  const me = (text: string) => setTurns((v) => [...v, { from: 'me', text }])

  function pickImage(f: File | undefined) {
    if (!f) return
    setImageFile(f)
    setImageUrl(URL.createObjectURL(f))
    setStage('confirmImage')
    say(e.confirmImage)
  }

  async function acceptImage() {
    if (!imageFile) return
    setStage('scan')
    setBusy(true)
    // La imagen es el insumo más rico: lo que se lee de ella no se pregunta.
    const desc = await describeImage(imageFile)
    if (desc?.tags?.length) setCategory(desc.tags[0])
    if (desc?.caption) setMaterial(null)
    setBusy(false)
    say(e.askScan)
  }

  async function doScan() {
    if (!imageFile) return
    setBusy(true)
    const r = await runSimilarityScan(imageFile)
    const score = 'score' in r && r.score != null ? Math.round(r.score * 100) : 0
    const st = r.status === 'skipped' ? 'clear' : r.status
    setScanScore(score)
    setScanState(st)
    setBusy(false)
    if (st === 'blocked') {
      say(t.brew.scanBlockBody.replace('{score}', String(score)))
      return
    }
    say(st === 'warning' ? t.brew.scanWarnBody.replace('{score}', String(score)) : t.brew.scanCleanTitle)
    setStage('work')
    say(e.askWork)
  }

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    me(text)
    setDraft('')
    setBusy(true)
    setNote('')

    if (stage === 'work') {
      const f = await extractFields('work', text)
      if (f) setWork({ title: f.title, aboutWork: f.aboutWork, createdDate: f.creationDate, assetLinks: f.assetLinks })
      // Sin extracción no se adivina: la revisión queda en blanco para escribir.
      else setNote(e.noExtract)
      setBusy(false)
      setStage('value')
      say(e.askValue)
      return
    }

    if (stage === 'value') {
      const f = await extractFields('value', text)
      if (f) {
        setValue({
          marketPrice: f.marketPrice != null ? String(f.marketPrice) : '',
          currency: f.currency || 'USD',
          royaltyType: f.royaltyType,
          royaltyValue: f.royaltyValue != null ? String(f.royaltyValue) : '',
        })
      } else setNote(e.noExtract)
      setBusy(false)
      setStage('context')
      say(e.writingContext)
      void draftContext(f?.marketPrice != null ? String(f.marketPrice) : '')
      return
    }
    setBusy(false)
  }

  /** El demo redacta el Contexto dentro del hilo y sólo entonces pasa al Seal. */
  async function draftContext(_price: string) {
    setBusy(true)
    let lat: number | undefined
    let lng: number | undefined
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch {
      /* sin ubicación el backend igual redacta, sólo que sin lugar ni clima */
    }
    const r = await generateContext({
      creatorAlias,
      creatorBio,
      creatorType,
      workTitle: work.title,
      workCategory: category || defaultCategory,
      workMaterial: material ?? undefined,
      lat,
      lng,
    })
    setBusy(false)
    if ('error' in r) {
      setNote(t.brew.errors.contextFailed)
      setStage('review')
      return
    }
    setLocation(r.location)
    setWeather(r.weather)
    setContextText(r.summary)
    setStage('review')
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const r = getRecognition(locale === 'en' ? 'en-US' : locale === 'pt' ? 'pt-BR' : locale === 'fr' ? 'fr-FR' : 'es-CO')
    if (!r) return setNote(e.voiceUnsupported)
    recRef.current = r
    r.onresult = (ev) => {
      const said = ev.results?.[0]?.[0]?.transcript ?? ''
      if (said) setDraft((d) => (d ? `${d} ${said}` : said))
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    setListening(true)
    r.start()
  }

  const asking = stage === 'work' || stage === 'value'

  return (
    <BrewChrome onBack={onBack} backLabel={t.creator.back} onClose={onClose} progressPct={stage === 'review' ? 60 : 25}>
      <div ref={logRef} className="flex flex-col gap-2.5 max-h-[46vh] overflow-y-auto pr-0.5">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={
              turn.from === 'bot'
                ? 'self-start max-w-[85%] font-display text-[16px] leading-[1.5] text-ink'
                : 'self-end max-w-[85%] rounded-2xl bg-paper-warm border border-hairline px-3.5 py-2.5 text-[13px] text-ink'
            }
          >
            {turn.text}
          </div>
        ))}
        {busy && <div className="self-start text-[12px] text-placeholder">…</div>}
      </div>

      {stage === 'image' && (
        <div className="mt-5">
          <p className="text-[11px] text-placeholder mb-2.5">{e.askImageHint}</p>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => camRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1.5 border border-ink bg-white rounded-xl px-2.5 py-3.5 text-[12px] font-medium text-ink"
            >
              {t.brew.takePhoto}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-1.5 border border-hairline bg-paper-warm rounded-xl px-2.5 py-3.5 text-[12px] text-ink-soft"
            >
              {t.brew.chooseFile}
            </button>
          </div>
        </div>
      )}

      {/* Montados siempre: en la confirmación "elegir otra" necesita este input,
          y si vive dentro del paso anterior el ref queda vacío. */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(ev) => pickImage(ev.target.files?.[0])} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(ev) => pickImage(ev.target.files?.[0])} />

      {stage === 'confirmImage' && imageUrl && (
        <div className="mt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="w-full aspect-[4/3] object-cover rounded-[14px] border border-hairline" />
          <div className="flex gap-2.5 mt-3">
            <BrewButton onClick={acceptImage}>{e.yes}</BrewButton>
            <BrewButton ghost onClick={() => fileRef.current?.click()}>
              {e.retake}
            </BrewButton>
          </div>
        </div>
      )}

      {stage === 'scan' && (
        <div className="mt-5">
          <BrewButton onClick={doScan} disabled={busy}>
            {busy ? e.scanning : e.runScan}
          </BrewButton>
        </div>
      )}

      {asking && (
        <div className="mt-5">
          <p className="text-[11px] text-placeholder mb-2">{stage === 'work' ? e.askWorkHint : e.askValueHint}</p>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              placeholder={listening ? e.listening : e.typeHere}
              rows={3}
              className="flex-1 border border-hairline rounded-xl p-3.5 text-[15px] outline-none focus:border-ink transition-colors resize-none placeholder:text-placeholder"
            />
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={e.micHint}
              className={`w-11 h-11 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
                listening ? 'border-t-red text-t-red' : 'border-hairline text-ink-soft'
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2.5 mt-3">
            <BrewButton onClick={send} disabled={busy || !draft.trim()}>
              {e.send}
            </BrewButton>
            {stage === 'value' && (
              <BrewButton
                ghost
                onClick={() => {
                  me(e.skip)
                  setStage('review')
                }}
              >
                {e.skip}
              </BrewButton>
            )}
          </div>
        </div>
      )}

      {stage === 'review' && (
        <div className="mt-5">
          <div className="font-display font-medium text-[20px] text-ink">{e.reviewTitle}</div>
          <p className="text-[12px] text-ink-soft mt-1">{e.reviewSub}</p>
          {note && <p className="text-[11.5px] text-t-red mt-2">{note}</p>}

          <div className="border border-hairline rounded-2xl p-3.5 mt-3.5 flex flex-col gap-3">
            <Field label={t.brew.fieldTitle} value={work.title} onChange={(v) => setWork({ ...work, title: v })} />
            <Field label={t.brew.aboutWork} value={work.aboutWork} onChange={(v) => setWork({ ...work, aboutWork: v })} />
            <Field
              label={t.brew.marketPrice}
              value={value.marketPrice}
              onChange={(v) => setValue({ ...value, marketPrice: v })}
            />
            <Field
              label={t.brew.royalty}
              value={value.royaltyType === 'none' ? '' : value.royaltyValue}
              onChange={(v) => setValue({ ...value, royaltyValue: v, royaltyType: v ? 'percentage' : 'none' })}
            />
          </div>

          {contextText && (
            <div className="mt-3.5">
              <div className="text-[9px] tracking-[0.16em] uppercase text-placeholder mb-2">{t.brew.contextTitle}</div>
              <ContextEditor
                value={contextText}
                onChange={setContextText}
                className="w-full min-h-[160px] border border-hairline rounded-[14px] p-3.5 font-display text-[15px] leading-[1.6] text-ink outline-none focus:border-ink transition-colors bg-[#FCFBFA] overflow-y-auto"
              />
            </div>
          )}

          <div className="mt-4">
            <BrewButton
              onClick={() =>
                imageFile &&
                onComplete({
                  imageFile,
                  title: work.title,
                  aboutWork: work.aboutWork,
                  createdDate: work.createdDate,
                  assetLinks: work.assetLinks,
                  category,
                  material,
                  marketPrice: value.marketPrice,
                  currency: value.currency,
                  royaltyType: value.royaltyType,
                  royaltyValue: value.royaltyValue,
                  scanState,
                  scanScore,
                  location,
                  weather,
                  aiSummary: contextText,
                })
              }
              disabled={!work.title.trim() || scanState === 'blocked'}
            >
              {e.sealIt}
            </BrewButton>
          </div>
        </div>
      )}

      {note && stage !== 'review' && <p className="text-[11.5px] text-ink-soft mt-3">{note}</p>}
    </BrewChrome>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[10px] font-medium tracking-[0.18em] uppercase text-ink-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink transition-colors"
      />
    </label>
  )
}
