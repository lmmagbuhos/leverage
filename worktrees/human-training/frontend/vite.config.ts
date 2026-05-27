import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: true,
    port: 6001,
    allowedHosts: true, // allow the ngrok host
    // Plain HTTP locally; ngrok provides trusted TLS so the mic / Web Speech works.
    proxy: {
      "/api": { target: "http://localhost:6000", changeOrigin: true }
    }
  }
});
