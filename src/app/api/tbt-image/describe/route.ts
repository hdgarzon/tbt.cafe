import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'

/**
 * Descripcion de una imagen — alimenta categoria/material en Espresso sin
 * preguntar. Update Package 01, N10 (pivot 21 sept 2026): sin procesador
 * propio con GPU, se llama al Inference API de HuggingFace contra el mismo
 * modelo BLIP que corria en el procesador (`Salesforce/blip-image-captioning-large`).
 *
 * PIDE SESION, como similarity. Era un proxy abierto que cualquiera podia
 * usar como API gratuita. El wizard de Brew ya exige sesion antes de llegar
 * aqui.
 *
 * DEGRADA CON GRACIA: si HF esta caido o el token no esta, se devuelve 503
 * — Espresso lo trata como "no extraction" y sigue con los campos vacios
 * para que el creador los escriba (comportamiento existente en EspressoFlow).
 * Cold Brew no toca esta ruta.
 */

const BLIP_MODEL = 'Salesforce/blip-image-captioning-large'
// HuggingFace retiro `api-inference.huggingface.co` — todo el trafico va por
// el router con rutas por pipeline. BLIP entra por image-to-text.
const HF_INFERENCE_URL = `https://router.huggingface.co/hf-inference/models/${BLIP_MODEL}/pipeline/image-to-text`
const TIMEOUT_MS = 60_000

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'with', 'to', 'from', 'by', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'has', 'have', 'had', 'do', 'does', 'did', 'not', 'no', 'yes', 'so', 'if', 'but',
])

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const token = process.env.HF_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'HF_TOKEN not configured' }, { status: 503 })
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const response = await fetch(HF_INFERENCE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'X-Wait-For-Model': 'true',
      },
      body: new Blob([bytes as BlobPart], { type: file.type || 'application/octet-stream' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) {
      return NextResponse.json({ error: `HF returned ${response.status}` }, { status: response.status })
    }

    // BLIP en HF Inference API: `[{ generated_text: "..." }]`.
    const payload = (await response.json()) as unknown
    const caption = extractCaption(payload)
    if (!caption) {
      return NextResponse.json({ error: 'no caption' }, { status: 502 })
    }

    // Derivamos tags del caption: palabras > 3 chars, sin stop words, top 5.
    const tags = caption
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
      .slice(0, 5)

    // La respuesta del procesador tambien traia colors + orientation +
    // aspect_ratio. Espresso solo consume `tags[0]`, asi que se omite el resto
    // — el tipo `ImageDescription` los declara opcionales.
    return NextResponse.json({ caption, tags })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'unreachable' },
      { status: 503 },
    )
  }
}

function extractCaption(payload: unknown): string | null {
  if (Array.isArray(payload) && payload.length > 0) {
    const first = payload[0] as unknown
    if (first && typeof first === 'object' && 'generated_text' in first) {
      const text = (first as { generated_text: unknown }).generated_text
      if (typeof text === 'string') return text.trim()
    }
  }
  if (payload && typeof payload === 'object' && 'generated_text' in payload) {
    const text = (payload as { generated_text: unknown }).generated_text
    if (typeof text === 'string') return text.trim()
  }
  return null
}
