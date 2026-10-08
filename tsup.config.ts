import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  dts: false,
  sourcemap: true,
  clean: process.env.npm_lifecycle_event !== 'dev',
  splitting: false,
  treeshake: true,
  external: ['react', 'react-dom'],
})
