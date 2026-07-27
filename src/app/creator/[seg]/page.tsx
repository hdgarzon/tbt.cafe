'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/LocaleProvider'
import { findCreatorBySeg, fetchCreatorWorks, type PublicCreator, type PublicWork } from '@/lib/creator-data'

/**
 * /creator/[seg] — perfil público de un creador con sus obras reales.
 *
 * [seg] es el UUID real de `profiles.id`, o su `public_alias` (case-
 * insensitive) como alias amigable. El backend no tiene el sistema de "key
 * permanente + handle comprado" del prototipo original ni una tabla de
 * "colecciones" — un creador es simplemente su lista de obras publicadas y
 * certificadas.
 */
export default function CreatorPage({ params }: { params: { seg: string } }) {
  const { t } = useLocale()
  const [loading, setLoading] = useState(true)
  const [creator, setCreator] = useState<PublicCreator | null>(null)
  const [works, setWorks] = useState<PublicWork[]>([])

  useEffect(() => {
    ;(async () => {
      const found = await findCreatorBySeg(params.seg)
      setCreator(found)
      if (found) setWorks(await fetchCreatorWorks(found.id))
      setLoading(false)
    })()
  }, [params.seg])

  if (loading) {
    return <div className="px-4 pt-6 text-[13px] text-ink-soft">{t.work.loading}</div>
  }

  if (!creator) {
    return (
      <div className="px-4 pt-6">
        <a href="/" className="back-link">← {t.purchase.home}</a>
        <div className="urlbar">tbt.cafe/creator/{params.seg}</div>
        <p className="text-[14px] mt-4">{t.work.notFound}</p>
      </div>
    )
  }

  const seg = creator.public_alias || creator.id
  const name = creator.public_alias || creator.display_name || 'Creator'

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <div className="urlbar">tbt.cafe/creator/{seg}</div>

      <h1 className="page-title">{name}</h1>
      <div className="page-sub">{t.search.works.replace('{n}', String(works.length))}</div>

      {works.length === 0 ? (
        <p className="page-note">{t.work.notFound}</p>
      ) : (
        <div className="mt-[22px] grid grid-cols-2 gap-3">
          {works.map((w) => (
            <a
              key={w.id}
              href={`/work/${w.tbt_id}`}
              className="aspect-square rounded-[10px] border border-hairline bg-paper-warm overflow-hidden flex items-center justify-center text-center p-2 font-display text-[14px] text-ink-soft hover:border-ink hover:text-ink transition-colors"
            >
              {w.media_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.media_url} alt={w.title} className="w-full h-full object-cover" />
              ) : (
                w.title
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
