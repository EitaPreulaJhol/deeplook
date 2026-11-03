# 🧱 Plano de melhorias técnicas

Levantamento feito depois que o [backlog de UX](ux-backlog.md) chegou ao fim (251 itens)
e as quatro rodadas do Strix fecharam os buracos de segurança. O que sobra não é
funcionalidade de tela: é **robustez, automação e operação**.

**Legenda** — Prioridade: 🔴 alta · 🟡 média · ⚪ baixa. Esforço: **P** (horas),
**M** (1–2 dias), **G** (vários dias). Status: ✅ feito · ⬜ pendente · ⏸ adiado (registrado, não iniciado) · 🚫 fora de escopo.

## Resumo

| # | Item | Prioridade | Esforço | Área | Status |
|---|---|---|---|---|---|
| 1.1 | ErrorBoundary global no frontend | 🔴 | P | Web | ✅ |
| 1.2 | Health check de *readiness* real | 🔴 | P–M | API / Compose | ✅ |
| 1.3 | Logger estruturado nos jobs de fundo | 🟡 | P | API | ✅ |
| 2.1 | CI (GitHub Actions): lint, typecheck, build, testes | 🔴 | M | Repositório | ✅ |
| 2.2 | Testes unitários no frontend (Vitest) | 🟡 | M | Web | ✅ |
| 2.3 | Atualização de dependências e `npm audit` no CI | 🟡 | P | Repositório | ✅ |
| 2.4 | Limpeza: `infra/nginx/` vazio | ⚪ | P | Repositório | ✅ |
| 3.1 | Métricas Prometheus (`/metrics`) | ⚪ | M | API | ⬜ |
| 3.2 | Status do sistema legível por máquina | ⚪ | P | API | ✅ |
| 4.1 | Afinar cabeçalhos do nginx | 🟡 | P | Web | ✅ |
| 4.2 | Conferência de integridade (SHA-256) no download e em segundo plano | ⚪ | P–M | API | ✅ |
| 5.1 | Notificações por e-mail (SMTP) | — | G | API | 🚫 |
| 5.2 | Webhooks de saída | — | M–G | API | 🚫 |
| 5.3 | Exportar indicadores em MISP/TAXII | ⚪ | M | API | ⬜ |
| 6.1 | Correções pequenas: `.dockerignore` da API, `@types/node`, resíduo do Node 22 | 🟡 | P | API | ✅ |
| 6.2 | Versão do Playwright em lockstep (CI + Dependabot) | 🟡 | P | Repositório | ✅ |
| 6.3 | Dependabot ignora a major do `node` (Current, não LTS) | ⚪ | P | Repositório | ✅ |
| 6.4 | Varredura semanal de CVE nas imagens (Trivy) | 🔴 | P–M | Repositório | ✅ |
| 6.5 | `web` sem root e compose endurecido | 🟡 | P–M | Web / Compose | ✅ |
| 6.6 | Rotação dos logs do Docker | 🟡 | P | Compose | ✅ |
| 6.7 | nginx: cache dos assets, 404 de asset e COOP/CORP | 🟡 | P | Web | ✅ |
| 6.8 | CI roda `test:images` e `test:smoke` | 🔴 | P | Repositório | ✅ |
| 6.9 | Vitest: `client.ts`, `cases.ts`, hook da lista, ErrorBoundary, cobertura | 🟡 | M | Web | ✅ |
| 6.10 | Frontend: code splitting (rotas e noVNC) e CSS do Carbon | 🟡 | M | Web | ✅ (JS; o CSS ficou para depois) |
| 6.11 | Dependências da API: majors do `postal-mime`, multipart, rate-limit e bcryptjs | 🟡 | M | API | ✅ |
| 6.12 | Dependências do web: React 19, Vite 8, TypeScript 7 | ⚪ | M–G | Web | ✅ (React e Vite; o TypeScript 7 está bloqueado) |
| 6.13 | Cópia do backup fora do disco | 🔴 | M | API / Operação | ⏸ adiado pelo dono |
| 6.14 | Suíte visual (Playwright) no CI | 🟡 | M | Repositório | ✅ |

Os itens **5.1** e **5.2** ficaram **fora do escopo** por decisão do dono do projeto;
continuam registrados para quando voltarem à mesa.

**Ordem de execução combinada:** 1.1 → 1.2 → 2.1 → 1.3 → 2.3 → 2.4 → depois o resto.

**Primeira leva entregue** (1.1, 1.2, 1.3, 2.1, 2.3 e 2.4): cada item abaixo traz um bloco
**Implementado** com o que mudou e o que ficou de fora. Dois achados apareceram no caminho
e estão no fim, em [Achados no caminho](#achados-no-caminho).

Validação da leva: `format:check`, `lint` e `build` limpos na API e no web, e **917 checagens
em 29 arquivos** de integração, todas verdes.

**Terceira leva entregue** (3.2, 4.2 e 6.1 a 6.12; o 6.13, backup fora do disco, ficou de fora e
está **adiado pelo dono**, registrado sem código). Cinco achados novos estão em [Achados no caminho](#achados-no-caminho) (D a H).
Validação: `format:check`, `lint` e `build` limpos na API e no web; **1014 checagens em 33
arquivos** de integração (eram 917 em 29); **113 testes unitários** do web em 11 arquivos (eram
55 em 5), com cobertura de 95,7%; `test:images` com 45 checagens e `test:smoke` com 100; os **91
cenários de tela**; `npm audit --audit-level=high` e o Trivy (seis imagens e os Dockerfiles) em
zero; `actionlint` nos workflows. Pacote principal do web: de 1.076 kB (383 kB no fio) para
268 kB (82 kB).

---

## ⏸ Onde paramos

Três levas entregues. A **primeira** (1.1, 1.2, 1.3, 2.1, 2.3, 2.4), a **segunda** (2.2 Vitest,
4.1 cabeçalhos do nginx e o Node 26 LTS) e a **terceira** (3.2, 4.2 e 6.1 a 6.12: endurecimento,
CI, desempenho e dependências). O que falta está abaixo, na ordem sugerida.

| Próximo | Item | Por que nesta ordem | Esforço |
|---|---|---|---|
| 1º | [3.1 Métricas Prometheus](#31-métricas-prometheus) | Vale com Grafana; o status por token (3.2) já cobre o básico | **M** |
| 2º | [5.3 Export MISP/TAXII](#53-exportar-indicadores-em-misptaxii) | Só se alguém for consumir | **M** |
| — | [6.13 Backup fora do disco](#613-cópia-do-backup-fora-do-disco-adiado) | **Adiado pelo dono:** é o maior risco que sobra (perder o disco perde dado e backup), mas não entra na ordem e não se começa sem ele pedir | **M** |
| — | CSS do Carbon seletivo (sobra do [6.10](#610-frontend-code-splitting-e-css)) | Exige um teste visual (capturas antes e depois) que o repositório não tem | **M** |
| — | TypeScript 7 (sobra do [6.12](#612-dependências-do-web-majors)) | Bloqueado: o `typescript-eslint` só aceita `<6.1.0`; rever quando ele aceitar | **P** |
| — | `cap_drop` e `no-new-privileges` em `db`, `minio` e `clamav` | Não foi tentado: são serviços com estado e precisam de teste próprio | **P–M** |

O **6.13 está registrado, não iniciado**: o desenho e os cuidados estão na seção dele, para
quando o dono do projeto decidir retomar. Nada foi codificado.

### Para retomar

```bash
# a terceira leva deixou tudo verde; confirme antes de mexer
cd apps/api && npm run format:check && npm run lint && npm run build
cd ../web   && npm run format:check && npm run lint && npm run build && npm run test:coverage
cd ../api   && npm run test:integration          # 1014 checagens em 33 arquivos
cd ../api   && npm run test:images && npm run test:smoke   # 45 e 100 checagens
cd ../..    && node scripts/check-playwright-version.mjs && node scripts/trivy.mjs image deeplook-api
```

### Armadilhas conhecidas (custaram tempo na primeira leva)

- **`prisma generate` antes de lint/build na API.** `apps/api/src/generated/` está no
  `.gitignore`; sem ele, ESLint e `tsc` não acham os tipos.
- **Fim de linha.** O repositório tem cerca de 144 arquivos com CRLF, porque o projeto é
  desenvolvido no Windows. O `.prettierrc.json` usa `endOfLine: "auto"` por causa disso —
  **não troque para `lf`** sem querer um diff de 144 arquivos.
- **`format:check` só cobre `apps/api` e `apps/web`.** O `README.md` e os `.md` de `docs/`
  nunca passaram pelo Prettier: está certo que acusem desvio se você rodar na raiz.
- **Node 26 LTS** no CI e nas imagens (`apps/api/Dockerfile` e `apps/web/Dockerfile`), a
  mesma da máquina de desenvolvimento. Cuidado: o `npm` 11 que vem com ele **não roda script
  de instalação de dependência** sem aprovação — no `npm ci` é só aviso, e o build não depende
  disso (Achado C, no fim).
- **Os testes de integração pedem só Docker** e sobem o que usam. `-- <filtro>` roda um
  arquivo só; `--clean` derruba os contêineres no fim.
- **O Vitest do web (`npm run test:unit`) não sobe nada.** É lógica pura, `environment: 'node'`,
  e os `*.test.ts` são type-checados pelo `build` (o `tsconfig` inclui `src`): erro de tipo no
  teste reprova o CI mesmo sem rodar o Vitest.
- **Vitest com DOM.** Os `*.test.tsx` declaram `// @vitest-environment jsdom` no topo; sem
  globais, cada um chama `cleanup()` e, quando o `ErrorBoundary` captura um erro de propósito,
  cancela o evento `error` da janela (senão o jsdom imprime a pilha de cada um).
- **Não corte a saída do `test:images` com `head`.** O SIGPIPE mata o teste no meio e deixa a
  rede `dl-test-capt-net` órfã: a rodada seguinte morre com "network already exists".
- **O `images.mjs` e o `smoke.mjs` leem o `web` do compose** (`tests/compose-service.mjs`):
  mudou o endurecimento do serviço no `docker-compose.yml`, o teste já o exercita. O navegador
  do smoke acessa por `localhost` (compartilhando a rede do container `web`) porque o
  Cross-Origin-Opener-Policy só vale em origem confiável.
- **O mock dos testes de tela é parte do contrato.** Campo novo numa tabela do web pede o dado
  no `scripts/ui-playwright/mock-api.mjs` e os índices de coluna do cenário (foi o `api-tokens`).
- **As imagens finais não têm `npm`.** `docker compose exec api npm ...` não existe mais; use
  `node`. O `prisma` do entrypoint roda por `node_modules/.bin/prisma`.
- **`add_header` num `location` descarta os do servidor; `expires` não.** Por isso o cache dos
  assets usa `expires` (item 6.7). Quem precisar de um `add_header` num `location` tem de
  repeti-los ali, e o `images.mjs` confere os cabeçalhos em `/`, num asset e num erro.
- **Exceções do Trivy têm justificativa e validade.** `trivy.yaml` (por arquivo ou pasta) e
  `.trivyignore` (por CVE, com `exp:`). Revise a do `gosu` ao trocar a versão do Postgres.
- **Os avisos de `if()` do Sass no build** vêm do próprio Carbon, não do projeto.
- **A suíte visual roda como o seu usuário** (`docker run --user $(id -u):$(id -g)`). Sem isso o
  container grava `node_modules`, `test-results` e baselines novas como root, e a rodada seguinte
  no host não consegue nem sobrescrever. E os argumentos vão por `"$@"`, não interpolados no
  `sh -c`: um `--grep 'histórico global'` interpelado vira dois argumentos e o Playwright responde
  "No tests found".

---

## 1. Correções e robustez

### 1.1 ErrorBoundary global no frontend
- **Problema:** não existe nenhum `ErrorBoundary` em `apps/web/src`. Uma exceção durante o
  render derruba a árvore inteira do React e o usuário fica com a **tela branca**, sem
  mensagem nem saída. Numa ferramenta que abre várias abas de documento ao mesmo tempo,
  perder a sessão de trabalho por causa de um campo inesperado de uma amostra é caro.
- **Proposta:** um componente de classe `ErrorBoundary` em
  `apps/web/src/components/ErrorBoundary.tsx`, no estilo HPSM (barra de mensagens de erro,
  sem modernizar), com o texto do erro, **Recarregar** e **Voltar ao início**. Envolve o
  `<App />` no `main.tsx`, por dentro dos provedores, para que o botão de voltar use o
  roteador. Um segundo boundary mais interno, por aba de documento, evita que o erro de uma
  aba derrube as outras.
- **Onde mexer:** `apps/web/src/components/ErrorBoundary.tsx` (novo),
  `apps/web/src/main.tsx`, `apps/web/src/styles/hpsm.scss`.

**Implementado.** `ErrorBoundary` é um componente de classe (só a classe tem
`getDerivedStateFromError`), em dois lugares:

- `variant="app"` no `main.tsx`, **por fora** de `AuthProvider` e `ConfirmProvider`: pega
  até a falha que acontece antes de existir sessão;
- `variant="page"` no `AppShell`, em volta do conteúdo, com `key={pathname}`: o topo, o
  navegador e as abas continuam de pé, e trocar de tela limpa o aviso sozinho.

O painel não usa hook de roteador nem componente do Carbon de propósito — um aviso de erro
que depende do que acabou de quebrar não aparece. Os botões são `<button>` com as classes
`cds--btn`, só para sair com a cara do HPSM; "Voltar ao início" usa `window.location`. O
círculo vermelho é o mesmo da barra de mensagens, para não inventar linguagem visual.
Traz "Detalhes técnicos" recolhido, com a pilha, para colar num relato.

`componentDidCatch` escreve no console: é o único erro inesperado que o `test:smoke`
deve pegar, e é exatamente quando a tela quebrou de verdade.

### 1.2 Health check de *readiness* real
- **Problema:** `GET /api/health` responde `{ status: 'ok' }` **sem consultar nada**
  (`apps/api/src/index.ts`). O `docker-compose.yml` usa justamente essa rota como
  `healthcheck` do serviço `api`, então o contêiner aparece como `healthy` mesmo com o
  Postgres ou o MinIO fora do ar — e o `depends_on: condition: service_healthy` do `web`
  libera o tráfego para uma API que não consegue responder nada de útil.
- **Proposta:** separar os dois papéis, como manda o padrão:
  - `GET /api/health` continua sendo **liveness** (o processo está de pé), sem tocar em
    dependência nenhuma;
  - `GET /api/health/ready` é a **readiness**: `SELECT 1` no Postgres e `HeadBucket` no
    MinIO, cada um com tempo-limite curto (2 s), devolvendo `200` com o detalhe de cada
    dependência ou `503` com quem falhou. Sem autenticação, porque o Docker consulta antes
    de existir sessão, e sem vazar endereço nem credencial — só o nome da dependência e
    `ok`/`erro`.
  - o `healthcheck` do compose passa a apontar para a readiness.
- **Cuidado:** o `start_period` de 120 s precisa continuar grande, porque as migrações e o
  seed rodam no boot.
- **Onde mexer:** `apps/api/src/routes/health.ts` (novo), `apps/api/src/index.ts`,
  `docker-compose.yml`.

**Implementado.** `apps/api/src/routes/health.ts` com as duas rotas, e a rota inline do
`index.ts` saiu. O `healthcheck` do compose aponta para a readiness; o `start_period` de
120 s continua, porque as migrações e o seed rodam no boot.

Decisões que fogem do plano original:

- **A resposta não diz o motivo da falha.** A rota é pública (o Docker consulta antes de
  existir sessão) e a mensagem do driver carrega endereço e, às vezes, usuário do banco. A
  resposta traz só `{ name, ok }` por dependência; o motivo vai para o log da API, e o
  detalhe completo continua em Administração > Status. Um teste garante que endereço,
  porta e credencial não aparecem no corpo.
- **Cache de 1 s.** A rota é pública e consulta banco e MinIO: sem isso, uma enxurrada de
  sondas vira uma enxurrada de consultas. O `interval: 15s` do compose nem percebe.
- `apps/api/tests/images.mjs` e `apps/api/tests/smoke.mjs` passaram a sondar a readiness,
  já que os dois sobem Postgres e MinIO de verdade — o de imagens até chama a checagem de
  "healthcheck do compose", então tem de ser a mesma rota.

**Coberto por** `apps/api/tests/integration/health.test.ts` (11 checagens): liveness,
readiness com tudo no ar, o 503 com o MinIO fora (banco `ok`, armazenamento não), o motivo
ausente da resposta e duas sondas seguidas.

### 1.3 Logger estruturado nos jobs de fundo
- **Problema:** 25 chamadas de `console.log`/`warn`/`error` em `seed.ts`, `env.ts`,
  `lib/s3.ts`, `lib/sandbox.ts`, `lib/ldap.ts`, `lib/retention.ts`, `lib/backup.ts` e
  `lib/lookalike.ts`. O resto da API usa o Pino do Fastify, com serializer próprio
  (`lib/request-log.ts`) que tira a query string dos caminhos. Essas linhas soltas saem em
  texto puro, fora do JSON, e um agregador de logs não as correlaciona.
- **Proposta:** passar o `FastifyBaseLogger` para quem já é chamado depois do boot
  (`ensureBucket`, reaper do sandbox, retenção, backup, lookalike) e manter `console` só
  onde o logger ainda não existe: `env.ts` (validação antes de o app subir) e `seed.ts`
  (script separado, rodado pelo `npm run seed`).
- **Onde mexer:** os arquivos citados em `apps/api/src/lib/` e `apps/api/src/index.ts`.

**Implementado** com `apps/api/src/lib/log.ts`: um logger de módulo, registrado uma vez no
boot (`setLogger(app.log)`), com a assinatura do Pino (`log.warn('texto')` ou
`log.warn({ err }, 'texto')`). Passar o logger por parâmetro exigiria mudar a assinatura de
funções que ninguém mais chama com ele (`purgeExpiredFiles`, `reapExpired`,
`scanLookalikesQuietly`); o módulo resolve sem espalhar o parâmetro.

Sem logger — `npm run seed`, um script, um teste de integração — a mensagem cai no console,
para não se perder. `resetLogger()` existe para o teste não vazar logger entre arquivos.

Trocados em `lib/s3.ts` (4), `lib/sandbox.ts` (6), `lib/retention.ts`, `lib/backup.ts`,
`lib/ldap.ts` e `lib/lookalike.ts`. **Continuam no console, de propósito:** `env.ts` (roda
antes de o app existir), `seed.ts` (script separado) e o `catch` final do `index.ts` (ali o
Fastify pode nem ter chegado a existir) — este último agora com um comentário dizendo isso.

---

## 2. Automação e qualidade

### 2.1 CI (GitHub Actions)
- **Problema:** não há `.github/workflows`. Existem 28 arquivos de teste de integração
  muito bons (`apps/api/tests/integration`), que sobem Postgres, MinIO e OpenLDAP de
  verdade, mas só rodam quando alguém lembra de rodar na mão.
- **Proposta:** um workflow com dois jobs:
  - **`lint`** — `npm ci`, `npm run lint` e `npm run build` (que já roda `tsc` com
    `noUnusedLocals`) nos três apps, em paralelo por matriz;
  - **`integration`** — `npm run test:integration` na API. O runner do GitHub tem Docker,
    que é tudo de que o `tests/run.mjs` precisa; o `--clean` derruba os contêineres no fim.
  - Dispara em `push` na `main` e em `pull_request`. Cache de `~/.npm` pela chave do
    lockfile.
- **Onde mexer:** `.github/workflows/ci.yml` (novo).

**Implementado** em `.github/workflows/ci.yml`, com quatro jobs: `check` (matriz de `api` e
`web`: `format:check`, `lint` e `build`), `capture` (testes do proxy de saída),
`integration` (a suíte da API) e `audit` (item 2.3). Dispara em `push` na `main`, em
`pull_request` e pela aba Actions; um push novo cancela a rodada anterior do mesmo ramo.

Detalhes que custaram para acertar:

- **`prisma generate` antes de tudo, na API.** `apps/api/src/generated/` está no
  `.gitignore`: sem o passo, nem o ESLint nem o `tsc` encontram os tipos.
- **`npm ci --ignore-scripts` no capture.** O teste do proxy não abre navegador, e não vale
  baixar os ~400 MB do Chromium do Playwright.
- **Node 22** na época, a mesma versão das imagens (depois a leva do item 2.2 subiu as duas
  pontas, imagens e CI, para o Node 26 LTS da máquina de desenvolvimento).
- **`--clean`** nos testes de integração, para derrubar Postgres, MinIO e OpenLDAP no fim.

Todos os passos foram rodados localmente antes de confiar no arquivo, e os dois YAML foram
conferidos num parser de verdade.

### 2.2 Testes unitários no frontend
- **Problema:** o frontend só tem verificação visual com Playwright (`scripts/ui-playwright`)
  e o smoke com navegador. Não há teste unitário: o `package.json` do web não tem Vitest nem
  Testing Library. Lógica pura e cheia de casos de borda fica descoberta —
  `components/decoder.ts`, `notifications.ts`, `sha256.ts`, `textDiff.ts`, `iocs.ts`,
  `cases.ts`, `useEntryListState.ts`.
- **Proposta:** Vitest com `environment: 'node'` para os módulos puros (barato, sem DOM) e
  `@testing-library/react` só onde o componente tiver lógica de verdade. Começar pelos
  decodificadores e pelo diff, que são os de regra mais densa, e ligar no job de `lint` do CI.
- **Onde mexer:** `apps/web/package.json`, `apps/web/vitest.config.ts` (novo),
  `apps/web/src/**/*.test.ts` (novos).

**Levantamento já feito** (para não refazer):

| Módulo | Linhas | Por que vale |
|---|---|---|
| `src/components/decoder.ts` | 225 | Base64, hex, URL, ROT13: o de regra mais densa |
| `src/components/notifications.ts` | 151 | Rotula e agrupa aviso por tipo |
| `src/components/iocs.ts` | 69 | Monta a chave do indicador (par do `lib/ioc-normalize.ts` da API) |
| `src/components/sha256.ts` | 66 | Hash no navegador, com casos de borda de buffer |
| `src/components/textDiff.ts` | 66 | Diff das revisões de relatório |

Como ligar no CI: o job `check` do `.github/workflows/ci.yml` já roda `lint` e `build` na
matriz `api`/`web`; basta um passo `npm run test:unit` com `if: matrix.app == 'web'`, no
mesmo molde do passo de `prisma:generate`, que já usa `if: matrix.app == 'api'`.

**Implementado.** `apps/web/vitest.config.ts` com `environment: 'node'` (lógica pura, sem DOM)
e `include: ['src/**/*.test.ts']`; ele faz `mergeConfig` com o `vite.config.ts` só para herdar
o plugin do React e o alias `~`, porque `notifications.ts` puxa `tags.tsx` (JSX). **Sem
globais:** cada teste importa `describe/it/expect` de `vitest`, então nem o ESLint nem o
`tsconfig` precisaram mudar. Dois scripts novos no `package.json` (`test:unit` = `vitest run`,
`test:watch` = `vitest`) e o passo "Testes unitários (Vitest)" com `if: matrix.app == 'web'` no
job `check`.

Os cinco módulos do levantamento viraram **55 checagens**: `decoder.test.ts` (cada passo, o
encadeamento, o teto de 1 MB, o índice do erro e um gzip de ida e volta pela Web Streams),
`textDiff.test.ts` (inserção, remoção, troca e CRLF igual a LF), `sha256.test.ts` (os vetores do
FIPS 180-4 e o cruzamento com a Web Crypto nas bordas do padding e em vários blocos),
`iocs.test.ts` (tipo, rótulo, a chave SHA-256 da URL e o reconhecimento) e `notifications.test.ts`
(frase, citação, alvo e destino, com `actor` null caindo em "O sistema"). Rodam em ~300 ms.

Um detalhe que vale lembrar: o `build` do web é `tsc --noEmit && vite build` e o `tsconfig`
inclui `src`, então os `*.test.ts` são **type-checados no build** — um erro de tipo no teste já
reprova, antes mesmo do Vitest. Os testes não entram no pacote, porque o `vite build` só
empacota o que a `index.html` alcança.

### 2.3 Atualização de dependências e `npm audit`
- **Problema:** a troca do MinIO pelo `pgsty/silo` (CVE-2026-40344 e CVE-2026-41145) foi
  reativa, feita durante uma rodada do Strix. Nada avisa da próxima.
- **Proposta:** Dependabot semanal para os três `package.json` e para as imagens do
  `docker-compose.yml`/Dockerfiles, agrupando patches, mais um passo de
  `npm audit --audit-level=high` no CI que reprova em vulnerabilidade alta.
- **Onde mexer:** `.github/dependabot.yml` (novo), `.github/workflows/ci.yml`.

**Implementado.** `.github/dependabot.yml` cobre os três `package.json` (semanal, com
`minor` e `patch` agrupados num PR só), as imagens base dos três Dockerfiles e as ações do
próprio CI (mensal). O major do Prisma fica de fora do automático, porque cliente, adapter
e CLI sobem juntos ou o build quebra.

O job `audit` roda `npm audit --audit-level=high` nos três apps. **Hoje passa:** há 27
vulnerabilidades moderadas, todas na cadeia do ESLint (via `minimatch`), nenhuma em
dependência de runtime e nenhuma alta ou crítica.

### 2.4 Limpeza: `infra/nginx/` vazio
- **Problema:** `infra/nginx/` existe e está vazio; a configuração real do nginx mora em
  `apps/web/nginx.conf`, copiada pelo `apps/web/Dockerfile`. Quem procura a configuração
  perde tempo no lugar errado.
- **Proposta:** remover a pasta e conferir se o README não aponta para ela.
- **Onde mexer:** `infra/`, `README.md`.

**Implementado.** A pasta nem era versionada (`git ls-files infra` não devolvia nada): era
resíduo local, e some sem diff. De quebra, a árvore de "Estrutura do projeto" do README
estava desatualizada e passou a mostrar `apps/capture/`, `apps/api/rules/`,
`apps/api/tests/`, `icons/`, `.github/` e `data/clamav/`, com uma nota de que o
`apps/web/nginx.conf` é a configuração real.

---

## 3. Observabilidade e operação

### 3.1 Métricas Prometheus
- **Proposta:** `GET /metrics` no formato texto do Prometheus, protegido por token ou preso
  à rede interna, com: amostras enviadas, varreduras de antivírus e YARA (resultado e
  duração), tamanho das filas, latência das rotas e os números que o `lib/status.ts` já
  calcula. Num homelab com Grafana, é o que falta para ter gráfico sem abrir a tela de admin.
- **Cuidado:** nada de rótulo com hash, URL ou nome de usuário — vira cardinalidade infinita
  e vaza indicador para o painel.
- **Ponto de partida:** `systemStatus()` (`lib/status.ts:537`) já reúne quase tudo; falta
  contador e histograma por rota, que o Fastify entrega com um hook `onResponse`.

### 3.2 Status do sistema legível por máquina
- **Problema:** o `lib/status.ts` já checa API, banco, MinIO, ClamAV, LDAP, Proxmox,
  reputação e filas, mas o resultado só aparece em Administração > Status.
- **Proposta:** expor o mesmo objeto como JSON numa rota de admin, para que um monitor
  externo (Uptime Kuma, Zabbix) leia sem raspar HTML.
- **Ponto de partida:** `GET /api/admin/status` (`routes/admin.ts:133`) já devolve o
  `systemStatus()` para a tela — na prática o item é deixar um **token de API** de admin
  alcançar essa rota, em vez de só a sessão do navegador. Hoje token não chega à
  administração (403), então vale decidir entre abrir uma exceção de leitura ou criar uma
  rota própria.
- **Não confundir com o 1.2:** a readiness é pública e só diz `ok`/`não`; esta é
  autenticada e traz o detalhe (endereços, versões, latências).
- **Decidido** (o item entra na terceira leva): **rota própria somente de leitura**, com um
  token de escopo `status:read`, e não uma exceção que abra `/api/admin` para tokens. Só
  admin cria esse token, e ele não alcança nenhuma outra rota.

**Implementado.** O token ganhou um **escopo** (`ApiTokenScope`: `SAMPLES` e `STATUS`, migração
`20261220000000_api_token_scope`; os tokens que já existiam ficam `SAMPLES`). Em
`lib/api-tokens.ts`, `ALLOWED_ROUTES` continua sendo só a lista das amostras (é a que a
especificação OpenAPI espelha) e `STATUS_ROUTES` é a do monitor; `scopesFor(rota)` junta as duas.
Detalhes que importam:

- A conferência do escopo vem **depois** de provar que o token é válido: quem erra o token recebe
  401 e não descobre os escopos. O token de status exige que o dono **ainda seja ADMIN** a cada
  uso (rebaixado, para de valer na hora).
- `GET /api/status` (`routes/status.ts`) devolve o `systemStatus()` para a sessão de um admin ou
  para um token de status. `?strict=1` responde **503** quando a situação geral é `error`, para
  monitor que só olha o código HTTP. A resposta sai com `Cache-Control: no-store`, e o servidor
  guarda o resultado por **10 s** (uma verificação por vez, e a falha não é guardada): um monitor
  insistente não vira uma enxurrada de consultas ao banco, ao MinIO, ao ClamAV e ao LDAP.
- Só **admin cria** esse token (403 para os demais, e a regra do "Acesso por API" continua); a
  auditoria da criação diz o escopo; a tela de tokens ganhou a coluna e o seletor *Finalidade*
  (este só aparece para admin). A aba Tokens de API da Administração também mostra o escopo.
- Ficou **fora** da especificação OpenAPI de propósito: ela é a de quem integra amostras.

**Coberto por** `status-token.test.ts` (33 checagens): quem cria; o que cada escopo alcança nos
dois sentidos; sem credencial, token desconhecido, vencido e revogado; dono rebaixado e
promovido de novo; cache; `?strict=1` com o MinIO fora (503) e de volta (200). **Prova de dentes:**
com as duas travas removidas, um token de status passou a ler amostras e o teste reprovou nos
quatro casos. No web, o cenário `api-tokens` cobre o seletor e o `scope` no POST.

---

## 4. Segurança

### 4.1 Afinar os cabeçalhos do nginx
- **Estado:** `apps/web/nginx.conf` já manda `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Strict-Transport-Security` e uma CSP fechada (`object-src 'none'`,
  `base-uri 'self'`, sem `unsafe-inline` em script).
- **Falta:** `Permissions-Policy` (desligar câmera, microfone, geolocalização e
  pagamento, que o app não usa), `server_tokens off` (a versão do nginx aparece no
  cabeçalho `Server` e no corpo das páginas de erro) e `includeSubDomains` no HSTS.
- **Cuidado:** `preload` no HSTS, não — é um compromisso difícil de desfazer e o domínio é
  de homelab.
- **Onde mexer:** `apps/web/nginx.conf`, logo abaixo do bloco "Headers de segurança
  (item 115)" — os quatro `add_header` já estão juntos ali.
- **Lembre:** cada `add_header` novo precisa do `always`, igual aos de hoje, senão não sai
  nas respostas de erro. E `add_header` em um `location` **substitui** os do servidor: se
  algum bloco ganhar um `add_header` próprio, os de cima somem dali.

**Implementado** em `apps/web/nginx.conf`, no bloco de "Headers de segurança": `server_tokens
off;` (tira a versão do nginx do cabeçalho `Server` e das páginas de erro), o `Permissions-Policy`
desligando câmera, microfone, geolocalização e pagamento, e o `includeSubDomains` no HSTS —
**sem `preload`**, de propósito. Todos com `always`. Conferido que nenhum `location`
(`/api/sandbox`, `/api/`, `/`) tem `add_header` próprio, então os do servidor valem para todas
as respostas; se algum ganhar um no futuro, estes precisam ser repetidos lá.

### 4.2 Conferência de integridade no download
- **Proposta:** ao servir o arquivo de uma amostra (e ao restaurar um backup), recalcular o
  SHA-256 e comparar com o que está gravado na linha da amostra, registrando divergência na
  Auditoria. Pega corrupção silenciosa do armazenamento e adulteração do bucket por fora da
  API.
- **Cuidado:** só vale com streaming e para arquivo abaixo de um teto, senão um download de
  200 MB paga o hash duas vezes.
- **Onde mexer:** `GET /api/entries/:id/download` (`routes/entries.ts:1566`) e o caminho de
  restauração em `lib/backup.ts`.
- **Decidido** (o item entra na terceira leva): o download é *streaming*, então o hash só
  fecha depois de os bytes saírem — "recusar na divergência" exigiria ler duas vezes e tiraria
  do analista a única cópia que resta. O desenho: **calcular durante o stream** (sem teto de
  tamanho: custa CPU, não leitura), **entregar**, e na divergência **registrar na Auditoria e
  marcar a amostra**, para a ficha avisar e os downloads seguintes saírem com um cabeçalho de
  alerta. Download abortado no meio não tem veredito e não marca nada. Um **job periódico de
  "scrub"** relê as amostras e confere o SHA-256 em segundo plano, no molde dos jobs de
  retenção e backup, e pega corrupção sem pesar no download.

**Implementado.** `lib/integrity.ts` e `lib/integrity-scrub.ts`; colunas `integrityCheckedAt` e
`integrityFailedAt` em `Entry` e duas ações de auditoria (migração `20261219000000_entry_integrity`).

- **Download:** um `Transform` calcula o SHA-256 e o tamanho enquanto os bytes passam
  (`stream.pipeline`, que também fecha a leitura do MinIO se o cliente desistir). O `flush` só
  roda se o fluxo terminou **inteiro**: download abortado não tem veredito e não marca nada. O fim
  do fluxo espera o registro, então quem recebeu o último byte já encontra o resultado gravado. O
  `Content-Length` passou a ser o do **objeto** (e não o da ficha): se divergirem, o corpo segue
  bem formado e a divergência aparece na conferência. Sem hash gravado, não há o que comparar.
- **Divergência:** entrega o arquivo mesmo assim, marca a amostra, audita
  (`ENTRY_INTEGRITY_FAILED`, com os dois hashes e o tamanho) e a ficha mostra um aviso vermelho
  e o campo **Integridade**; os downloads seguintes saem com `X-DeepLook-Integrity: mismatch`.
- **Transições atômicas:** a marca é um `UPDATE` condicional (`integrityFailedAt IS NULL`), então
  duas conferências ao mesmo tempo não auditam duas vezes, e conferir de novo o mesmo arquivo
  estragado só renova a data da leitura. Voltando a conferir, a marca sai e a auditoria registra
  `ENTRY_INTEGRITY_RESTORED`.
- **Scrub** (`INTEGRITY_SCRUB_INTERVAL_MINUTES`, padrão 60, `0` desliga; `INTEGRITY_SCRUB_MAX_MB`,
  padrão 512 por rodada): nunca conferidas primeiro, depois as conferidas há mais tempo. O
  orçamento barra a **próxima**, nunca a primeira (um arquivo maior que ele ainda é conferido,
  sozinho). Objeto **ausente** (404) também marca; falha de leitura não marca ninguém e a rodada
  desiste depois de três seguidas. Expurgadas, na lixeira, sem hash e links ficam de fora.
- **Status:** a verificação *Integridade dos arquivos* fica **laranja** (e não vermelha: pede
  atenção, mas o serviço segue de pé) e, por ela, a divergência chega ao monitor do 3.2.

**Coberto por** `integrity.test.ts` e `integrity-scrub.test.ts` (28 cada): o ciclo completo com
upload real, divergência entregue e marcada, sem spam de auditoria, truncado, recuperação, sem
hash, **download abortado**, ausente, orçamento, ordem, MinIO fora e rodadas concorrentes.
**Prova de dentes:** com o `judge` sempre aprovando, 9 checagens reprovaram.

---

## 5. Funcionalidades

### 5.1 Notificações por e-mail (SMTP) — 🚫 fora de escopo
Era o único item do Roadmap do README (e o item 79 do backlog de UX, adiado por não haver
SMTP). Fica registrado: a aba Notificações de Minha Conta já tem a estrutura de preferências
por tipo de aviso que o envio por e-mail usaria.

### 5.2 Webhooks de saída — 🚫 fora de escopo
Avisar um canal de chat ou um SIEM quando uma amostra recebe veredito malicioso ou quando um
indicador vigiado dispara.

### 5.3 Exportar indicadores em MISP/TAXII
- **Problema:** a importação já lê CSV e STIX (`lib/ioc-import.ts`), e a exportação
  (`lib/ioc-export.ts`) sai em formatos próprios. Falta o caminho de volta para quem usa MISP.
- **Proposta:** exportar um evento MISP (JSON) a partir de um caso ou de uma busca de
  indicadores, reaproveitando a normalização que o item 165 já fez.

---

## 6. Terceira leva: endurecimento, CI, desempenho e dependências

Levantamento feito depois da segunda leva, com evidência de execução e não só de leitura:
requisições reais ao nginx (cabeçalhos, gzip, cache), `npm outdated` nos três apps e os
scripts `test:images` e `test:smoke` rodados contra as imagens do Node 26. Entram também o
**3.2** e o **4.2**, com o desenho decidido nas suas seções. O item 6.13 (backup fora do
disco) **foi adiado pelo dono**: fica registrado com o desenho, sem código e fora da ordem.

**Ordem de execução** — cada fase termina validada antes da seguinte:

| Fase | Itens | Validação ao fim |
|---|---|---|
| A. Correções pequenas e fiação | 6.1, 6.2, 6.3, 6.6 | `build` e `lint` da API, `test:images` |
| B. Web e nginx | 6.5, 6.7 | `test:images` e `test:smoke` |
| C. CI | 6.8, 6.4 | `actionlint` e o Trivy rodado de verdade, local |
| D. Testes e frontend | 6.9, 6.10 | `test:unit`, `build` e `test:smoke` |
| E. API | 4.2, 3.2 | suíte de integração, com arquivos novos |
| F. Dependências | 6.11, 6.12 | uma major por vez: suíte inteira e smoke |

### 6.1 Correções pequenas
- **Problema:** `apps/api/.dockerignore` tem `*.log` e `src/generated` colados numa linha
  (`*.logsrc/generated`), então nenhum dos dois é ignorado no build. O `@types/node` da API
  está em `^22.9.0` com o runtime no Node 26. E `apps/api/tests/images.mjs` ainda sobe o eco
  que faz as vezes da API com `node:22-slim`: resíduo da troca de Node, que o levantamento
  daquela leva não pegou porque só olhou Dockerfile, yml e md.
- **Proposta:** separar as linhas do `.dockerignore`; subir `@types/node` para `^26` (e o
  `target`/`lib` do `tsconfig`, se o `tsc` pedir); trocar o eco para `node:26-slim`.
- **Validação:** `build` e `lint` da API, `test:images`.

**Implementado.** O `.dockerignore` da API separou `*.log` de `src/generated` (e passou a ignorar
`tests`, onde as imagens de disco dos testes ficam em `.tmp`). O `@types/node` subiu para `^26` e
**revelou um erro de tipo real** em `lib/clamav.ts` (o evento `data` do socket admite `string`
nos tipos novos); o `target` ES2022 não precisou mudar. O `images.mjs` passou a usar `node:26-slim`.

### 6.2 Versão do Playwright em lockstep
- **Problema:** a versão aparece em `apps/capture/package.json` (exata), no `FROM` de
  `apps/capture/Dockerfile`, em `apps/api/tests/smoke.mjs` e duas vezes em
  `scripts/ui-playwright/run.ps1`. O Dependabot abre PRs separados para o npm e para a imagem,
  e o job `capture` do CI não abre navegador: um PR mesclado sozinho quebraria a captura sem
  o CI perceber.
- **Proposta:** `scripts/check-playwright-version.mjs`, que falha se os lugares divergirem, num
  passo do CI; o Dependabot passa a ignorar `playwright` (npm) e `mcr.microsoft.com/playwright`
  (docker), e a troca se faz à mão, nos lugares juntos, com o script de rede de segurança.
- **Validação:** o script passa no estado atual e reprova quando se muda um dos lugares.

**Implementado.** `scripts/check-playwright-version.mjs` confere os **cinco** lugares (pacote,
imagem da captura, `smoke.mjs` e duas vezes no `run.ps1`) e falha também se um padrão deixar de
casar (uma reescrita não desliga a conferência em silêncio). Roda como primeiro passo do job
`capture`. O Dependabot passou a ignorar o `playwright` (npm) e `mcr.microsoft.com/playwright`
(docker). Testado com os três jeitos de reprovar: versão diferente, padrão sumido e arquivo ausente.

### 6.3 Dependabot e a major do Node
- **Problema:** quando sair o Node 27 (Current, sem LTS), o ecossistema `docker` vai propor
  `node:27-slim`.
- **Proposta:** `ignore` de `version-update:semver-major` para `node`; a troca para o próximo
  LTS é manual e deliberada.

**Implementado.** `ignore` de `version-update:semver-major` para `node` no Dependabot. As tags são
flutuantes (`26-slim`), então o patch vem a cada rebuild; o Trivy semanal avisa de base velha.

### 6.4 Varredura semanal de CVE nas imagens (Trivy)
- **Problema:** o item 2.3 nasceu de um CVE do MinIO descoberto por acaso. O `dependabot.yml`
  só olha npm, os Dockerfiles e as ações: `postgres`, `clamav` e o `minio` do compose (por
  `${MINIO_IMAGE:-pgsty/silo@sha256:…}`, com variável) ficam de fora, e nada avisa de CVE
  novo nas imagens já construídas.
- **Proposta:** `.github/workflows/security-scan.yml`, semanal, manual e em PR que toque
  Dockerfile ou compose: constrói as três imagens do projeto e varre também o que
  `docker compose config --images` lista de terceiros, com **Trivy rodado pela imagem
  oficial** (sem ação de terceiros, e o mesmo comando roda local). Reprova em
  HIGH/CRITICAL **com correção disponível**; o que for risco aceito vai para o
  `.trivyignore`, cada linha com a justificativa.
- **Validação:** o mesmo comando rodado aqui, contra as seis imagens.

**Implementado**, com o scan local antes e depois em cada decisão:

| Imagem | Antes | Depois |
|---|---|---|
| `web` (`nginx:1.27-alpine`) | **62** achados altos/críticos com correção | **0** |
| `api` e `capture` | 6 cada (`undici` e `brace-expansion`) | **0** |
| `postgres:16-alpine` | 26 (todos no `gosu`) | 0, com exceção justificada |
| `minio` (`pgsty/silo`) e `clamav` | 0 | 0 |

Os 6 da API e do capture estavam **no `npm` embutido na imagem**, não em dependência do projeto,
e o runtime só executa `node`: o `npm` saiu das imagens finais. Os 26 do Postgres são todos o
`gosu`, que roda uma vez no boot só para largar o root. `.github/workflows/security-scan.yml`
(semanal, manual e em PR que mexa em Dockerfile ou compose) varre as três imagens do projeto,
as de terceiros do compose (a lista vem de `docker compose config --images`) e os Dockerfiles. O
Trivy roda pela **imagem oficial**, sem ação de terceiros, pelo `scripts/trivy.mjs`: o mesmo
comando no CI e na máquina. Reprova só em severidade alta ou crítica **com correção**
(`trivy.yaml`). Duas exceções, ambas justificadas no arquivo e **estreitas**: o `gosu`, e
`/root/.npm`, onde a imagem base do Playwright (Microsoft) traz um link assinado (SAS) do feed
dela que o scanner de segredos acusa. **Provas:** a `nginx:1.27-alpine` reprova (62), e uma chave
privada fora de `/root/.npm` também; o banco de vulnerabilidades baixa do espelho do ECR (o
`ghcr.io` limita as consultas anônimas dos runners).

### 6.5 `web` sem root e compose endurecido
- **Problema:** o `web` é a porta de entrada (atrás do Cloudflare Tunnel) e o menos
  endurecido: o master do nginx roda como root e não há `cap_drop`, `no-new-privileges`,
  `read_only`, limite de memória nem healthcheck. A API e o capture já têm os dois primeiros.
- **Proposta:** `nginxinc/nginx-unprivileged` (porta 8080, usuário 101), `read_only` com
  `tmpfs` em `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit`, `pids_limit` e
  healthcheck. A porta publicada no host continua `127.0.0.1:8080`, então o `cloudflared` não
  muda. `images.mjs` e `smoke.mjs` passam a usar a 8080 interna, e `images.mjs` ganha as
  checagens de "sem root e sem capacidades" que a API já tem.
- **Validação:** `test:images` e `test:smoke`, mais `docker compose config`.

**Implementado.** Base `nginxinc/nginx-unprivileged:1.29-alpine-slim` (a variante `-slim` não
traz os módulos xslt, image-filter e geoip, nem libxml2, libtiff e libpng) com `apk upgrade` na
montagem; porta interna 8080 (o host segue publicando `127.0.0.1:8080`, então o `cloudflared`
não muda). No compose, o `web` ganhou `read_only` (com `tmpfs` em `/tmp`), `cap_drop: ALL`,
`no-new-privileges`, `mem_limit` (`WEB_MEM_LIMIT`, 256m), `pids_limit` e healthcheck.
`tests/compose-service.mjs` lê o serviço **do compose** e monta os flags do `docker run`, e o
`images.mjs` e o `smoke.mjs` rodam o `web` com eles: o teste exercita o que vai para produção, e
confere uid sem root, sem capacidades, somente leitura e healthcheck saudável.

### 6.6 Rotação dos logs do Docker
- **Problema:** o compose não tem `logging:`; o `json-file` do Docker não tem limite se o
  `daemon.json` do host não definir um, e o disco do homelab é o mesmo dos dados.
- **Proposta:** um bloco `x-logging` com `max-size` e `max-file`, aplicado a todos os
  serviços, com as duas medidas ajustáveis por `.env`.

**Implementado.** Bloco `x-logging` (`json-file`, `LOG_MAX_SIZE` 10m e `LOG_MAX_FILE` 3, ajustáveis
por `.env`) aplicado aos seis serviços; conferido com `docker compose config`.

### 6.7 nginx: cache dos assets, 404 de asset e COOP/CORP
- **Problema:** conferido com requisição real: `/assets/*` sai sem `Cache-Control` (só ETag),
  então todo carregamento revalida cada arquivo, e um asset que não existe cai no fallback da
  SPA e responde `index.html` com 200 (o cliente com a página velha recebe HTML no lugar do
  JS). Faltam também `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy`.
- **Proposta:** `location /assets/` com `expires 1y` e `try_files $uri =404`; o resto com
  `expires -1` (o `index.html` sempre revalidado); os dois cabeçalhos `same-origin` no nível do
  servidor. **Usa `expires`, e não `add_header`, de propósito:** `add_header` dentro de um
  `location` descarta todos os do servidor (a armadilha do 4.1); `expires` não.
- **Validação:** `images.mjs` confere os cabeçalhos de segurança e o cache em `/`, em
  `/assets/…` e numa resposta de erro; `test:smoke` cobre o console noVNC.

**Implementado.** `location /assets/` com `expires 1y` e `try_files $uri =404`; o resto com
`expires -1`. Os dois cabeçalhos `same-origin` no servidor. Conferido: um `expires` **não**
derruba os cabeçalhos de segurança do servidor (o `images.mjs` os confere em `/`, num asset e
num 404). De quebra, **medido** com o `dist` novo: o nginx comprimia no nível 1 (o padrão) e não
mandava `Vary`; com `gzip_comp_level 6` e `gzip_vary on`, o JS principal caiu de 96,9 para
82,4 kB (-15%) e o CSS de 168,6 para 117,6 kB (-30%).

O `images.mjs` ganhou 13 checagens do `web` (cabeçalhos, `Server` sem versão, cache, gzip, `Vary`,
404 de asset, rota da SPA, uid, capacidades, somente leitura e healthcheck). **O smoke achou algo
real:** com o COOP, o Chrome escreve um aviso no console quando a origem é HTTP em outro nome que
não `localhost`, e o smoke reprova qualquer mensagem de console (58 falhas, uma causa só). No
deploy isso não acontece (a porta só é publicada em `127.0.0.1` e o Tunnel entrega HTTPS), então
o navegador do smoke passou a acessar por `localhost`, compartilhando a rede do container `web`.

### 6.8 CI roda `test:images` e `test:smoke`
- **Problema:** os dois scripts existem e testam exatamente o que o bump do Node e os PRs do
  Dependabot mexem, mas só rodam à mão. Hoje um PR que muda `node`, `nginx` ou `playwright`
  passa no CI sem a imagem ser construída.
- **Proposta:** job `images` em todo push e PR; job `smoke` só fora de PR (`main` e manual),
  porque puxa a imagem do Playwright (3,6 GB). O passo de lockstep do 6.2 entra no job `capture`.

**Implementado.** `ci.yml` ganhou o job `images` (todo push e PR) e o `smoke` (só fora de PR, porque
puxa a imagem do Playwright de 3,6 GB); o passo do lockstep do Playwright entrou no `capture`.
Validado com o **actionlint** (o linter oficial de workflows) e rodando aqui os mesmos scripts.

### 6.9 Vitest: mais cobertura onde há risco
- **Proposta, em ordem de valor:** `api/client.ts` (`request` e `parseResponse`: página HTML
  de 502, falha de rede, 204, erro JSON), com `fetch` simulado; `cases.ts`; o hook de
  `useEntryListState.ts`; o `ErrorBoundary` com Testing Library e jsdom; e
  `@vitest/coverage-v8` com piso nos módulos testados. Os 55 testes atuais não protegem
  componente React, e o 6.12 vai mexer no React.

**Implementado.** Dependências novas: Testing Library, jsdom e `@vitest/coverage-v8`. **113
checagens em 11 arquivos** (eram 55 em 5): `api/client.ts` (resposta, erros da API, 502 em HTML,
falha de rede, `AbortError`, o que vai na requisição e o `upload`), `cases.ts`, `lazyPage`, os
hooks do sininho (`notifications.ts`), o hook `useEntryListState` (a URL como estado, com
debounce) e o `ErrorBoundary` (inclusive a troca de `key` do AppShell). Cobertura dos módulos
listados: 95,7% das instruções, 88,7% dos ramos, 97,7% das funções. O **piso** (92/84/92/91) fica
~3 pontos abaixo, e reprova de verdade (testado com um piso de 99%). O CI roda `test:coverage`.

### 6.10 Frontend: code splitting e CSS
- **Problema:** não há nenhum `lazy()`, o bundle é um chunk só de 1,08 MB (383 kB no fio) e o
  `@novnc/novnc` é importado direto em `SandboxConsole.tsx`: todo mundo baixa o noVNC mesmo
  com `SANDBOX_ENABLED=false`, que é o padrão. O CSS tem 1,04 MB (169 kB no fio).
- **Proposta:** `React.lazy` nas rotas e `import()` do noVNC; medir antes e depois. O CSS
  do Carbon seletivo só entra se der para provar que a tela não mudou.

**Implementado (o JS).** `React.lazy` em 29 páginas (`components/lazyPage.ts` mantém o tipo das
props); só login, cadastro, página inicial e troca de senha forçada ficam no pacote principal. O
`Suspense` fica **dentro** do `ErrorBoundary` do AppShell (topo, navegador e abas ficam de pé) e
outro cobre as telas sem casca (impressão e janela do console). O noVNC virou um chunk próprio,
baixado só quando a janela do console abre. Pacote principal: **1.076 kB (383 kB no fio) →
268 kB (82 kB)**, já contando o Vite 8 do 6.12. Se o pacote de uma página não baixa (deploy novo
com a aba aberta), o erro vai para o `ErrorBoundary`, que oferece "Recarregar a página"; o 404 de
asset do 6.7 torna isso explícito. **Ficou de fora, de propósito:** o CSS do Carbon seletivo. O
app usa 18 componentes e 29 classes `cds--*` diretas, então dá para fazer, mas provar que
**nenhuma tela mudou** pede uma comparação de capturas que o repositório não tem; o plano
condicionava o passo a essa prova. O CSS tem 1,04 MB (117 kB no fio, agora com um ano de cache).

### 6.11 Dependências da API (majors)
- **Estado (`npm outdated`):** `postal-mime` 2.7.6 → 4.2.0 (lê `.eml` hostil),
  `@fastify/multipart` 9 → 10, `@fastify/rate-limit` 10 → 11, `bcryptjs` 2 → 3. O Prisma 8 é
  RC: fica de fora.
- **Proposta:** uma de cada vez, lendo o changelog e rodando a suíte inteira entre uma e
  outra; o que quebrar sem ganho claro fica registrado e não entra.

**Implementado.** Uma major por vez, lendo o changelog antes:

| Pacote | De → para | O que se verificou |
|---|---|---|
| `postal-mime` | 2.7.6 → 4.2.0 | Muitas correções de parsing em tempo linear (relevantes para `.eml` hostil). **Mudança visível:** cabeçalho duplicado agora vale o **primeiro** (antes, o último): um `From:` repetido mostrava `segundo@evil.test` e agora mostra o primeiro. Fixado em `eml-headers.test.ts` (8), que **reprova na 2.7.6** |
| `bcryptjs` | 2.4.3 → 3.0.3 | Hashes `$2a$` e `$2b$` se verificam **nos dois sentidos** (ninguém é trancado para fora, e o rollback funciona); o código só usa `hash` e `compare` assíncronos |
| `@fastify/multipart` | 9 → 10 | Só mudou o retorno de `saveRequestFiles`, que o projeto não usa (usa `req.parts()`) |
| `@fastify/rate-limit` | 10 → 11 | Só removeu tipos deprecados |

Todas têm entrada CommonJS (`require`), então nenhuma quebrou o build. Suíte de integração
inteira: **1014 checagens em 33 arquivos**, verdes (eram 917 em 29).

### 6.12 Dependências do web (majors)
- **Estado:** React 18 → 19, Vite 6.4.5 → 8 (o pin exato foi correção de CVE) com
  `@vitejs/plugin-react` 4 → 6, TypeScript 5.9 → 7.
- **Proposta:** depois do 6.9, uma por vez, com `lint`, `build`, `test:unit` e `test:smoke`.
  O TypeScript 7 só entra se o `typescript-eslint` o aceitar.

**Implementado.** **React 18 → 19.3** e **Vite 6.4.5 → 8.3.5** (versão exata, como antes) com
`@vitejs/plugin-react` 6. Os tipos do React 19 só reprovaram o meu teste novo (o namespace global
`JSX` saiu); o app inteiro compilou. Verificado: `lint`, `tsc`, build, os 113 testes, o `test:smoke`
(100 checagens, **uma vez só com o React 19** e outra com os dois) e os **91 cenários de tela**
(`scripts/ui-playwright`), que pegaram uma regressão **minha**: o `api-tokens` comparava o texto
da linha, e a coluna nova *Finalidade* deslocou os índices; o mock e o cenário foram atualizados
e ganharam 8 checagens. **TypeScript 7 não entrou:** o `typescript-eslint` só aceita
`>=4.8.4 <6.1.0`, como o plano previa.

### 6.14 Suíte visual no CI
- **Problema:** os 91 cenários de tela verificam comportamento e texto e tiram capturas para
  revisão manual, mas nada compara a aparência entre versões. O `web` é o único componente sem
  esse tipo de rede, e foi por falta dela que o CSS do Carbon seletivo (6.10) ficou de fora.
- **Proposta:** uma suíte separada, pequena, com as telas de layout crítico, `toHaveScreenshot`
  contra baselines versionadas, rodando na imagem do Playwright (renderização idêntica em
  qualquer máquina) e um job no CI que publica os diffs como artefato.

**Implementado.** `scripts/ui-visual` com `@playwright/test` 1.64.1 e **14 capturas** (10 telas
no desktop de 1440x900; 4 delas também em 1024x700, pelas listas e pela ficha, onde o layout
aperta): login, página inicial, histórico, meus uploads, ficha da amostra, ficha para impressão,
casos, painel, caixa de entrada e configurações da administração. `fullPage`, então o que está
abaixo da dobra também está na comparação. 1,9 MB de baselines.

O que faz a captura ser estável, e que custou para acertar:

- **Relógio congelado nos dois lados.** `page.clock.setFixedTime` no navegador e `DL_NOW` no
  mock: o `mock-api` calculava as idades das amostras com `Date.now()` na carga do módulo, então
  congelar só o navegador deixava o texto "há 30 h" inconsistente. Com os dois no mesmo instante,
  as datas e as idades param de mudar a cada hora.
- **Animação, cursor e rolagem fora:** `animations: 'disabled'`, `caret: 'hide'`, uma folha de
  estilo que zera transições e animação de CSS, e `--hide-scrollbars`.
- **Estado completo em vez de "carregando".** A amostra `e1` nasce sem TLSH e sem conferência de
  integridade: a ficha mostraria "Calculando..." e "Ainda não conferido" para sempre. A fixture
  fixa um TLSH e uma data de conferência, e a baseline cobre a renderização desses campos.
- **Um worker só**, porque o mock guarda estado global.

**Provas de dentes:** com `.hpsm-status { letter-spacing: 1px }` no CSS do build, a comparação
reprovou nos dois viewports com **18.378 pixels diferentes** (ratio 0,02) e gerou
`actual`/`diff`/`expected`; com uma baseline corrompida à mão, também reprovou. Rodada duas vezes
seguidas, os 14 PNGs saem com o **mesmo hash**.

No CI, o job `visual` constrói o `web`, roda a comparação e, se falhar, sobe o `test-results`
como artefato. A versão do Playwright entrou no `check-playwright-version.mjs` (agora seis
lugares), porque a suíte visual usa a mesma imagem das baselines: versão diferente, captura
diferente.

**Ficou de fora, de propósito:** baseline das 91 telas (manutenção enorme para pouco retorno) e
captura do console do sandbox, que exigiria um servidor VNC falso. **Próximo uso previsto:** com
a suíte no lugar, o CSS do Carbon seletivo (6.10) passa a ser verificável — cortar o SCSS e
comparar as telas.

### 6.13 Cópia do backup fora do disco (adiado)
- **Problema:** o ZIP do backup fica no bucket (`backups/`), e bucket e Postgres são
  `./data/minio` e `./data/pgdata` na mesma máquina: perder o disco perde dado e backup.
- **Proposta (quando voltar à mesa):** cópia agendada para fora (`mc mirror` ou `rclone`) ou
  um segundo destino S3, e um teste de restauração periódico.

**Adiado pelo dono do projeto:** registrado aqui com o problema e o desenho, sem código e fora
da ordem de execução. Não iniciar sem ele pedir. Quando retomar, a decisão que falta é o destino
(segundo bucket S3, outro host, ou armazenamento frio) e se a cópia leva as amostras junto; o
teste de restauração vale mais que a cópia em si, porque um backup que nunca foi restaurado é
uma suposição.

---

## Achados no caminho

Duas coisas apareceram ao montar o CI e precisaram de conserto antes, senão a esteira
nasceria vermelha — e esteira vermelha no primeiro dia ensina todo mundo a ignorá-la.

### A. `access-lifecycle.test.ts` desatualizado desde o commit 385da17

A quarta rodada do Strix trocou, de propósito, o bloqueio por CAPTCHA: um dispositivo novo
numa conta com muitas falhas passou a receber **428 com `captchaRequired`** em vez de
**429**, para que alguém de fora não consiga trancar a dona da conta. O teste continuou
exigindo 429 e falhava em três checagens — `IP novo sem cookie é barrado`, `cookie de outra
conta não vale` e `cookie forjado não vale`.

Confirmado como **anterior a esta leva**: as mesmas três falham no HEAD limpo, com o
trabalho guardado no stash. As asserções passaram a conferir 428 **e** `captchaRequired:
true` (antes só olhavam o código), e a primeira ganhou um nome que diz o que acontece:
"IP novo sem cookie cai no CAPTCHA". São 45 checagens agora, todas verdes.

### B. `format:check` reprovava 20 arquivos, 12 deles só por fim de linha

O repositório tem 144 arquivos com CRLF (o projeto é desenvolvido no Windows), e o Prettier
sem `endOfLine` assume `lf` e reprova todos. Normalizar os 144 seria um diff enorme, que
enterraria o resto e brigaria com o fluxo de quem trabalha no Windows.

O conserto foi `"endOfLine": "auto"` no `.prettierrc.json` — a recomendação do próprio
Prettier para repositório misto. Com isso sobraram 12 arquivos com desvio **real** (linha
acima das 100 colunas), corrigidos com `npm run format`; o diff ficou pequeno e contido,
sem nenhuma troca de fim de linha. `apps/api/rules` entrou no `.prettierignore`, porque o
`.gitattributes` manda copiar os pacotes de regras sem alterar — inclusive no fim de linha.

Também havia um erro de ordem de imports no `iocs.test.ts`, corrigido com `eslint --fix`.

### C. O npm 11 do Node 26 não roda script de instalação sem aprovação

Subir as imagens e o CI do Node 22 para o 26 trouxe o `npm` 11, que **bloqueia por padrão o
script de instalação das dependências** (`postinstall`, `install`) e só os roda depois de um
`npm install-scripts approve`. No `npm ci` isso é aviso, não erro, e o build não depende dele: o
binário do esbuild chega pelo pacote por plataforma (`@esbuild/linux-x64`), não pelo script; o
cliente do Prisma é gerado no passo próprio (`prisma generate`); e os `postinstall` de telemetria
do Carbon são justamente o que não se quer rodar. Fica o registro para quando alguém vir o aviso
e achar que quebrou algo.

O `apps/capture` não muda de Node: roda sobre a imagem do Playwright
(`mcr.microsoft.com/playwright`), que traz o seu próprio runtime; o Dependabot já vigia essa
imagem. E o teste de tamanho da tag em `decryptSecret` (ux-backlog) agora roda no Node 26, que
recusa tag curta sozinho — o `authTagLength: 16` continua sendo a defesa real; a camada do Node
22 era a redundância que se perde.

### D. O `npm` embutido nas imagens era o que o Trivy acusava

Os seis achados das imagens da API e do capture (`undici` e `brace-expansion`, as mesmas versões
nas duas) pareciam dependência do projeto e eram do **`npm` que vem dentro da imagem do Node**:
o caminho nos relatórios era `/usr/local/lib/node_modules/npm/...`. O runtime só executa `node`
(o entrypoint chama `node_modules/.bin/prisma`), então o conserto honesto foi tirar o `npm` da
imagem final, e não ignorar o achado. De quebra a imagem fica menor e sem uma ferramenta de
instalação que um atacante usaria. A imagem do capture, aliás, já roda o Node 26.

### E. O scanner de segredos e a imagem do Playwright

Na primeira rodada, o Trivy reprovou o capture sem nenhuma CVE: o **scanner de segredos** achou
um token SAS da Azure no cache e nos logs do npm (`/root/.npm`) que a imagem base da Microsoft
traz gravados numa camada dela (a Microsoft instala o yarn por um link assinado do feed). Apagar
o diretório na camada seguinte **não tira o achado**: o scanner olha cada camada. A saída foi uma
exceção **estreita** no `trivy.yaml` (só esse diretório; uma chave privada em outro lugar
continua reprovando, e isso foi testado), mantendo o `rm` para o nosso próprio cache não ficar
gravado na nossa camada.

### F. Um `From:` duplicado mudava de dono com o `postal-mime` 3

Com o `postal-mime` 2, um e-mail com dois `From:` mostrava o **último** (o do atacante); a partir
da 3.0 vale o **primeiro**, como a RFC 5322 manda. Nenhum teste cobria isso. O `eml-headers.test.ts`
fixa o comportamento (e reprova na 2.7.6, o que prova que ele distingue as versões), junto com
`Subject` repetido, `Subject` dobrado, `Received` dobrado em várias linhas (o normal num e-mail
real) e `Authentication-Results` repetido. **Fica como ideia** sinalizar na ficha um `From:` ou
`Subject:` duplicado: é, por si só, um indicador.

### G. O que o levantamento da leva anterior não pegou

Ao conferir a leva do Node 26 de verdade, apareceu o que a leitura não tinha mostrado: o
`node:22-slim` que sobrou no eco do `images.mjs` (o levantamento só olhou Dockerfile, yml e md, e
não os `.mjs`), as duas linhas coladas do `.dockerignore` da API (`*.logsrc/generated`), o
`test:images` e o `test:smoke` que **nunca rodavam no CI** (só à mão) e, por isso, nenhum PR de
imagem do Dependabot provava que a imagem ainda montava. O item 6.8 fecha esse último buraco.
Lição que vale para as próximas trocas: rodar o que existe antes de dizer que não há pendência.

### H. O mock dos testes de tela é parte do contrato

Os 91 cenários de tela passaram com React 19 e Vite 8, menos o `api-tokens`: a coluna nova
*Finalidade* deslocou os índices que o cenário comparava, e o mock devolvia tokens sem `scope`.
Foi uma regressão **minha**, pega exatamente por essa suíte (e é o argumento para rodá-la inteira
depois de uma troca de dependência, e não só o smoke). O mock e o cenário foram atualizados e
ganharam 8 checagens do recurso.
