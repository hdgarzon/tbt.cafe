import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'

/**
 * Descripción de una imagen — proxy al servicio tbt_image_processor.
 *
 * Cruzó desde el backend (repo hdgarzon/tbt) sin CORS: allí exportaba un
 * OPTIONS y envolvía cada respuesta en `jsonWithCors` porque el front vivía en
 * otro origen. Aquí es el mismo, así que esa capa entera desaparece — es la
 * mitad del motivo de unificar.
 *
 * Sin autenticación, igual que en el backend. Ver la nota en `similarity`.
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
    return NextResponse.json({ error: 'Image processor not configured' }, { status: 503 })
  }

  const formData = await req.formData()
  const file = formData.get('file')

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const upstream = new FormData()
  upstream.append('file', file)

  const response = await fetch(`${PROCESSOR_URL}/images/describe`, {
    method: 'POST',
    headers: { 'X-API-Key': PROCESSOR_KEY ?? '' },
    body: upstream,
  })

  if (!response.ok) {
    const text = await response.text()
    return NextResponse.json({ error: text }, { status: response.status })
  }

  return NextResponse.json(await response.json())
}
