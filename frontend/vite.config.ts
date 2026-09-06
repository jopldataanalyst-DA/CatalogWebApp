import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
  build: {
    // The backend serves this directly in production (see main.py) - same
    // single-container pattern PricingManagementSystem uses, just Docker
    // instead of Nixpacks since this is a fresh, simpler app.
    outDir: '../backend/static',
    emptyOutDir: true,
  },
})
