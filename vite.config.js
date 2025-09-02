// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@supabase/supabase-js', 'wanakana'],
  },
  
  server: {
    // Enable history API fallback for client-side routing
    historyApiFallback: true,
  },
  
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        register: resolve(__dirname, 'register.html'),
        profile: resolve(__dirname, 'profile.html'),
        calendar: resolve(__dirname, 'calendar.html'),
      },
    },
  },
});