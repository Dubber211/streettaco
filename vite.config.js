import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor';
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) return 'map';
          if (id.includes('node_modules/@supabase')) return 'supabase';
        },
      },
    },
  },
})
