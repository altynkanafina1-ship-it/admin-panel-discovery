/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Cinzel only for brand / rare large headings, Inter for UI + tables, mono for IDs.
        display: ["'Cinzel'", "ui-serif", "Georgia", "serif"],
        sans: ["'Inter'", "'Montserrat'", "ui-sans-serif", "system-ui"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      colors: {
        // Shashki Royale light-premium semantic tokens (mirror of game --sr-*)
        sr: {
          bg: "#F5EFE6",
          bgsoft: "#EFE6D8",
          bgdeep: "#E8DCC8",
          surface: "#FFFDF8",
          surface2: "#FAF3E6",
          surfacemuted: "#EDE1D2",
          text: "#2B241E",
          textmuted: "#77695D",
          textsubtle: "#A9988A",
          border: "#D9C9B7",
          bordersoft: "#E6D7C2",
          borderstrong: "#C2AB8D",
          woodlight: "#D7B48A",
          woodmid: "#B58863",
          wooddeep: "#815B43",
          gold: "#C39A48",
          golddeep: "#A77E2E",
          goldsoft: "#E3C97B",
          danger: "#A74740",
          success: "#56815D",
          info: "#3F6E94",
          warning: "#BC8B33",
        },
        // `ink` scale INVERTED to warm light values so existing text-ink-* / bg-ink-*
        // utilities resolve to correct light-mode contrast without touching every file.
        // ink-50 = strongest text (darkest); ink-950 = lightest surface.
        ink: {
          50: "#2B241E",
          100: "#3A322A",
          200: "#4A3F35",
          300: "#5E5246",
          400: "#77695D",
          500: "#A9988A",
          600: "#C2AB8D",
          700: "#D9C9B7",
          800: "#EDE1D2",
          850: "#F2E8DA",
          900: "#FAF3E6",
          950: "#FFFDF8",
        },
        // gold retuned so accent text is readable on light surfaces.
        gold: {
          50: "#FBF3DD",
          100: "#E3C97B",
          200: "#C39A48",
          300: "#A77E2E",
          400: "#8A6A2A",
          500: "#6E5420",
          600: "#E3C97B",
          700: "#C39A48",
        },
        accent: {
          rose: "#A74740",
          mint: "#56815D",
          sky: "#3F6E94",
        },
      },
      boxShadow: {
        royal: "0 25px 60px -25px rgba(195, 154, 72, 0.28)",
        innerline: "inset 0 0 0 1px rgba(43, 36, 30, 0.05)",
        card: "0 1px 2px rgba(43,36,30,0.04), 0 8px 24px -12px rgba(43,36,30,0.12)",
        cardmd: "0 2px 4px rgba(43,36,30,0.05), 0 18px 40px -18px rgba(43,36,30,0.18)",
      },
      backgroundImage: {
        grain:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      },
    },
  },
  plugins: [],
};
