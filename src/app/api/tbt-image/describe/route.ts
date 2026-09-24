import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'

/**
 * Descripcion de una imagen — alimenta la categoria sugerida en Espresso sin
 * preguntar. Proxy al `/images/describe` del procesador.
 *
 * SIN UPSTREAM HOY, Y ES DELIBERADO QUE SE VEA. La trim del procesador
 * (Update Package 01, N10, opcion C) le quito el describer BLIP junto con
 * SQLite y Qdrant. La condicion #1 de Federico hablaba de index y search, no
 * del describer: quitarlo fue decision nuestra al recortar, no suya. Mientras
 * no se decida si BLIP vuelve, esta ruta responde 503.
 *
 * QUE SIGNIFICA EL 503 AQUI: Espresso lo trata como "no extraction" y deja los
 * campos vacios para que el creador los escriba — comportamiento que ya
 * existia en EspressoFlow para cuando la extraccion fallaba. No rompe el
 * flujo, solo pierde la sugerencia automatica de categoria. Cold Brew no toca
 * esta ruta y no se entera.
 *
 * POR QUE NO VOLVIO BLIP DE UNA: `blip-image-captioning-large` pesa ~1.8 GB y
 * la VM que aloja el procesador tiene 2 GB, ya ocupados por SigLIP. Meterlo
 * pide subir de plan, y eso es una decision de presupuesto que no es nuestra.
 * Va como pregunta abierta en el reporte.
 *
 * PIDE SESION, como similarity. Era un proxy abierto que cualquiera podia
 * usar como API gratuita.
 */

const TIMEOUT_MS = 60_000

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const url = process.env.TBT_IMAGE_PROCESSOR_URL
  const key = process.env.TBT_IMAGE_PROCESSOR_API_KEY

  if (!url || !key) {
    return NextResponse.json({ error: 'Image processor not configured' }, { status: 503 })
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const upstream = new FormData()
  upstream.append('file', file, 'image.jpg')

  try {
    const response = await fetch(`${url}/images/describe`, {
      method: 'POST',
      headers: { 'X-API-Key': key },
      body: upstream,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    // 404 es el caso esperado mientras el describer no exista en el procesador.
    // Se responde 503 igual que una caida: el llamante ya sabe degradar, y no
    // conviene que un 404 se lea como "la imagen no existe".
    if (response.status === 404) {
      return NextResponse.json({ error: 'describe_not_deployed' }, { status: 503 })
    }
    if (!response.ok) {
      const text = await response.text()
      return NextResponse.json({ error: text.slice(0, 300) }, { status: response.status })
    }

    return NextResponse.json(await response.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'unreachable' },
      { status: 503 },
    )
  }
}
