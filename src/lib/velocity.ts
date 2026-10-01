import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { getRules } from '@/lib/rules'
import { notify } from '@/lib/notify'

/**
 * Velocidad — Work Order 02, Stage 10.4 (M16).
 *
 * Tres comprobaciones sobre money_action_auth, antes de cobrar o autorizar:
 *  - cuenta: mas de `velocity_count_per_hour` acciones en la ultima hora;
 *  - valor: mas de `velocity_outbound_24h` en 24 horas contando esta;
 *  - pareja nueva: dos personas sin historia entre ellas en los ultimos
 *    `velocity_new_pair_days`, por `velocity_new_pair_threshold` o mas.
 *
 * Las dos primeras DESAFIAN (se exige el biometrico aunque el monto no lo
 * pidiera, y avisa `suspicious`); nunca rechazan. La tercera RETIENE: una fila
 * de revision y un ticket; la persona sabe que se esta revisando. Un operador
 * la libera —vale 48 horas— o la rechaza con motivo.
 */

export type VelocityAction = 'purchase' | 'offer_accept' | 'transfer_initiate'
export type VelocityVerdict = { verdict: 'ok' } | { verdict: 'challenge'; reason: 'count' | 'value' } | { verdict: 'hold'; holdId: string }

const RELEASE_WINDOW_MS = 48 * 3_600_000

export async function velocityCheck(
  admin: SupabaseClient,
  p: { userId: string; action: VelocityAction; amount: number; workId: string | null; counterpartyId: string | null }
): Promise<VelocityVerdict> {
  const { velocity } = await getRules()
  const now = Date.now()

  // Una retencion ya liberada para esta accion y esta obra deja pasar, una vez.
  const { data: released } = await admin
    .from('velocity_holds')
    .select('id')
    .eq('user_id', p.userId)
    .eq('action', p.action)
    .eq('status', 'released')
    .gt('release_expires_at', new Date(now).toISOString())
    .match(p.workId ? { work_id: p.workId } : {})
    .limit(1)
    .maybeSingle()
  if (released) {
    await admin.from('velocity_holds').update({ status: 'used' }).eq('id', released.id).eq('status', 'released')
    return { verdict: 'ok' }
  }

  // Pareja nueva: retiene.
  if (p.counterpartyId && p.amount >= velocity.newPairThreshold) {
    const since = new Date(now - velocity.newPairDays * 86_400_000).toISOString()
    const { count } = await admin
      .from('transfers')
      .select('id', { count: 'exact', head: true })
      .or(
        `and(from_owner_id.eq.${p.userId},to_owner_id.eq.${p.counterpartyId}),and(from_owner_id.eq.${p.counterpartyId},to_owner_id.eq.${p.userId})`
      )
      .eq('payment_status', 'completed')
      .lt('completed_at', since)
    if (!count) {
      const { data: ticket } = await admin
        .from('tickets')
        .insert({
          origin: 'system',
          category: 'payments',
          severity: 'secondary',
          subject: 'Velocity review: new pair',
          body: `A ${p.action} of ${p.amount} between a new pair is held for review.`,
          subject_user: p.userId,
          context: { kind: 'velocity_hold', action: p.action, amount: p.amount, work_id: p.workId, counterparty_id: p.counterpartyId },
        })
        .select('ref')
        .single()
      const { data: hold } = await admin
        .from('velocity_holds')
        .insert({
          user_id: p.userId,
          action: p.action,
          amount: p.amount,
          work_id: p.workId,
          counterparty_id: p.counterpartyId,
          ticket_ref: ticket?.ref ?? null,
        })
        .select('id')
        .single()
      await notify(admin, { userId: p.userId, eventKey: 'suspicious', dedupeKey: `velocity_hold:${hold?.id ?? randomUUID()}`, href: '/help' })
      return { verdict: 'hold', holdId: hold?.id ?? '' }
    }
  }

  // Cuenta y valor: desafian.
  const hourAgo = new Date(now - 3_600_000).toISOString()
  const dayAgo = new Date(now - 86_400_000).toISOString()
  const [{ count: lastHour }, { data: lastDay }] = await Promise.all([
    admin.from('money_action_auth').select('id', { count: 'exact', head: true }).eq('user_id', p.userId).gte('created_at', hourAgo),
    admin.from('money_action_auth').select('amount').eq('user_id', p.userId).gte('created_at', dayAgo),
  ])
  const outbound = ((lastDay ?? []) as { amount: number | null }[]).reduce((sum, r) => sum + Number(r.amount ?? 0), 0) + p.amount
  const reason = (lastHour ?? 0) >= velocity.countPerHour ? 'count' : outbound > velocity.outbound24h ? 'value' : null
  if (reason) {
    // El hecho es este desafio, que no se repite: su propio id.
    await notify(admin, { userId: p.userId, eventKey: 'suspicious', dedupeKey: `velocity_challenge:${randomUUID()}`, href: '/help' })
    return { verdict: 'challenge', reason }
  }
  return { verdict: 'ok' }
}

/** Cuando un operador libera una retencion: vale 48 horas. */
export function releaseExpiry(from = Date.now()): string {
  return new Date(from + RELEASE_WINDOW_MS).toISOString()
}
