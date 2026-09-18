import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Its own port, so Rosium and the ShreeRam platform can run side by side without
  // one of them silently landing on the other's port and talking to the wrong API.
  server: { port: 5273, strictPort: true },
  preview: { port: 5273, strictPort: true },
})
