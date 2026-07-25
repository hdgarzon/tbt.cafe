'use client'

import { useLocale } from '@/i18n/LocaleProvider'

export default function CollectionPage({
  params,
}: {
  params: { seg: string; collection: string }
}) {
  const { t } = useLocale()
  return (
    <div className="flex-1 px-5 py-8">
      <a href={`/creator/${params.seg}`} className="label-caps hover:text-ink">
        ← {params.seg}
      </a>
      <h1 className="font-display text-[34px] leading-tight mt-2 capitalize">
        {params.collection.replace(/-/g, ' ')}
      </h1>
      <p className="text-[13px] text-ink-soft mt-2">{t.creator.collectionWorks}</p>
    </div>
  )
}
