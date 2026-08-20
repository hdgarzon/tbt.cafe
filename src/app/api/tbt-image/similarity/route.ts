import { NextRequest, NextResponse } from 'next/server'

/**
 * Detección de plagio por similitud semántica — proxy al tbt_image_processor.
 *
 * Cruzó desde el backend sin la capa de CORS, que en un mismo origen sobra.
 *
 * FALLA ABIERTO, a propósito: si el procesador no responde, la certificación
 * sigue. Pero "no configurado" no es lo mismo que "caído", y las dos salían por
 * el mismo `skipped` mudo — con lo cual olvidar una variable de entorno apaga
 * la comprobación de plagio sin que nadie se entere. Esa rama ahora avisa.
 *
 * Sin autenticación, igual que en el backend: el front la llama sin token
 * desde el flujo de Brew. Eso deja un proxy abierto contra un servicio con GPU
 * y clave propia, y merece decidirse aparte de una mudanza.
 */
const PROCESSOR_URL = process.env.TBT_IMAGE_PROCESSOR_URL
const PROCESSOR_KEY = process.env.TBT_IMAGE_PROCESSOR_API_KEY

const THRESHOLD_BLOCK = 0.9
const THRESHOLD_WARN = 0.75

export async function POST(req: NextRequest) {
  if (!PROCESSOR_URL) {
    console.warn('[tbt-image/similarity] TBT_IMAGE_PROCESSOR_URL sin definir: no se comprobó plagio')
    return NextResponse.json({ status: 'skipped' })
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const upstream = new FormData()
  upstream.append('file', file)
  upstream.append('top_k', '5')

  const response = await fetch(`${PROCESSOR_URL}/search/images`, {
    method: 'POST',
    headers: { 'X-API-Key': PROCESSOR_KEY ?? '' },
    body: upstream,
  })

  // Índice vacío o búsqueda fallida: el flujo continúa.
  if (!response.ok) return NextResponse.json({ status: 'skipped' })

  const data = await response.json()
  const hits = data.hits ?? []
  if (hits.length === 0) return NextResponse.json({ status: 'clear' })

  const topScore: number = hits[0].score
  if (topScore >= THRESHOLD_BLOCK) {
    return NextResponse.json({ status: 'blocked', score: topScore, matches: hits.slice(0, 3) })
  }
  if (topScore >= THRESHOLD_WARN) {
    return NextResponse.json({ status: 'warning', score: topScore, matches: hits.slice(0, 3) })
  }
  return NextResponse.json({ status: 'clear', score: topScore })
}
