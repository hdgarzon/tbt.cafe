import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * POST /api/claims — reclamar una obra que ya está registrada.
 *
 * Work Order 01 Step 20, corregido por Update Package 01 §2: el reclamo es un
 * ticket de soporte HR-#### en la categoría `claim`, no un correo a
 * claims@tbt.cafe (el dominio no tiene MX) ni una referencia CLM-####. Una
 * persona lo lee; el titular actual no recibe aviso automático.
 *
 * El ticket lleva el resultado del escaneo y la obra con la que coincidió, y
 * los dos se leen aquí, del escaneo guardado de quien reclama: lo que diga el
 * navegador no entra al ticket.
 */
export const dynamic = 'force-dynamic'

const MAX_BODY = 4000

type Match = { work_id?: string; score?: number }

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const input = (await request.json().catch(() => ({}))) as { scanId?: unknown; body?: unknown }
  const scanId = typeof input.scanId === 'string' ? input.scanId : ''
  const text = typeof input.body === 'string' ? input.body.trim() : ''
  if (!scanId) return NextResponse.json({ error: 'scan_required' }, { status: 400 })
  if (!text || text.length > MAX_BODY) return NextResponse.json({ error: 'body_required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: scan } = await admin
    .from('plagiarism_scans')
    .select('id, scan_result, similarity_score, scanned_at')
    .eq('id', scanId)
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (!scan) return NextResponse.json({ error: 'scan_not_found' }, { status: 404 })

  const result = (scan.scan_result ?? {}) as { status?: string; matches?: Match[] }
  const scanStatus = result.status
  if (scanStatus !== 'blocked') return NextResponse.json({ error: 'not_blocked' }, { status: 409 })
  const top = (result.matches ?? [])[0]
  if (!top?.work_id) return NextResponse.json({ error: 'no_match' }, { status: 409 })

  const { data: matched } = await admin.from('works').select('id, tbt_id, title').eq('id', top.work_id).maybeSingle()
  if (!matched) return NextResponse.json({ error: 'no_match' }, { status: 409 })

  // Un reclamo por escaneo: pulsar dos veces no abre dos tickets.
  const { data: existing } = await admin
    .from('tickets')
    .select('ref')
    .eq('subject_user', auth.user.id)
    .eq('category', 'claim')
    .contains('context', { scan_id: scan.id })
    .maybeSingle()
  if (existing) return NextResponse.json({ ref: existing.ref })

  const { data: ticket, error } = await admin
    .from('tickets')
    .insert({
      origin: 'human',
      category: 'claim',
      severity: 'secondary',
      subject: `${matched.title ?? 'Work'} — ${matched.tbt_id ?? ''}`.trim(),
      body: text,
      subject_user: auth.user.id,
      context: {
        kind: 'claim',
        scan_id: scan.id,
        score: scan.similarity_score,
        scanned_at: scan.scanned_at,
        matched_work_id: matched.id,
        matched_tbt_id: matched.tbt_id,
      },
    })
    .select('ref')
    .single()
  if (error || !ticket) return NextResponse.json({ error: 'claim_failed' }, { status: 500 })

  return NextResponse.json({ ref: ticket.ref })
}
