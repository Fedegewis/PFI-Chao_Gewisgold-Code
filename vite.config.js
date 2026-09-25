import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    // 6E.1: limitar Vitest a tests del frontend (src/). Los tests del backend
    // usan node:test y se ejecutan con `npm run test:backend`.
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    exclude: ["backend/**", "node_modules/**", "dist/**"]
  }
});
