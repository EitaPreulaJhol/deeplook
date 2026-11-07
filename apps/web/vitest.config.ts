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
      // .tsx: testes de componente e de hook, que pedem o DOM (jsdom). Cada um declara o
      // ambiente no topo (`// @vitest-environment jsdom`); os de logica pura ficam em node.
      include: ['src/**/*.test.{ts,tsx}'],
      // Cada teste importa de 'vitest': sem globais, nao mexemos no eslint nem no tsconfig.
      // (Sem globais o Testing Library nao limpa o DOM sozinho: cada .tsx chama cleanup.)
      globals: false,
      coverage: {
        provider: 'v8',
        reporter: ['text'],
        // So os modulos que ja tem teste: o piso abaixo vale para eles, e a tela inteira
        // (centenas de componentes sem teste) nao derruba a conta. Ao ganhar teste, o
        // modulo entra aqui.
        include: [
          'src/api/client.ts',
          'src/components/{backupSchedule,cases,decoder,iocs,notifications,sha256,textDiff,useEntryListState}.ts',
          'src/components/{ErrorBoundary,lazyPage}.{ts,tsx}',
        ],
        // Piso, nao meta: ~3 a 4 pontos abaixo do medido (95,9% / 88,4% / 97,8% / 95,3%),
        // para pegar uma regressao sem reprovar por ruido. Suba junto com a cobertura.
        thresholds: { statements: 92, branches: 84, functions: 92, lines: 91 },
      },
    },
  }),
);
