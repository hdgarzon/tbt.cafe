import type { SupabaseClient } from '@supabase/supabase-js'
import { sealOnChain } from './seal'
import { publishProvenance } from './provenance-publish'
import { publishProofs } from './proof-publish'
import { moveTokenForOwnership } from '@/lib/token-move'

/**
 * El barrido de recuperacion — Chains 01, 7.3.
 *
 * Termina lo que las rutas dejaron a medias, sin republicar nunca nada cuyo ID
 * de Arweave ya este guardado: cada paso que llama es idempotente por su cuenta
 * (sealOnChain reutiliza el registro y la imagen; publishProvenance y
 * publishProofs no tocan una fila que ya tiene su ID).
 *
 *  a, b  obra certificada sin registro o sin token → sealOnChain;
 *  c     fila del historial sin movimiento del token → moverlo;
 *  d     fila con movimiento y sin registro de procedencia → publicarlo,
 *        en orden de secuencia para que cada eslabon tenga su anterior;
 *  e     ancla confirmada sin registro de prueba → publicarla;
 *  f     lo que lleva 24 horas fallando → un ticket de operador con la obra y
 *        el paso, uno solo.
 *
 * Sin programar: el horario espera la pregunta (s).
 */

const BATCH = 20
export const FAILURE_TICKET_MS = 24 * 3_600_000

type Step = 'seal' | 'move' | 'provenance'

export type RecoverySummary = {
  sealed: number
  moved: number
  provenance: number
  proofs: number
  failures: number
  tickets: number
}

async function cleared(admin: SupabaseClient, workId: string, step: Step, subjectId: string): Promise<void> {
  await admin
    .from('chain_recovery_failures')
    .delete()
    .eq('work_id', workId)
    .eq('step', step)
    .eq('subject_id', subjectId)
}

/** Cuenta el fallo y, pasadas 24 horas, abre el ticket. Devuelve si abrio uno. */
async function failed(
  admin: SupabaseClient,
  f: { workId: string; tbtId: string | null; step: Step; subjectId: string },
  error: unknown
): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error)
  const now = new Date()
  const { data: existing } = await admin
    .from('chain_recovery_failures')
    .select('id, first_failed_at, attempts, ticket_ref')
    .eq('work_id', f.workId)
    .eq('step', f.step)
    .eq('subject_id', f.subjectId)
    .maybeSingle()

  if (!existing) {
    await admin.from('chain_recovery_failures').insert({ work_id: f.workId, step: f.step, subject_id: f.subjectId, last_error: message })
    return false
  }

  await admin
    .from('chain_recovery_failures')
    .update({ attempts: existing.attempts + 1, last_failed_at: now.toISOString(), last_error: message })
    .eq('id', existing.id)

  if (existing.ticket_ref || now.getTime() - new Date(existing.first_failed_at).getTime() < FAILURE_TICKET_MS) return false

  const { data: ticket } = await admin
    .from('tickets')
    .insert({
      origin: 'system',
      category: 'registration',
      severity: 'secondary',
      subject: `Chain recovery: ${f.step} failing for ${f.tbtId ?? f.workId}`,
      body: `The recovery sweep has failed to ${f.step} since ${existing.first_failed_at} (${existing.attempts + 1} attempts). Last error: ${message}`,
      context: { kind: 'chain_recovery', work_id: f.workId, tbt_id: f.tbtId, step: f.step, subject_id: f.subjectId, since: existing.first_failed_at },
    })
    .select('ref')
    .single()
  if (!ticket?.ref) return false
  await admin.from('chain_recovery_failures').update({ ticket_ref: ticket.ref }).eq('id', existing.id).is('ticket_ref', null)
  return true
}

export async function runChainRecovery(admin: SupabaseClient): Promise<RecoverySummary> {
  const summary: RecoverySummary = { sealed: 0, moved: 0, provenance: 0, proofs: 0, failures: 0, tickets: 0 }
  const fail = async (f: Parameters<typeof failed>[1], error: unknown) => {
    summary.failures++
    if (await failed(admin, f, error)) summary.tickets++
  }

  // a, b — sin registro o sin token. Solo obras que pueden llevar registro:
  // las anteriores al hash de contenido no tienen nada que publicar.
  const { data: unsealed } = await admin
    .from('works')
    .select('id, tbt_id')
    .eq('status', 'certified')
    .is('mint_address', null)
    .not('content_hash', 'is', null)
    .order('certified_at', { ascending: true })
    .limit(BATCH)
  for (const w of unsealed ?? []) {
    try {
      await sealOnChain(admin, w.id)
      await cleared(admin, w.id, 'seal', w.id)
      summary.sealed++
    } catch (error) {
      await fail({ workId: w.id, tbtId: w.tbt_id, step: 'seal', subjectId: w.id }, error)
    }
  }

  // c, d — las filas del historial sin registro, de obras ya acuñadas.
  const { data: rows } = await admin
    .from('ownership_history')
    .select('id, work_id, sequence_number, token_move_signature')
    .is('record_uri', null)
    .order('work_id', { ascending: true })
    .order('sequence_number', { ascending: true })
    .limit(BATCH * 5)
  const workIds = Array.from(new Set((rows ?? []).map((r) => r.work_id as string)))
  const { data: works } = workIds.length
    ? await admin.from('works').select('id, tbt_id, mint_address').in('id', workIds).not('mint_address', 'is', null)
    : { data: [] as { id: string; tbt_id: string; mint_address: string }[] }
  const tbtOf = new Map((works ?? []).map((w) => [w.id as string, w.tbt_id as string]))

  // Un eslabon que falla detiene los siguientes de esa obra en esta pasada.
  const blocked = new Set<string>()
  for (const row of rows ?? []) {
    const tbtId = tbtOf.get(row.work_id)
    if (!tbtId || blocked.has(row.work_id)) continue

    if (row.sequence_number > 1 && !row.token_move_signature) {
      const signature = await moveTokenForOwnership(admin, {
        workId: row.work_id,
        tbtId,
        fromSequence: row.sequence_number - 1,
        toSequence: row.sequence_number,
        historyId: row.id,
      })
      if (!signature) {
        blocked.add(row.work_id)
        await fail({ workId: row.work_id, tbtId, step: 'move', subjectId: row.id }, new Error('the token move returned no signature'))
        continue
      }
      await cleared(admin, row.work_id, 'move', row.id)
      summary.moved++
    }

    try {
      const outcome = await publishProvenance(admin, row.id)
      if (outcome.published || outcome.reason === 'already') {
        await cleared(admin, row.work_id, 'provenance', row.id)
        if (outcome.published) summary.provenance++
      } else {
        blocked.add(row.work_id)
        await fail({ workId: row.work_id, tbtId, step: 'provenance', subjectId: row.id }, new Error(`waiting: ${outcome.reason}`))
      }
    } catch (error) {
      blocked.add(row.work_id)
      await fail({ workId: row.work_id, tbtId, step: 'provenance', subjectId: row.id }, error)
    }
  }

  // e — las pruebas confirmadas sin publicar.
  const proofs = await publishProofs(admin)
  summary.proofs = proofs.published

  return summary
}
