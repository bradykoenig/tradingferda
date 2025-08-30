import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        bull: "#22c55e", // green-500
        bear: "#ef4444", // red-500
        accent: "#60a5fa" // blue-400
      }
    },
  },
  darkMode: "class",
  plugins: [],
} satisfies Config;
