'use client'

/**
 * Anillo biométrico — .collect-bio / .collect-bio-ring del prototipo.
 *
 * 72px, borde de 2, y al confirmarse pasa a verde con el pulso `bioRingPulse`
 * de medio segundo: acusa recibo del dedo sin decir nada.
 *
 * Lo comparten el cobro y el cambio de destino, que son las dos acciones
 * incondicionales del §5.1.
 */
export function BiometricRing({
  confirmed,
  busy,
  onPress,
  hint,
}: {
  confirmed: boolean
  busy?: boolean
  onPress: () => void
  hint: string
}) {
  return (
    <div className="flex flex-col items-center pt-5 pb-3">
      <button
        type="button"
        onClick={onPress}
        disabled={busy || confirmed}
        aria-pressed={confirmed}
        className={`w-[72px] h-[72px] rounded-full border-2 flex items-center justify-center transition-[border-color,color] duration-300 ${
          confirmed
            ? 'border-t-green text-t-green animate-bio-ring'
            : 'border-hairline text-ink-soft cursor-pointer hover:border-ink-soft'
        }`}
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 11c0 3-1 5-2 7" />
          <path d="M8 6.5a6 6 0 0 1 8 5.5c0 1 0 2-.3 3" />
          <path d="M5.5 9A8 8 0 0 1 12 5a8 8 0 0 1 4 1" />
          <path d="M12 11v1c0 4-1 6-2 8" />
          <path d="M15.5 12c0 4-.5 5.5-1.2 7.5" />
        </svg>
      </button>
      <div className={`text-[11px] mt-2.5 ${confirmed ? 'text-t-green' : 'text-ink-soft'}`}>
        {hint}
      </div>
    </div>
  )
}
