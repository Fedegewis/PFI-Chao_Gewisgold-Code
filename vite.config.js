import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// F0 (mismo origen): con VITE_API_URL=/api el frontend llama a su propio origen
// y Vite reenvía /api al backend local, igual que vercel.json lo hace en
// producción. Con VITE_API_URL absoluta (default actual) este proxy no se usa.
// API_PROXY_TARGET permite apuntar a otro backend local sin tocar el código.
const apiProxy = {
  "/api": {
    target: process.env.API_PROXY_TARGET || "http://localhost:3001",
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    // 6E.1: limitar Vitest a tests del frontend (src/). Los tests del backend
    // usan node:test y se ejecutan con `npm run test:backend`.
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: ["backend/**", "node_modules/**", "dist/**"]
  }
});
