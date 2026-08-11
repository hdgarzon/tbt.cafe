'use client'

/**
 * Admin tool — Backend Spec 07.
 *
 * English only, deliberately (§4.1): translating an internal tool is real cost
 * with little return. Customer-facing content authored here is a different
 * question and must exist in all four languages (§4.2).
 *
 * INCOMPLETE, and the gap is deliberate rather than forgotten: §1.4 requires
 * biometric + private code on admin access regardless of action value, and
 * there is no private-code verification endpoint yet — only set and clear. The
 * membership check below is a real gate, but it is not the step-up the spec
 * asks for.
 */
import { useCallback, useEffect, useState } from 'react'
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

async function authHeader() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : null
}

export default function AdminPage() {
  const [state, setState] = useState<'loading' | 'denied' | 'ready'>('loading')
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

  const load = useCallback(async () => {
    const auth = await authHeader()
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
    setState('ready')
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  async function act(payload: Record<string, unknown>) {
    const auth = await authHeader()
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

  async function decide(approvalId: string, decision: 'approved' | 'rejected') {
    const auth = await authHeader()
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
    </div>
  )
}
