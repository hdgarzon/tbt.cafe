import type { SupabaseClient } from '@supabase/supabase-js'
import { PublicKey } from '@solana/web3.js'
import { getRules } from '@/lib/rules'
import { createAdminClient } from '@/lib/supabase-admin'
import { sendSms } from '@/lib/sms'
import { recordProviderEvent } from '@/lib/provider-events'
import { MIN_LAMPORTS_FOR_MINT, readSecret } from '@/lib/solana/keys'
import { thresholdsFor, levelFor, nextAlert, type AlertLevel, type BalanceLevel } from './balance-rules'

/**
 * La alarma de saldo del payer — Chains 01, 7.2.2 y 7.2.3.
 *
 * Lee el saldo, lo compara con los umbrales (balance-rules.ts) y, si cruza
 * uno, avisa una vez a los operadores activos por SMS y por correo, y deja un
 * evento de proveedor. Un mint que no se intenta por saldo (assertPayerCanMint)
 * dispara la urgente por `raiseUrgent`.
 *
 * Los creditos de Turbo de la clave de almacenamiento se suman con la 5.1.
 * Sin programar: el horario espera la pregunta (s).
 */

const LAMPORTS_PER_SOL = 1_000_000_000
const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(3)

export type BalanceOutcome = { lamports: number; level: BalanceLevel; fired: AlertLevel | null; thresholds: { warning: number; urgent: number } }

async function registrationsPerDay(admin: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { count } = await admin.from('works').select('id', { count: 'exact', head: true }).eq('status', 'certified').gte('certified_at', since)
  return (count ?? 0) / 30
}

async function tellOperators(admin: SupabaseClient, level: AlertLevel, lamports: number, threshold: number): Promise<void> {
  const text =
    `tbt.cafe payer balance ${level.toUpperCase()}: ${sol(lamports)} SOL, threshold ${sol(threshold)} SOL. ` +
    `Mints stop below ${sol(MIN_LAMPORTS_FOR_MINT)} SOL. Fund the payer.`

  const { data: members } = await admin.from('admin_members').select('user_id').eq('active', true)
  const ids = (members ?? []).map((m) => m.user_id as string)
  if (!ids.length) return
  // El telefono es privado (053): solo el service role lo lee.
  const { data: profiles } = await createAdminClient().from('profiles').select('id, phone').in('id', ids)

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  const { Resend } = await import('resend')
  for (let i = 0; i < ids.length; i++) {
    const phone = (profiles ?? []).find((p) => p.id === ids[i])?.phone as string | undefined
    if (phone) await sendSms(phone, text, 'payer_balance_alert')
    const { data: user } = await admin.auth.admin.getUserById(ids[i])
    const email = user?.user?.email
    if (email && apiKey && from) {
      const { error } = await new Resend(apiKey).emails.send({ from, to: email, subject: `Payer balance ${level}`, text })
      void recordProviderEvent({ provider: 'resend', operation: 'payer_balance_alert', ok: !error, error: error ?? undefined })
    }
  }
}

/** Aplica el siguiente paso de la alerta abierta; avisa si toca. */
async function settle(admin: SupabaseClient, level: BalanceLevel, lamports: number, thresholds: { warning: number; urgent: number }): Promise<AlertLevel | null> {
  const { data: open } = await admin
    .from('balance_alerts')
    .select('id, level')
    .eq('account', 'payer')
    .is('cleared_at', null)
    .maybeSingle()
  const step = nextAlert(level, (open?.level as AlertLevel | undefined) ?? null)
  const now = new Date().toISOString()

  if (open && (step.fire || !step.open)) await admin.from('balance_alerts').update({ cleared_at: now }).eq('id', open.id)
  else if (open && step.open && step.open !== open.level) await admin.from('balance_alerts').update({ level: step.open }).eq('id', open.id)

  if (step.fire) {
    const threshold = step.fire === 'urgent' ? thresholds.urgent : thresholds.warning
    await admin.from('balance_alerts').insert({ level: step.fire, balance_lamports: lamports, threshold_lamports: threshold })
    await recordProviderEvent({ provider: 'solana', operation: 'payer_balance_alert', ok: false, error: { code: `balance_${step.fire}`, lamports, threshold } })
    await tellOperators(admin, step.fire, lamports, threshold)
  }
  return step.fire
}

async function payerLamports(): Promise<number> {
  const { getConnection } = await import('@/lib/solana/config')
  const payer = new PublicKey(readSecret('payer').slice(32, 64))
  return getConnection().getBalance(payer)
}

export async function checkPayerBalance(admin: SupabaseClient): Promise<BalanceOutcome> {
  const [rules, perDay, lamports] = await Promise.all([getRules(), registrationsPerDay(admin), payerLamports()])
  const thresholds = thresholdsFor(perDay, rules.balance)
  const level = levelFor(lamports, thresholds)
  const fired = await settle(admin, level, lamports, thresholds)
  return { lamports, level, fired, thresholds }
}

/** 7.2.3: un mint no se intento por saldo. La urgente, si no esta abierta ya. */
export async function raiseUrgent(admin: SupabaseClient, lamports: number): Promise<void> {
  const rules = await getRules()
  const thresholds = thresholdsFor(await registrationsPerDay(admin), rules.balance)
  await settle(admin, 'urgent', lamports, thresholds)
}
