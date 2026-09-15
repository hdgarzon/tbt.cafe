import { createAdminClient } from '@/lib/supabase-admin'
import { assertPublishableSource } from '@/lib/chain/publish-image'
import { recordProviderEvent } from '@/lib/provider-events'
import { fileSystemTicket } from '@/lib/system-tickets'

/**
 * Añade una imagen recién certificada al índice de originalidad — Update
 * Package 01, N10 (b).
 *
 * El índice nunca guardó nada y nadie se enteró: `complete-tbt` mandaba la
 * imagen con un `fetch` sin esperar, a una ruta propia que respondía 200 aunque
 * el procesador la rechazara, y el fallo acababa en una línea de log que caduca.
 *
 * Ahora cada desenlace queda en `provider_events`, que la vista de
 * observabilidad ya lee, y un fallo abre un ticket de sistema sobre la obra.
 * Quien llama lo corre en `after()`: el creador no espera al embedding y el
 * despliegue sí espera a que termine.
 *
 * Nunca lanza. Para cuando esto corre la obra ya está certificada, y un
 * problema de indexación nuestro no puede deshacer eso.
 */

export type IndexOutcome = 'indexed' | 'failed'

/** El procesador calcula el embedding en CPU; más que esto es un procesador colgado. */
const PROCESSOR_TIMEOUT_MS = 90_000
const MEDIA_TIMEOUT_MS = 30_000

export async function indexCertifiedImage(params: {
  workId: string
  creatorId: string
  mediaUrl: string
}): Promise<IndexOutcome> {
  const started = Date.now()

  async function fail(error: unknown): Promise<IndexOutcome> {
    await recordProviderEvent({ provider: 'image_processor', operation: 'index_image', ok: false, error, latencyMs: Date.now() - started, entityType: 'work', entityId: params.workId })
    try {
      const admin = createAdminClient()
      await fileSystemTicket(admin, {
        userId: params.creatorId,
        eventCode: 'image_index_failed',
        entityType: 'work',
        entityId: params.workId,
        errorDetail: error,
      })
    } catch (ticketError) {
      console.error('[image-index] could not open the ticket:', params.workId, ticketError)
    }
    return 'failed'
  }

  try {
    const url = process.env.TBT_IMAGE_PROCESSOR_URL
    const key = process.env.TBT_IMAGE_PROCESSOR_API_KEY ?? ''

    // Sin URL no se indexa nada, en ninguna obra. Es un fallo de configuración,
    // y callarlo es exactamente como el índice se quedó vacío.
    if (!url) {
      return fail({ code: 'url_unset', message: 'TBT_IMAGE_PROCESSOR_URL is not set' })
    }

    // `media_url` la escribió el navegador al crear el borrador y aquí la lee
    // el servidor: sin comprobar el origen, una llamada preparada a mano haría
    // que pidiéramos una dirección interna. La misma guarda que la de publicar.
    assertPublishableSource(params.mediaUrl)

    const image = await fetch(params.mediaUrl, { signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS) })
    if (!image.ok) {
      return fail({ code: 'media_unreadable', status: image.status })
    }

    const form = new FormData()
    form.append('file', await image.blob(), params.mediaUrl.split('/').pop() || 'image.jpg')

    const response = await fetch(`${url}/images`, {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: form,
      signal: AbortSignal.timeout(PROCESSOR_TIMEOUT_MS),
    })
    if (!response.ok) {
      return fail({ code: `http_${response.status}`, status: response.status, body: (await response.text()).slice(0, 300) })
    }

    await recordProviderEvent({ provider: 'image_processor', operation: 'index_image', ok: true, latencyMs: Date.now() - started, entityType: 'work', entityId: params.workId })
    return 'indexed'
  } catch (error) {
    return fail(error)
  }
}
