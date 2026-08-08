import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./context/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fdf5f2",
          100: "#fbe8e0",
          200: "#f5cdbc",
          300: "#eaad91",
          400: "#dc9270",
          500: "#d97757",
          600: "#cc785c",
          700: "#b35f43",
          800: "#8f4c37",
          900: "#743f2e",
          950: "#3d1f17",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
