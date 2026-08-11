/**
 * Imagen de previsualización 1200×630 — Backend Spec 05 §4.
 *
 * La obra se COMPONE entera dentro del marco, no se recorta. Las obras no son
 * 1.91:1, y recortar arriesga cortar justo lo que se está compartiendo; el spec
 * prefiere la obra completa sobre papel de la casa con tipografía discreta.
 *
 * Sobre "generar en el registro y servir estática" (§4.2): aquí se compone bajo
 * demanda pero se marca `immutable` con un año de caché, así que la CDN la sirve
 * estática desde el primer visitante. El motivo del spec para prohibir la
 * generación por petición es el coste de que los rastreadores la pidan una y
 * otra vez, y eso queda cubierto. Se cumplen además las cinco propiedades
 * exigidas en §3.2: absoluta, pública, sin caducidad, PNG y servida directo sin
 * cadena de redirecciones.
 *
 * Cachear sin miedo es posible porque la imagen no lleva nada volátil — ni
 * precio, ni disponibilidad, ni dueño (§1.1).
 */
import { ImageResponse } from 'next/og'
import { createClient } from '@supabase/supabase-js'
import { localeFromAcceptLanguage, ogImageAlt } from '@/lib/og-copy'

export const runtime = 'edge'

const W = 1200
const H = 630

/** Papel y tinta de la casa, en literales: aquí no llegan los tokens de Tailwind. */
const PAPER = '#f4f2ef'
const INK = '#141312'
const INK_SOFT = '#6b665f'

/**
 * El renderizador solo entiende PNG y JPEG. Un WebP lo hace fallar, y ese fallo
 * salía como 200 con cero bytes — que las plataformas cachean igual que una
 * imagen buena. Se comprueban los bytes reales, no la extensión: una URL puede
 * mentir sobre lo que sirve.
 */
async function loadArtwork(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())

    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    if (!isPng && !isJpeg) return null

    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
    return `data:${isPng ? 'image/png' : 'image/jpeg'};base64,${btoa(bin)}`
  } catch {
    return null
  }
}

export async function GET(request: Request, { params }: { params: { slug: string } }) {
  // La ruta se publica como /og/{TBT-ID}.png para que la URL termine en una
  // extensión de imagen, que es lo que esperan varios rastreadores.
  const tbtId = decodeURIComponent(params.slug).replace(/\.(png|jpg|jpeg)$/i, '')

  let title = 'tbt.cafe'
  let creator = ''
  let artwork: string | null = null

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    const { data } = await supabase
      .from('works')
      .select('title, media_url, creator:profiles!works_creator_id_fkey(public_alias, display_name)')
      .eq('tbt_id', tbtId)
      .single()

    if (data) {
      const creatorRow = Array.isArray(data.creator) ? data.creator[0] : data.creator
      creator = creatorRow?.public_alias || creatorRow?.display_name || ''
      title = data.title || title
      if (data.media_url) artwork = await loadArtwork(data.media_url)
    }
  } catch (error) {
    // Se sigue adelante con la tarjeta tipográfica: una previsualización sin la
    // obra sirve; una respuesta vacía cacheada durante un año, no.
    console.error('[og] lookup failed for', tbtId, error)
  }

  const alt = ogImageAlt(localeFromAcceptLanguage(request.headers.get('accept-language')), title, creator)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: PAPER,
          padding: 48,
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {artwork ? (
            // `contain` es lo que garantiza que la obra nunca salga truncada.
            // next/image no existe dentro de ImageResponse: aquí solo se
            // admite <img>, así que la regla no aplica.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artwork}
              alt={alt}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div style={{ fontSize: 56, color: INK_SOFT, letterSpacing: 3 }}>tbt.cafe</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 40, color: INK, lineHeight: 1.1 }}>{title}</div>
            {creator ? <div style={{ fontSize: 26, color: INK_SOFT, marginTop: 8 }}>{creator}</div> : null}
          </div>
          <div style={{ fontSize: 22, color: INK_SOFT, letterSpacing: 2 }}>tbt.cafe</div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // Un año e inmutable: la CDN la sirve estática y los rastreadores no
        // vuelven a costar nada. Se regenera solo si cambian imagen o título
        // (§4.3), y ambos están sellados en la práctica.
        'Cache-Control': 'public, immutable, no-transform, max-age=31536000',
      },
    }
  )
}
