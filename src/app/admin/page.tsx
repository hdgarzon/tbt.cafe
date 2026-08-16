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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-t border-hairline text-[12.5px] first:border-t-0">
      <span className="text-ink-soft">{k}</span>
      <span className="text-ink text-right">{v}</span>
    </div>
  )
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
  const [section, setSection] = useState<'board' | 'tickets' | 'people' | 'works' | 'money' | 'health' | 'config'>('board')
  const [workQuery, setWorkQuery] = useState('')
  const [workHits, setWorkHits] = useState<Array<Record<string, string>>>([])
  const [work, setWork] = useState<Record<string, any> | null>(null)
  const [notActionable, setNotActionable] = useState<string[]>([])
  const [annotation, setAnnotation] = useState('')
  const [txns, setTxns] = useState<Record<string, any> | null>(null)
  const [obs, setObs] = useState<Record<string, any> | null>(null)
  const [board, setBoard] = useState<{
    registrations: { today: number; last7: number; last30: number }
    transfers30: number
    offersOpen: number
    tickets: { financial: number; secondary: number }
    coveredRegistrations: number
    approvalsPending: number
    failing: Array<{ what: string; count: number; where: string }>
    notBuiltYet: string[]
  } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<Record<string, string | boolean | null>>>([])
  const [person, setPerson] = useState<Record<string, any> | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string | null>>({})
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

    const bRes = await fetch(`${TBT_BACKEND_URL}/api/admin/dashboard`, { headers: auth })
    if (bRes.ok) setBoard(await bRes.json())

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

  async function findWork() {
    const auth = await authHeader(stepUp)
    if (!auth || !workQuery.trim()) return
    setBusy(true)
    setWork(null)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/works?q=${encodeURIComponent(workQuery.trim())}`, { headers: auth })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    setWorkHits(body.works ?? [])
  }

  async function openWork(tbtId: string) {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/works?tbtId=${encodeURIComponent(tbtId)}`, { headers: auth })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    setWork(body.work ?? null)
    setNotActionable(body.notActionable ?? [])
  }

  async function annotate(tbtId: string, kind: 'note' | 'correction' | 'flag') {
    const auth = await authHeader(stepUp)
    if (!auth || !annotation.trim()) return
    setBusy(true)
    await fetch(`${TBT_BACKEND_URL}/api/admin/works`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tbtId, kind, body: annotation.trim() }),
    })
    setBusy(false)
    setAnnotation('')
    openWork(tbtId)
  }

  async function loadObs() {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/observability`, { headers: auth })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    setObs(body)
  }

  async function loadTxns() {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/transactions`, { headers: auth })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    setTxns(body)
  }

  async function search() {
    const auth = await authHeader(stepUp)
    if (!auth || !query.trim()) return
    setBusy(true)
    setPerson(null)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/people?q=${encodeURIComponent(query.trim())}`, {
      headers: auth,
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    setResults(body.people ?? [])
  }

  async function openPerson(id: string) {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    setRevealed({})
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/people?id=${id}`, { headers: auth })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    setPerson(body.person ?? null)
  }

  /**
   * Revelar es una acción, no una lectura: el backend registra quién miró qué y
   * de quién. Por eso hay un botón y no simplemente el dato a la vista.
   */
  async function reveal(personId: string, field: 'phone' | 'email' | 'recovery_email') {
    const auth = await authHeader(stepUp)
    if (!auth) return
    setBusy(true)
    const res = await fetch(`${TBT_BACKEND_URL}/api/admin/people`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personId, field }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) setRevealed((prev) => ({ ...prev, [field]: body.value }))
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
        {(['board', 'tickets', 'people', 'works', 'money', 'health', 'config'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setSection(k)
              if (k === 'money' && !txns) loadTxns()
              if (k === 'health' && !obs) loadObs()
            }}
            className={`pb-2.5 text-[11px] font-medium tracking-[0.16em] uppercase transition-colors border-b-2 -mb-px ${
              section === k ? 'border-ink text-ink' : 'border-transparent text-ink-soft'
            }`}
          >
            {k === 'board'
              ? 'Board'
              : k === 'tickets'
                ? 'Tickets'
                : k === 'people'
                  ? 'People'
                  : k === 'works'
                    ? 'Works'
                    : k === 'money'
                      ? 'Money'
                      : k === 'health'
                        ? 'Health'
                        : 'Configuration'}
          </button>
        ))}
      </div>

      {section === 'board' && board && (
        <section className="mt-5">
          {/* What is broken goes first, not buried under counts. Someone opening
              this in the morning should see overnight damage immediately. */}
          {board.failing.length > 0 ? (
            <div className="border border-t-red/50 bg-t-red/[0.05] rounded-2xl p-4">
              <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-t-red mb-2">
                Needs attention
              </div>
              {board.failing.map((f) => (
                <div key={f.what} className="flex items-center justify-between py-1.5 text-[12.5px]">
                  <span className="text-ink">{f.what}</span>
                  <span className="text-t-red font-medium">{f.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-hairline rounded-2xl p-4">
              <p className="text-[12.5px] text-ink-soft">Nothing is failing right now.</p>
            </div>
          )}

          {board.approvalsPending > 0 && (
            <div className="border border-t-yellow/50 bg-t-yellow/[0.05] rounded-2xl p-4 mt-3 text-[12.5px] text-ink">
              {board.approvalsPending} action{board.approvalsPending === 1 ? '' : 's'} waiting for a
              second person.
            </div>
          )}

          <div className="border border-hairline rounded-2xl p-4 mt-3">
            <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
              Registrations
            </div>
            <Row k="Today" v={String(board.registrations.today)} />
            <Row k="Last 7 days" v={String(board.registrations.last7)} />
            <Row k="Last 30 days" v={String(board.registrations.last30)} />
          </div>

          <div className="border border-hairline rounded-2xl p-4 mt-3">
            <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
              Activity
            </div>
            <Row k="Transfers, last 30 days" v={String(board.transfers30)} />
            <Row k="Open offers" v={String(board.offersOpen)} />
            <Row k="Open requests · money" v={String(board.tickets.financial)} />
            <Row k="Open requests · other" v={String(board.tickets.secondary)} />
            <Row k="Registrations covered by tbt.cafe" v={String(board.coveredRegistrations)} />
          </div>

          <p className="text-[11px] text-placeholder mt-3">
            Not built yet: {board.notBuiltYet.join(', ')}.
          </p>
        </section>
      )}

      {section === 'works' && (
        <section className="mt-5">
          <div className="flex gap-2">
            <input
              value={workQuery}
              onChange={(e) => setWorkQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && findWork()}
              placeholder="TBT-ID or title"
              className="flex-1 px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={findWork}
              disabled={busy}
              className="px-4 rounded-xl bg-ink text-paper text-[11px] font-semibold tracking-[0.14em] uppercase disabled:opacity-50"
            >
              Find
            </button>
          </div>

          {!work && workHits.length > 0 && (
            <div className="flex flex-col gap-2 mt-4">
              {workHits.map((w) => (
                <button
                  key={w.tbt_id}
                  type="button"
                  onClick={() => openWork(w.tbt_id)}
                  className="text-left border border-hairline rounded-xl p-3.5 hover:bg-paper-warm transition-colors"
                >
                  <div className="text-[13px] font-medium text-ink">{w.title}</div>
                  <div className="text-[11px] text-ink-soft mt-0.5">
                    {w.tbt_id} · {w.status} · {w.mint_address ? 'on chain' : 'no chain write'}
                  </div>
                </button>
              ))}
            </div>
          )}

          {work && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setWork(null)}
                className="text-[11px] font-medium tracking-[0.12em] uppercase text-ink-soft"
              >
                ‹ Back
              </button>

              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[15px] font-medium text-ink">{work.title}</div>
                <div className="text-[11px] text-ink-soft mt-0.5">{work.tbtId} · {work.category}</div>
                <div className="mt-2.5">
                  <Row k="Status" v={work.status ?? '—'} />
                  <Row k="Payment" v={work.paymentStatus ?? '—'} />
                  <Row k="Certificate delivery" v={work.mmsDelivery ?? '—'} />
                  <Row k="Certified" v={work.certifiedAt ? new Date(work.certifiedAt).toLocaleDateString() : '—'} />
                </div>
              </div>

              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">Chain</div>
                <Row k="Network" v={work.chain.network ?? '—'} />
                <Row k="Mint" v={work.chain.mintAddress ?? 'not written'} />
                <Row k="NFT status" v={work.chain.nftStatus ?? '—'} />
                {work.chain.explorerUrl && (
                  <a href={work.chain.explorerUrl} target="_blank" rel="noreferrer" className="text-[11px] text-ink-soft underline">
                    Open in explorer
                  </a>
                )}
                <p className="text-[10.5px] text-placeholder mt-2">
                  Arweave and Bitcoin anchors are not written yet.
                </p>
              </div>

              {work.commerce && (
                <div className="border border-hairline rounded-2xl p-4 mt-3">
                  <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">Commerce</div>
                  <Row k="Availability" v={work.commerce.availability ?? '—'} />
                  <Row k="Price" v={work.commerce.price != null ? `${work.commerce.price} ${work.commerce.currency}` : '—'} />
                  <Row
                    k="Royalty"
                    v={
                      work.commerce.royaltyType === 'fixed'
                        ? `${work.commerce.royaltyValue} ${work.commerce.currency} fixed`
                        : work.commerce.royaltyType === 'percentage'
                          ? `${work.commerce.royaltyValue}%`
                          : 'None'
                    }
                  />
                  <Row k="Royalty locked" v={work.commerce.royaltyLocked ? 'Yes — cannot be changed' : 'No'} />
                </div>
              )}

              {work.ownership.length > 0 && (
                <div className="border border-hairline rounded-2xl p-4 mt-3">
                  <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">Ownership</div>
                  {work.ownership.map((o: any, i: number) => (
                    <div key={i} className="text-[11.5px] text-ink-soft py-1">
                      {o.sequence_number}. {o.event_type} · {o.owner_name ?? '—'}
                      {o.price ? ` · ${o.price} ${o.currency ?? ''}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {/* §6 — the tool must not imply these are possible. */}
              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
                  Annotations
                </div>
                {work.annotations.map((a: any) => (
                  <div key={a.id} className="border-t border-hairline py-2 first:border-t-0">
                    <div className="text-[10.5px] tracking-[0.12em] uppercase text-ink-soft">
                      {a.kind} · {a.actor_name} · {new Date(a.created_at).toLocaleDateString()}
                    </div>
                    <p className="text-[12px] leading-[1.55] text-ink mt-0.5">{a.body}</p>
                  </div>
                ))}
                <textarea
                  value={annotation}
                  onChange={(e) => setAnnotation(e.target.value)}
                  placeholder="Add a note, a flag, or a corrective record"
                  className="w-full mt-3 px-3.5 py-3 border border-hairline rounded-xl text-[14px] min-h-16 resize-none outline-none focus:border-ink"
                />
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(['note', 'flag', 'correction'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={busy || !annotation.trim()}
                      onClick={() => annotate(work.tbtId, k)}
                      className="px-3.5 py-2 rounded-lg border border-hairline text-ink-soft text-[11px] font-medium tracking-[0.12em] uppercase disabled:opacity-50 capitalize"
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <p className="text-[10.5px] text-placeholder mt-2">
                  Annotations are append-only. A correction supersedes; it never erases.
                </p>
              </div>

              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-1.5">
                  Not possible, by design
                </div>
                {notActionable.map((n) => (
                  <div key={n} className="text-[11.5px] text-placeholder py-0.5">· {n}</div>
                ))}
                <p className="text-[10.5px] text-placeholder mt-2 leading-[1.5]">
                  A certificate the issuer can quietly revise is not a certificate.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {section === 'health' && obs && (
        <section className="mt-5">
          <div className="text-[11px] text-placeholder mb-3">Last {obs.windowHours} hours.</div>

          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
            Grouped failures
          </div>
          {(obs.failures ?? []).length === 0 ? (
            <p className="text-[12px] text-placeholder">No provider failures recorded.</p>
          ) : (
            (obs.failures ?? []).map((f: any, i: number) => (
              <div key={i} className="border border-hairline rounded-xl p-3.5 mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-ink">
                    {f.provider} · {f.operation}
                  </span>
                  <span className="text-[12px] text-t-red font-medium">{f.occurrences}</span>
                </div>
                <div className="text-[11px] text-ink-soft mt-1 break-all">{f.error_code}</div>
                <div className="text-[10.5px] text-placeholder mt-1">
                  first {new Date(f.first_seen).toLocaleString()} · last{' '}
                  {new Date(f.last_seen).toLocaleString()}
                </div>
              </div>
            ))
          )}

          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mt-6 mb-2">
            Providers
          </div>
          {(obs.providers ?? []).length === 0 ? (
            <p className="text-[12px] text-placeholder">Nothing recorded in this window.</p>
          ) : (
            <div className="border border-hairline rounded-2xl p-4">
              {(obs.providers ?? []).map((p: any) => (
                <Row
                  key={p.provider}
                  k={p.provider}
                  v={`${p.calls} calls · ${p.failureRate}% failed${p.avgLatencyMs != null ? ` · ${p.avgLatencyMs}ms avg` : ''}`}
                />
              ))}
            </div>
          )}

          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mt-6 mb-2">
            Chain writes
          </div>
          <div className="border border-hairline rounded-2xl p-4">
            <Row k="Certified without a mint" v={String(obs.chain.certifiedWithoutMint)} />
            <Row k="Certificate deliveries failed" v={String(obs.chain.certificateDeliveriesFailed)} />
          </div>

          {/* An empty panel and an uninstrumented one look identical. */}
          <p className="text-[11px] text-placeholder mt-3">
            Not instrumented yet: {(obs.notInstrumentedYet ?? []).join(', ')}.
          </p>
        </section>
      )}

      {section === 'money' && txns && (
        <section className="mt-5">
          <div className="border border-hairline rounded-2xl p-4">
            <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
              Current model
            </div>
            <Row k="Service fee" v={`$${txns.model.serviceFee} — charged on both sides`} />
            <Row k="Platform per sale" v={`$${txns.model.platformPerSale}`} />
            <Row k="Processing" v={txns.model.processing} />
            <Row k="Processing borne by" v={txns.model.processingBorneBy} />
          </div>

          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mt-6 mb-2">
            Transfers
          </div>
          {(txns.transfers ?? []).length === 0 ? (
            <p className="text-[12px] text-placeholder">None.</p>
          ) : (
            (txns.transfers ?? []).map((t: any) => (
              <div key={t.id} className="border border-hairline rounded-xl p-3.5 mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-medium text-ink">{t.title ?? t.tbtId ?? '—'}</span>
                  <span className="text-[10.5px] text-placeholder">{t.status} · {t.paymentStatus ?? '—'}</span>
                </div>
                <div className="mt-1.5">
                  <Row k="Recorded value" v={String(t.money.value)} />
                  <Row k="Royalty" v={String(t.money.royalty)} />
                  <Row k="Service fee" v={String(t.money.serviceFee)} />
                  <Row k="Processing" v={String(t.money.processing)} />
                  <Row k="Sender pays" v={String(t.money.senderPays)} />
                </div>
                {t.stripe.session && (
                  <div className="text-[10px] text-placeholder mt-1.5 break-all">{t.stripe.session}</div>
                )}
              </div>
            ))
          )}

          <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mt-6 mb-2">
            Registrations
          </div>
          {(txns.registrations ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between py-1.5 text-[12px] border-b border-hairline">
              <span className="text-ink-soft">{new Date(r.created_at).toLocaleDateString()} · {r.status}</span>
              <span className="text-ink">{r.amount} {String(r.currency).toUpperCase()}</span>
            </div>
          ))}

          <p className="text-[11px] text-placeholder mt-3">
            Not built yet: {(txns.notBuiltYet ?? []).join(', ')}.
          </p>
        </section>
      )}

      {section === 'people' && (
        <section className="mt-5">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Name, alias, phone, email or TBT-ID"
              className="flex-1 px-3.5 py-3 border border-hairline rounded-xl text-[14px] outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={search}
              disabled={busy}
              className="px-4 rounded-xl bg-ink text-paper text-[11px] font-semibold tracking-[0.14em] uppercase disabled:opacity-50"
            >
              Find
            </button>
          </div>

          {!person && results.length > 0 && (
            <div className="flex flex-col gap-2 mt-4">
              {results.map((r) => (
                <button
                  key={String(r.id)}
                  type="button"
                  onClick={() => openPerson(String(r.id))}
                  className="text-left border border-hairline rounded-xl p-3.5 hover:bg-paper-warm transition-colors"
                >
                  <div className="text-[13px] font-medium text-ink">{String(r.alias ?? '—')}</div>
                  <div className="text-[11px] text-ink-soft mt-0.5">
                    {String(r.emailMasked ?? '—')} · {String(r.phoneMasked ?? '—')}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!person && results.length === 0 && query && !busy && (
            <p className="text-[12px] text-placeholder mt-4">Nobody matched that.</p>
          )}

          {person && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setPerson(null)}
                className="text-[11px] font-medium tracking-[0.12em] uppercase text-ink-soft"
              >
                ‹ Back to results
              </button>

              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[15px] font-medium text-ink">
                  {person.identity.alias ?? person.identity.displayName ?? '—'}
                </div>
                <div className="text-[11px] text-ink-soft mt-0.5">
                  {person.identity.isCreator ? 'Creator' : 'Collector'}
                  {person.identity.category ? ` · ${person.identity.category}` : ''}
                  {person.identity.language ? ` · ${person.identity.language}` : ''}
                </div>

                {/* Masked by default. Revealing is an action that gets logged. */}
                {(['phone', 'email'] as const).map((f) => (
                  <div key={f} className="flex items-center justify-between py-2 mt-1 border-t border-hairline text-[12.5px]">
                    <span className="text-ink-soft capitalize">{f}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-ink">
                        {revealed[f] ?? (f === 'phone' ? person.identity.phoneMasked : person.identity.emailMasked) ?? '—'}
                      </span>
                      {!revealed[f] && (f === 'phone' ? person.identity.hasPhone : person.identity.hasEmail) && (
                        <button
                          type="button"
                          onClick={() => reveal(person.id, f)}
                          disabled={busy}
                          className="text-[10px] tracking-[0.12em] uppercase text-ink-soft underline disabled:opacity-50"
                        >
                          Reveal
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-placeholder mt-1">
                  Revealing writes your name into the audit log.
                </p>
              </div>

              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
                  Authentication
                </div>
                <Row k="Private code" v={person.authentication.privateCodeSet ? `Set · ${person.authentication.privateCodeFrequency ?? '—'}` : 'Not set'} />
                <Row k="Recovery email" v={person.authentication.recoveryEmailVerified ? 'Verified' : person.authentication.recoveryEmailMasked ? 'Unverified' : 'None'} />
                <Row k="Biometric devices" v={String(person.authentication.devices.length)} />
                {person.authentication.devices.map((d: any, i: number) => (
                  <div key={i} className="text-[11px] text-ink-soft pl-1 py-1">
                    {d.label ?? 'Device'} · {d.mode ?? '—'} · last used{' '}
                    {d.lastUsedAt ? new Date(d.lastUsedAt).toLocaleDateString() : 'never'}
                  </div>
                ))}
              </div>

              <div className="border border-hairline rounded-2xl p-4 mt-3">
                <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">Works</div>
                <Row k="Created" v={String(person.works.created)} />
                <Row k="Still held" v={String(person.works.stillHeld)} />
                <Row k="Transferred away" v={String(person.works.transferredAway)} />
                <Row k="Free registrations granted" v={String(person.coveredRegistrationsGranted)} />
                {person.works.recent.map((w: any) => (
                  <div key={w.tbt_id} className="text-[11px] text-ink-soft py-1">
                    {w.tbt_id} · {w.title} · {w.status}
                  </div>
                ))}
              </div>

              {person.tickets.length > 0 && (
                <div className="border border-hairline rounded-2xl p-4 mt-3">
                  <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-ink-soft mb-2">
                    Requests
                  </div>
                  {person.tickets.map((t: any) => (
                    <div key={t.ref} className="flex items-center justify-between py-1.5 text-[12px]">
                      <span className="text-ink-soft">
                        {t.severity === 'financial' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-t-red mr-1.5" />}
                        {t.ref} · {t.subject}
                      </span>
                      <span className="text-placeholder">{t.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Saying these do not exist yet beats rendering empty panels that
                  read as "no activity". */}
              <p className="text-[11px] text-placeholder mt-3">
                Not built yet: {person.notBuiltYet.join(', ')}.
              </p>
            </div>
          )}
        </section>
      )}

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
