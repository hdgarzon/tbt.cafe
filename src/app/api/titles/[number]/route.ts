import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/route-auth'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * GET /api/titles/<title number> — la página del enlace (Work Order 01 Step 17).
 *
 * Tres constantes, del Addendum A y de Update Package 01 §17:
 *  - Autenticada con el teléfono del titular. La URL no lleva token: el
 *    número del título no abre nada por sí solo, la sesión sí.
 *  - Abre repetidas veces durante 30 días desde la emisión. El enlace de un
 *    título ya superado sigue abierto sus propios 30 días.
 *  - Muestra el título animado y lo deja descargar. Los archivos viven en un
 *    bucket privado; aquí se firman URLs de vida corta después de comprobar
 *    que quien pide es el titular de ESE título.
 *
 * Un número que no es de quien pregunta responde igual que uno que no existe:
 * no se confirma a un tercero qué títulos hay.
 */
export const dynamic = 'force-dynamic'

const SIGNED_URL_SECONDS = 600

export async function GET(request: NextRequest, props: { params: Promise<{ number: string }> }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })
  const { number } = await props.params

  const admin = createAdminClient()
  const { data: title } = await admin
    .from('titles')
    .select('id, work_id, version, title_number, facts, issued_at, link_expires_at, title_files(gif_path, png_path, webp_path, files_deleted_at)')
    .eq('title_number', number)
    .eq('owner_id', auth.user.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!title) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const expired = !title.link_expires_at || new Date(title.link_expires_at).getTime() <= Date.now()
  const { data: newer } = await admin
    .from('titles')
    .select('title_number, issued_at')
    .eq('work_id', title.work_id)
    .gt('version', title.version)
    .order('version', { ascending: true })
    .limit(1)
    .maybeSingle()

  const facts = (title.facts ?? {}) as { work_title?: string; tbt_id?: string }
  const base = {
    title_number: title.title_number,
    work_title: facts.work_title ?? null,
    tbt_id: facts.tbt_id ?? null,
    issued_at: title.issued_at,
    link_expires_at: title.link_expires_at,
    superseded_by: newer?.title_number ?? null,
  }

  if (expired) return NextResponse.json({ ...base, status: 'expired' }, { status: 410 })

  const files = (Array.isArray(title.title_files) ? title.title_files[0] : title.title_files) as
    | { gif_path: string; png_path: string; webp_path: string; files_deleted_at: string | null }
    | null
  if (!files || files.files_deleted_at) return NextResponse.json({ ...base, status: 'rendering' }, { status: 202 })

  const bucket = admin.storage.from('titles')
  const [webp, gif, png] = await Promise.all([
    bucket.createSignedUrl(files.webp_path, SIGNED_URL_SECONDS),
    bucket.createSignedUrl(files.gif_path, SIGNED_URL_SECONDS, { download: `${title.title_number}.gif` }),
    bucket.createSignedUrl(files.png_path, SIGNED_URL_SECONDS, { download: `${title.title_number}.png` }),
  ])
  if (webp.error || gif.error || png.error) {
    return NextResponse.json({ error: 'signing_failed' }, { status: 500 })
  }

  return NextResponse.json(
    { ...base, status: 'ready', urls: { view: webp.data.signedUrl, gif: gif.data.signedUrl, png: png.data.signedUrl } },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
