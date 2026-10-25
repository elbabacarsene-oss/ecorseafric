import type { Config } from "tailwindcss";

// Couleurs ECORSE AFRIC : vert et bleu. Ajuster ici les teintes exactes de la charte graphique.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ecorse: {
          vert: { 50: "#ecf8f0", 100: "#d2efdc", 500: "#1f9d55", 600: "#178a47", 700: "#126d39", 800: "#0f5a30" },
          bleu: { 50: "#eaf1fb", 100: "#cddcf4", 500: "#1d5fbf", 600: "#174ea0", 700: "#123f82", 800: "#0e3166", 900: "#0b264f" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
