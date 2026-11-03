# 🧱 Plano de melhorias técnicas

Levantamento feito depois que o [backlog de UX](ux-backlog.md) chegou ao fim (251 itens)
e as quatro rodadas do Strix fecharam os buracos de segurança. O que sobra não é
funcionalidade de tela: é **robustez, automação e operação**.

**Legenda** — Prioridade: 🔴 alta · 🟡 média · ⚪ baixa. Esforço: **P** (horas),
**M** (1–2 dias), **G** (vários dias). Status: ✅ feito · ⬜ pendente · 🚫 fora de escopo.

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
| 3.2 | Status do sistema legível por máquina | ⚪ | P | API | ⬜ |
| 4.1 | Afinar cabeçalhos do nginx | 🟡 | P | Web | ✅ |
| 4.2 | Conferência de integridade (SHA-256) no download | ⚪ | P | API | ⬜ |
| 5.1 | Notificações por e-mail (SMTP) | — | G | API | 🚫 |
| 5.2 | Webhooks de saída | — | M–G | API | 🚫 |
| 5.3 | Exportar indicadores em MISP/TAXII | ⚪ | M | API | ⬜ |

Os itens **5.1** e **5.2** ficaram **fora do escopo** por decisão do dono do projeto;
continuam registrados para quando voltarem à mesa.

**Ordem de execução combinada:** 1.1 → 1.2 → 2.1 → 1.3 → 2.3 → 2.4 → depois o resto.

**Primeira leva entregue** (1.1, 1.2, 1.3, 2.1, 2.3 e 2.4): cada item abaixo traz um bloco
**Implementado** com o que mudou e o que ficou de fora. Dois achados apareceram no caminho
e estão no fim, em [Achados no caminho](#achados-no-caminho).

Validação da leva: `format:check`, `lint` e `build` limpos na API e no web, e **917 checagens
em 29 arquivos** de integração, todas verdes.

---

## ⏸ Onde paramos

A primeira leva fechou com os seis itens de cima; a segunda levou o **2.2 (Vitest)** e o
**4.1 (cabeçalhos do nginx)**, e de quebra subiu as imagens e o CI para o **Node 26 LTS**, a
mesma versão da máquina de desenvolvimento. O que falta está listado abaixo na ordem sugerida,
com o estado de cada um já conferido no código — nada aqui depende de relembrar conversa.

| Próximo | Item | Por que nesta ordem | Esforço |
|---|---|---|---|
| 1º | [3.2 Status em JSON](#32-status-do-sistema-legível-por-máquina) | `lib/status.ts` já calcula tudo | **P** |
| 2º | [4.2 Integridade no download](#42-conferência-de-integridade-no-download) | Precisa decidir o teto de tamanho | **P** |
| 3º | [3.1 Métricas Prometheus](#31-métricas-prometheus) | Vale com Grafana no homelab | **M** |
| 4º | [5.3 Export MISP/TAXII](#53-exportar-indicadores-em-misptaxii) | Só se alguém for consumir | **M** |

### Para retomar

```bash
# a leva anterior deixou tudo verde; confirme antes de mexer
cd apps/api && npm run format:check && npm run lint && npm run build
cd ../web   && npm run format:check && npm run lint && npm run build && npm run test:unit
cd ../api   && npm run test:integration          # 917 checagens em 29 arquivos
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
- **A decidir antes de codar:** o teto de tamanho e o que fazer na divergência — recusar o
  download (seguro, mas tira do analista a única cópia que resta) ou entregar com um aviso
  gritante na ficha. O registro na Auditoria vale nos dois casos.

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
