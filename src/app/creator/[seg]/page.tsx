import { resolveCreatorSeg } from '@/lib/creator-routing'

/**
 * /creator/[seg] — Build Spec 01, ÍTEM 2.
 * [seg] puede ser la KEY permanente (p.ej. a7f3k9) o un HANDLE comprado
 * (p.ej. picasso). La key es la canónica bajo el capó: soltar el handle
 * nunca rompe enlaces, simplemente resuelve de vuelta a la key.
 */
export default function CreatorPage({ params }: { params: { seg: string } }) {
  const { key, handle, isHandle } = resolveCreatorSeg(params.seg)

  return (
    <div className="flex-1 px-5 py-8">
      <div className="label-caps">Creator</div>
      <h1 className="font-display text-[34px] leading-tight mt-1">
        {handle ?? key}
      </h1>
      <p className="text-[13px] text-ink-soft mt-2">
        {isHandle ? (
          <>Handle comprado · resuelve a la key <code className="font-mono">{key}</code></>
        ) : (
          <>Key permanente <code className="font-mono">{key}</code></>
        )}
      </p>

      <div className="mt-8 border-t border-hairline pt-4">
        <div className="label-caps">Collections</div>
        <a
          href={`/creator/${params.seg}/collection-1`}
          className="block mt-3 text-[15px] hover:text-t-magenta transition-colors"
        >
          Collection 1
        </a>
        <p className="text-[12px] text-ink-soft mt-2">
          El primer TBT crea &quot;Collection 1&quot; automáticamente (renombrable; el slug sigue al nombre).
        </p>
      </div>
    </div>
  )
}
