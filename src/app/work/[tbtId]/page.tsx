/**
 * /work/[tbtId] — página pública canónica de una obra.
 * Reutiliza el backend existente: work_commerce.is_for_sale + initial_price
 * alimentan el botón Buy, que va contra /api/stripe/create-checkout
 * (path de comprador, ya soportado por la RLS de transfers).
 */
export default function WorkPage({ params }: { params: { tbtId: string } }) {
  return (
    <div className="flex-1 px-5 py-8">
      <div className="label-caps">TBT</div>
      <h1 className="font-display text-[30px] leading-tight mt-1 font-mono">
        {params.tbtId}
      </h1>
      <p className="text-[13px] text-ink-soft mt-2">
        Verificación pública: autoría, propietario actual e historial completo.
      </p>
    </div>
  )
}
