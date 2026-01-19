import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl()],
  base: '/yomi/',
  server: {
    host: true,
    proxy: {
      '/misskey-api': {
        target: 'https://misskey.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/misskey-api/, '/api'),
        secure: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Origin': 'https://misskey.io',
          'Referer': 'https://misskey.io/',
        },
      },
    },
  },
})
