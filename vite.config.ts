import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pagesのサブパス (https://<user>.github.io/<repo>/) でも動くよう相対パスにする
  base: './',
  plugins: [react()],
  optimizeDeps: {
    // onnxruntime-webを含むためViteの事前バンドルから除外する
    exclude: ['@huggingface/transformers'],
  },
})
