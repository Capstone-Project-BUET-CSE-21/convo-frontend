import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  server: {
    proxy: {
      // Forwards /api/watermark/* requests to the watermark Spring Boot service
      '/api/watermark': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
})