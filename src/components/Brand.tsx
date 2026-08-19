/**
 * Marcas e iconos del sistema — portados VERBATIM del prototipo tbt-auth.html.
 *
 * El logo TBT usa el lenguaje de píldoras superpuestas de Transbit: cada letra
 * se compone de rectángulos redondeados que se solapan con `mix-blend-mode:
 * multiply`, de modo que los solapes generan un tercer color. No sustituir por
 * texto: la marca ES el dibujo.
 */

/** Logo TBT completo — cabecera. */
export function TbtLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 268 88" role="img" aria-label="TBT" className={className}>
      <g style={{ mixBlendMode: 'multiply' }} strokeLinecap="round">
        {/* T (1): brazo = dos píldoras desplazadas, asta cian + nodo verde */}
        <rect x="6" y="8" width="60" height="22" rx="11" fill="#FAD212" />
        <rect x="18" y="8" width="60" height="22" rx="11" fill="#EF1385" />
        <rect x="31" y="8" width="22" height="72" rx="11" fill="#21ABCC" />
        <circle cx="42" cy="54" r="13" fill="#3EA32C" />

        {/* B (2): asta amarilla + dos cuencos magenta, solapes cian/rojo/navy */}
        <rect x="98" y="8" width="22" height="72" rx="11" fill="#FAD212" />
        <rect x="104" y="8" width="46" height="22" rx="11" fill="#EF1385" />
        <rect x="139" y="14" width="22" height="30" rx="11" fill="#21ABCC" />
        <rect x="104" y="33" width="46" height="20" rx="10" fill="#ED2D0C" />
        <rect x="139" y="42" width="22" height="30" rx="11" fill="#EF1385" />
        <rect x="104" y="58" width="46" height="22" rx="11" fill="#220E82" />
        <circle cx="112" cy="19" r="9" fill="#220E82" />

        {/* T (3): colorway espejado del T(1) */}
        <rect x="188" y="8" width="60" height="22" rx="11" fill="#EF1385" />
        <rect x="200" y="8" width="60" height="22" rx="11" fill="#FAD212" />
        <rect x="213" y="8" width="22" height="72" rx="11" fill="#3EA32C" />
        <circle cx="224" cy="54" r="13" fill="#21ABCC" />
      </g>
    </svg>
  )
}

/**
 * Marca compacta de Transbit — pie de página.
 * Usa `screen` en vez de `multiply` porque el pie es oscuro.
 */
export function TransbitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" role="img" aria-label="Transbit" className={className}>
      <g style={{ mixBlendMode: 'screen' }} strokeLinecap="round">
        <rect x="8" y="12" width="40" height="12" rx="6" fill="#FAD212" />
        <rect x="14" y="12" width="40" height="12" rx="6" fill="#EF1385" />
        <rect x="23" y="12" width="12" height="38" rx="6" fill="#21ABCC" />
        <circle cx="29" cy="38" r="8" fill="#3EA32C" />
      </g>
    </svg>
  )
}

/** Hamburguesa de tres líneas. */
export function MenuIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2" y1="6" x2="18" y2="6" />
      <line x1="2" y1="10" x2="18" y2="10" />
      <line x1="2" y1="14" x2="18" y2="14" />
    </svg>
  )
}

/** Corazón radiante — favoritos. Contorno + rayos, nunca relleno sólido. */
export function HeartIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth="26"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M262 210c-14-46-52-64-86-56-38 9-62 44-56 92 9 72 122 148 142 158 20-10 133-86 142-158 6-48-18-83-56-92-34-8-72 10-86 56z" />
      <line x1="256" y1="16" x2="256" y2="70" />
      <line x1="256" y1="442" x2="256" y2="496" />
      <line x1="16" y1="256" x2="70" y2="256" />
      <line x1="442" y1="256" x2="496" y2="256" />
      <line x1="86" y1="86" x2="124" y2="124" />
      <line x1="388" y1="388" x2="426" y2="426" />
      <line x1="426" y1="86" x2="388" y2="124" />
      <line x1="124" y1="388" x2="86" y2="426" />
    </svg>
  )
}

/**
 * Toggle de conexión — el track es un trazo, no un relleno.
 * Desconectado: gris (#C4C8CC). Conectado: tinta, con el knob desplazado 19px.
 */
export function ConnectToggle({ connected }: { connected: boolean }) {
  return (
    <svg width="46" height="27" viewBox="0 0 46 27" fill="none" aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="43"
        height="24"
        rx="12"
        stroke="currentColor"
        strokeWidth="3"
      />
      <circle
        cx="13.5"
        cy="13.5"
        r="8.5"
        fill="currentColor"
        style={{
          transform: connected ? 'translateX(19px)' : 'translateX(0)',
          transition: 'transform .22s cubic-bezier(.4,0,.15,1)',
        }}
      />
    </svg>
  )
}

/** Lupa de búsqueda. */
export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="7" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" />
    </svg>
  )
}

/** Aspa de cierre. */
export function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="3" x2="15" y2="15" />
      <line x1="15" y1="3" x2="3" y2="15" />
    </svg>
  )
}

/** Ojo — curación (Build Spec 02, ÍTEM 5; el "critique" renombrado). */
export function CurateIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth="30"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M32 256s76-118 224-118 224 118 224 118-76 118-224 118S32 256 32 256z" />
      <path d="M256 182a74 74 0 1 0 56 26" />
    </svg>
  )
}

/** Tres nodos conectados — compartir. */
export function ShareIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" />
    </svg>
  )
}

/** Cheurón hacia abajo — selectores. */
export function CaretIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4.5L6 8l3.5-3.5" />
    </svg>
  )
}

/**
 * Recibo — icono de los recibos de cobro (.payout-receipts-icon del
 * prototipo). Trazo de 32 sobre un lienzo de 512, con el borde inferior
 * dentado que hace que se lea como un recibo y no como un documento.
 */
export function ReceiptIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 512 512"
      fill="none"
      stroke="currentColor"
      strokeWidth="32"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M48 74a32 32 0 0 1 32-32h332a10 10 0 0 1 8 16 40 40 0 0 0-8 24v378a8 8 0 0 1-12 7l-58-36-58 36a8 8 0 0 1-8 0l-58-36-58 36a8 8 0 0 1-12-7z" />
      <path d="M412 42a40 40 0 0 1 40 40v68a10 10 0 0 1-10 10h-30" />
      <line x1="112" y1="150" x2="300" y2="150" />
      <line x1="112" y1="236" x2="300" y2="236" />
      <line x1="112" y1="322" x2="300" y2="322" />
    </svg>
  )
}
