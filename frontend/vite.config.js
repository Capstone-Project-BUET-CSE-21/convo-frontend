import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
    ],
    server: {
      proxy: {
        '/api/backend': {
          target: `https://${env.VITE_DEBO_API_BASE}`,
          changeOrigin: true,
        },
        '/api/watermark': {
          target: `https://${env.VITE_MONA_API_BASE}`,
          changeOrigin: true,
        },
      },
    },
  }
})