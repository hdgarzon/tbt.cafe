'use client'

import { useLocale } from '@/i18n/LocaleProvider'

/**
 * /collections/favorites — el corazón del header y este enlace del menú
 * apuntan a una función que NO existe en el backend: no hay tabla
 * `favorites` en Supabase. En vez de simular datos falsos, esta página lo
 * dice explícitamente en lugar de dar un 404 silencioso.
 */
export default function FavoritesPage() {
  const { t } = useLocale()

  return (
    <div className="px-4 pt-6">
      <a href="/" className="back-link">← {t.purchase.home}</a>
      <h1 className="page-title">{t.menu.favorites}</h1>
      <div className="page-sub">{t.myCollections.favoritesSub}</div>
      <p className="page-note">{t.myCollections.favoritesUnavailable}</p>
    </div>
  )
}
