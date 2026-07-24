'use client'

export default function PurchaseCancelPage() {
  return (
    <div className="flex-1 px-5 py-10 flex flex-col items-center text-center">
      <p className="font-display text-[28px]">Purchase cancelled.</p>
      <p className="text-[13px] text-ink-soft mt-2">No charge was made.</p>
      <a href="/" className="label-caps mt-8 hover:text-ink">← Home</a>
    </div>
  )
}
