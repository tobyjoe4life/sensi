import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version } from './package.json'

// Inject version so the React frontend can read it via import.meta.env.VITE_APP_VERSION
process.env.VITE_APP_VERSION = version;

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: './', // Use relative paths for Electron
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
            // sensi M1: narrow aliases for runtime-safe type + registry modules
            // shared between main and renderer. Only type-only or pure-data
            // modules live under these roots — nothing with Node imports or
            // Electron-only code. See electron/shared/standardCloudModels.ts
            // and electron/providers/types.ts.
            "@shared": path.resolve(__dirname, "./electron/shared"),
            "@providers": path.resolve(__dirname, "./electron/providers"),
        },
    },
    server: {
        port: 5180,
    },
    build: {
        chunkSizeWarningLimit: 1000,
        // PERF-04 (v2.18.0): switch from esbuild to Terser so we can drop
        // console.log + debugger statements in prod. Build is ~2-3s slower
        // but the bundle ends up ~5-10% smaller and cold-boot is faster.
        minify: 'terser',
        terserOptions: {
            compress: {
                // Strip diagnostic console noise from prod, keep warn/error
                // so users can still report issues with stack traces.
                drop_console: ['log', 'debug', 'info'],
                drop_debugger: true,
            },
            format: {
                comments: false,
            },
        },
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom', 'framer-motion'],
                    // Markdown stack splits cleanly off the entry chunk so it
                    // can fetch in parallel with the rest of the app.
                    'vendor-markdown': ['react-markdown', 'remark-gfm', 'remark-math', 'rehype-katex'],
                    ui: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-toast']
                }
            }
        }
    }
})
