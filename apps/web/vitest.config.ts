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
        // Toda a logica fora de componente: os modulos .ts de api, auth e components (revisao de
        // novembro, 2.4). Antes a lista era so dos modulos que ja tinham teste, e um modulo novo
        // de logica sem teste nao aparecia na conta. As telas (.tsx, centenas de componentes)
        // continuam de fora: quem as cobre sao os cenarios do Playwright.
        include: [
          'src/{api,auth}/*.ts',
          'src/components/*.ts',
          'src/components/{ErrorBoundary,sandboxStatus}.tsx',
        ],
        // So tipos, sem codigo para medir.
        exclude: ['src/api/types.ts', 'src/**/*.test.{ts,tsx}'],
        // Piso, nao meta: ~3 pontos abaixo do medido (87,3% / 84,4% / 86,6% / 86,6%), para pegar
        // uma regressao sem reprovar por ruido. Suba junto com a cobertura. O que puxa a conta para
        // baixo hoje: useUnsavedChanges (preso ao roteador) e parte das acoes dos favoritos.
        thresholds: { statements: 84, branches: 81, functions: 83, lines: 83 },
      },
    },
  }),
);
