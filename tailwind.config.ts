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
          50: "#eefdf4",
          100: "#d6fae3",
          200: "#b0f2cb",
          300: "#7ce5ab",
          400: "#42d086",
          500: "#1cb56a",
          600: "#129055",
          700: "#117246",
          800: "#125a3a",
          900: "#104a31",
          950: "#062a1b",
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
