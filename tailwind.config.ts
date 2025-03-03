import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    screens: {
      '4xs': '280px',
      // => @media (min-width: 280px) { ... }
      '3.5xs': '320px',
      // => @media (min-width: 320px) { ... }
      '3xs': '375px',
      // => @media (min-width: 375px) { ... }
      '2xs': '414px',
      // => @media (min-width: 414px) { ... }
      xs: '520px',
      // => @media (min-width: 414px) { ... }
      sm: '640px',
      // => @media (min-width: 640px) { ... }
      sm2: '724px',
      // => @media (min-width: 724px) { ... }
      md: '768px',
      // => @media (min-width: 768px) { ... }
      md2: '896px',
      // => @media (min-width: 896px) { ... }
      lg: '1024px',
      // => @media (min-width: 1024px) { ... }
      lg2: '1158px',
      // => @media (min-width: 1024px) { ... }
      xl: '1280px',
      // => @media (min-width: 1280px) { ... }
      '1.5xl': '1348px',
      // => @media (min-width: 1348px) { ... }
      '2xl': '1536px',
      // => @media (min-width: 1536px) { ... }
      '3xl': '1820px'
      // => @media (min-width: 1820px) { ... }
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          100: "#FFFFFF",
          200: "#F5F5F5",
          300: "#E5E5E5",
          400: "#D4D4D4",
          500: "#737373",
          600: "#404040",
          700: "#171717",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
          100: "#A3A3A3",
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      boxShadow: {
        "btn-inner": "0px 0px 2px 2px rgba(255, 255, 255, 0.1) inset",
        box: "6px -6px 44px 0px rgba(255, 255, 255, 0.05) inset",
        btn: "4px 4px 21px 0px rgba(255, 255, 255, 0.1) inset",
        deposit: "0px -6px 22px 2px rgba(255, 255, 255, 0.1) inset",
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
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { transform: "translateY(20px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        glow: {
          "0%, 100%": { filter: "brightness(1)" },
          "50%": { filter: "brightness(1.2)" },
        },
        bounce: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fadeIn": "fadeIn 0.3s ease-out",
        "slideUp": "slideUp 0.3s ease-out",
        "glow": "glow 2s infinite",
        "bounce": "bounce 5s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
