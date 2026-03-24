import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
        registerType: "autoUpdate",
        devOptions: { enabled: false },
        workbox: {
          navigateFallbackDenylist: [/^\/~oauth/],
          // Network-only for everything — game is online-only
          globPatterns: [],
          runtimeCaching: [
            {
              urlPattern: /.*$/,
              handler: "NetworkOnly",
            },
          ],
        },
        manifest: {
          name: "Wayfarers of Edhelard",
          short_name: "WoE",
          description: "A journey through the lands of Edhelard",
          theme_color: "#1a1a2e",
          background_color: "#1a1a2e",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          icons: [
            { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
          ],
        },
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
}));
