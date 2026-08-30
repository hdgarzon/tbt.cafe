import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * Sirve la prueba .ots — Chain Spec 01, Item 8.
 *
 * «Downloadable from the work page so a third party can verify independently,
 * without tbt.cafe.» Esa frase es el punto entero: si la verificacion
 * dependiera de que nosotros sigamos aqui, no seria verificacion.
 *
 * Publica y sin sesion, como el hash que la nombra: ambos ya viven en un
 * registro permanente y publico.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: { hash: string } }
) {
  const hash = params.hash.replace(/^sha256:/i, '').replace(/\.ots$/i, '')

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    return NextResponse.json({ error: 'bad_hash' }, { status: 400 })
  }

  const { data } = await createAdminClient()
    .from('chain_anchors')
    .select('ots_proof, status')
    .eq('record_hash', hash)
    .maybeSingle()

  if (!data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Supabase devuelve bytea como cadena hex con prefijo \x.
  const raw = data.ots_proof as unknown as string
  const proof = Buffer.from(raw.replace(/^\\x/, ''), 'hex')

  return new NextResponse(new Uint8Array(proof), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${hash.slice(0, 16)}.ots"`,
      'Content-Length': String(proof.length),
      // Una prueba pendiente cambia; una confirmada ya no.
      'Cache-Control': data.status === 'confirmed' ? 'public, max-age=31536000, immutable' : 'no-store',
    },
  })
}
