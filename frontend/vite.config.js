// import { defineConfig, loadEnv } from 'vite'
// import react from '@vitejs/plugin-react'
// import process from 'node:process'

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
  ]
})