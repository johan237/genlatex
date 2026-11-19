import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class", // Disabled - light mode only
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#f7f8ff",
        foreground: "#0f0f14",
        primary: {
          DEFAULT: "#2668ff",
          hover: "#1743d6",
        },
        secondary: "#4b5168",
        border: "#dde3fb",
        card: "#ffffff",
        accent: "#6e90ff",
        highlight: "#ffef93",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        heading: ["var(--font-space)", "Space Grotesk", "system-ui", "sans-serif"],
      },
      maxWidth: {
        container: "1200px",
        hero: "1280px",
      },
      boxShadow: {
        "card-soft": "0 20px 50px -24px rgba(15, 15, 20, 0.45)",
        "card-solid": "0 25px 60px -30px rgba(15, 15, 20, 0.65)",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
      },
      animation: {
        marquee: "marquee 30s linear infinite",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
