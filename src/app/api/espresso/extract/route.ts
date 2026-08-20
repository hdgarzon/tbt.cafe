import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'

/**
 * Extracción conversacional para Espresso (tbt-espresso.html, EXTRACT SEAM).
 *
 * El prototipo simula esto con un parser local y lo deja anotado: "in
 * production the free-text answers post to a new conversational endpoint
 * (Gemini) that returns structured fields". Esta es esa ruta.
 *
 * Recibe una respuesta hablada o escrita en lenguaje natural y devuelve los
 * campos que Cold Brew recoge con formularios. Nunca inventa: lo que no está
 * en el texto vuelve vacío, porque la pantalla de confirmación —no la
 * transcripción— es la fuente de verdad, y ahí el creador corrige antes de
 * sellar. Rellenar huecos con suposiciones metería datos falsos en un
 * certificado permanente.
 */

export const dynamic = 'force-dynamic'

type Field = 'work' | 'value'

const WORK_SCHEMA = `{
  "title": string,        // el nombre de la obra; "" si no lo dice
  "aboutWork": string,    // lo que cuenta sobre la pieza, en sus palabras; "" si no hay
  "creationDate": string, // ISO YYYY-MM-DD si menciona una fecha concreta; "" si no
  "assetLinks": string[]  // URLs que mencione; [] si no hay
}`

const VALUE_SCHEMA = `{
  "marketPrice": number|null,               // el precio; null si no vende o no lo dice
  "currency": string,                       // ISO: USD, EUR, COP, MXN. "USD" por defecto
  "royaltyType": "none"|"percentage"|"fixed",
  "royaltyValue": number|null               // el porcentaje o el monto; null si royaltyType es none
}`

function promptFor(field: Field, text: string): string {
  const schema = field === 'work' ? WORK_SCHEMA : VALUE_SCHEMA
  const extra =
    field === 'work'
      ? 'El título es lo más importante. Si el creador describe la pieza sin nombrarla, deja "title" vacío.'
      : 'Si dice que no está a la venta, marketPrice es null y royaltyType es "none". "10%" es percentage con royaltyValue 10; "500 dólares por reventa" es fixed con royaltyValue 500.'

  return `Eres un extractor de datos. Devuelve SOLO un objeto JSON válido con esta forma exacta, sin texto alrededor ni bloques de código:

${schema}

Reglas:
- Extrae únicamente lo que el texto dice de verdad. No inventes ni completes con suposiciones.
- Si un campo no aparece, devuelve "" (texto), null (número) o [] (lista).
- ${extra}

Texto del creador:
"""
${text}
"""`
}


export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  let body: { field?: string; text?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const field = body.field
  const text = (body.text ?? '').trim()

  if (field !== 'work' && field !== 'value') {
    return NextResponse.json({ error: 'field debe ser "work" o "value"' }, { status: 400 })
  }
  if (!text) {
    return NextResponse.json({ error: 'text es obligatorio' }, { status: 400 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    // Sin llave no hay extracción: que el front muestre los campos vacíos para
    // que el creador los escriba, en vez de adivinar por él.
    return NextResponse.json({ fields: null, reason: 'unavailable' })
  }

  // Menos reintentos y espera más corta que generate-context: esto ocurre en
  // medio de una conversación, y hacer esperar 8s a quien acaba de hablar es
  // peor que caer al formulario vacío.
  const maxRetries = 2
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptFor(field, text) }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 500,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      )

      if (response.status === 429) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 2000))
        continue
      }
      if (!response.ok) {
        console.error('Gemini extract error:', response.status)
        throw new Error(`Gemini API error: ${response.status}`)
      }

      const data = await response.json()
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!raw) throw new Error('Gemini devolvió una respuesta vacía')

      const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      return NextResponse.json({ fields: JSON.parse(cleaned) })
    } catch (err) {
      if (attempt === maxRetries - 1) {
        console.error('espresso/extract falló:', err)
        // Falla suave: el front cae a los campos vacíos y el creador escribe.
        return NextResponse.json({ fields: null, reason: 'failed' })
      }
    }
  }

  return NextResponse.json({ fields: null, reason: 'failed' })
}
