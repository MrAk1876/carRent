import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = String(env.VITE_DEV_BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '')

  return {
    plugins: [
      react(),
      tailwindcss()
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      hmr: {
        host: 'localhost',
        protocol: 'ws',
        clientPort: 5173,
      },
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/socket.io': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
        '/uploads': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
