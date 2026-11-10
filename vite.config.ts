import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 目标手机 WebView 153（Chromium 153），构建目标可放心用现代语法
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'chrome120',
    outDir: 'dist',
  },
  server: {
    // 工具链和 Gradle 缓存都在工作区内，不能让开发服务器每写一个临时文件就整页刷新。
    watch: { ignored: ['**/.toolchain/**', '**/android/**', '**/out/**', '**/docs/**', '**/dist/**'] },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 沙箱里 fork 子进程会 EPERM，必须用 worker_threads
    pool: 'threads',
  },
});
