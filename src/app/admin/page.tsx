'use client'

/**
 * Admin tool — Backend Spec 07.
 *
 * English only, deliberately (§4.1): translating an internal tool is real cost
 * with little return. Customer-facing content authored here is a different
 * question and must exist in all four languages (§4.2).
 *
 * §1.4 — admin access requires biometric AND private code, whatever the action
 * is worth, and the session is short. Both factors are presented here before
 * anything loads; the resulting token is sent with every admin call and the
 * backend refuses without it.
 *
 * The private code is 3-5 characters and the app itself calls it a convenience
 * layer rather than a real second factor, so failed attempts are counted and
 * locked server-side. Without that, four digits are ten thousand guesses in
 * front of the most privileged surface in the product.
 */
import { useCallback, useEffect, useState } from 'react'
import { startAuthentication } from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'
import { TBT_BACKEND_URL } from '@/lib/backend'

type Reply = {
  id: string
  author_type: 'customer' | 'team' | 'system' | 'ai'
  author_name: string
  body: string
  internal: boolean
  created_at: string
}

type Ticket = {
  id: string
  ref: string
  origin: string
  category: string
  severity: 'financial' | 'secondary'
  status: string
  subject: string
  body: string
  context: Record<string, unknown> | null
  assigned_to: string | null
  created_at: string
  updated_at: string
  replies: Reply[]
}

type Approval = {
  id: string
  action: string
  entity_type: string | null
  entity_id: string | null
  reason: string
  initiator_id: string
  expires_at: string
}

async function authHeader(stepUp: string | null) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null
  const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` }
  if (stepUp) headers['x-admin-step-up'] = stepUp
  return headers
}

export default function AdminPage() {
  const [state, setState] = useState<'stepup' | 'loading' | 'denied' | 'ready'>('stepup')
  const [stepUp, setStepUp] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [stepMsg, setStepMsg] = useState('')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [canApprove, setCanApprove] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [section, setSection] = useState<'tickets' | 'config'>('tickets')
  const [config, setConfig] = useState<{
    config: { covered_brews_enabled: boolean; covered_brews_count: number } | null
    covered: { count: number; borneInRecent: number }
    canChangeRules: boolean
  } | null>(null)
  const [ruleReason, setRuleReason] = useState('')
  const [countDraft, setCountDraft] = useState('')

  const load = useCallback(async () => {
    if (!stepUp) return
    const auth = await authHeader(stepUp)
    if (!auth) return setState('denied')

    const [tRes, aRes] = await Promise.all([
      fetch(`${TBT_BACKEND_URL}/api/admin/tickets?status=${filter}`, { headers: auth }),
      fetch(`${TBT_BACKEND_URL}/api/admin/approvals`, { headers: auth }),
    ])
    if (tRes.status === 403 || tRes.status === 401) return setState('denied')

    const tBody = await tRes.json()
    setTickets(tBody.tickets ?? [])

    if (aRes.ok) {
      const aBody = await aRes.json()
      setApprovals(aBody.approvals ?? [])
      setCanApprove(aBody.canApprove === true)
      setMe(aBody.me ?? null)
    }
    const cRes = await fetch(`${TBT_BACKEND_URL}/api/admin/config`, { headers: auth })
    if (cRes.ok) setConfig(await cRes.json())

    setState('ready')
  }, [filter, stepUp])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Los dos factores antes de que cargue nada. Si el biométrico no se completa
   * no se pide el código: un step-up a medias no vale, y el backend lo
   * rechazaría de todos modos.
   */
  async function doStepUp() {
    setBusy(true)
    setStepMsg('')
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setState('denied')
        return
      }
      const bearer = { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }

      const begin = await fetch('/api/webauthn/auth/begin', { method: 'POST', headers: bearer })
      const beginBody = await begin.json()
      if (!begin.ok) {
        setStepMsg('Enrol a biometric on this device first.')
        return
      }
      const credential = await startAuthentication({ optionsJSON: beginBody.options })
      const finish = await fetch('/api/webauthn/auth/finish', {
        method: 'POST',
        headers: bearer,
        body: JSON.stringify({ credential }),
      })
      if (!finish.ok) {
        setStepMsg('Biometric check failed.')
        return
      }

      const res = await fetch('/api/admin/step-up', {
        method: 'POST',
        headers: bearer,
        body: JSON.stringify({ code: code.trim(), biometric: true }),
      })
      const body = await res.json()
      if (!res.ok) {
        // El bloqueo se dice con su hora: callarlo solo haría que insistieran.
        if (body.error === 'locked') {
          setStepMsg(`Too many attempts. Locked until ${new Date(body.lockedUntil).toLocaleTimeString()}.`)
        } else if (body.error === 'invalid_code') {
          setStepMsg('That code is not right.')
        } else {
          setStepMsg('Could not verify.')
        }
        return
      }
      setCode('')
      setStepUp(body.token)
      setState('loading')
    } catch {
      setStepMsg('Could not verify.')
    } finally {
      setBusy(false)
    }
  }

  async function act(payload: Record<string, unknown>) {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    setNote('')
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/tickets`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setNote(body.message ?? body.error ?? 'Failed')
      return
    }
    setDraft('')
    load()
  }

  async function changeRule(action: 'covered_count' | 'covered_kill_switch', value: number | boolean) {
    const auth = await authHeader(stepUp)
    if (!auth) return
    if (!ruleReason.trim()) {
      setNote('A reason is required. Write what you are doing and why.')
      return
    }
    setBusy(true)
    setNote('')
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/config`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, value, reason: ruleReason.trim() }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    // 202 means it is waiting for a second person, which is the rule working,
    // not a failure.
    setNote(body.message ?? body.error ?? 'Done')
    setRuleReason('')
    load()
  }

  async function decide(approvalId: string, decision: 'approved' | 'rejected') {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/approvals`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, decision }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) setNote(body.error ?? 'Failed')
    load()
  }

  if (state === 'stepup') {
    return (
      <div className="px-4 pt-6">
        <h1 className="font-display font-medium text-[27px] leading-[1.08] text-ink">Admin</h1>
        <div className="border border-hairline rounded-2xl p-4 mt-5">
          <p className="text-[12px] leading-[1.6] text-ink-soft">
            Admin access needs your biometric and your private code, every time. The session lasts
            15 minutes.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            type="password"
            inputMode="numeric"
            placeholder="Private code"
            className="w-full mt-3.5 px-3.5 py-3 border border-hairline rounded-xl text-[16px] outline-none focus:border-ink transition-colors"
          />
          <button
            type="button"
            onClick={doStepUp}
            disabled={busy || !code.trim()}
            className="w-full mt-3 py-4 text-[12px] font-semibold tracking-[0.16em] uppercase bg-ink text-paper rounded-xl disabled:opacity-50"
          >
            Verify
          </button>
          {stepMsg && <p className="text-[11.5px] text-t-red mt-2.5">{stepMsg}</p>}
        </div>
      </div>
    )
  }
  if (state === 'loading') return <div className="px-4 pt-6 text-[13px] text-ink-soft">Loading…</div>
  if (state === 'denied') {
    return (
      <div className="px-4 pt-6">
        <p className="text-[13px] text-ink-soft mt-6">This area is for the tbt.cafe team.</p>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-10">
      <h1 className="font-display font-medium text-[27px] leading-[1.08] text-ink">Admin</h1>

      {/* §1.3 — two people, and the approver is never the initiator. */}
      {approvals.length > 0 && (
        <section className="mt-5">
          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
            Awaiting a second person
          </div>
          <div className="flex flex-col gap-2">
            {approvals.map((a) => {
              const mine = a.initiator_id === me
              return (
                <div key={a.id} className="border border-t-yellow/50 bg-t-yellow/[0.05] rounded-xl p-3.5">
                  <div className="text-[12.5px] font-medium text-ink">{a.action}</div>
                  <p className="text-[11.5px] leading-[1.55] text-ink-soft mt-1">{a.reason}</p>
                  <div className="text-[10.5px] text-placeholder mt-1.5">
                    expires {new Date(a.expires_at).toLocaleString()}
                  </div>
                  {mine ? (
                    <p className="text-[11px] text-ink-soft mt-2.5">
                      You started this one, so someone else has to approve it.
                    </p>
                  ) : canApprove ? (
                    <div className="flex gap-2 mt-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide(a.id, 'approved')}
                        className="px-3.5 py-2 rounded-lg bg-ink text-paper text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide(a.id, 'rejected')}
                        className="px-3.5 py-2 rounded-lg border border-hairline text-ink-soft text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="flex gap-5 mt-5 mb-1 border-b border-hairline">
        {(['tickets', 'config'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSection(k)}
            className={`pb-2.5 text-[11px] font-medium tracking-[0.16em] uppercase transition-colors border-b-2 -mb-px ${
              section === k ? 'border-ink text-ink' : 'border-transparent text-ink-soft'
            }`}
          >
            {k === 'tickets' ? 'Tickets' : 'Configuration'}
          </button>
        ))}
      </div>

      {section === 'config' && (
        <section className="mt-5">
          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
            Covered registrations
          </div>
          <div className="border border-hairline rounded-2xl p-4">
            <p className="text-[11.5px] leading-[1.6] text-ink-soft">
              Exposure is uncapped: per creator and not time-boxed. Five thousand creators using ten
              each is $400,000 absorbed. The kill switch is the control.
            </p>
            <div className="flex items-center justify-between mt-3.5 py-2 border-t border-hairline text-[12.5px]">
              <span className="text-ink-soft">Programme</span>
              <span className="text-ink">
                {config?.config?.covered_brews_enabled ? 'Running' : 'Stopped'}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-hairline text-[12.5px]">
              <span className="text-ink-soft">Free registrations per creator</span>
              <span className="text-ink">{config?.config?.covered_brews_count ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-t border-hairline text-[12.5px]">
              <span className="text-ink-soft">Covered so far</span>
              <span className="text-ink">{config?.covered.count ?? 0}</span>
            </div>

            {config?.canChangeRules && (
              <div className="mt-4 pt-3.5 border-t border-hairline">
                <textarea
                  value={ruleReason}
                  onChange={(e) => setRuleReason(e.target.value)}
                  placeholder="Why are you changing this? Required, and it goes in the audit log."
                  className="w-full px-3.5 py-3 border border-hairline rounded-xl text-[14px] min-h-16 resize-none outline-none focus:border-ink"
                />
                <div className="flex gap-2 mt-2.5 flex-wrap items-center">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      changeRule('covered_kill_switch', !config?.config?.covered_brews_enabled)
                    }
                    className="px-3.5 py-2 rounded-lg border border-t-red text-t-red text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                  >
                    {config?.config?.covered_brews_enabled ? 'Stop new allowances' : 'Resume'}
                  </button>
                  <input
                    value={countDraft}
                    onChange={(e) => setCountDraft(e.target.value)}
                    inputMode="numeric"
                    placeholder="Count"
                    className="w-20 px-3 py-2 border border-hairline rounded-lg text-[13px] outline-none focus:border-ink"
                  />
                  <button
                    type="button"
                    disabled={busy || !countDraft.trim()}
                    onClick={() => changeRule('covered_count', Number(countDraft))}
                    className="px-3.5 py-2 rounded-lg border border-hairline text-ink-soft text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                  >
                    Set count
                  </button>
                </div>
                <p className="text-[10.5px] text-placeholder mt-2">
                  Both need a second person to approve before they take effect.
                </p>
              </div>
            )}
          </div>
          {note && <p className="text-[11.5px] text-ink-soft mt-3">{note}</p>}
        </section>
      )}

      {section === 'tickets' && (
      <>
      <div className="flex gap-1.5 mt-6 mb-3 flex-wrap">
        {['open', 'answered', 'resolved', 'closed'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full border text-[11px] capitalize transition-colors ${
              filter === s ? 'border-ink bg-paper-warm text-ink' : 'border-hairline text-ink-soft'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {note && <p className="text-[11.5px] text-t-red mb-3">{note}</p>}

      {tickets.length === 0 ? (
        <p className="text-[12px] text-placeholder">Nothing here.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {tickets.map((tk) => (
            <div key={tk.id} className="border border-hairline rounded-2xl p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {/* Financial first, and visibly so. */}
                  {tk.severity === 'financial' && <span className="w-1.5 h-1.5 rounded-full bg-t-red" />}
                  <span className="text-[10.5px] tracking-[0.12em] uppercase text-ink-soft">
                    {tk.category} · {tk.origin}
                  </span>
                </div>
                <span className="text-[10px] text-placeholder">{tk.ref}</span>
              </div>

              <button
                type="button"
                onClick={() => setOpenId(openId === tk.id ? null : tk.id)}
                className="text-left w-full"
              >
                <div className="text-[13.5px] font-medium text-ink mt-1.5">{tk.subject}</div>
              </button>

              {openId === tk.id && (
                <div className="mt-2.5">
                  <p className="text-[12px] leading-[1.6] text-ink-soft whitespace-pre-wrap">{tk.body}</p>

                  {/* Full context: provider payloads, AI transcript, linked entity. */}
                  {tk.context && Object.keys(tk.context).length > 0 && (
                    <pre className="mt-2.5 p-2.5 bg-paper-warm border border-hairline rounded-lg text-[10.5px] text-ink-soft overflow-x-auto">
                      {JSON.stringify(tk.context, null, 2)}
                    </pre>
                  )}

                  {tk.replies.map((r) => (
                    <div
                      key={r.id}
                      className={`mt-2 rounded-lg px-3 py-2.5 border ${
                        r.internal
                          ? 'border-t-yellow/60 bg-t-yellow/[0.07]'
                          : 'border-hairline bg-paper-warm'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10.5px] text-ink-soft">
                        <span className="font-medium">
                          {r.author_name}
                          {/* Internal notes must be unmistakable so nothing is
                              posted publicly by accident. */}
                          {r.internal && <span className="ml-1.5 text-t-yellow">INTERNAL</span>}
                        </span>
                        <span>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-[12px] leading-[1.6] text-ink mt-1 whitespace-pre-wrap">{r.body}</p>
                    </div>
                  ))}

                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={internal ? 'Internal note — the customer never sees this' : 'Reply to the customer'}
                    className={`w-full mt-3 px-3.5 py-3 border rounded-xl text-[14px] min-h-20 resize-none outline-none transition-colors ${
                      internal ? 'border-t-yellow bg-t-yellow/[0.05]' : 'border-hairline focus:border-ink'
                    }`}
                  />

                  <label className="flex items-center gap-2 mt-2 text-[11.5px] text-ink-soft">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                    />
                    Internal note
                  </label>

                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <button
                      type="button"
                      disabled={busy || !draft.trim()}
                      onClick={() => act({ action: 'reply', ticketId: tk.id, text: draft, internal })}
                      className="px-3.5 py-2 rounded-lg bg-ink text-paper text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                    >
                      {internal ? 'Add note' : 'Send reply'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act({ action: 'assign', ticketId: tk.id, assignTo: me })}
                      className="px-3.5 py-2 rounded-lg border border-hairline text-ink-soft text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                    >
                      Assign to me
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act({ action: 'status', ticketId: tk.id, status: 'closed' })}
                      className="px-3.5 py-2 rounded-lg border border-hairline text-ink-soft text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50"
                    >
                      Close
                    </button>
                  </div>

                  {/* Resolved means the customer confirmed it. The team can
                      close, but cannot declare someone else's problem solved. */}
                  <p className="text-[10.5px] text-placeholder mt-2">
                    Only the customer marks a request resolved.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  )
}
