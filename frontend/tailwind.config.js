/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Olive / earthy palette — calm, low-glare, high-contrast for Echo Show.
        olive: {
          50: "#f6f6ef",
          100: "#e8e8d6",
          200: "#d3d3ac",
          300: "#b7b881",
          400: "#9fa262",
          500: "#7d7f45", // primary
          600: "#616337",
          700: "#4a4b2b",
          800: "#34351f",
          900: "#1f2013",
        },
        clay: {
          100: "#f1e4d4",
          300: "#dcb98f",
          500: "#b9814f", // accent
          700: "#8a5c33",
          900: "#4f3520",
        },
        sand: {
          50: "#fbf8f1",
          100: "#f3ecdd",
          500: "#c8b895",
        },
        bark: "#2b241c", // near-black text on light surfaces
      },
      fontFamily: {
        display: ["Georgia", "serif"],
        body: ["system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1rem",
      },
    },
  },
  plugins: [],
};
