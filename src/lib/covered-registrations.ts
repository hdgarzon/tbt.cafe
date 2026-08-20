/**
 * Registraciones cubiertas — Backend Spec 01 §1.5.
 *
 * Las primeras N registraciones de cada creador las paga tbt.cafe. Es un
 * programa de adquisición con exposición agregada sin tope, y el control es el
 * interruptor `covered_brews_enabled`.
 *
 * La elegibilidad se resuelve solo aquí, del lado del servidor. El cliente
 * muestra el estado pero no lo decide.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FEE } from '@/lib/fees'

/** Lo que se habría cobrado por una registración. */
export const REGISTRATION_FEE = FEE.service

export type CoveredReason = 'first_n_allowance' | 'admin_grant'

/**
 * Devuelve la razón por la que esta registración va cubierta, o null si toca
 * cobrarla.
 *
 * Falla hacia el lado seguro: ante cualquier error —incluida la migración 011
 * sin aplicar— devuelve null y se exige el pago. El error caro es regalar
 * registraciones, no pedir una de más.
 *
 * Lo consumido es el número de filas del libro, no un contador aparte: así no
 * puede desfasarse respecto del costo realmente asumido.
 */
export async function resolveCoveredRegistration(
  supabase: SupabaseClient,
  creatorId: string
): Promise<CoveredReason | null> {
  try {
    const [{ data: config }, { data: profile }, { count }] = await Promise.all([
      supabase.from('platform_config').select('covered_brews_enabled, covered_brews_count').single(),
      supabase.from('profiles').select('covered_registrations_granted').eq('id', creatorId).single(),
      supabase
        .from('covered_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', creatorId),
    ])
    if (!config) return null

    const granted = profile?.covered_registrations_granted ?? 0
    // El interruptor detiene asignaciones nuevas sin tocar las ya otorgadas a
    // una persona en concreto: por eso `granted` se suma aunque esté apagado.
    const base = config.covered_brews_enabled ? config.covered_brews_count : 0
    const used = count ?? 0
    if (used >= base + granted) return null

    // Lo que exceda el cupo general salió de una concesión de soporte.
    return used >= base ? 'admin_grant' : 'first_n_allowance'
  } catch (error) {
    console.error('resolveCoveredRegistration failed:', error)
    return null
  }
}
