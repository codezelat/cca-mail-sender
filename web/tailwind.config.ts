import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#000000",
        panel: "#0c0c0c",
        ink: "#f8fafc",
        muted: "#94a3b8"
      },
      boxShadow: {
        glow: "0 0 20px rgba(255,255,255,0.1)",
        panel: "0 20px 50px -10px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)"
      },
      animation: {
        "soft-pulse": "soft-pulse 8s ease-in-out infinite"
      },
      keyframes: {
        "soft-pulse": {
          "0%, 100%": { transform: "translateX(-50%) scale(1)", opacity: "0.6" },
          "50%": { transform: "translateX(-50%) scale(1.1)", opacity: "0.8" }
        }
      }
    }
  },
  plugins: []
};

export default config;
