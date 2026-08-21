import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'

/**
 * Registro de la imagen tras certificar, para que futuras subidas se comparen
 * contra ella — proxy al tbt_image_processor.
 *
 * Cruzó desde el backend tal cual: nunca tuvo capa de CORS porque la llama el
 * servidor, no el navegador.
 *
 * NO BLOQUEANTE por diseño: un fallo aquí se registra y devuelve 200. Para
 * cuando esto corre la obra ya está certificada, y no dejarla certificada por
 * un problema de indexación nuestro sería cobrar dos veces el mismo error.
 *
 * PIDE SESION. Era un proxy abierto delante de un servicio con GPU y clave
 * propia: cualquiera podia usarlo como API gratuita, y en el caso de `register`
 * envenenar el indice contra el que se compara todo lo demas. El wizard de Brew
 * ya exige sesion antes de llegar aqui, y `complete-tbt` reenvia el token de
 * quien llamo igual que hace con sus otras llamadas internas.
 */
const PROCESSOR_URL = process.env.TBT_IMAGE_PROCESSOR_URL
const PROCESSOR_KEY = process.env.TBT_IMAGE_PROCESSOR_API_KEY

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  if (!PROCESSOR_URL) {
    console.warn('[tbt-image/register] TBT_IMAGE_PROCESSOR_URL sin definir: la imagen no se indexó')
    return NextResponse.json({ status: 'skipped' })
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const upstream = new FormData()
  upstream.append('file', file)

  const response = await fetch(`${PROCESSOR_URL}/images`, {
    method: 'POST',
    headers: { 'X-API-Key': PROCESSOR_KEY ?? '' },
    body: upstream,
  })

  if (!response.ok) {
    console.error('[tbt-image/register] no se pudo registrar la imagen:', await response.text())
    return NextResponse.json({ status: 'failed' }, { status: 200 })
  }

  const data = await response.json()
  return NextResponse.json({ status: 'registered', image_id: data.id })
}
