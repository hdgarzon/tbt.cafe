'use client'

import { useLocale } from '@/i18n/LocaleProvider'
import { SIMULATED_CREATORS, creatorSeg, tbtIdFor } from '@/lib/creator-routing'

/**
 * /creator/[seg] — Build Spec 01, ÍTEM 2.
 * [seg] puede ser la KEY permanente (p.ej. a7f3k9) o un HANDLE comprado
 * (p.ej. picasso). La key es la canónica bajo el capó: soltar el handle
 * nunca rompe enlaces, simplemente resuelve de vuelta a la key.
 *
 * Datos de simulación (Master Handoff §4.1) hasta integrar con Supabase —
 * mismo dataset que alimenta la búsqueda en vivo del home.
 */
export default function CreatorPage({ params }: { params: { seg: string } }) {
  const { t } = useLocale()
  const creator = SIMULATED_CREATORS.find(
    (c) => c.key.toLowerCase() === params.seg.toLowerCase() || c.handle?.toLowerCase() === params.seg.toLowerCase()
  )

  if (!creator) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">← {t.purchase.home}</a>
        <div className="urlbar">tbt.cafe/creator/{params.seg}</div>
        <p className="text-[14px] mt-4">{t.work.notFound}</p>
      </div>
    )
  }

  const seg = creatorSeg(creator)
  const idNote = creator.handle
    ? `${t.creator.purchasedHandle} ${creator.key}`
    : `${t.creator.permanentKey} ${creator.key}`

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <div className="urlbar">tbt.cafe/creator/{seg}</div>

      <h1 className="page-title">{creator.name}</h1>
      <div className="page-sub">
        {t.search.works.replace('{n}', String(creator.works.length))} · {idNote}
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

      <div className="mt-[22px] pt-5 border-t border-hairline">
        <div className="label-caps">{t.creator.collectionsLabel}</div>
        <a
          href={`/creator/${seg}/${creator.collection.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
          className="block mt-3 text-[15px] text-ink hover:text-t-magenta transition-colors"
        >
          {creator.collection}
        </a>
        <p className="page-note">{t.creator.collectionOneAuto}</p>
      </div>
    </div>
  )
}
