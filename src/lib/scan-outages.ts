import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Alertas del servicio de escaneo — Update Package 01, N9 (f).
 *
 * "Una alerta de operador por caida, urgente cuando la causa es de
 * configuracion." fileSystemTicket abre tickets contra una persona y una caida
 * no es de nadie, asi que la alerta sale de provider_events, que la vista de
 * observabilidad ya lee.
 *
 * Una caida es una racha de fallos de `health` sin un exito en medio. El
 * sondeo escribe cada fallo, pero de los exitos solo el que cierra una racha
 * (ver /api/tbt-image/health): sin ese cierre, una caida resuelta pareceria
 * abierta para siempre. Cien sondeos fallidos seguidos son UNA alerta con cien
 * intentos, no cien alertas.
 */

export type ScanOutage = {
  startedAt: string
  /** null mientras sigue abierta. */
  endedAt: string | null
  /** Urgente si algun intento fallo por configuracion: URL sin poner, clave ausente o rechazada. */
  urgent: boolean
  reasons: string[]
  codes: string[]
  attempts: number
}

type Row = { ok: boolean; error_code: string | null; error_detail: unknown; created_at: string }

/** El sondeo guarda `{ code, reason, detail }` en error_detail; error_code es el mismo `code`. */
function detail(row: Row): { reason: string | null; code: string | null } {
  const e = row.error_detail && typeof row.error_detail === 'object' ? (row.error_detail as Record<string, unknown>) : {}
  return {
    reason: typeof e.reason === 'string' ? e.reason : null,
    code: row.error_code ?? (typeof e.code === 'string' ? e.code : null),
  }
}

export function groupOutages(rows: Row[]): ScanOutage[] {
  const outages: ScanOutage[] = []
  let open: ScanOutage | null = null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.ok) {
      if (open) {
        open.endedAt = row.created_at
        outages.push(open)
        open = null
      }
      continue
    }
    const { reason, code } = detail(row)
    if (!open) open = { startedAt: row.created_at, endedAt: null, urgent: false, reasons: [], codes: [], attempts: 0 }
    open.attempts += 1
    if (reason === 'setup') open.urgent = true
    if (reason && open.reasons.indexOf(reason) === -1) open.reasons.push(reason)
    if (code && open.codes.indexOf(code) === -1) open.codes.push(code)
  }
  if (open) outages.push(open)
  // La mas reciente primero: es la que el operador tiene que ver.
  return outages.reverse()
}

export async function getScanOutages(admin: SupabaseClient, sinceIso: string): Promise<ScanOutage[]> {
  const { data } = await admin
    .from('provider_events')
    .select('ok, error_code, error_detail, created_at')
    .eq('provider', 'image_processor')
    .eq('operation', 'health')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(5000)
  return groupOutages((data ?? []) as Row[])
}

/** ¿La ultima noticia del sondeo es un fallo? Entonces un exito ahora cierra esa caida. */
export async function outageIsOpen(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin
    .from('provider_events')
    .select('ok')
    .eq('provider', 'image_processor')
    .eq('operation', 'health')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? data.ok === false : false
}
