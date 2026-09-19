import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El primer filtro de originalidad: igualdad exacta byte a byte — Update
 * Package 01, N10 (Federico condicion #3).
 *
 * NO ES EL FILTRO PRINCIPAL. Solo atrapa la subida byte-identica: el mismo
 * archivo, subido dos veces. Una reencodificacion, un recorte de un pixel o
 * una recompresion pasan por aqui sin marca — y contra eso es lo que corre la
 * busqueda de similitud sobre image_vectors.
 *
 * Se llama antes de crear la sesion de Stripe. Bloquear despues costaria un
 * reembolso; aqui no ha cobrado nadie.
 *
 * La sha256 la calcula quien llama, en servidor, sobre los bytes de
 * works-media (image-bytes). Este modulo no la deriva de ninguna entrada del
 * cliente.
 *
 * ¿Y si el mismo creador vuelve a subir su propio archivo? Se permite. La
 * consulta filtra por `creator_id != $creator`: si es de otro, se bloquea; si
 * es mio, es mi decision — puede ser una amendment, una reissue, o un mismo
 * archivo con otra intencion. La titularidad es lo que este filtro protege.
 */

export type ExactDuplicate = {
  workId: string
  creatorId: string
  tbtId: string | null
}

/**
 * Busca una obra CERTIFICADA de otro creador con la misma sha256. Un draft no
 * cuenta: un borrador que nunca se cobro no es un registro, y bloquear por
 * borradores ajenos volveria abusable el sistema (subo un draft, tumbo al
 * proximo).
 *
 * Devuelve la primera coincidencia, o null. `limit(1)` es intencional: quien
 * llama solo necesita saber que existe.
 */
export async function findExactDuplicateByAnotherCreator(
  admin: SupabaseClient,
  params: { imageSha256: string; currentCreatorId: string },
): Promise<ExactDuplicate | null> {
  const { data, error } = await admin
    .from('works')
    .select('id, creator_id, tbt_id')
    .eq('image_sha256', params.imageSha256)
    .neq('creator_id', params.currentCreatorId)
    .eq('status', 'certified')
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`image-dedup: la consulta fallo — ${error.message}`)
  }
  if (!data) return null

  return {
    workId: data.id as string,
    creatorId: data.creator_id as string,
    tbtId: (data.tbt_id as string | null) ?? null,
  }
}
