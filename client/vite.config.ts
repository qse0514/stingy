import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 🌐 跟 Week 2 学的 proxy 同款：/api 开头的请求转发给后端，避开 CORS
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
