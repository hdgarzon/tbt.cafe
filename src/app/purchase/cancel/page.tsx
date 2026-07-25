'use client'

import { useLocale } from '@/i18n/LocaleProvider'

export default function PurchaseCancelPage() {
  const { t } = useLocale()
  return (
    <div className="flex-1 px-5 py-10 flex flex-col items-center text-center">
      <p className="font-display text-[28px]">{t.purchase.cancelTitle}</p>
      <p className="text-[13px] text-ink-soft mt-2">{t.purchase.cancelDesc}</p>
      <a href="/" className="label-caps mt-8 hover:text-ink">← {t.purchase.home}</a>
    </div>
  )
}
