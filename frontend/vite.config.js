import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  const isDev = mode === 'development'
  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://localhost:8080'

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
    ],
    server: {
      proxy: isDev ? {
        '/api/backend': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
        '/api/watermark': {
          target: 'http://localhost:8081',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:8080',
          ws: true,
          changeOrigin: true
        }
      } : {},
    },
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
  }
})