/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
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
        // Jewel tones for gem rewards / celebration confetti only — never used
        // for body text or large surfaces, to keep the olive/earthy base calm.
        gem: {
          emerald: "#3f8f6d",
          ruby: "#a8434f",
          amber: "#d19a3d",
          sapphire: "#3f6f8f",
        },
      },
      fontFamily: {
        // Rounder, friendlier pairing than the old Georgia serif — reads as
        // playful/kid-engaging rather than formal. See frontend/index.html
        // for the Google Fonts <link>.
        display: ["Baloo 2", "system-ui", "sans-serif"],
        body: ["Quicksand", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1.25rem",
      },
      keyframes: {
        "confetti-fall": {
          "0%": { transform: "translateY(-10vh) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(60vh) rotate(360deg)", opacity: "0" },
        },
        // A threat creeping in from the edge of the screen.
        "sneak-in": {
          "0%": { transform: "translateX(-120%) rotate(-8deg)", opacity: "0" },
          "60%": { transform: "translateX(8%) rotate(3deg)", opacity: "1" },
          "100%": { transform: "translateX(0) rotate(0deg)", opacity: "1" },
        },
        // ...and scurrying back out once the chore is done.
        "flee-out": {
          "0%": { transform: "translateX(0) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateX(140%) rotate(14deg)", opacity: "0" },
        },
        // A nervous shuffle while the gems are still at risk.
        prowl: {
          "0%, 100%": { transform: "translateX(-3px) rotate(-2deg)" },
          "50%": { transform: "translateX(3px) rotate(2deg)" },
        },
        // The King's approving nod.
        "king-nod": {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "30%": { transform: "translateY(-8px) rotate(-4deg)" },
          "60%": { transform: "translateY(0) rotate(4deg)" },
        },
        // Wren's celebration twirl.
        "princess-twirl": {
          "0%": { transform: "rotate(0deg) scale(1)" },
          "50%": { transform: "rotate(180deg) scale(1.12)" },
          "100%": { transform: "rotate(360deg) scale(1)" },
        },
        // A gem counter ticking up.
        "gem-count": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.35)" },
          "100%": { transform: "scale(1)" },
        },
        "pop-in": {
          "0%": { transform: "scale(0.4)", opacity: "0" },
          "70%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "confetti-fall": "confetti-fall 1.8s ease-in forwards",
        "pop-in": "pop-in 0.5s ease-out forwards",
        "sneak-in": "sneak-in 0.7s ease-out forwards",
        "flee-out": "flee-out 0.8s ease-in forwards",
        prowl: "prowl 1.6s ease-in-out infinite",
        "king-nod": "king-nod 1.4s ease-in-out infinite",
        "princess-twirl": "princess-twirl 1.2s ease-in-out",
        "gem-count": "gem-count 0.6s ease-out",
      },
    },
  },
  plugins: [],
};
