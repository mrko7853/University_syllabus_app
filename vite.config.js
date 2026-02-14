// vite.config.js
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  const base = isBuild ? '/dev/' : '/';

  return {
    base,

    optimizeDeps: {
      include: ['@supabase/supabase-js', 'wanakana'],
    },

    server: {
      // Enable history API fallback for client-side routing
      historyApiFallback: true,
    },

    // Ensure assets are copied to build
    publicDir: 'assets',

    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          login: resolve(__dirname, 'login.html'),
          register: resolve(__dirname, 'register.html'),
          profile: resolve(__dirname, 'profile.html'),
          calendar: resolve(__dirname, 'calendar.html'),
          assignments: resolve(__dirname, 'assignments.html'),
          course: resolve(__dirname, 'course.html'),
        },
        output: {
          // Ensure proper chunking for components
          manualChunks: (id) => {
            // Keep components together with shared utilities
            if (id.includes('components.js') || id.includes('shared.js')) {
              return 'app-core';
            }
            // External libraries
            if (id.includes('node_modules')) {
              if (id.includes('@supabase')) return 'supabase';
              if (id.includes('wanakana')) return 'wanakana';
              return 'vendor';
            }
          }
        }
      },
    },
  };
});
