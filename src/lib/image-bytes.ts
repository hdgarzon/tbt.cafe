import { createHash } from 'crypto'
import { assertPublishableSource } from '@/lib/chain/publish-image'

/**
 * Traer y hashear los bytes que nuestro almacen ya tiene — Update Package 01,
 * N10, condicion #3 de Federico.
 *
 * La sha256 vive en el servidor porque el cliente no puede firmarla: cualquier
 * navegador con sesion puede subir un JSON con la sha256 que quiera. Y si el
 * cliente miente sobre la sha256, el filtro exacto deja de valer para nada.
 * Aqui se leen los bytes tal como quedaron en works-media y se hashea; lo que
 * el navegador dijo no cuenta.
 *
 * `assertPublishableSource` es la misma guarda que usa publish-image para no
 * dejar que una URL preparada a mano nos haga pedir una direccion interna. Si
 * un dia se cambia alli, cambia aqui tambien.
 */

const FETCH_TIMEOUT_MS = 30_000

export type StoredBytes = {
  bytes: Uint8Array
  contentType: string
}

/**
 * Trae los bytes de una imagen guardada en works-media, o lanza. No captura
 * nada: quien llama decide si un fallo es un ticket, un warning o un skip.
 */
export async function fetchStoredImageBytes(mediaUrl: string): Promise<StoredBytes> {
  assertPublishableSource(mediaUrl)

  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`image-bytes: works-media respondio ${response.status} para ${mediaUrl}`)
  }

  const buffer = await response.arrayBuffer()
  return {
    bytes: new Uint8Array(buffer),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

/**
 * SHA-256 en hex, sin prefijo. La columna works.image_sha256 la guarda asi:
 * es lo que compara igualdad exacta byte a byte. Distinto de la convencion de
 * la cadena (chain_image_hash, content_hash) que llevan `sha256:` porque el
 * registro publico las nombra completas.
 */
export function computeImageSha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
