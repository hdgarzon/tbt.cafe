/**
 * Observability — Backend Spec 07 §2.7.
 *
 * Errores agrupados con frecuencia y primera/última aparición, latencia por
 * proveedor, y salud de la escritura en cadena.
 *
 * Aquí se ven patrones; los tickets siguen el impacto en una persona concreta.
 * Ambos, no uno u otro — un fallo de los del Área 3 §1.2 aparece en las dos
 * partes a propósito.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'
import { loadAdmin, can, hasValidStepUp, STEP_UP_HEADER } from '@/lib/admin/guard'


export async function GET(request: NextRequest) {

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const admin = await loadAdmin(auth.supabase, auth.user.id)
  if (!can(admin, 'observability.view')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!(await hasValidStepUp(auth.user.id, request.headers.get(STEP_UP_HEADER)))) {
    return NextResponse.json({ error: 'step_up_required' }, { status: 428 })
  }

  try {
    // La autorización ya se comprobó arriba. Las políticas de estas tablas están
    // escritas para el cliente final —sus propios tickets, sus propias obras— y
    // aplicadas al equipo le esconderían justo lo que tiene que ver.
    const supabase = createAdminClient()
    const hours = Number(new URL(request.url).searchParams.get('hours') ?? 168)

    const sinceIso = new Date(Date.now() - hours * 3_600_000).toISOString()

    const [failures, recent, chainPending, mmsFailed, mmsUnknown] = await Promise.all([
      supabase.rpc('provider_failure_summary', { window_hours: hours }),
      supabase
        .from('provider_events')
        .select('provider, operation, ok, latency_ms, created_at')
        .gte('created_at', sinceIso)
        .limit(1000),
      supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'certified')
        .is('mint_address', null),
      supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('mms_delivery_status', 'failed'),
      // Un null NO es un éxito. La columna solo la escribe el código nuevo, así
      // que todo lo anterior quedó sin marcar: contar solo los 'failed' daba
      // cero para algo que llevaba meses fallando.
      supabase
        .from('works')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'certified')
        .is('mms_delivery_status', null),
    ])

    // Latencia y tasa de éxito por proveedor, calculadas de la muestra traída.
    const byProvider = new Map<string, { calls: number; failures: number; totalMs: number; timed: number }>()
    for (const e of recent.data ?? []) {
      const key = e.provider as string
      const agg = byProvider.get(key) ?? { calls: 0, failures: 0, totalMs: 0, timed: 0 }
      agg.calls += 1
      if (!e.ok) agg.failures += 1
      if (e.latency_ms != null) {
        agg.totalMs += Number(e.latency_ms)
        agg.timed += 1
      }
      byProvider.set(key, agg)
    }

    const providers = Array.from(byProvider.entries()).map(([provider, a]) => ({
      provider,
      calls: a.calls,
      failures: a.failures,
      failureRate: a.calls ? Math.round((a.failures / a.calls) * 1000) / 10 : 0,
      avgLatencyMs: a.timed ? Math.round(a.totalMs / a.timed) : null,
    }))

    return NextResponse.json({
      windowHours: hours,
      failures: failures.data ?? [],
      providers,
      chain: {
        certifiedWithoutMint: chainPending.count ?? 0,
        certificateDeliveriesFailed: mmsFailed.count ?? 0,
        // Separado del cero: "no lo sabemos" y "no falló" son cosas distintas y
        // mezclarlas es cómo un panel acaba diciendo que todo va bien.
        certificateDeliveriesUnknown: mmsUnknown.count ?? 0,
      },
      // Se nombra lo que aún no se observa, para que un panel vacío no se lea
      // como "todo bien".
      notInstrumentedYet: ['arweave', 'opentimestamps', 'queue depths'],
    })
  } catch (error) {
    console.error('[admin/observability] failed:', error)
    return NextResponse.json({ error: 'observability_failed' }, { status: 500 })
  }
}
