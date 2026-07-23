import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

/**
 * Tipografía del sistema (Master Handoff §5):
 * Cormorant Garamond para display, Inter para UI.
 * Se cargan con next/font para evitar FOUT y peticiones a CDNs externos.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-cormorant",
  display: "swap",
});

export const metadata: Metadata = {
  title: "tbt.cafe",
  description:
    "Certificados de autoría y propiedad para obra creativa. Transbit × BROCHA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // El idioma real lo fija el provider de i18n; `en` es el fallback (Build Spec 01, ÍTEM 3)
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`}>
      <body className="font-sans bg-paper text-ink">
        {/*
          Shell bloqueado a móvil: toda la app vive en una columna centrada de
          ~390px y el desktop replica el móvil exactamente (Master Handoff §5).
        */}
        {/*
          overflow-hidden recorta al borde de la columna: los paneles off-canvas
          (menú deslizable) quedan ocultos como en un móvil real, en vez de
          derramarse al costado cuando la columna está centrada en desktop.
        */}
        <div className="col-locked min-h-screen flex flex-col border-x border-hairline overflow-hidden">
          {children}
        </div>
      </body>
    </html>
  );
}
