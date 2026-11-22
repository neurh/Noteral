import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wails from "@wailsio/runtime/plugins/vite";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
    proxy: {
      // In dev the renderer is served by Vite; the tiny Go asset server on
      // 9246 serves workspace attachments so image URLs work exactly as in
      // the production embedded server.
      "/__assets": {
        target: "http://127.0.0.1:9246",
        changeOrigin: false,
      },
    },
  },
  plugins: [react(), wails("./bindings")],
});
