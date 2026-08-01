/**
 * Celda de obra — el `makeCell` del prototipo (tbt-espresso.html), compartido
 * por /creator/[seg] y las tres vistas personales (Favorites · Collections ·
 * Creations), igual que allí: una sola definición para todas las rejillas.
 *
 * La imagen llena el cuadro y el título va sobre una banda cálida cruzando el
 * centro — la imagen es el objeto y el título su etiqueta, no un reemplazo.
 * El punto de estado va en un badge blanco abajo a la derecha y SOLO aparece
 * si la obra está en venta o reservada: una obra simplemente registrada no
 * lleva punto, como en la pared de una galería.
 */

export type WorkCellAvailability = 'for_sale' | 'reserved' | 'not_for_sale'

/** Fondo determinista para una obra sin imagen — cada obra un color estable. */
function softBg(seed: string): string {
  let h = 7
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${h}, 32%, 90%), hsl(${(h + 40) % 360}, 30%, 82%))`
}

export function WorkCell({
  tbtId,
  title,
  mediaUrl,
  availability,
}: {
  tbtId: string
  title: string
  mediaUrl: string | null
  /** Sin valor (o not_for_sale) ⇒ sin punto de estado, como en el prototipo. */
  availability?: WorkCellAvailability
}) {
  const showDot = availability === 'for_sale' || availability === 'reserved'
  return (
    <a
      href={`/work/${tbtId}`}
      className="group relative aspect-square rounded-[10px] border border-hairline overflow-hidden bg-paper-warm flex items-center justify-center"
    >
      <div className="absolute inset-0" style={mediaUrl ? undefined : { background: softBg(tbtId) }}>
        {mediaUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl} alt={title} className="w-full h-full object-cover" />
        )}
      </div>
      <div className="relative z-[2] w-full bg-paper-warm border-t border-white/50 border-b border-black/[0.06] px-2 py-[9px] text-center font-display text-[14px] leading-[1.25] text-ink shadow-[0_1px_12px_rgba(0,0,0,0.10)] group-hover:bg-white transition-colors">
        {title}
      </div>
      {showDot && (
        <div className="absolute right-2 bottom-2 z-[3] flex items-center rounded-full bg-white/95 p-1 shadow-[0_1px_6px_rgba(0,0,0,0.16)]">
          <i className={`block w-2 h-2 rounded-full ${availability === 'reserved' ? 'bg-[#D9922B]' : 'bg-[#3EA32C]'}`} />
        </div>
      )}
    </a>
  )
}
