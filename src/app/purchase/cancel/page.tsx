'use client'

import { useLocale } from '@/i18n/LocaleProvider'

export default function PurchaseCancelPage() {
  const { t } = useLocale()
  return (
    <div className="px-4 pt-16 pb-10 flex flex-col items-center text-center">
      <p className="font-display font-medium text-[28px] leading-[1.08] text-ink">{t.purchase.cancelTitle}</p>
      <p className="text-[13px] text-ink-soft mt-2">{t.purchase.cancelDesc}</p>
      <a href="/" className="back-link mt-8">← {t.purchase.home}</a>
    </div>
  )
}
