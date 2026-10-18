import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 部署时用 VITE_BASE=/ai-galaxy/ 覆盖
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  // 绑所有网卡：只绑 localhost 时会走 IPv6，127.0.0.1 反而打不开
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
