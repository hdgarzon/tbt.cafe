'use client'

/**
 * Fila de ledger — título + "what" a la izquierda, monto + fecha a la
 * derecha (prototipo: .txn-row/.txn-main/.txn-side). Usada por las cinco
 * vistas de Transactions (Brews/Offers/Royalties/Transfers/Sales).
 */
export function LedgerRow({
  title,
  what,
  amount,
  when,
  href,
}: {
  title: string
  what: string
  amount: string | null
  when: string
  href?: string
}) {
  const Tag = href ? 'a' : 'div'
  return (
    <Tag
      href={href}
      className={`flex items-start justify-between gap-3 py-4 border-b border-hairline transition-colors -mx-1 px-1 ${
        href ? 'hover:bg-paper-warm cursor-pointer' : ''
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink truncate">{title}</span>
        <span className="block text-[11.5px] text-ink-soft mt-1">{what}</span>
      </span>
      <span className="shrink-0 text-right">
        {amount && <span className="block text-[13px] font-medium text-ink">{amount}</span>}
        <span className="block text-[11px] text-ink-soft mt-0.5">{when}</span>
      </span>
    </Tag>
  )
}
