'use client'

import { useLocale } from '@/i18n/LocaleProvider'
import { SIMULATED_CREATORS, creatorSeg, tbtIdFor, toCollectionSlug } from '@/lib/creator-routing'

/**
 * /creator/[seg]/[collection] — artist page ESCOPADA a una colección (mismo
 * componente que /creator/[seg], filtrado). En estos datos de simulación cada
 * creador tiene una única colección, así que el filtro es por identidad de
 * slug, no por lista real de colecciones.
 */
export default function CollectionPage({ params }: { params: { seg: string; collection: string } }) {
  const { t } = useLocale()
  const creator = SIMULATED_CREATORS.find(
    (c) => c.key.toLowerCase() === params.seg.toLowerCase() || c.handle?.toLowerCase() === params.seg.toLowerCase()
  )

  if (!creator || toCollectionSlug(creator.collection) !== params.collection.toLowerCase()) {
    return (
      <div className="px-4 pt-6">
        <a href={`/creator/${params.seg}`} className="back-link">← {params.seg}</a>
        <p className="text-[14px] mt-4">{t.work.notFound}</p>
      </div>
    )
  }

  const seg = creatorSeg(creator)

  return (
    <div className="px-4 pt-6">
      <a href={`/creator/${seg}`} className="back-link">← {creator.name}</a>
      <div className="urlbar">
        tbt.cafe/creator/{seg}/{params.collection}
      </div>

      <h1 className="page-title">{creator.collection}</h1>
      <div className="page-sub">
        {t.search.works.replace('{n}', String(creator.works.length))} · {creator.name}
      </div>

      <div className="mt-[22px] grid grid-cols-2 gap-3">
        {creator.works.map((title, i) => (
          <a
            key={title}
            href={`/work/${tbtIdFor(creator, i)}`}
            className="aspect-square rounded-[10px] border border-hairline bg-paper-warm flex items-center justify-center text-center p-2 font-display text-[14px] text-ink-soft hover:border-ink hover:text-ink transition-colors"
          >
            {title}
          </a>
        ))}
      </div>

      <p className="page-note">{t.creator.collectionWorks}</p>
    </div>
  )
}
