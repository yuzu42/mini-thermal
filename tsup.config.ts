import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
});