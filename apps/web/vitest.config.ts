import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config';

// Testes unitarios (item 2.2 do plano de melhorias). So logica pura por enquanto,
// entao `environment: 'node'` (barato, sem DOM); Testing Library entra depois, so
// onde houver componente com logica de verdade. Herdamos o plugin do React e o
// alias '~' do vite.config para transformar o JSX que notifications.ts puxa de
// tags.tsx; o server/build do vite.config o Vitest ignora.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // Cada teste importa de 'vitest': sem globais, nao mexemos no eslint nem no tsconfig.
      globals: false,
    },
  }),
);
