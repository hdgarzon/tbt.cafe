/**
 * Página pública de la obra — Backend Spec 05 §3.1.
 *
 * Este archivo es un componente de SERVIDOR y existe por una sola razón: los
 * rastreadores no ejecutan JavaScript. Piden el HTML y lo parsean, así que unas
 * etiquetas meta inyectadas desde el cliente les resultan invisibles y la
 * previsualización vuelve en blanco. El spec lo señala como la causa más
 * probable de "compartir no funciona".
 *
 * Toda la interfaz sigue en WorkClient; aquí solo se generan las etiquetas.
 */
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { OG_LOCALE, localeFromAcceptLanguage, ogTitle, ogDescription, ogImageAlt } from '@/lib/og-copy'
import WorkClient from './WorkClient'

const SITE = 'https://tbt.cafe'

/** Cliente anónimo: la página de la obra es pública y el rastreador no trae sesión. */
function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export async function generateMetadata({ params }: { params: { tbtId: string } }): Promise<Metadata> {
  const locale = localeFromAcceptLanguage(headers().get('accept-language'))
  const canonical = `${SITE}/work/${params.tbtId}`

  const { data } = await publicClient()
    .from('works')
    .select('tbt_id, title, series:work_series(name), creator:profiles!works_creator_id_fkey(public_alias, display_name)')
    .eq('tbt_id', params.tbtId)
    .single()

  if (!data) {
    // Sin obra no se inventa una previsualización.
    return { title: 'tbt.cafe', alternates: { canonical } }
  }

  const creatorRow = Array.isArray(data.creator) ? data.creator[0] : data.creator
  const seriesRow = Array.isArray(data.series) ? data.series[0] : data.series
  const creator = creatorRow?.public_alias || creatorRow?.display_name || ''
  const title = ogTitle(data.title ?? '', creator)
  const description = ogDescription(locale, seriesRow?.name)
  const image = `${SITE}/og/${encodeURIComponent(params.tbtId)}.png`
  const alt = ogImageAlt(locale, data.title ?? '', creator)

  return {
    title,
    description,
    // La URL canónica es SIEMPRE la forma TBT-ID, nunca un alias ni una ruta
    // vanidosa, para que todo lo compartido se consolide en una sola dirección.
    alternates: { canonical },
    openGraph: {
      type: 'article',
      siteName: 'tbt.cafe',
      url: canonical,
      title,
      description,
      locale: OG_LOCALE[locale],
      images: [{ url: image, width: 1200, height: 630, alt }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: image, alt }],
    },
  }
}

export default function Page({ params }: { params: { tbtId: string } }) {
  return <WorkClient params={params} />
}
