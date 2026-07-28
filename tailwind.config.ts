import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ["Cinzel", "serif"],
        body: ["Crimson Text", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        "border-subtle": "hsl(var(--border-subtle))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        surface: {
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          3: "hsl(var(--surface-3))",
          raised: "hsl(var(--surface-raised))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        parchment: {
          DEFAULT: "hsl(var(--parchment))",
          foreground: "hsl(var(--parchment-foreground))",
        },
        gold: {
          DEFAULT: "hsl(var(--gold))",
          glow: "hsl(var(--gold-glow))",
        },
        blood: "hsl(var(--blood))",
        elvish: "hsl(var(--elvish))",
        dwarvish: "hsl(var(--dwarvish))",
        "dot-poison": "hsl(var(--dot-poison))",
        "dot-burn": "hsl(var(--dot-burn))",
        "dot-bleed": "hsl(var(--dot-bleed))",
        soulforged: "hsl(var(--soulforged))",
        log: {
          player: "hsl(var(--log-player))",
          enemy: "hsl(var(--log-enemy))",
          heal: "hsl(var(--log-heal))",
          holy: "hsl(var(--log-holy))",
          fire: "hsl(var(--log-fire))",
          poison: "hsl(var(--log-poison))",
          bleed: "hsl(var(--log-bleed))",
          shadow: "hsl(var(--log-shadow))",
          buff: "hsl(var(--log-buff))",
          mitigation: "hsl(var(--log-mitigation))",
          loot: "hsl(var(--log-loot))",
          telegraph: "hsl(var(--log-telegraph))",
          system: "hsl(var(--log-system))",
          "number-damage": "hsl(var(--log-number-damage))",
          "number-heal": "hsl(var(--log-number-heal))",
          "number-block": "hsl(var(--log-number-block))",
        },
        ui: {
          number: "hsl(var(--ui-number))",
          "number-pos": "hsl(var(--ui-number-pos))",
          "number-neg": "hsl(var(--ui-number-neg))",
          "number-cap": "hsl(var(--ui-number-cap))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "flicker": {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "0.6" },
        },
        "drip": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(0.5px)" },
        },
        "aggro-flash": {
          "0%, 100%": { boxShadow: "none" },
          "50%": { boxShadow: "0 0 6px 2px hsl(var(--destructive) / 0.35)" },
        },
        "polish-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "flicker": "flicker 2s ease-in-out infinite",
        "drip": "drip 2.5s ease-in-out infinite",
        "aggro-flash": "aggro-flash 0.6s ease-out",
        "polish-fade-in": "polish-fade-in 0.25s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
