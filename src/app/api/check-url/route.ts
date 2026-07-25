import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/check-url — liveness de URL (Master Handoff §14).
 *
 * "URL liveness (does the link actually load?) cannot be done in-browser —
 * CORS blocks it. Seam: await checkUrlReachable(v) against a backend fetch
 * endpoint." Esta es esa ruta: hace el fetch server-side (sin restricción de
 * CORS, porque no es un navegador) y devuelve solo un booleano — nunca el
 * contenido de la URL de terceros.
 *
 * Complementa, no reemplaza, la validación de formato+dominio que ya corre
 * client-side en FormBits' Field (borde verde/rojo instantáneo). Esto añade
 * la confirmación de que el link realmente responde.
 */

const TIMEOUT_MS = 5000

export async function POST(request: NextRequest) {
  const { url } = await request.json()

  if (typeof url !== 'string' || !url) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ reachable: false, reason: 'invalid_url' })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ reachable: false, reason: 'invalid_protocol' })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // HEAD primero (más liviano); algunos sitios no lo soportan y devuelven
    // 405 — en ese caso se reintenta con GET antes de darlo por inalcanzable.
    let res = await fetch(parsed.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })
    if (res.status === 405) {
      res = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      })
    }
    return NextResponse.json({ reachable: res.ok, status: res.status })
  } catch {
    return NextResponse.json({ reachable: false, reason: 'unreachable' })
  } finally {
    clearTimeout(timeout)
  }
}
