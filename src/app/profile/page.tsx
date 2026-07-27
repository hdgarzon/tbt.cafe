'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useLocale } from '@/i18n/LocaleProvider'

/**
 * /profile — selector entre perfil de Creador y de Coleccionista
 * (Master Handoff §11). Se puede tener uno, otro, o ambos.
 *
 * Cada choose-card muestra "Set up ✓" cuando ese perfil ya tiene datos
 * guardados — is_creator para el de creador, collector_alias como señal para
 * el de coleccionista (el único campo que persiste incluso en modo anónimo).
 */
export default function ProfilePage() {
  const { t } = useLocale()
  const [creatorSet, setCreatorSet] = useState(false)
  const [collectorSet, setCollectorSet] = useState(false)

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('profiles')
        .select('is_creator, collector_alias, collector_category')
        .eq('id', user.id)
        .single()
      if (data) {
        setCreatorSet(!!data.is_creator)
        setCollectorSet(!!data.collector_alias || !!data.collector_category)
      }
    })()
  }, [])

  const cards = [
    { key: 'creator', title: t.profile.creatorTitle, desc: t.profile.creatorSub, set: creatorSet },
    { key: 'collector', title: t.profile.collectorTitle, desc: t.profile.collectorSub, set: collectorSet },
  ]

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <h1 className="page-title">{t.profile.title}</h1>
      <div className="page-sub">{t.profile.pageSub}</div>

      <div className="mt-[26px] flex flex-col gap-3.5">
        {cards.map((c) => (
          <a
            key={c.key}
            href={`/profile/${c.key}`}
            className="text-left rounded-2xl border border-hairline bg-paper p-5 transition-colors hover:border-ink hover:bg-paper-warm"
          >
            <div className="font-display font-medium text-[24px] leading-none text-ink mt-1.5">
              {c.title}
            </div>
            <div className="text-[12px] leading-[1.55] text-ink-soft mt-2">{c.desc}</div>
            {c.set && (
              <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-t-green mt-2.5">
                {t.profile.statusSet}
              </div>
            )}
          </a>
        ))}
      </div>
    </div>
  )
}
