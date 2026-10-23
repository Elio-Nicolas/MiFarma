
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "MiFarma | Farmacias de turno",
        short_name: "MiFarma",
        description:
          "Encontrá farmacias de turno en San Luis y Villa Mercedes.",
        theme_color: "#08111f",
        background_color: "#08111f",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icons/mifarma.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      }
    })
  ]
});
