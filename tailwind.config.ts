import type { Config } from "tailwindcss";

/**
 * Los colores apuntan a las CSS custom properties definidas en globals.css,
 * que a su vez son los tokens del prototipo tbt-auth.html.
 * Un solo lugar donde cambiar un valor.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        "paper-warm": "var(--paper-warm)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        hairline: "var(--hairline)",
        placeholder: "var(--placeholder)",
        // Paleta Transbit — acento precioso, nunca campos de color
        t: {
          yellow: "var(--t-yellow)",
          cyan: "var(--t-cyan)",
          magenta: "var(--t-magenta)",
          red: "var(--t-red)",
          green: "var(--t-green)",
          navy: "var(--t-navy)",
        },
      },
      fontFamily: {
        // Inter para UI, Cormorant Garamond para display (Master Handoff §5)
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-cormorant)", "Georgia", "serif"],
        mono: ["ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      maxWidth: {
        col: "var(--col-width)",
      },
      height: {
        header: "var(--header-h)",
        footer: "var(--footer-h)",
      },
      borderColor: {
        DEFAULT: "var(--hairline)",
      },
    },
  },
  plugins: [],
};
export default config;
