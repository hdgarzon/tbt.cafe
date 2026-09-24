import { createAdminClient } from '@/lib/supabase-admin'
import { indexCertifiedImage } from '@/lib/image-index'

/**
 * Reconstruye el indice de originalidad y las sha256 desde media_url — Update
 * Package 01, N10 (opcion C).
 *
 * El indice es DERIVADO: works.media_url guarda cada imagen publicada, y desde
 * ahi se puede regenerar todo. Perder el indice es un reconstruye, no una
 * perdida de datos. Este script materializa esa promesa.
 *
 * Cuando corre:
 *  - despues de una migracion de dimension (siglip base → siglip large, si algun
 *    dia ocurre): la columna vector(768) cambia y la tabla se rehace vacia;
 *  - despues de un desastre en la tabla `image_vectors` — para eso existe;
 *  - despues de un cambio de proveedor de embedding — mismo motivo.
 *
 * Idempotente: `indexCertifiedImage` hace upsert por work_id y sobrescribe la
 * sha256 con el mismo valor. Reejecutar es seguro; parar a mitad tambien.
 *
 * Secuencial por defecto. El procesador embebe en CPU, y varias peticiones en
 * paralelo solo sirven si hay balanceador; esa decision no vive aqui.
 *
 * Ejecutar con:
 *   npm run reindex:images
 * o directamente:
 *   npx tsx scripts/reindex-images.ts
 *
 * Requiere las mismas variables que la ruta del embedder:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TBT_IMAGE_PROCESSOR_URL, TBT_IMAGE_PROCESSOR_API_KEY
 */

async function main(): Promise<number> {
  if (!process.env.TBT_IMAGE_PROCESSOR_URL) {
    console.error('reindex: TBT_IMAGE_PROCESSOR_URL no esta configurada. Nada que hacer.')
    return 1
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('works')
    .select('id, creator_id, media_url, tbt_id')
    .eq('status', 'certified')
    .not('media_url', 'is', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('reindex: no se pudo listar obras certificadas:', error.message)
    return 1
  }

  const works = (data ?? []) as Array<{ id: string; creator_id: string; media_url: string | null; tbt_id: string | null }>
  console.log(`reindex: ${works.length} obra(s) certificada(s) por re-embeber.`)

  let indexed = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < works.length; i++) {
    const work = works[i]
    const label = `[${i + 1}/${works.length}] ${work.tbt_id ?? work.id}`

    if (!work.media_url) {
      console.log(`${label}  skip — sin media_url`)
      skipped++
      continue
    }

    process.stdout.write(`${label}  ... `)
    const outcome = await indexCertifiedImage({
      workId: work.id,
      creatorId: work.creator_id,
      mediaUrl: work.media_url,
    })
    console.log(outcome)
    if (outcome === 'indexed') indexed++
    else failed++
  }

  console.log(`\nreindex: ${indexed} indexadas, ${failed} fallidas, ${skipped} sin media, ${works.length} totales.`)
  return failed === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('reindex: fallo inesperado —', err)
    process.exit(1)
  })
