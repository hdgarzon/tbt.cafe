'use client'

/**
 * Panel de soporte — Backend Spec 03, y Spec 04 §5.1.
 *
 * Las tres pestañas del prototipo: Notificaciones · Asistente · Solicitud de
 * ayuda. Vive aquí y no en la página porque tiene DOS superficies: la ruta
 * /help y el sheet que abre el icono de notificaciones del header, que es de
 * donde cuelga en el prototipo. Duplicarlo habría dejado dos copias que se
 * separan a la primera corrección.
 *
 * `compact` quita el título y el relleno cuando lo monta el sheet, que ya trae
 * los suyos.
 *
 *
 * Dos partes: abrir una solicitud y ver las propias, incluidas las que abrió el
 * sistema. Que el cliente vea los tickets de sistema es una decisión de
 * transparencia: enseña que la plataforma detecta los fallos en vez de esperar
 * a que se los cuenten.
 *
 * Navegar está abierto; enviar exige autenticación. Sin sesión se invita a
 * autenticarse en vez de mostrar un formulario vacío que no va a funcionar.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'
import { useShell } from '@/components/AppShell'
import { AssistantChat } from '@/components/AssistantChat'
import { NotificationFeed } from '@/components/NotificationFeed'
import {
  TICKET_CATEGORIES,
  fetchMyTickets,
  openTicket,
  replyToTicket,
  type Ticket,
  type TicketCategory,
} from '@/lib/tickets-data'

export function SupportPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale()
  const { connected, openAuth } = useShell()

  const [userId, setUserId] = useState<string | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [category, setCategory] = useState<TicketCategory>('payments')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  // El asistente es triaje del sistema de solicitudes, así que viven juntos.
  const [tab, setTab] = useState<'alerts' | 'ask' | 'requests'>('alerts')
  const [replyBody, setReplyBody] = useState('')

  const load = useCallback(async (uid: string) => setTickets(await fetchMyTickets(uid)), [])

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        /*
         * Sin sesión se abre en «preguntar» — Gating Spec 01, ítem 2.
         *
         * Alertas y solicitudes son personales y no tienen nada que enseñarle a
         * una visita. El asistente sí, y es la razón de que este panel exista
         * para quien todavía no se ha unido.
         */
        setTab('ask')
        return
      }
      setUserId(user.id)
      load(user.id)
    })()
  }, [connected, load])

  async function submit() {
    if (!userId) return openAuth()
    if (!subject.trim() || !body.trim()) {
      setMsg(t.help.needBoth)
      return
    }
    setBusy(true)
    // La superficie de origen sale gratis y vale: quien reporta desde la
    // pantalla de cobros ya dijo algo sobre su problema sin escribirlo.
    const { error } = await openTicket(userId, category, subject.trim(), body.trim(), '/help')
    setBusy(false)
    if (error) return setMsg(t.work.errors.offerFailed)
    setSubject('')
    setBody('')
    setMsg(t.help.submitted)
    load(userId)
  }

  async function sendReply(ticketId: string) {
    if (!userId || !replyBody.trim()) return
    setBusy(true)
    await replyToTicket(ticketId, t.help.you, replyBody.trim())
    setBusy(false)
    setReplyBody('')
    setReplyTo(null)
    load(userId)
  }

  /*
   * La puerta es de la PESTAÑA, no del panel.
   *
   * Tapaba las tres: sin sesión, el panel entero era esta tarjeta y las
   * pestañas no llegaban a verse. Las solicitudes sí necesitan una cuenta —hay
   * que poder contestarle a alguien— y ahí sigue, con su botón.
   */
  const requestsGate = (
    <div className="px-4 pt-6">
      <div className="border border-hairline rounded-2xl px-5 py-10 text-center mt-6">
        <div className="text-[15px] font-medium text-ink">{t.help.gateTitle}</div>
        <p className="text-[12px] leading-[1.6] text-ink-soft mt-2">{t.help.gateSub}</p>
        <button
          type="button"
          onClick={() => openAuth()}
          className="mt-5 px-6 py-3.5 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl"
        >
          {t.help.authenticate}
        </button>
      </div>
    </div>
  )

  return (
    <div className={compact ? '' : 'px-4 pt-6 pb-10'}>
      {!compact && (
        <h1 className="font-display font-medium text-[27px] leading-[1.08] text-ink">{t.help.title}</h1>
      )}

      {/* Las pestañas se reparten el ancho y solo cada una lleva su subrayado:
          el prototipo no pone hairline bajo la fila entera. */}
      <div className="flex gap-1 mt-4 mb-1">
        {(['alerts', 'ask', 'requests'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 pt-2.5 pb-3 text-[12px] font-medium tracking-[0.04em] transition-colors border-b-2 ${
              tab === k ? 'border-ink text-ink' : 'border-transparent text-ink-soft'
            }`}
          >
            {k === 'alerts' ? t.feed.tab : k === 'ask' ? t.assistant.tab : t.assistant.tabRequests}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <div className="mt-5">
          <NotificationFeed />
        </div>
      )}

      {tab === 'ask' && (
        <div className="mt-5">
          <AssistantChat />
        </div>
      )}

      {tab === 'requests' && !userId && requestsGate}

      {tab === 'requests' && userId && (
      <>
      <div className="pt-1 pb-2 mt-4">
        <div className="text-[12px] font-semibold tracking-[0.04em] text-ink">{t.help.openRequest}</div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {TICKET_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`px-[12px] py-[6px] rounded-[16px] border text-[10.5px] tracking-[0.02em] transition-colors ${
                category === c ? 'border-ink bg-paper-warm text-ink' : 'border-hairline text-ink-soft'
              }`}
            >
              {t.help.categories[c]}
            </button>
          ))}
        </div>

        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={t.help.subject}
          className="w-full mt-3 px-3.5 py-3 border border-hairline rounded-xl text-[16px] outline-none focus:border-ink transition-colors"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t.help.describe}
          className="w-full mt-2.5 px-3.5 py-3 border border-hairline rounded-xl text-[16px] min-h-24 resize-none outline-none focus:border-ink transition-colors"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="w-full mt-3 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl disabled:opacity-50"
        >
          {t.help.submit}
        </button>
        {msg && <p className="text-[11.5px] text-ink-soft mt-2.5 text-center">{msg}</p>}
      </div>

      <div className="text-[10px] tracking-[0.14em] uppercase text-placeholder mt-5 mb-2.5">
        {t.help.yourRequests}
      </div>

      {tickets.length === 0 ? (
        <p className="text-[12px] leading-[1.6] text-placeholder">{t.help.empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((tk) => (
            <div key={tk.id} className="border border-hairline rounded-xl p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] tracking-[0.12em] uppercase text-ink-soft">
                  {t.help.categories[tk.category]}
                </span>
                <div className="flex items-center gap-1.5">
                  {/* Lo financiero se distingue: dinero y entrega del certificado
                      no son fallos silenciosos. */}
                  {tk.severity === 'financial' && <span className="w-1.5 h-1.5 rounded-full bg-t-red" />}
                  <span
                    /* Rellena y sin borde, como el prototipo: el estado se lee de un
                       vistazo por el fondo, no por el contorno. */
                    className={`text-[9.5px] font-semibold tracking-[0.1em] uppercase px-[9px] py-[3px] rounded-[20px] ${
                      tk.status === 'answered'
                        ? 'bg-[rgba(62,163,44,0.12)] text-t-green'
                        : tk.status === 'open'
                          ? 'bg-paper-warm text-ink-soft'
                          : 'bg-paper-warm text-placeholder'
                    }`}
                  >
                    {t.help.status[tk.status]}
                  </span>
                </div>
              </div>

              <div className="text-[13.5px] font-medium text-ink mt-2">{tk.subject}</div>
              <p className="text-[12px] leading-[1.6] text-ink-soft mt-1.5 whitespace-pre-wrap">{tk.body}</p>

              <div className="flex items-center justify-between text-[10.5px] text-placeholder mt-2.5">
                <span>{tk.ref}</span>
                <span>
                  {tk.origin === 'system' && `${t.help.systemBadge} · `}
                  {new Date(tk.createdAt).toLocaleDateString()}
                </span>
              </div>

              {tk.replies.length > 0 && (
                <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-hairline">
                  {tk.replies.map((r) => (
                    <div
                      key={r.id}
                      className={`rounded-xl px-3 py-2.5 ${
                        r.authorType === 'customer' ? 'bg-paper-warm' : 'bg-paper-warm border border-hairline'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10.5px] text-ink-soft">
                        <span className="font-medium">{r.authorName}</span>
                        <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[12px] leading-[1.6] text-ink mt-1 whitespace-pre-wrap">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Nada se cierra por encima del cliente: mientras el ticket siga
                  vivo puede responder, y su respuesta lo devuelve a abierto. */}
              {tk.status !== 'closed' &&
                (replyTo === tk.id ? (
                  <div className="mt-3">
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      placeholder={t.help.replyPlaceholder}
                      className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[16px] min-h-20 resize-none outline-none focus:border-ink transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => sendReply(tk.id)}
                      disabled={busy}
                      className="w-full mt-2 py-3 text-[11.5px] font-semibold tracking-[0.16em] uppercase border border-ink text-ink rounded-xl disabled:opacity-50"
                    >
                      {t.help.sendReply}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReplyTo(tk.id)}
                    className="mt-3 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-soft hover:text-ink transition-colors"
                  >
                    {t.help.replyPlaceholder}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}
