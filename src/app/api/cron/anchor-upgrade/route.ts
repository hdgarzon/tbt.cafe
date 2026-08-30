import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { upgrade } from '@/lib/chain/ots'

/**
 * Actualiza las anclas pendientes — Chain Spec 01, Item 8.
 *
 * Los calendarios agregan muchos hashes en un arbol de Merkle y solo
 * comprometen la raiz en Bitcoin, asi que una prueba recien sellada tarda horas
 * en poder completarse. Este trabajo pregunta cada hora si alguna ya entro en
 * un bloque.
 *
 * NO ES UN REINTENTO DE ALGO QUE FALLO. Una prueba pendiente esta bien; solo
 * esta esperando. Por eso no hay tope de intentos que la marque fallida: se
 * cuentan para poder ver una atascada, no para rendirse.
 */
/*
 * Dinamica, o no corre.
 *
 * Sin esto Next la prerenderiza: el build la EJECUTA una vez, congela su
 * respuesta, y cada disparo horario devuelve ese resultado vacio sin tocar la
 * base ni los calendarios. Se vio en la salida del build —«[ots-cron] revisadas
 * 0» durante el prerenderizado— y en la tabla de rutas, marcada estatica.
 */
export const dynamic = 'force-dynamic'

export const maxDuration = 300

/** De golpe, para no agotar el tiempo si un dia hay muchas. */
const BATCH = 50

export async function GET(request: NextRequest) {
  /*
   * Vercel manda `Authorization: Bearer ${CRON_SECRET}` cuando la variable
   * existe. Sin ella la ruta queda abierta, y aunque solo lea calendarios
   * publicos, dejar que cualquiera dispare 50 llamadas de red no es gratis.
   */
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'not_authorised' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: pending, error } = await admin
    .from('chain_anchors')
    .select('record_hash, ots_proof')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[ots-cron] no se pudieron leer las anclas:', error)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }

  let confirmed = 0
  let stillPending = 0

  for (const row of pending ?? []) {
    try {
      // Supabase devuelve bytea como cadena hex con prefijo \x.
      const raw = row.ots_proof as unknown as string
      const proof = Buffer.from(raw.replace(/^\\x/, ''), 'hex')

      const result = await upgrade(proof)

      if (result.upgraded && result.blockHeight) {
        await admin
          .from('chain_anchors')
          .update({
            ots_proof: result.proof,
            status: 'confirmed',
            block_height: result.blockHeight,
            attested_at: new Date().toISOString(),
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('record_hash', row.record_hash)
        confirmed++
      } else {
        /*
         * Cambio pero sin bloque todavia, o no cambio. Se guarda la prueba de
         * todas formas cuando avanzo: un calendario puede haber añadido
         * eslabones que aun no llegan a Bitcoin, y perderlos alargaria la
         * espera sin motivo.
         */
        await admin
          .from('chain_anchors')
          .update({
            ...(result.upgraded ? { ots_proof: result.proof } : {}),
            upgrade_attempts: (await attemptsFor(admin, row.record_hash)) + 1,
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('record_hash', row.record_hash)
        stillPending++
      }
    } catch (err) {
      console.error(`[ots-cron] ${row.record_hash.slice(0, 16)}…:`, err)
      stillPending++
    }
  }

  console.log(`[ots-cron] revisadas ${pending?.length ?? 0}: ${confirmed} confirmadas, ${stillPending} pendientes`)

  return NextResponse.json({
    checked: pending?.length ?? 0,
    confirmed,
    pending: stillPending,
  })
}

async function attemptsFor(
  admin: ReturnType<typeof createAdminClient>,
  hash: string
): Promise<number> {
  const { data } = await admin
    .from('chain_anchors')
    .select('upgrade_attempts')
    .eq('record_hash', hash)
    .single()
  return data?.upgrade_attempts ?? 0
}
