'use client'

/**
 * Asistente — Backend Spec 04.
 *
 * Explica y guía; no actúa. Donde actuaría, enruta: dice qué hacer y enlaza al
 * lugar del producto donde se hace. Cada acción que mueve dinero tiene su propia
 * confirmación deliberada —biométrico, código privado, el anillo de sellado— y
 * un "sí" conversacional no sustituye a ninguna.
 *
 * Abre en modo proactivo: si la persona tiene solicitudes abiertas, levanta la
 * más grave en vez de esperar a que pregunte. Es la razón por la que el
 * asistente lee los tickets, e invierte la dinámica habitual de soporte.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { TBT_BACKEND_URL } from '@/lib/backend'

type Turn = { role: 'user' | 'assistant'; text: string }
type Cta = { label: string; href: string }

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

/**
 * Voz por Web Speech API. El spec prefiere un servicio alojado por consistencia
 * en español latinoamericano y portugués de Brasil, y deja la elección de
 * proveedor como punto abierto; esto es lo que funciona sin backend mientras se
 * decide.
 */
function getRecognition(lang: string): Recognition | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined
  if (!Ctor) return null
  const r = new Ctor()
  r.lang = lang
  r.interimResults = false
  r.continuous = false
  return r
}

const SPEECH_LANG: Record<string, string> = { en: 'en-US', es: 'es-CO', pt: 'pt-BR', fr: 'fr-FR' }

export function AssistantChat() {
  const { t, locale } = useLocale()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [cta, setCta] = useState<Cta | null>(null)
  const [escalated, setEscalated] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const openedRef = useRef(false)
  const recRef = useRef<Recognition | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  const send = useCallback(
    async (question: string, viaVoice: boolean) => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return

      setBusy(true)
      setCta(null)
      const history = turns.slice(-8)
      setTurns((prev) => [...prev, { role: 'user', text: question }])

      try {
        const res = await fetch(`${TBT_BACKEND_URL}/api/assistant`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          // No se manda ningún identificador de usuario: la identidad sale del
          // token en el servidor. Si el cliente pudiera elegirla, podría pedir
          // los datos de otra persona.
          body: JSON.stringify({ question, locale, viaVoice, history }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'failed')

        setTurns((prev) => [...prev, { role: 'assistant', text: body.text }])
        setCta(body.cta ?? null)
        if (body.escalatedTo) setEscalated(body.escalatedTo)
      } catch {
        setTurns((prev) => [...prev, { role: 'assistant', text: t.assistant.failed }])
      } finally {
        setBusy(false)
      }
    },
    [turns, locale, t.assistant.failed]
  )

  // Apertura proactiva: si hay solicitudes abiertas se levanta la más grave.
  // La plataforma se da cuenta por la persona, no al revés.
  useEffect(() => {
    ;(async () => {
      if (openedRef.current) return
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setSignedIn(!!session)
      if (!session) return
      openedRef.current = true

      try {
        const res = await fetch(`${TBT_BACKEND_URL}/api/assistant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ question: t.assistant.openingProbe, locale, viaVoice: false, history: [] }),
        })
        const body = await res.json()
        const top = (body.openTickets ?? [])[0] as { ref: string; subject: string } | undefined
        setTurns([
          {
            role: 'assistant',
            text: top
              ? t.assistant.proactive.replace('{subject}', top.subject).replace('{ref}', top.ref)
              : t.assistant.greeting,
          },
        ])
      } catch {
        setTurns([{ role: 'assistant', text: t.assistant.greeting }])
      }
    })()
  }, [locale, t.assistant])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  function submit() {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    send(q, false)
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop()
      return
    }
    const rec = getRecognition(SPEECH_LANG[locale] ?? 'en-US')
    if (!rec) return
    recRef.current = rec
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript?.trim()
      // Una pregunta hablada recibe una respuesta más corta: el servidor lo sabe
      // por `viaVoice`, no se descubre después de lanzar.
      if (said) send(said, true)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }

  if (signedIn === false) {
    return <p className="text-[12px] leading-[1.6] text-ink-soft">{t.assistant.needSignIn}</p>
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5">
        {turns.map((turn, i) => (
          <div
            key={i}
            className={`rounded-2xl px-3.5 py-2.5 max-w-[85%] ${
              turn.role === 'user'
                ? 'self-end bg-ink text-paper'
                : 'self-start bg-paper-warm border border-hairline text-ink'
            }`}
          >
            <p className="text-[12.5px] leading-[1.6] whitespace-pre-wrap">{turn.text}</p>
          </div>
        ))}

        {busy && (
          <div className="self-start rounded-2xl px-3.5 py-2.5 bg-paper-warm border border-hairline">
            <span className="text-[12.5px] text-placeholder">…</span>
          </div>
        )}

        {cta && (
          <a
            href={cta.href}
            className="self-start mt-0.5 px-4 py-2.5 rounded-xl border border-ink text-ink text-[11.5px] font-medium tracking-[0.12em] uppercase"
          >
            {cta.label}
          </a>
        )}

        {/* No saber es un desenlace legítimo y termina en una persona. */}
        {escalated && (
          <p className="self-start text-[11px] text-ink-soft mt-1">
            {t.assistant.escalated.replace('{ref}', escalated)}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 mt-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t.assistant.placeholder}
          rows={1}
          className="flex-1 px-3.5 py-3 border border-hairline rounded-xl text-[16px] resize-none outline-none focus:border-ink transition-colors"
        />
        <button
          type="button"
          onClick={toggleVoice}
          aria-label={t.assistant.speak}
          className={`w-11 h-11 shrink-0 rounded-xl border flex items-center justify-center transition-colors ${
            listening ? 'border-t-magenta text-t-magenta' : 'border-hairline text-ink-soft'
          }`}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
          </svg>
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 h-11 shrink-0 rounded-xl bg-ink text-paper text-[11.5px] font-semibold tracking-[0.14em] uppercase disabled:opacity-50"
        >
          {t.assistant.send}
        </button>
      </div>

      <p className="text-[10.5px] leading-[1.5] text-placeholder mt-2.5">{t.assistant.boundary}</p>
    </div>
  )
}
