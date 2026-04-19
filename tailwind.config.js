/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{tsx,ts}", "!./node_modules/**"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        "surface-raised": "hsl(var(--surface-raised))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          dim: "hsl(var(--primary-dim))",
        },
        phosphor: {
          DEFAULT: "hsl(var(--phosphor))",
          foreground: "hsl(var(--phosphor-foreground))",
        },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        danger: { DEFAULT: "hsl(var(--danger))", foreground: "hsl(var(--danger-foreground))" },
        data: { DEFAULT: "hsl(var(--data))", foreground: "hsl(var(--data-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
      },
      backgroundImage: {
        "gradient-panel": "var(--gradient-panel)",
      },
      boxShadow: {
        bezel: "var(--shadow-bezel)",
        readout: "var(--shadow-readout)",
        "glow-phosphor": "var(--glow-phosphor)",
        "glow-amber": "var(--glow-amber)",
        "glow-cyan": "var(--glow-cyan)",
        "glow-danger": "var(--glow-danger)",
      },
      borderRadius: {
        DEFAULT: "2px",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      keyframes: {
        "pulse-amber": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
        "pulse-phosphor": {
          "0%,100%": { opacity: "1", boxShadow: "0 0 10px hsl(135 70% 55% / 0.7)" },
          "50%": { opacity: "0.6", boxShadow: "0 0 4px hsl(135 70% 55% / 0.4)" },
        },
        "blink-cursor": { "0%,49%": { opacity: "1" }, "50%,100%": { opacity: "0" } },
        "scanline-sweep": { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(1000%)" } },
        "scan-sweep": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } },
        "boot-in": { "0%": { opacity: "0", transform: "translateY(4px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "pulse-amber": "pulse-amber 1.4s ease-in-out infinite",
        "pulse-phosphor": "pulse-phosphor 1.6s ease-in-out infinite",
        "blink-cursor": "blink-cursor 1s steps(2) infinite",
        "scanline-sweep": "scanline-sweep 2.5s linear infinite",
        "scan-sweep": "scan-sweep 1.6s linear infinite",
        "boot-in": "boot-in 0.35s ease-out both",
      },
    },
  },
  plugins: [],
}
