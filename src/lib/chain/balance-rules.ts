import { MIN_LAMPORTS_FOR_MINT } from '@/lib/solana/keys'

/**
 * Los umbrales del saldo del payer — Chains 01, 7.2.2. Puro: lo prueba
 * check:balance con saldos simulados.
 *
 * Aviso a unos `warningDays` de registros al promedio diario reciente, nunca
 * por debajo de `warningFloorSol`; urgente a unos `urgentDays`, nunca por debajo
 * de `urgentFloorSol`. Una registracion cuesta, con margen, lo que pide un mint
 * (MIN_LAMPORTS_FOR_MINT, medido en devnet).
 */

const LAMPORTS_PER_SOL = 1_000_000_000

export type BalanceRules = { warningDays: number; urgentDays: number; warningFloorSol: number; urgentFloorSol: number }
export type BalanceLevel = 'ok' | 'warning' | 'urgent'
export type AlertLevel = Exclude<BalanceLevel, 'ok'>

export function thresholdsFor(registrationsPerDay: number, r: BalanceRules): { warning: number; urgent: number } {
  const perDay = registrationsPerDay * MIN_LAMPORTS_FOR_MINT
  return {
    warning: Math.max(Math.round(r.warningFloorSol * LAMPORTS_PER_SOL), Math.round(r.warningDays * perDay)),
    urgent: Math.max(Math.round(r.urgentFloorSol * LAMPORTS_PER_SOL), Math.round(r.urgentDays * perDay)),
  }
}

export function levelFor(lamports: number, t: { warning: number; urgent: number }): BalanceLevel {
  if (lamports < t.urgent) return 'urgent'
  if (lamports < t.warning) return 'warning'
  return 'ok'
}

/**
 * Una alerta por cruce. Subir de nivel (nada → aviso → urgente) avisa; quedarse
 * no vuelve a avisar; bajar de urgente a aviso deja el aviso abierto sin
 * repetirlo; recuperarse lo cierra, y el siguiente cruce vuelve a avisar.
 */
export function nextAlert(level: BalanceLevel, open: AlertLevel | null): { fire: AlertLevel | null; open: AlertLevel | null } {
  if (level === 'ok') return { fire: null, open: null }
  if (open === level) return { fire: null, open }
  if (open === 'urgent' && level === 'warning') return { fire: null, open: 'warning' }
  return { fire: level, open: level }
}
