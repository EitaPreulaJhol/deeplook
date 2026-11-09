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
| 5.3 | Feed de indicadores: TAXII 2.1 e feed MISP | ⚪ | M | API / Web | ✅ |
| 6.1 | Correções pequenas: `.dockerignore` da API, `@types/node`, resíduo do Node 22 | 🟡 | P | API | ✅ |
| 6.2 | Versão do Playwright em lockstep (CI + Dependabot) | 🟡 | P | Repositório | ✅ |
| 6.3 | Dependabot ignora a major do `node` (Current, não LTS) | ⚪ | P | Repositório | ✅ |
| 6.4 | Varredura semanal de CVE nas imagens (Trivy) | 🔴 | P–M | Repositório | ✅ |
| 6.5 | `web` sem root e compose endurecido | 🟡 | P–M | Web / Compose | ✅ |
| 6.6 | Rotação dos logs do Docker | 🟡 | P | Compose | ✅ |
| 6.7 | nginx: cache dos assets, 404 de asset e COOP/CORP | 🟡 | P | Web | ✅ |
| 6.8 | CI roda `test:images` e `test:smoke` | 🔴 | P | Repositório | ✅ |
| 6.9 | Vitest: `client.ts`, `cases.ts`, hook da lista, ErrorBoundary, cobertura | 🟡 | M | Web | ✅ |
| 6.10 | Frontend: code splitting (rotas e noVNC) e CSS do Carbon | 🟡 | M | Web | ✅ |
| 6.11 | Dependências da API: majors do `postal-mime`, multipart, rate-limit e bcryptjs | 🟡 | M | API | ✅ |
| 6.12 | Dependências do web: React 19, Vite 8, TypeScript 7 | ⚪ | M–G | Web | ✅ (React e Vite; o TypeScript 7 está bloqueado) |
| 6.13 | Pasta de backup fora do disco (`BACKUP_DIR`) e backup agendado | 🔴 | M | API / Web / Operação | ✅ |
| 6.14 | Suíte visual (Playwright) no CI | 🟡 | M | Repositório | ✅ |
| 6.15 | Fronteiras da API: rede confiável, sessão por hash, CSRF e `.env` | 🔴 | M | API / Compose | ✅ |
| 6.16 | Sandbox do Chromium da captura (perfil seccomp próprio) | 🔴 | M | Capture / Compose | ✅ |
| 6.17 | Captura somente leitura e um container por captura | 🟡 | P–M | Capture / API / Compose | ✅ |
| 6.18 | Bateria de verificação: repetição da captura, download de amostra e portas dos testes | 🟡 | P | API / Testes | ✅ |
| 6.19 | Rede da captura sem saída direta (proxy de saída em container próprio) | 🔴 | M | Capture / Compose | ✅ |
| 6.20 | Capacidades mínimas em `db`, `minio` e `clamav`; portas proibidas no `egress` | 🟡 | P–M | Compose / Capture | ✅ |
| 6.21 | Alerta do backup agendado no status e permissões dos arquivos da máquina | 🔴 | P | API / Web / Operação | ✅ |
| 6.22 | API com raiz somente leitura, `/tmp` em disco e limite de processos; checklist de implantação | 🟡 | P–M | API / Compose / Operação | ✅ |
| 7.1 | Análise estática do PE: imphash, Rich header, exports, recursos, overlay, assinatura, .NET e anomalias | 🟡 | M–G | API / Web | ✅ |
| 7.2 | capa e FLOSS em contêiner isolado (capacidades por função, com ATT&CK, e strings ofuscadas) | 🟡 | M | API / Compose / Web | ✅ |
| 7.3 | Ghidra headless sob demanda (funções, referências a imports suspeitos, pseudo-C) | 🟡 | G | API / Compose / Web | ✅ |
| 7.4 | Regras de triagem com os sinais do 7.1 e do 7.2 | 🔴 | P | API / Web | ✅ |
| 7.5 | Pontuação de risco explicável (sugere o veredito) | 🟡 | P–M | API / Web | ⬜ |
| 7.6 | Relacionadas: mesmo certificado e mesmo comportamento (capacidades do capa) | 🟡 | P | API / Web | ⬜ |
| 7.7 | Retro-hunt com o capa ao subir as regras | ⚪ | P | API | ⬜ |
| 7.8 | Desempacotar e extrair (UPX, NSIS/Inno, PyInstaller) em amostras filhas | 🔴 | M | API / Compose / Web | ✅ |
| 7.9 | Detect It Easy: compilador, empacotador, instalador e ofuscador | 🟡 | P–M | API / Compose | ✅ |
| 7.10 | Descompilar .NET (ilspycmd) | 🟡 | M | API / Compose / Web | ⬜ |
| 7.11 | Extração de configuração de famílias conhecidas (extratores maco/CAPE) | 🟡 | M–G | API / Compose | ⬜ |
| 7.12 | Emulação com o Speakeasy (sequência de APIs sem VM) | ⚪ | M | API / Compose | ⬜ |
| 7.13 | APK, JAR e Mach-O | ⚪ | M | API | ⬜ |
| 7.14 | Office e PDF mais fundo (oletools, XLM 4.0) | ⚪ | P–M | API / Compose | ⬜ |
| 7.15 | Sugerir regra YARA a partir da amostra | ⚪ | M | API / Web | ⬜ |

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

Três levas entregues, mais as fronteiras da API (6.15), que fecham o vuln-0008 que tinha ficado
aberto. A **primeira** (1.1, 1.2, 1.3, 2.1, 2.3, 2.4), a **segunda** (2.2 Vitest,
4.1 cabeçalhos do nginx e o Node 26 LTS) e a **terceira** (3.2, 4.2 e 6.1 a 6.12: endurecimento,
CI, desempenho e dependências). O que falta está abaixo, na ordem sugerida.

| Próximo | Item | Por que nesta ordem | Esforço |
|---|---|---|---|
| 1º | [7.11 Extração de configuração](#711-extração-de-configuração-de-famílias-conhecidas) | Maior ganho de IOC; o DIE (7.9) já mostra quais famílias e ferramentas aparecem | **M–G** |
| 2º | [3.1 Métricas Prometheus](#31-métricas-prometheus) | Vale com Grafana; o status por token (3.2) já cobre o básico | **M** |
| — | TypeScript 7 (sobra do [6.12](#612-dependências-do-web-majors)) | Bloqueado: o `typescript-eslint` só aceita `<6.1.0`; rever quando ele aceitar | **P** |

O **6.13 saiu do adiamento** a pedido do dono, no desenho dele: uma pasta no `.env`, e levá-la
para fora do disco é de quem configura o ambiente. Em seguida veio o **backup agendado**, com as
decisões dele: senha no `.env`, ZIP com as amostras e os dias escolhidos num calendário na aba
Backup.

### Para retomar

```bash
# a identificação com o Detect It Easy (7.9) deixou tudo verde; confirme antes de mexer
cd apps/api && npm run format:check && npm run lint && npm run build
cd ../web   && npm run format:check && npm run lint && npm run build && npm run test:coverage
cd ../api   && npm run test:integration          # 1468 checagens em 41 arquivos (sobe o capa, o Ghidra e o unpack reais)
cd ../api   && npm run test:images && npm run test:smoke   # 102 e 101 checagens
cd ../capture && npm test                         # 13 testes do proxy (sem rede)
# ao trocar o Playwright: node scripts/chromium-unsafe-ports.mjs (lista de portas do egress)
cd ../..    && node scripts/check-playwright-version.mjs && node scripts/check-carbon-css.mjs \
            && node scripts/seccomp-chromium.mjs --check
# o repositorio nao tem remoto: os passos do CI so rodam se alguem os rodar aqui
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
- **O CSS do Carbon é seletivo (item 6.10).** Usou um componente novo de `@carbon/react`? Acrescente
  o módulo em `apps/web/src/styles/app.scss` e rode `node scripts/check-carbon-css.mjs`; o CI
  reprova se esquecer (componente sem estilo não quebra teste nenhum, só a tela). Componentes do
  Carbon precisam estar sob `<Theme theme="g10">`; e a emissão do tema (`_carbon-theme.scss`) fica
  **antes** de `tokens`/`auth`/`hpsm`, porque o skin sobrescreve os mesmos tokens com a mesma
  especificidade.
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
- **Problema (como estava registrado):** a importação lê CSV e STIX, e faltava o caminho de volta
  para quem usa MISP.
- **O que já existia:** ao retomar, a exportação em **arquivo** já estava feita, com evento MISP
  (`.misp.json`) e bundle STIX 2.1 (`.stix.json`) na ficha da amostra e no caso (itens 74 e
  165). O que faltava era a outra ponta buscar sozinha.
- **Decisão do dono:** os dois caminhos de integração contínua, TAXII 2.1 e feed MISP, só com
  indicadores de amostras **maliciosas ou suspeitas**, sem a lista de permitidos.

**Implementado:**
- **Conjunto** (`lib/indicator-feed.ts`): amostras maliciosas e suspeitas fora da lixeira, com
  os indicadores dos relatórios publicados e da própria amostra (o mesmo `entriesIocs` do caso).
  - Ficam de fora a lista de permitidos e também os **domínios da empresa** (`CompanyDomain`,
    com subdomínios, e-mails e URLs deles): sem isso, o domínio da própria empresa sairia como
    ameaça para um SIEM.
  - Cada indicador leva o pior veredito entre as amostras **que entram**, a primeira aparição e
    a última mudança (da amostra ou de um relatório publicado dela). Com cache de 60 s.
- **TAXII 2.1** (`routes/feeds.ts`), só leitura:
  - descoberta, raiz da API e uma coleção;
  - objetos com `added_after`, `limit` (até 1000), `next` (cursor por data e id),
    `match[type]`, `match[id]`, `match[version]` e `match[spec_version]`;
  - objeto, versões e manifesto, com os cabeçalhos `X-TAXII-Date-Added-First/Last`, erros no
    formato do TAXII, 406 para outra versão e os caminhos com e sem barra final.
  - A identidade e os ids dos indicadores são **os mesmos** dos arquivos `.stix.json`, então
    quem já importou um arquivo não ganha duplicata.
  - O `date_added` é a última mudança: quem busca com `added_after` recebe também a amostra que
    **virou** maliciosa depois (um `date_added` pela criação da amostra perderia esse caso).
- **Feed MISP**: `manifest.json` e um `<uuid>.json` por amostra, com os mesmos uuids do
  `.misp.json`, organização, `published`, `timestamp` e uma etiqueta com o veredito.
- **Acesso:** escopo novo de token, `FEED` (migração `20261223000000_api_token_feed`).
  - Só admin cria, e o token para de valer se o dono deixar de ser admin, como o de status.
  - Vale só nas rotas do feed, e o token de amostras não lê o feed.
  - Aceita `Bearer` e **Basic com o token como senha** (o conector do Sentinel só fala Basic),
    e o Basic vale só nestas rotas. A API nunca manda `WWW-Authenticate`, então o navegador não
    guarda credencial.
  - O admin logado também lê. O limite é de 1200 pedidos por minuto, contra 120 dos outros,
    porque o MISP busca um arquivo por evento.
- **Tela:** a finalidade **Feed de indicadores** em Minha Conta > Tokens de API, com o que sai,
  os dois endereços e o passo a passo do MISP.

**No caminho:**
- **O tipo da resposta.** O Fastify reescreve `application/taxii+json;version=2.1` como
  `application/taxii+json; version="2.1"; charset=utf-8`. Um cliente que compara o texto
  recusaria. Um hook `onSend`, só neste plugin, devolve o texto exato da especificação, e o
  teste exige igualdade.
- **Um teste que travava, e a minha leitura errada dele.** O passo de interoperabilidade usava
  `spawnSync`, que bloqueia o processo do próprio servidor que o cliente Python consultava. O
  arquivo morria nos 10 minutos do executor, e eu cheguei a ler "32 de 33" como se o passo
  tivesse passado. Com a chamada assíncrona, o arquivo roda em 15 s.

**Testes:** `feeds.test.ts`, com 37 checagens:
- **Acesso:**
  - analista não cria o token; sem credencial, 401;
  - o token de amostras não lê o feed, e o do feed não lê amostras;
  - Basic só vale no feed, e nunca há `WWW-Authenticate`;
  - analista logado, não; admin logado, sim;
  - o token para quando o dono é rebaixado.
- **TAXII:**
  - a descoberta, com o tipo exato;
  - a raiz, a coleção, a 404 no formato do TAXII e a 406.
- **O que sai:**
  - entram a maliciosa e a suspeita;
  - ficam de fora a limpa, a sem veredito e a da lixeira;
  - ficam de fora a lista de permitidos e o domínio da empresa (subdomínio, e-mail e URL);
  - vale o veredito da maliciosa mesmo com o domínio também numa limpa;
  - o id é o mesmo do arquivo.
- **Paginação e filtros:**
  - a paginação de 2 em 2 percorre tudo sem repetir;
  - `match[type]`, os cabeçalhos de data e o `added_after` vazio;
  - a amostra que vira maliciosa aparece no `added_after`;
  - objeto, versões, 404 fora do feed e manifesto.
- **MISP:**
  - o manifesto tem um evento por amostra;
  - o evento sai filtrado e publicado;
  - 404 para amostra limpa e para nome qualquer.
- **Limite:** 150 pedidos seguidos passam.
- **Interoperabilidade**, com a API escutando numa porta de verdade e os clientes de referência
  num container:
  - o `taxii2-client` (OASIS) pagina a coleção, e o `stix2` valida **cada objeto** sem
    extensões;
  - o `pymisp` carrega cada evento do feed.
- **Prova inversa:** desligando, um de cada vez, o filtro da empresa, a lista de permitidos e o
  filtro de veredito, reprovam as checagens daquele filtro (inclusive pelo `pymisp`).
- O cenário de tela `api-tokens` ganhou 5 checagens: o que sai, os dois endereços, o que o token
  não alcança, o `POST` com `FEED` e a finalidade na lista.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1125 checagens em 36
arquivos** de integração (eram 1088 em 35); 120 testes unitários do web; `test:images` com 67;
`test:smoke` com 101; os cenários `api-tokens` e `backup` verdes.

**Fica de fora:**
- **remoção:** quando uma amostra deixa de ser maliciosa, o indicador some da coleção, mas o
  TAXII não avisa quem já o tinha (não há "revogado" sem guardar o histórico do que já saiu);
- o `POST` de objetos no TAXII (a coleção é só leitura);
- o `hashes.csv` opcional do feed MISP.

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
asset do 6.7 torna isso explícito.

**Implementado (o CSS), depois da suíte visual do 6.14.** O `@use '@carbon/react'` virou uma lista
de módulos em `app.scss`: o Carbon trazia os ~80 componentes, os quatro temas, o grid e as fontes
IBM Plex, e as telas usam **18 componentes** (10 módulos). Medido nas capturas e nas classes:

| | Antes | Depois |
|---|---|---|
| CSS | 1.056 kB (117 kB no fio) | **307 kB (37 kB no fio)** |
| Fontes woff2 no `dist` | 90 arquivos, 1,5 MB | **0** |
| `dist` do web | ~4,0 MB | **1,8 MB** |

O corte é seguro porque o SCSS do projeto **não usa** função nem mixin do Carbon (é `var(--dl-*)`
e CSS puro), a tipografia é a do HPSM (Tahoma, então a IBM Plex nunca era aplicada) e o `hpsm.scss`
já sobrescreve 55 tokens `--cds-*`. Três cuidados que valem registro:

- **A ordem importa.** O tema é emitido em `_carbon-theme.scss`, carregado **antes** de
  `tokens`/`auth`/`hpsm`: as duas regras (`.cds--g10` do Carbon e `.cds--g10, .cds--white` do
  skin) têm a mesma especificidade, e quem vem depois vence. Emitir o tema no fim do `app.scss`
  faria a paleta do Carbon passar por cima da do HPSM.
- **Só o tema claro `g10`**, que é o único que o app aplica (`<Theme theme="g10">` no AppShell e
  nas telas de impressão); os dois escuros saíram.
- **Componente novo pede módulo novo**, senão fica sem estilo em silêncio. Por isso
  `scripts/check-carbon-css.mjs` (passo do CI no job `check`) lê os imports de `@carbon/react` e
  reprova se faltar módulo, se sobrar módulo sem uso ou se aparecer componente fora da tabela; o
  `form` entra como módulo de suporte, porque todo campo do Carbon renderiza `cds--form-item` e
  `cds--label`.

**Prova:** as 14 baselines do 6.14 passam **sem uma diferença de pixel** com o CSS seletivo, e o
`test:images` (45) e o `test:smoke` (100) seguem verdes. O guardião foi testado nos quatro casos
(componente sem módulo, módulo sem uso, suporte ausente e o estado correto).

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

### 6.13 Pasta de backup fora do disco

- **Problema:** o ZIP do backup ficava no bucket (`backups/`), e bucket e Postgres são
  `./data/minio` e `./data/pgdata` na mesma máquina: perder o disco perdia dado e backup.
- **Decisão do dono:** uma pasta configurada no `.env`, onde o backup é gravado. Levar essa pasta
  para um disco externo (montagem, NAS, sincronização) é responsabilidade de quem configura o
  ambiente; o DeepLook só grava nela.

**Implementado:**
- **`BACKUP_DIR`** no `.env` (caminho do host). O compose monta a pasta em `/backups` e passa
  `BACKUP_DIR=/backups` à API só quando ela está definida (`${BACKUP_DIR:+/backups}`, conferido
  com e sem a variável). Vazio, nada muda: o ZIP vai para o bucket, como antes.
- **O ZIP vai direto para a pasta**, e não para o bucket também, porque uma cópia no mesmo disco
  não protege de nada e dobraria o espaço:
  - o nome é `deeplook-backup-AAAA-MM-DD-<id>.zip`;
  - é montado como `.<nome>.partial` e renomeado no fim, então quem sincroniza a pasta nunca vê
    um ZIP pela metade, e o espaço é conferido na própria pasta;
  - ao lado vai um `.sha256` no formato do `sha256sum -c`;
  - os dois com permissão `600`, aplicada logo ao criar o provisório, porque o ZIP tem o banco e,
    se marcado, malware;
  - numa falha, o provisório e o `.sha256` saem da pasta.
- **A marca `.deeplook-backups`**, criada por quem configura. Com o disco desmontado, o ponto de
  montagem vira uma pasta vazia no disco principal, e o backup seria gravado ali sem ninguém
  perceber, que é exatamente a falha que o item quer evitar. Sem a marca, a pasta inexistente ou
  sem escrita, a API recusa **antes do `pg_dump`**, com o motivo.
- **Onde o problema aparece:**
  - a aba Backup diz para onde o ZIP vai e mostra o que impede de gravar;
  - a página de status ganha **Pasta de backup**: desligada sem `BACKUP_DIR`, em alerta com o
    motivo, ou pronta com o espaço livre; nos três casos, com a hora do último backup pronto.
- **Download, vencimento e exclusão:**
  - leem e apagam da pasta só o ZIP e o `.sha256` que a API gravou, pelo nome guardado na linha;
    o resto da pasta não é tocado;
  - backups anteriores, no bucket, seguem baixando até vencer (a chave em `backups/` diz onde
    estão; sem migração);
  - arquivo sumido da pasta faz o download responder 404 com o motivo provável (disco
    desmontado), e não 500.

**Testes:**
- `backup.test.ts` ganha 15 checagens (eram 39, são 54):
  - sem a marca, a tela mostra o motivo e o backup é recusado sem deixar nada na pasta;
  - com a marca, o ZIP é gravado na pasta com o nome esperado, e não no bucket;
  - o `.sha256` confere byte a byte, e o ZIP e o `.sha256` saem com `600`;
  - nenhum `.partial` sobra, o download devolve os mesmos bytes, e um backup antigo do bucket
    continua baixando;
  - arquivo fora da pasta dá 404 com o motivo;
  - falha simulada no meio da montagem não deixa provisório nem `.sha256`;
  - vencimento e exclusão apagam só o que é da API;
  - pasta sem escrita: o motivo traz o uid.
- **Prova inversa:** sem a exigência da marca, o backup é gravado na pasta "desmontada" e as duas
  checagens da marca reprovam; sem a limpeza, a da falha no meio reprova.
- O `test:images` sobe a imagem real com a pasta montada, como o compose faz. O usuário sem root
  grava no disco do host, o arquivo sai com uid 1000 e `600`, o `.sha256` confere e o download
  pela API devolve o arquivo.
- O cenário de tela `backup` ganha 3 checagens: o aviso de mesmo disco, o texto da pasta e o
  motivo do problema na tela.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1070 checagens em 35
arquivos** de integração (eram 1055); `test:images` com **65** (eram 62); `test:smoke` com 101;
113 testes unitários do web; o cenário `backup` verde.

**Para ligar numa instalação:** criar a pasta no disco externo, a marca e o dono uid 1000,
definir `BACKUP_DIR` no `.env` e `docker compose up -d` (o passo a passo está no README, em
"Pasta de backup fora do disco").

**Backup agendado**, a segunda parte, com as decisões do dono: senha numa variável do `.env`,
ZIP com as amostras (protegido pela senha), e a frequência num calendário na tela.

- **Tela:** a aba Backup ganha a seção **Backup agendado**. Ela oferece:
  - dias da semana (os sete = todos os dias) ou um dia do mês (1 a 28, para valer em todo mês) e
    o horário;
  - um **calendário** deste mês e do próximo, com os dias marcados, e as cinco próximas
    execuções, atualizados enquanto se escolhe, antes de salvar.

  O horário vale no fuso do navegador de quem salvou, que vai junto (`timezone`); outro admin
  num fuso diferente vê um aviso. A lógica da prévia é pura (`backupSchedule.ts`, com teste
  unitário).
- **Senha:** `BACKUP_SCHEDULE_PASSWORD` no `.env` (12+ caracteres; menos que isso, a API não
  sobe e diz por quê). Sem ela, o agendamento não liga: a tela informa (sem tom de erro, porque é
  opcional) e a API recusa com 409. A senha não vai para a linha do backup, para a auditoria nem
  para a configuração salva (conferido no teste).
- **API:**
  - a configuração fica em `systemSetting` (`backupSchedule`), com a próxima execução já em UTC;
  - um relógio confere a cada minuto. Se a API estava fora do ar na hora, o backup sai **uma
    vez** quando ela volta e o calendário segue; com outro backup em andamento, espera o minuto
    seguinte sem perder a vez;
  - a criação do backup saiu da rota para `createBackup`, que a tela e o agendamento usam (mesma
    trava de um por vez, mesma auditoria, com "agendado" no detalhe e sem autor);
  - a linha ganha `scheduled` (migração `20261222000000_backup_scheduled`), e a lista mostra
    **Agendado** em "Por";
  - a mudança do agendamento vai para a Auditoria (`SETTING_CHANGED`), e a página de status mostra
    o próximo e alerta se ele estiver ligado sem a senha.
- **Horário de verão.** O teste pegou um defeito no meu primeiro cálculo: em 8/3/2026, em Nova
  York, as 02:00 não existem (viram 03:00), e o backup marcado para 02:00 ia para a 01:00, uma
  hora **antes**. Agora o cálculo testa o deslocamento de antes e o de depois da troca:
  - a hora que não existe sai logo depois (03:00), como o `Date` do navegador faz na prévia;
  - a hora repetida na volta do horário de verão roda uma vez, na primeira.

**Testes do agendamento:**
- `backup.test.ts` passou de 54 para **72** checagens. Ele cobre:
  - próximas execuções em UTC, a virada do mês, as duas trocas de horário de verão e a validação
    (dia 31, fuso inexistente, nenhum dia);
  - sem senha a tela sabe e não liga, e analista não agenda;
  - a mudança vai para a auditoria sem a senha;
  - antes da hora nada sai, e com outro em andamento espera sem pular a vez;
  - atrasado, roda uma vez e o próximo é depois de agora;
  - o agendado sai com amostras, com senha, sem autor, marcado e na auditoria;
  - o ZIP abre no 7-Zip **com a senha do `.env`**, traz as amostras e recusa outra senha;
  - desligado, não roda mais.
- 7 testes unitários da prévia, com o módulo na cobertura (97,8% / 100% das linhas).
- O cenário de tela `backup` ganhou 8 checagens:
  - sem a senha, avisa e não liga;
  - os dias marcados no calendário e as próximas execuções, nos dois meses;
  - o `PUT` com os dias, o horário e o fuso;
  - a confirmação com o próximo;
  - o mensal;
  - "Agendado" na lista.
- O `test:smoke` reprovou a primeira versão, com razão: numa instalação sem a senha, a aba
  mostrava em vermelho um recurso opcional desligado. Virou mensagem informativa.

**Fica de fora:**
- **Teste de restauração periódico.** O `backup.test.ts` restaura de verdade (`pg_restore` num
  banco novo, contagens batendo), mas isso não roda na instalação.
- **Retenção própria da pasta.** Vale a mesma `BACKUP_RETENTION_DAYS` (até 90 dias); quem quiser
  guardar por mais tempo copia da pasta para outro lugar, e a API não apaga essas cópias.

### 6.15 Fronteiras da API: rede confiável, sessão por hash, CSRF e `.env`

Uma revisão depois da terceira leva achou quatro buracos de fronteira. O primeiro é o vuln-0008
do Strix, que a quarta rodada não fechou (Achado I).

- **Rede confiável.** A API confiava no `X-Forwarded-For` de qualquer endereço privado e estava
  também na rede `capture`, a do Chromium que abre páginas maliciosas. Esse Chromium roda sem o
  sandbox próprio (o padrão do Playwright é `chromiumSandbox: false`), então uma falha explorada
  no renderizador já dava código no container. De lá, `api:3000` respondia direto, sem o nginx,
  e o XFF trocado a cada pedido furava o limite de login por IP. Agora a rede `deeplook` tem
  sub-rede fixa (`DEEPLOOK_SUBNET`, padrão `172.31.250.0/24`), que chega à API como
  `TRUSTED_NETWORK`. Só o loopback e essa faixa informam o IP do cliente, e qualquer outra
  conexão é derrubada no evento `connection` do servidor, antes de o HTTP ser lido
  (`src/lib/network.ts`). A API continua chamando o `capture`, mas o `capture` não alcança mais
  a API. Sem `TRUSTED_NETWORK`, vale o comportamento antigo (desenvolvimento e testes) e o
  status do sistema avisa.
- **Sessão por hash.** O id da sessão era o próprio valor do cookie, e o `pg_dump` do backup
  (que pode sair sem senha) levava todas as sessões válidas. O banco passa a guardar o SHA-256
  do cookie, como já fazia com os tokens de API. A migração
  `20261221000000_session_id_hash` converte as sessões existentes com o mesmo hash, então
  ninguém é deslogado. A aba Sessões segue com o hash curto do id.
- **CSRF.** O `SameSite=Lax` não separa subdomínios: atrás do Tunnel, outro serviço em
  `*.seu-dominio` é *same-site*. Um `multipart/form-data`, que não pede preflight, enviaria uma
  amostra em nome de quem estivesse logado, e um WebSocket abriria o console do sandbox. Um hook
  `onRequest` global (`src/lib/cross-site.ts`) recusa com 403 os métodos não seguros, e todo
  WebSocket, quando `Sec-Fetch-Site` é `same-site` ou `cross-site`. Sem o cabeçalho (scripts,
  tokens de API) o pedido passa. Com `COOKIE_SECURE=true` o cookie vira `__Host-dl_session`,
  o que impede outro subdomínio de gravá-lo ou trocá-lo (fixação de sessão). Ao ligar, quem
  estava logado entra de novo uma vez.
- **`.env` com 777.** Numa partição ext4, qualquer usuário da máquina lia e alterava os
  segredos. Virou `600`. A permissão é da máquina, não do repositório (o `.env` não é
  versionado), então quem clonar de novo precisa repetir o `chmod 600 .env`.

**Testes.** O `boundaries.test.ts` traz 33 checagens:
- quem informa o IP: o nginx da faixa sim, um vizinho da rede `capture` não;
- uma conexão TCP de verdade derrubada fora da faixa e atendida dentro dela;
- POST e WebSocket de outro site recusados, e os da mesma origem e de script aceitos;
- o banco sem nenhum valor de cookie, e o id do banco recusado quando usado como cookie;
- o hash da migração igual ao do código, e uma sessão anterior à migração ainda válida depois
  dela;
- o `__Host-` com `Secure` e `Path=/`, inclusive ao sair.

Com cada proteção desligada à mão, 9 das checagens falham. O `test:smoke` ganhou a prova na
topologia real: a rede do teste com sub-rede fixa e uma segunda rede no papel da `capture`. Da
primeira, a API responde 200; da segunda, a conexão cai. O navegador real faz o roteiro inteiro
pelo nginx com o bloqueio de outro site ligado.

**Validação:** `format:check`, `lint` e `build` limpos na API; **1047 checagens em 34 arquivos**
de integração (eram 1014 em 33); `test:smoke` com 101 (eram 100).

**Para atualizar uma instalação:** `docker compose down` antes do `up -d --build`, porque o
Docker não muda a sub-rede de uma rede que já existe. Os dados ficam em `./data`.

**Ficou de fora, de propósito:**
- o sandbox do próprio Chromium (`chromiumSandbox: true`), que precisa de um perfil de seccomp
  que permita *user namespaces* e de teste no kernel do host;
- restringir as portas do `CONNECT` do proxy da captura;
- o `Content-Type` fixo no download de amostra.

Ficam como próximos passos.

### 6.16 Sandbox do Chromium da captura

O `capture` abre páginas maliciosas por definição, e o Chromium rodava com `--no-sandbox` (o
padrão do Playwright é `chromiumSandbox: false`): uma falha explorada no renderizador dava
código direto no container. O 6.15 tirou desse container o caminho até a API; este item
coloca a página atrás do sandbox do próprio Chromium.

**Medido antes de mexer** (num container com `cap_drop: ALL` e `no-new-privileges`, no
Liquorix 7.2 do host de desenvolvimento):

| Configuração | Resultado |
|---|---|
| Hoje: sem sandbox, seccomp padrão | renderizador com `--no-sandbox`, no namespace do container, 1 filtro seccomp (o do Docker) |
| Sandbox + seccomp padrão do Docker | não sobe ("Chromium sandboxing failed!") |
| Sandbox + `seccomp=unconfined` | sobe, mas tira a proteção do Docker inteira; só serviu de diagnóstico |
| Sandbox + perfil estreito | renderizador em *user* e *pid namespace* próprios, 2 filtros seccomp (o do Docker e o do Chromium), sem `--no-sandbox` |

**Implementado:**
- O perfil `apps/capture/seccomp-chromium.json` é o padrão do Docker (moby/profiles, commit
  fixo `4b8214fc4971`) mais quatro regras:
  - `clone`, com as duas ordens de parâmetro (a do s390 é outra), e `unshare`, só quando as
    flags criam namespaces *user*, *pid* ou *net*: mount, uts, ipc e cgroup continuam
    barrados (`SCMP_CMP_MASKED_EQ`);
  - `chroot`.
- Conferido no container: `unshare -U` e `-U -p -n` passam; `-m`, `-u`, `-i`, `-C` e um
  `mount` dentro do namespace continuam barrados.
- O perfil sai de `scripts/seccomp-chromium.mjs`, e o CI confere que o arquivo bate com o
  gerador (`--check`).
- O compose aplica o perfil ao `capture`. Ele resolve o caminho a partir da raiz do projeto e
  embute o conteúdo, mesmo chamado de outra pasta (conferido num projeto descartável).
- O `server.mjs` liga `chromiumSandbox`. Um navegador que não sobe vira erro legível da
  captura ("o sandbox do Chromium não subiu neste host...") e fecha o proxy daquela captura;
  antes, a falha do `launch` escapava como 500 e deixava o proxy aberto.
- `/health` informa `sandbox`. `CAPTURE_CHROMIUM_SANDBOX=false` fica como saída de emergência
  para um host sem *user namespaces*, com aviso no log.

**Testes:** o `test:images` passou a subir o `capture` com a configuração lida do compose
(`runArgs`, que ganhou `shm_size` e resolve o caminho do perfil). Antes, a configuração era
uma cópia à mão sem o `cap_drop`. Checagens novas:
- `/health` com o sandbox ligado;
- uma página que segura o renderizador por 4 s, inspecionado vivo: *user* e *pid namespace*
  próprios, 2 filtros e nenhum `--no-sandbox`;
- a mesma página capturada com sucesso;
- sem o perfil, a captura falha com o motivo.

O `test:images` passou de 45 para **49 checagens**. Fora dos testes, uma captura real de
`https://example.com/` pelo compose funcionou: print, status 200 e certificado.

**Custo assumido:** o perfil deixa um processo sem capacidades criar *user namespaces*, o que
amplia a superfície do kernel exposta ao container. É a troca que o próprio Chrome faz no
desktop. O sandbox protege contra a falha mais provável (o renderizador, com exploits que
circulam em kits de phishing); a outra exige uma falha de kernel, com namespaces de mount, uts,
ipc e cgroup continuando barrados e o container ainda sem capacidades.

**Ficou de fora:** o `capture` com sistema de arquivos somente leitura, que virou o item 6.17.

### 6.17 Captura somente leitura e um container por captura

O sandbox (6.16) segura a página dentro do renderizador. Este item cuida do que sobraria se
alguém passasse também por ele: hoje um processo ou arquivo deixado no container
sobreviveria para espionar as capturas seguintes.

**Medido antes de mexer:**
- **Somente leitura:** com a raiz somente leitura e só `/tmp` em `tmpfs`, o Chromium sobe e
  captura `example.com` e a Wikipedia (print e 120 kB de HTML). Ele só escreve o perfil
  temporário em `/tmp` (144 kB depois da captura); `/app` e `/home/pwuser` recusam escrita.
- **Reinício do Docker:** um container que vive menos de 10 s volta com espera dobrando a
  cada vez (0,1 s, 0,2 s, 0,4 s…; com 2 s de vida, passava de 12 s no 8º ciclo). Com 10 s ou
  mais, volta na hora: num laço de 10,5 s, um reinício a cada ~10,6 s, sem atraso acumulado.

**Implementado:**
- **Compose:** o `capture` ganha `read_only: true` e `/tmp` em `tmpfs` (256 MB, `noexec`,
  `nosuid`, `nodev`).
- **Servidor:** com `CAPTURE_RECYCLE` (padrão `true`), atende uma captura, responde e sai, e o
  `restart: unless-stopped` sobe um container limpo. A saída acontece no mínimo 10,5 s depois
  da subida, para não cair no atraso do Docker. Como o container novo fica parado esperando,
  uma captura manual não fica mais lenta: só duas seguidas ficam com uns 10 s entre si.
  Enquanto troca, o servidor responde 503 com `Retry-After`. `/health` informa `recycle` e
  `ready`.
- **API:** `requestCapture` espera a vez por até 2 minutos, tentando a cada 1 s quando recebe
  503 ou erro de conexão (container subindo). Estouro de tempo da própria captura não é
  repetido. Antes, a fila ficava dentro do serviço e contava nos mesmos 90 s, então pedidos
  simultâneos ganham folga em vez de perder.

**Testes:**
- `capture-recycle.test.ts` traz 6 checagens com um serviço falso:
  - espera a conexão e passa do 503;
  - devolve o 503 no fim da espera;
  - desiste com o erro de conexão;
  - ponta a ponta, a captura fica pronta depois de um 503.
  - Sem a espera, o teste quebra.
- O `test:images` sobe o `capture` com o `restart` do compose (`runArgs` aprendeu a opção) e
  ganha 7 checagens:
  - raiz somente leitura;
  - `/tmp` em `tmpfs` com `noexec`;
  - a captura;
  - o pedido logo depois recusado;
  - o container trocado;
  - um arquivo em `/tmp` e um `sleep` deixados antes da captura somem depois dela.
  - No caso contrário (`CAPTURE_RECYCLE=false`), conferido à mão, o arquivo e o processo
    continuam lá.

**Validação:** `format:check`, `lint` e `build` limpos na API; **1053 checagens em 35 arquivos**
de integração (eram 1047 em 34); `test:images` com **56** (eram 49); testes do capture verdes.

**Por que reiniciar o container e não limpar por dentro:** o processo que atende roda com o
mesmo usuário do navegador. Quem escapasse do sandbox poderia se anexar a ele (ptrace ou
`/proc/<pid>/mem`) e sobreviver a qualquer limpeza feita de dentro. Um PID namespace novo, que
só o Docker dá, não deixa nada para trás.

### 6.18 Bateria de verificação (novembro)

Rodada de conferência sobre o que as levas deixaram, rodando tudo o que existe antes de dizer
que não há pendência (lição do Achado G). Como o repositório **não tem remoto**, os passos que
só existem no CI (`check-carbon-css`, `check-playwright-version`, `seccomp-chromium --check` e o
`actionlint`) também foram rodados à mão.

**Ponto de partida, tudo verde:** `format:check`, `lint` e `build` na API e no web; 113 testes
unitários do web (cobertura de 95,7%); 4 testes do capture; 1053 checagens de integração em 35
arquivos; os três scripts do CI; `actionlint` sem achados. O `npm audit` acusa 10 moderadas, todas
em dependência de desenvolvimento (`minimatch` pelo ESLint e `typescript-eslint`); em produção
(`--omit=dev`) são zero, e o CI só reprova a partir de `high`.

**Corrigido:**
- **A API repetia uma captura que derrubava o serviço.** O `requestCapture` (6.17) tentava de
  novo, até o fim dos 120 s, em `ECONNRESET` e `UND_ERR_SOCKET`, que é também o que acontece
  quando a página estoura a memória e leva o container junto. Medido com um serviço falso que
  cai no meio do pedido: **11 visitas à mesma URL em 5 s** (21 em 3 s no teste). Cada uma
  revisitava a página maliciosa, e cada container que vive menos de 10 s aumenta o atraso de
  reinício do Docker para as capturas seguintes. Agora a falta de conexão (`ECONNREFUSED`, DNS,
  `EHOSTUNREACH`, tempo de conexão) continua sendo repetida à vontade, porque o pedido nem chegou;
  conexão que caiu depois de aberta ganha **uma** nova tentativa só (cobre o container antigo
  saindo). Checagem nova no `capture-recycle.test.ts`, que falha sem a correção.
- **`Content-Type` do download de amostra** (sobra do 6.15). Saía o `mimeType` gravado, que é o
  que o navegador de quem enviou declarou: uma amostra enviada como `text/html` voltava como
  `text/html`. O `attachment` e os cabeçalhos do nginx seguravam no navegador, mas chamada direto
  na API (token, teste) ia sem `nosniff`. Agora sempre `application/octet-stream`, com `nosniff`
  e `Content-Security-Policy: default-src 'none'; sandbox`, como já faziam o print e o HTML da
  captura. Checagem nova no `sample-access.test.ts`, que falha no código antigo.
- **Os containers de teste abertos para a LAN.** O `tests/run.mjs` publicava o Postgres (senha
  `pg`, superusuário), o MinIO e o OpenLDAP em `0.0.0.0`, e eles **continuam de pé** entre uma
  rodada e outra (só o `--clean` derruba): qualquer máquina da rede local entrava. Conferido de
  outro container: `10.0.0.85:55432` e `:6389` respondiam. Agora tudo publica em `127.0.0.1`,
  inclusive as três portas do `images.mjs`. O `ensure()` grava a configuração num rótulo e
  recria o container quando ela muda; sem isso, os containers antigos seguiriam em `0.0.0.0`.
- **Documentação:** o README dava `clamav/clamav:stable` como padrão do `CLAMAV_IMAGE`, e o
  compose usa `clamav/clamav:1.5`; o `.env.example` não trazia `CAPTURE_CHROMIUM_SANDBOX` nem
  `CAPTURE_RECYCLE` (entraram comentados, com o padrão). A tabela de variáveis do README foi
  cruzada inteira com os padrões do compose: era a única divergência.

**Conferido e descartado:**
- Suspeita de IDOR nas sub-rotas de amostra (`/captures`, `/antivirus`, `/yara`, `/iocs`,
  `/reputation` não aplicam `visibleEntries`): não é, porque o `requireUser` faz isso para toda
  rota `/api/entries/:id`, e o `own-samples.test.ts` varre todas elas.
- nginx: o `X-Forwarded-For` é o `$remote_addr`, sem concatenar o que o cliente mandou.

**Validação:** `format:check`, `lint` e `build` limpos na API; **1055 checagens em 35
arquivos** de integração (eram 1053); `test:images` com 56 e `test:smoke` com 101, todos verdes.

**Ficou como recomendação** (não feito nesta rodada):
- **Rede da captura sem saída direta** — virou o item 6.19 (feito).
- **Portas do `CONNECT`:** a lista 80/443/8080/8443 que o 6.15 previa quebraria a captura de
  phishing em porta alta (`:8000`, `:2083`...), que é comum. O Chromium já recusa as portas
  proibidas dele (SMTP, SSH...) antes do proxy; espelhar essa lista no proxy e validar 1–65535
  dá a mesma proteção sem quebrar captura. O ganho real contra um navegador comprometido está
  no 6.19, e não aqui.
- **Permissão dos arquivos:** cerca de 2.800 arquivos versionados têm escrita para outros
  usuários (cópia do Windows), código da API incluído, mesmo caso do `.env` no 6.15. Como o
  `core.fileMode` é `false`, `chmod -R o-w` não muda o Git; é da máquina, como o `chmod 600 .env`.
- **`pids_limit` e raiz somente leitura na API**, que analisa arquivo malicioso: o `capture` e o
  `web` já têm; a API precisa de teste próprio (o `genisoimage` e o Prisma escrevem em disco).

### 6.19 Rede da captura sem saída direta

O proxy que recusa endereço interno rodava **dentro** do container do Chromium e só valia para
quem o usasse: o Chromium, enquanto obedecesse. A rede `capture` era uma bridge comum, com saída
para tudo. Quem passasse pelo sandbox (6.16) até o processo do navegador falaria direto com a
rede da casa, inclusive com o Proxmox.

**Medido antes de mexer** (Docker 29.9, contêineres descartáveis com `cap_drop: ALL`):

| Rede | LAN e serviços do host pelo IP da LAN | Internet | DNS externo | Host pelo IP da bridge |
|---|---|---|---|---|
| bridge comum (a `capture` de antes) | alcança (`10.0.0.85:55432`, o DNS do libvirt) | alcança | resolve | alcança |
| `internal: true` | não | não | não | **alcança**: o Docker não filtra o tráfego para o próprio host, então um serviço do host em `0.0.0.0` (um sshd) responderia |
| `internal: true` + `inhibit_ipv4` | não | não | não | não: a bridge fica sem IP no host |

Nas três, os contêineres da mesma rede se veem pelo nome. Um contêiner na rede interna e numa
comum (o papel da API) sai pela comum, em qualquer ordem de ligação: a interna nunca vira a rota
padrão.

**Implementado:**
- **Compose:** a rede `capture` vira `internal: true` com
  `com.docker.network.bridge.inhibit_ipv4` (Docker 28+). O serviço novo **`egress`** fica nela e
  na rede `capture-egress`, a única com saída. O `capture` ganha
  `CAPTURE_EGRESS_PROXY=http://egress:3128` e depende do `egress` saudável. O `egress` roda
  somente leitura, sem capacidades, com `no-new-privileges`, 256 MB e 64 processos.
- **Imagem do `egress`** (`apps/capture/Dockerfile.egress`): `node:26-slim` com só o
  `proxy.mjs` e o `egress.mjs`. Não tem navegador, nem dependência de npm, nem o `npm` na imagem
  final.
- **`proxy.mjs`:**
  - com `upstream`, o proxy de dentro da captura repassa ao `egress` o HTTP (forma absoluta) e
    o `CONNECT`;
  - o `egress` resolve e confere com a mesma regra de antes, e o motivo de uma recusa volta no
    cabeçalho `x-deeplook-blocked`, então a ficha da captura continua listando o que foi
    barrado;
  - sem `upstream`, o comportamento é o de antes (fora do compose);
  - porta fora de 1–65535 recebe 400;
  - os manipuladores não deixam escapar exceção. No código antigo, `CONNECT 8.8.8.8:99999` chegava
    ao `net.connect` e o `RangeError` derrubava o processo. Pelo Chromium isso não acontece, mas o
    `egress` é um processo de vida longa e serve todas as capturas;
  - `/health` passa a existir, para o healthcheck do compose.
- **`server.mjs`:** `/health` informa `egress`, e o log diz por onde a captura sai.
- **CI:** a varredura do Trivy ganha a imagem do `egress` (matriz com `Dockerfile` por imagem).

**Testes:**
- `apps/capture/tests/chain.test.mjs` traz 7 testes, só em loopback:
  - HTTP e `CONNECT` passam pelos dois proxies;
  - rede interna e metadados são recusados pelo de saída, com o motivo chegando ao de dentro;
  - porta inválida recebe 400 nos dois, sem derrubar nenhum;
  - de saída fora do ar dá 502, e não conexão direta.
- O `test:images` monta a topologia do compose: a rede da captura é criada com a configuração
  lida do compose (`networkArgs`, novo no `compose-service.mjs`); a página de teste fica só na
  rede do `egress`, então só se chega a ela por ele; um repassador faz o papel da API, porque
  rede interna não publica porta. São 6 checagens novas:
  - a imagem do `egress` compila;
  - o `egress` sobe saudável;
  - o `egress` roda sem root e somente leitura;
  - a captura informa que sai pelo `egress`;
  - de dentro do `capture`, conexão direta à internet, à rede do `egress` e ao host não chega
    (até `ECONNREFUSED` reprova, porque quem recusa é um host alcançado);
  - de dentro do `capture`, o DNS externo não resolve.
- **Prova inversa:** com o `internal` e o `inhibit_ipv4` tirados do compose, exatamente essas
  duas reprovam: `1.1.1.1:443` conecta, o host responde (`ECONNREFUSED`) e o DNS resolve.
- O `test:smoke` passa a criar a rede no papel da `capture` com a configuração do compose. A API
  continua atendendo a rede do web e derrubando a da captura.

**No caminho: as bases das imagens com CVE alta já corrigida.** O Trivy da imagem nova reprovou
pelo `zlib1g` da `node:26-slim` (duas CVEs altas, corrigidas no Debian em `deb13u1`). A da API,
na mesma base, também reprovava, e a do `capture` tinha duas no `apt` do Ubuntu. Isso não vinha
deste item: eram CVEs novas nas bases, que a varredura semanal acusaria sem ninguém rodar, porque
não há remoto. As três imagens ganham `apt-get upgrade` na base, como o `web` já fazia com o
`apk upgrade`. As quatro imagens e os Dockerfiles passam no Trivy.

**Validação:**
- 11 testes do capture (eram 4);
- `test:images` com **62** (eram 56);
- `test:smoke` com 101;
- Trivy limpo nas quatro imagens do projeto e no `config`;
- `actionlint` limpo;
- `seccomp --check` confere.

A API não mudou de código neste item, e a integração (1055) é a do 6.18.

**Para atualizar uma instalação:** `docker compose down` antes do `up -d --build`, porque o Docker
não transforma em interna uma rede que já existe.

**Fica de fora:**
- o Docker anterior ao 28 não foi conferido: a rede segue interna, mas o host pode continuar
  alcançável pelo IP da bridge;
- as portas proibidas do Chromium espelhadas no `egress` (linha própria em "Onde paramos");
- as imagens de terceiros (Postgres, MinIO, ClamAV) não foram varridas nesta rodada.

### 6.20 Capacidades mínimas nos serviços com estado e portas proibidas no egress

As duas últimas sobras de endurecimento.

**Capacidades de `db`, `minio` e `clamav`.** Os três rodavam com as 14 capacidades padrão do
Docker e sem `no-new-privileges`, e o ClamAV lê arquivo malicioso. Os três sobem como root (o
entrypoint ajusta a posse dos dados e troca de usuário), então `cap_drop: ALL` puro quebra
todos. O mínimo de cada um foi medido com contêineres e volumes descartáveis, sem tocar em
`./data`, com volume e com pasta do host (bind, como o compose monta), e cada conjunto conferido
em três tempos: subir, gravar e **reiniciar com os próprios dados**.

| Serviço | Mínimo | O que acontece sem ele |
|---|---|---|
| `db` | `CHOWN DAC_OVERRIDE SETGID SETUID` | sem nenhuma, o entrypoint não troca para `postgres`; sem `DAC_OVERRIDE`, o primeiro boot passa e o **reinício** falha (a pasta já é do `postgres`, com `700`), que é o caso de toda instalação existente; `FOWNER` não é preciso |
| `minio` | `DAC_OVERRIDE` | roda como root numa pasta do host de outro dono e nem sobe ("file access denied") |
| `clamav` | `CHOWN DAC_OVERRIDE FOWNER SETGID SETUID` | sem `FOWNER`, o `install -d` não ajusta `/run/clamav`; sem `DAC_OVERRIDE`, o `clamd` não abre o próprio log. Conferido com a base real copiada: responde, detecta o EICAR e reinicia |

Saem `NET_RAW`, `MKNOD`, `SYS_CHROOT`, `SETFCAP`, `SETPCAP`, `KILL`, `FSETID`, `NET_BIND_SERVICE` e
`AUDIT_WRITE` (e `FOWNER` no banco e no MinIO). Os três ganham `no-new-privileges`.

**Portas proibidas no `egress`.** A lista 80/443/8080/8443 que o 6.15 previa quebraria a captura
de phishing em porta alta (revisto no 6.18). Em vez dela, o proxy recusa as portas que o próprio
Chromium recusa. A lista foi **medida, não copiada**: o Chromium 156 da imagem do Playwright
1.64.1 navegou para cada porta de 1 a 11000 e recusou exatamente 80, com `ERR_UNSAFE_PORT`. A
lista que eu teria escrito de memória tinha 4190 e 6679, que este Chromium não recusa. O navegador
já barra essas portas; no `egress` elas valem mesmo que ele seja comprometido. A recusa volta para
a ficha com o motivo, como as de endereço interno.

**Testes:**
- O `test:images` sobe o Postgres e o MinIO da API com a configuração lida do compose (`runArgs`
  aprendeu `cap_add`). Confere que estão sem as capacidades padrão e **reinicia o Postgres** antes
  da segunda API, que migra, entra e faz backup sobre ele. São 2 checagens novas.
- O `test:smoke` sobe o banco e o MinIO com a mesma configuração.
- O ClamAV ficou fora do `test:images`: baixaria 170 MB de base e ocuparia cerca de 1,5 GB de
  memória a cada rodada. A medição acima é o registro.
- `chain.test.mjs` traz 2 testes novos:
  - SMTP por `CONNECT` e SSH por HTTP recusados nos dois proxies, com o motivo;
  - a lista com as 80 portas, e as altas de phishing (8000, 2083) e as duas que eu erraria
    (4190, 6679) liberadas.
- **Prova inversa:** com o `proxy.mjs` anterior, o teste das portas reprova.

**Validação:** 13 testes do capture (eram 11); `test:images` com **67** (eram 65); `test:smoke`
com 101; o script de portas confere com o navegador. A API não mudou de código (1070 checagens de
integração, do 6.13).

**Para atualizar uma instalação:** `docker compose up -d` recria os três com o endurecimento; os
dados ficam onde estão.

**Fica de fora:**
- portas acima de 11000 não foram varridas (a maior da lista é 10080);
- a lista é do Chromium 156. Ao trocar o Playwright, rode `node scripts/chromium-unsafe-ports.mjs`:
  ele mede na imagem da versão do capture, sem rede e com 16 páginas em paralelo (cerca de 50 s),
  e compara com a do proxy. Hoje confere. Não está no CI, porque leva quase um minuto e só muda
  com o Playwright.

### 6.21 Alerta do backup agendado e permissões dos arquivos

Os dois primeiros itens da revisão feita depois do 5.3, os pequenos que valiam já.

**Backup que falha não avisava ninguém.** O agendado (6.13) só mostrava a falha na aba Backup;
um disco externo desmontado passaria semanas sem ninguém saber. Agora `scheduledBackupProblem`
diz o que está errado, com o agendamento ligado:
- o último agendado falhou (com a data e o motivo);
- a última hora marcada, com **6 h de folga** para um backup grande terminar, passou sem nenhum
  backup pronto (manual também vale; vencido depois também);
- a pasta de backup tem problema (o próximo vai falhar);
- falta a senha.

A verificação da página de status passa a se chamar **Backup** e fica em **erro**, e não em
alerta. É de propósito: o `?strict=1` do token de status só responde 503 em erro, então o monitor
que já existe avisa sem configuração nova. A aba Backup mostra o mesmo motivo. Com o agendamento
desligado, nada disso vira erro, e a pasta com problema volta a ser só alerta. Horários anteriores
a ligar o agendamento não contam: o agendamento guarda `savedAt`, sem isso daria alarme falso logo
depois de ligar.

**Testes:**
- `backup.test.ts` passou de 72 para **81** checagens:
  - a última hora marcada, inclusive na troca do horário de verão;
  - recém-ligado não acusa;
  - três dias depois sem backup, erro com a hora;
  - backup pronto depois da hora, sem erro;
  - último agendado falhou, erro com o motivo;
  - pasta com problema e sem senha, erro;
  - desligado, a pasta volta a ser alerta.
- **A prova inversa pegou um teste fraco.** Sem a proteção do `savedAt`, o teste continuava verde,
  porque os backups das seções anteriores, criados minutos antes, já satisfaziam a regra. O teste
  agora envelhece esses backups antes de conferir, e a prova inversa reprova exatamente as duas
  checagens da proteção.
- O cenário de tela `backup` ganhou a checagem do motivo na aba, como erro.

**Permissões dos arquivos da máquina.** Cerca de 2.950 arquivos e pastas do repositório
(inclusive o código da API, cópia do Windows) e de `data/` eram graváveis por qualquer usuário da
máquina. Em `data/pgdata` eram **1.524 arquivos do banco**, além do MinIO e do ClamAV. Foi
aplicado `chmod o-w` em tudo o que é do usuário (links simbólicos de fora). Sobrou zero, e o Git
não mudou, porque o `core.fileMode` está desligado. É seguro também em `data/`: na subida, cada
container ajusta o dono da sua pasta, e nenhum depende de "outros" poderem gravar. Como o `chmod
600 .env` do 6.15, é da máquina: quem copiar o projeto do Windows de novo precisa repetir.

### 6.22 API com raiz somente leitura e checklist de implantação

O item 4 da revisão. O `capture` e o `web` já rodavam somente leitura e com limite de processos;
a API, que analisa arquivo malicioso, ainda não.

**Medido antes de mexer:**
- O `test:images` (migrar, criar o admin, receber amostra, gerar backup) com `docker diff` no
  container. Fora do `/tmp`, a API só gravava em `/home/node/.cache` e `/home/node/.config`, e
  era o **Prisma CLI** do `migrate deploy`: a verificação de versão e a telemetria
  (`checkpoint-nodejs`), que chamavam a internet a cada subida.
- O *schema engine* já vem na imagem (`node_modules/@prisma/engines`) e roda sem rede: não há
  download de binário.
- No código, só `backup.ts` e `sandbox.ts` gravam, e sempre no `tmpdir()` (fora o `BACKUP_DIR`).

**A ressalva que mudou o desenho:** o `/tmp` da API não pode ser `tmpfs` como o do `capture`.
Sem `BACKUP_DIR`, o ZIP inteiro do backup (banco e arquivos) é montado ali, e o ISO do sandbox
também passa por lá. Em memória, isso contaria no `mem_limit` (4 GB) e derrubaria a API num
backup grande.

**Implementado:**
- O compose dá à API `read_only: true` e o `/tmp` num **volume em disco** (`api-tmp`).
- `pids_limit` de 256 (`API_PIDS_LIMIT`). O pico medido foi de **32**, depois de migrar, receber
  amostra e gerar backup (as threads dos workers contam), então há folga de 8 vezes para
  análises em paralelo.
- A imagem desliga a telemetria do Prisma (`CHECKPOINT_DISABLE=1`) e aponta os caches do CLI
  para o `/tmp` (`XDG_CACHE_HOME`, `XDG_CONFIG_HOME`).
- `cleanStaleWorkDirs` apaga na subida as pastas `deeplook-backup-*` e `deeplook-iso-*` que um
  travamento deixou. Elas já se acumulavam para sempre na camada gravável do container, e com um
  volume persistente acumulariam mais.

**Testes:** o `test:images` sobe a API com a configuração **lida do compose** (`runArgs` aprendeu
os volumes: o nomeado vira anônimo no teste; o bind fica com quem chama). Antes, a configuração
era escrita à mão. Checagens novas:
- raiz somente leitura (`/app` e `/home/node` recusam escrita) e `/tmp` gravável;
- Prisma sem telemetria;
- pico de processos abaixo da metade do teto (impresso no log);
- as sobras de backup e ISO limpas no reinício.

A checagem de erros de permissão nos logs passou a procurar também `EROFS`: uma gravação barrada
pela raiz somente leitura não passa calada. O `test:images` passou de 67 para **71**, com os
dois backups (bucket e pasta) funcionando na raiz somente leitura.

**Sub-rede fixa da `capture-egress`** (`CAPTURE_EGRESS_SUBNET`, padrão `172.31.252.0/24`; a
`deeplook` usa a `.250` e o smoke, a `.251`). Sem ela, o host não tem como mandar só a saída da
captura por uma VPN, e a captura abre links maliciosos pelo IP da casa. Conferido que não colide
com as redes deste host e que um container nela sai para a internet com origem na faixa (é
desta origem que o `ip rule` do checklist depende).

**Ficou de fora:** `noexec` no `/tmp` da API. Um volume nomeado não aceita a opção sem amarrar a
uma pasta do host. A raiz somente leitura, o usuário sem root e o `cap_drop: ALL` seguem valendo.

**Checklist de implantação** ([implantacao.md](implantacao.md)): o roteiro do piloto no homelab,
na ordem em que um passo protege o seguinte. Ele cobre:
- requisitos (Docker 28+, memória, *user namespaces*);
- segredos e permissões;
- Tunnel, `COOKIE_SECURE` e **Cloudflare Access**, com **service token** para os clientes de
  máquina (Uptime Kuma, MISP, TAXII), que de outro modo parariam no Access;
- a captura saindo **por VPN** (roteamento por origem da sub-rede fixa da `capture-egress`);
- o sandbox desligado no piloto;
- o backup no disco externo, agendado e **restaurado uma vez**;
- subida, contas, monitoramento, conferência final, operação e o combinado com quem vai testar.

---

## 7. Quarta leva: análise estática

Pedido do dono depois da 6.22: melhorar a análise estática e avaliar o **Ghidra + JDK** para
analisar as funções. A conclusão foi que o Ghidra vale, mas por último e fora da API. Antes vêm o
que falta no parser de PE (barato, sem dependência nova) e o capa, que é a análise de funções
voltada para triagem.

**Por que o Ghidra não vem primeiro:**
- **Custo:** Ghidra e JDK 21 somam 1 a 1,5 GB de imagem, e uma análise headless leva de 30 s a
  minutos e de 1 a 4 GB de RAM. Não cabe na thread de análise (60 s, 1,5 GB de heap).
- **Trivy:** o Ghidra traz dezenas de JARs de terceiros; com a varredura semanal que reprova CVE
  alta (6.4, 6.19), viraria fonte recorrente de achados que não dependem do projeto.
- **Superfície:** é mais um parser de binário hostil, em Java, com histórico de CVEs.
- **Retorno:** amostra empacotada mostra só o stub do empacotador, e os especialistas do grupo já
  têm Ghidra ou IDA na própria máquina. O que falta a eles é triagem rápida e pesquisável aqui.

### 7.1 Análise estática do PE

O `parsePe` lia cabeçalho, seções e imports e parava aí. Entram, todos na thread de análise e com
limites para arquivo hostil:
- **imphash** e **hash do Rich header**, iguais aos do `pefile` (a referência do VirusTotal), e a
  aba Relacionadas passa a ligar amostras com o mesmo imphash ou o mesmo Rich header;
- **exports** (com encaminhamentos), **TLS callbacks**, **overlay** (com tipo e entropia) e
  **checksum** declarado contra o calculado;
- **recursos** (tipo, idioma, tamanho, entropia, conteúdo embutido), **informações de versão**
  (OriginalFilename, empresa, produto) e o **manifesto** (pede administrador?);
- **assinatura Authenticode**: quem assinou, a cadeia que veio no arquivo e se o hash do arquivo e
  a assinatura conferem;
- **.NET**: versão do runtime, assembly, referências, P/Invoke (as APIs nativas que o .NET chama) e
  marcas de ofuscador;
- **anomalias**: seção gravável e executável, entry point fora do lugar, resolução dinâmica de
  APIs, data de compilação no futuro, e o empacotador reconhecido pelos bytes, não só pelo nome da
  seção.

**Implementado** (tudo em TypeScript, na thread de análise que já existia; nenhuma dependência
nova na imagem):
- `pe-analysis.ts` (cabeçalhos, imports, imphash, Rich header, exports, TLS, overlay, checksum,
  empacotador e alertas), `pe-resources.ts`, `pe-authenticode.ts`, `pe-dotnet.ts` e
  `file-type.ts` (o `detectType`, agora usado também nos recursos e no overlay).
- **imphash igual ao do pefile**, inclusive nas importações por ordinal: a tabela `ordlookup` do
  pefile (MIT) foi copiada para `pe-ordinals.json` (ws2_32, wsock32 e oleaut32). Sem ela, malware
  que importa o ws2_32 por ordinal teria imphash diferente do VirusTotal.
- **Rich header** no mesmo recorte do pefile, e a chave conferida contra o cabeçalho DOS e as
  entradas (como o linker da Microsoft a calcula): editado ou copiado de outro binário vira alerta.
- **Assinatura Authenticode** sem internet: o hash do arquivo contra o assinado, o messageDigest
  contra o conteúdo, a assinatura contra a chave do certificado (RSA e ECDSA), a cadeia que veio no
  arquivo, autoassinado, carimbo de tempo (contra-assinatura ou RFC 3161), nome e endereço do
  programa. A cadeia **não** é conferida contra as raízes do Windows, e a tela diz isso.
- **.NET**: as 45 tabelas de metadados do ECMA-335 com os índices codificados, para chegar ao
  assembly, às referências, ao P/Invoke (o "import" real de um carregador .NET), às chamadas
  sensíveis (`Assembly.Load`, `WebClient`...) e às marcas de ofuscador.
- **UPX pelo código de entrada**, medido nos binários do upx 4.2 para x86 e x64 (EXE e DLL): pega
  o UPX com as seções renomeadas e a marca `UPX!` apagada.
- **Relacionadas**: colunas `imphash` e `richHash` indexadas (migração
  `20261224000000_entry_pe_hashes`), motivos "Mesmas importações" e "Mesmo Rich header", e o
  mesmo rótulo no Mapa. O imphash só liga com tabela própria: fora o .NET (todo ele importa só
  `mscoree.dll!_CorExeMain`) e tabelas com menos de 10 funções (empacotador).
- **Amostras antigas**: `pe-backfill.ts` reanalisa os PEs em segundo plano depois do TLSH, um de
  cada vez, na thread; expurgado ou ilegível ganha só a marca, para não voltar à fila. A ficha de
  análise antiga avisa e oferece **Analisar de novo**; a reanálise grava as colunas.
- **Tela**: alertas por gravidade, imphash e Rich header com cópia, ponto de entrada, checksum,
  dados anexados, TLS, manifesto, permissões das seções (RWX em vermelho), assinatura, versão,
  recursos (com o idioma), exports, funções importadas por DLL e .NET. A comparação A × B ganha
  imphash, Rich header e quem assinou.

**Uma diferença do pefile, de propósito:** o pefile conta a tabela da assinatura como overlay, e
todo binário assinado teria "dados anexados". Aqui o overlay é o que sobra fora dela.

**Testes** (`pe-analysis.test.ts`): executáveis reais gerados por `tests/fixtures/pe/gen.sh` num
Debian trixie (mingw-w64 12, windres, mcs do Mono, upx 4.2, osslsigncode 2.9 com o TSA embutido e
data fixa), com o gabarito do **pefile 2024.8.26**, do **dnfile 0.15.1** e do **osslsigncode**.
O runner os gera em `.tmp/pe` e só refaz quando as fontes mudam (cerca de 40 s na primeira vez).
- Contra o gabarito, em 16 executáveis: imphash, Rich hash e entradas, imports na ordem, exports,
  TLS, checksum, ponto de entrada, recursos, versão, overlay, .NET e o hash da assinatura.
- O que cada achado quer dizer: recurso com executável, manifesto, "diz ser da Microsoft",
  assinado, adulterado (o hash não confere e a assinatura em si continua íntegra), autoassinado
  ECDSA, UPX disfarçado, Rich editado, .NET com P/Invoke e `Assembly.Load`.
- Checksum em blocos contra a porta literal do pefile, inclusive a soma múltipla de 2³²−1.
- Hostis: recursos em laço com 65.535 entradas, exports com 4 bilhões de funções, TLS sem fim de
  lista, tabela de assinatura gigante, DER com tamanho mentiroso, assinatura de lixo, .NET com 4
  bilhões de linhas por tabela, 2.400 mutações e cortes dos executáveis reais e um PE de 120 MB.
- Pela API: envio grava a coluna, Relacionadas por imphash e por Rich header, .NET não se liga
  pelo imphash genérico, reanálise devolve as colunas, e o preenchimento das amostras antigas
  (inclusive a expurgada, que não volta para a fila).

**Prova inversa:** sem a tabela de ordinais, o imphash dos executáveis com ws2_32 diverge do
pefile; sem o código de entrada, o UPX disfarçado passa; com a entrada da tabela de assinatura no
hash, assinado e autoassinado deixam de conferir; sem o filtro do imphash, o .NET se liga a outro
.NET. **A prova inversa pegou um teste fraco:** o caso dos recursos em laço tinha só 8 entradas
apontando para a raiz e passava mesmo sem o teto de entradas e sem a marca de visitado. Com as
65.535 apontando para a raiz, o parser sem os limites ficou preso mais de 60 s.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1351 checagens de
integração em 37 arquivos** (eram 1134 em 36; o `pe-analysis` tem 217); 120 testes unitários do
web (cobertura de 95,9%); `test:images` com 71 e `test:smoke` com 101, como antes; os cenários de
tela `static-analysis` (com a ficha nova, o .NET e a ficha de análise antiga), `related` e
`compare` verdes.

**Desempenho:** o checksum é a única conta que percorre o arquivo inteiro. Com `readUInt32LE` a
análise de um PE de 190 MB subiu de 0,35 s para 1,6 s; somando em blocos de 2²⁰ dwords num
`Uint32Array` (o "vai-um" do pefile equivale à soma módulo 2³²−1), o checksum caiu de 479 ms para
64 ms, com o mesmo resultado em 1.610 casos.

### 7.2 capa e FLOSS em contêiner isolado

O [capa](https://github.com/mandiant/capa) desmonta o binário e diz o que cada função faz ("injeta
código via APC", "persiste via Run key"), com o ID do ATT&CK, que entra direto no `attack.ts`. O
[FLOSS](https://github.com/mandiant/flare-floss) recupera strings ofuscadas e montadas na pilha,
que hoje não viram sugestão de IOC. Os dois rodam sem JDK, num serviço no molde do `capture`: sem
rede de saída, raiz somente leitura, `cap_drop: ALL`, limite de tempo e memória.

**Implementado:**
- **Serviço `capa`** (`apps/capa`): `server.py` (só a biblioteca padrão do Python) roda o capa
  10.0.0 e, em PE, o FLOSS 3.2.0 com tetos de tempo próprios (`CAPA_TIMEOUT_S` 600,
  `FLOSS_TIMEOUT_S` 300; o grupo de processos inteiro morre no estouro) e devolve um resumo: regras
  com grupo, ATT&CK, MBC e até 20 endereços; strings da pilha, "tight" e decifradas com a função.
  Um trabalho por vez (os outros recebem 503), o `/health` responde durante a análise (livre,
  analisando, trocando) e, como a captura, **um contêiner por análise**.
- **Imagem**: dois estágios. O `binary2strings` do FLOSS só existe em código-fonte, então o
  compilador fica no estágio de build; os wheels saem dele conferidos pelo **lockfile com hash**
  (`requirements.txt`, gerado por `pip-compile` a partir de `requirements.in`). As **regras e as
  assinaturas FLIRT** não vêm no pacote do pip: o `ADD --checksum` as baixa das tags `v10.0.0` e
  confere o SHA-256. O cache das regras é gerado no build (com a raiz somente leitura o capa não
  conseguiria gravá-lo e desistia, medido). Usuário `capa` (uid 10001), 548 MB.
- **Compose**: rede interna `analysis` só com a API (sem internet nem o egress), raiz somente
  leitura, `/tmp` de 256 MB em memória sem execução, `cap_drop: ALL`, `no-new-privileges`,
  `pids_limit` 64, `mem_limit` 3 GB e o restart que troca o contêiner.
- **Fila na API** (`lib/capa.ts`, tabela `CapaAnalysis`, migração `20261225000000_capa_analysis`):
  executável do Windows ou do Linux até `CAPA_MAX_MB` entra sozinho depois do envio (anexo de
  e-mail e arquivo de ZIP também); um por vez, persistida no banco. Serviço fora do ar: volta para
  a fila com o motivo, até 3 tentativas espaçadas (5 e 10 min). API reiniciada no meio: o que
  estava em andamento volta para a fila, ou falha se já gastou as tentativas. A resposta do serviço
  é validada com teto em cada campo, o NUL sai (o Postgres o recusaria) e só entram técnicas que
  existem no ATT&CK embutido.
- **Rotas**: `GET /api/entries/:id/capa` (quem vê a amostra; também por token de API, na OpenAPI)
  e `POST` (analistas; 409 na fila, 400 fora dos executáveis, 503 desligado).
- **Tela**: seção "Análise de funções (capa)" com situação, executável, ferramentas, técnicas
  ATT&CK, capacidades (as de risco em destaque) e as strings escondidas, com os IOCs delas. No
  Novo relatório, **Inserir técnicas sugeridas pelo capa** e os IOCs do FLOSS em "Inserir IOCs
  sugeridos". Status do sistema com versões, fila e análises em 24 h.
- **Trivy e Dependabot**: a imagem entra na varredura semanal; o pip sai da imagem final (o pip 26.3
  traz no SBOM o `pkg_resources` de um setuptools com CVE alta, e o runtime não usa o pip, como o
  npm no achado D). O Dependabot cuida do lockfile e da imagem base, mas não sobe o capa nem o FLOSS:
  as regras, as assinaturas e os hashes do Dockerfile têm de subir juntos.

**Medido antes de fixar os tetos:** de 0,6 a 9 s por executável pequeno no capa e de 16 a 21 s no
FLOSS (ele emula); num PE sintético de 1,8 MB com 4.000 funções, o capa passou de **17 minutos com
1,8 GB** e foi interrompido. Daí os tetos por ferramenta, a fila fora do caminho do envio e "tempo
esgotado" como resultado legítimo.

**Uma corrida que só apareceu com o contêiner de verdade:** a segunda análise seguida chegava como
"conexão derrubada", contada como tentativa. O serviço recusava com 503 sem ler o corpo e saía com
o arquivo ainda chegando, e o TCP mandava RST. Duas correções: o servidor lê o corpo antes de
recusar e, na troca, para de aceitar conexões antes de sair; e a API só manda o arquivo depois de o
`/health` dizer "livre" (um GET, seguro de repetir). **A prova inversa mostrou que a segunda é a que
resolve:** só com a do servidor, a conexão ainda caía.

**Testes:**
- `capa.test.ts` (29) contra o serviço real, subido pelo runner com o endurecimento do compose e o
  restart: o executável ofuscado (capa acha a pilha ofuscada e o XOR; FLOSS devolve
  `stack.evil.test` e `http://xor.evil.test/painel`, que viram sugestão de IOC), a injeção
  (`inject thread`, T1055.003), .NET, ELF (sem FLOSS), um contêiner novo a cada análise, rotas e
  permissões, desligado, serviço parado (volta para a fila; gastas as tentativas, falha) e um serviço
  falso hostil (campo gigante, NUL, técnica inexistente, recusa, travado, conexão derrubada),
  reinício da API e exclusão em cascata.
- `test:images`: com a configuração do compose e na rede interna, sem root, raiz somente leitura,
  `/tmp` sem execução, sem capacidades, sem saída para a internet, token, só executáveis, 413 com
  resposta para arquivo acima do teto, análise de um ELF com a raiz somente leitura e o contêiner
  novo livre depois.
- Cenário de tela `capa` e os geradores de fixtures ganham o executável ofuscado (x64 e x86) e um ELF.
- **Prova inversa:** sem a espera pelo "livre", a segunda análise cai; sem tirar o NUL, o Postgres
  recusa; sem filtrar as técnicas, uma inexistente entra.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1380 checagens de
integração em 38 arquivos** (eram 1351 em 37; o `capa` tem 29); 120 testes unitários do web;
`test:images` com **82** (eram 71) e `test:smoke` com 101; os **94 cenários de tela** (1679
checagens), com o novo `capa`; Trivy sem achados na imagem do capa e nos Dockerfiles.

**Ficou de fora:** reanalisar com o capa as amostras enviadas antes (cada análise leva minutos; o
analista pede pela ficha), e as regras do capa como condição das regras de triagem.

### 7.3 Ghidra headless sob demanda

Se os analistas pedirem além do capa: botão "Analisar funções" (só analistas), um contêiner por
análise sem rede, e um post-script que exporta só o essencial: funções com tamanho, referências
cruzadas aos imports suspeitos, grafo de chamadas resumido e o pseudo-C apenas das funções que
chamam esses imports. O projeto `.gzf` pode ir para download, para abrir no Ghidra local.


**Implementado** (o dono pediu o Ghidra antes das ideias 7.4 a 7.15):
- **Serviço `ghidra`** (`apps/ghidra`): o mesmo esqueleto do capa (token, recusa lendo o corpo,
  `/health` com o estado, um contêiner por análise) rodando o Ghidra 12.2 headless em **duas
  passadas**: a primeira importa, analisa e roda `ExportDeepLook.java` (programa, até 300 maiores
  funções com complexidade, quem chama as APIs de `sensitive-apis.txt` e o pseudo-C de até 25 delas
  e do ponto de entrada); a segunda abre o programa já gravado, sem analisar de novo, e roda
  `PackGzf.java`. Na primeira passada o programa ainda não está no projeto quando o script roda: o
  exportador de `.gzf` devolvia `false` calado, e salvar dali dava "Location does not exist".
- **Ordinais**: o Ghidra mostra `Ordinal_115` para o ws2_32; o script usa a tabela do pefile do 7.1
  (`pe-ordinals.json`), e `WSAStartup` entra na lista de APIs sensíveis.
- **Imagem** (1,45 GB): Debian trixie, OpenJDK 25 (o Ghidra 12 pede 25) sem os `jmods` (337 MB que
  só servem ao `jlink`), Python para o servidor e o Ghidra sem documentação, extensões, servidor de
  repositórios e depurador. O pacote vem com `ADD --checksum` (o SHA-256 publicado). Usuário
  `ghidra` (uid 10002) com a home no `/tmp`: o Java tira `user.home` do `/etc/passwd`, não do
  `$HOME`, e sem isso o Ghidra nem subia.
- **Trivy**: a imagem crua tinha 5 achados. Os do netty (1 crítico, 3 altos) eram do `yajsw`, o
  wrapper do servidor de repositórios, que saiu. O do guava 32.1.3 (alto, negação de serviço ao
  desserializar) é do núcleo: o build o troca pelo 33.7.2 e o `failureaccess` 1.0.3 do Maven Central,
  conferidos pelo hash (o SHA-256 publicado do guava; o do `failureaccess` pelo SHA-1 publicado). O
  `ADD` grava com permissão 600 e o usuário do Ghidra não lia os JARs: `install -m 644`. Sem exceção
  no `.trivyignore`.
- **API** (`lib/ghidra.ts`, `routes/ghidra.ts`, tabela `GhidraAnalysis`, migração
  `20261226000000_ghidra_analysis`): **sob demanda** (só analistas pedem; nada no envio), fila
  persistida, um por vez, as mesmas novas tentativas do capa. O cliente dos dois serviços virou
  `lib/analysis-service.ts` (a espera pelo "livre" do 7.2 vale para os dois). Elegível: PE ou ELF até
  `GHIDRA_MAX_MB`, fora o .NET (o Ghidra não descompila IL). O GET entra para token de API; o
  download do projeto, não.
- **O `.gzf` tem os bytes da amostra**: fica em `samples/ghidra/`, então o backup sem amostras o
  deixa de fora sem mudar a regra do backup; a retenção e a exclusão definitiva o apagam com o
  arquivo; baixar segue a regra de baixar a amostra (quem enviou e os analistas) e vai para a
  Auditoria.
- **Tela**: seção "Análise com o Ghidra" (situação, quem pediu, programa, funções, o link do projeto
  para quem pode baixar, o pseudo-C recolhível por função com cópia e quem chama, as maiores
  funções); status do sistema com a versão e a fila.

**Medido:** de 12 a 18 s nos executáveis de teste (o Java e a compilação do script contam a cada
análise) e de 680 a 840 MB de pico; o `.gzf` de 48 a 210 KB. No UPX, o Ghidra só vê o
descompactador, como esperado: o 7.8 (desempacotar) é o que resolve.

**Testes:**
- `ghidra.test.ts` (31) contra o serviço real, subido pelo runner com o endurecimento do compose: a
  injeção (`OpenProcess`, `VirtualAllocEx`, `WriteProcessMemory`, `CreateRemoteThread` e a URL no
  pseudo-C), o ordinal com nome, o ponto de entrada, o `.gzf` sob `samples/`, o download (quem
  enviou e o analista sim, outro usuário não, dois na Auditoria), ELF, um contêiner novo a cada
  análise, .NET e texto recusados, retenção e lixeira apagando o `.gzf`, desligado, um serviço falso
  hostil (falha do Ghidra, pseudo-C acima do teto, sem projeto, NUL, travado) e o reinício da API.
- `test:images`: com a configuração do compose e na rede interna, sem root, raiz somente leitura,
  `/tmp` sem execução, sem capacidades, sem internet, sem o guava 32 e sem o `yajsw`, token, só
  executáveis, um ELF analisado e empacotado com a raiz somente leitura, e o contêiner novo livre
  depois.
- Cenário de tela `ghidra`.
- **Prova inversa:** sem apagar o `.gzf` na retenção ou na lixeira, sem a regra de quem baixa e sem
  a tabela de ordinais, cada um falha a sua checagem e só ela.
- **Um teste meu errado no caminho:** a retenção não pegava a amostra porque mudar o status regrava o
  `statusChangedAt` na mesma atualização; a data vai numa segunda atualização.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1411 checagens de
integração em 39 arquivos** (eram 1380 em 38; o `ghidra` tem 31, e o `capa` segue com 29 depois de o
cliente virar `analysis-service.ts`); 120 testes unitários do web; `test:images` com **93** (eram 82)
e `test:smoke` com 101; os **95 cenários de tela** (1700 checagens), com o novo `ghidra`; Trivy sem
achados na imagem do Ghidra e nos seis Dockerfiles.

**Ficou de fora:** descompilar todas as funções (custa minutos e ninguém lê; o `.gzf` está lá para
isso), o grafo de chamadas desenhado (por ora, "chamada por" em cada função) e .NET (7.10).

### 7.4 Regras de triagem com os sinais do 7.1 e do 7.2

As regras de triagem passam a aceitar condições sobre a análise nova: capacidade do capa ("inject
thread"), técnica ATT&CK, alerta do PE (assinatura adulterada, recurso com executável, UPX),
indicador nas strings do FLOSS. A amostra já chega com prioridade e responsável certos. Como o
capa termina depois do envio, a regra tem de ser avaliada de novo quando a análise de funções
concluir.

**Implementado:**
- **Seis condições novas** (migração `20261227000000_triage_analysis_conditions`): o capa encontrou a
  capacidade (parte do nome ou grupo; vazio = qualquer capacidade de risco), técnica ATT&CK do capa
  (`T1055` casa as subtécnicas; o código é conferido e vai em maiúsculas), assinatura que não
  confere (adulterada ou inválida; a ilegível não conta, porque não foi conferida), empacotado (com o
  empacotador, opcional), alerta do executável (trecho sem acento e sem caixa; vazio = qualquer
  alerta alto) e indicador numa string que só o FLOSS vê.
- **Quando rodam:** as do executável já valem na chegada (a análise estática roda antes). As do capa
  pedem as regras de novo quando a análise de funções conclui, e a reanálise estática pedida pelo
  analista também as roda. O preenchimento em segundo plano das amostras antigas (7.1) não roda:
  mudaria em massa a prioridade de amostras já concluídas sem ninguém pedir.
- **"Capacidade de risco"** é uma lista só (`lib/capa-risk.ts`), a mesma do destaque na ficha.
- **Tela** com as seis condições e as dicas de valor; o README ganhou a seção de regras de triagem,
  que não existia.

**Testes** (`pe-triage.test.ts`, 24): validação da técnica; com os executáveis reais do 7.1, UPX
(empacotado e pede administrador, sem alerta alto), adulterado (assinatura, alerta alto, P1),
assinado e autoassinado (não casam) e a assinatura ilegível (não casa); com um capa falso, nada do
capa na chegada e tudo quando ele conclui (capacidade, técnica pela subtécnica, risco, IOC escondido,
P1, o histórico), rodar de novo sem repetir, capacidade comum sem risco, o grupo como valor; e a
reanálise aplicando uma regra criada depois do envio. Cenário de tela das regras com a técnica e a
lista das condições.

**Prova inversa:** sem rodar as regras quando o capa conclui, sem excluir a assinatura ilegível,
tratando qualquer capacidade como de risco e sem rodar na reanálise, cada um falha a sua checagem.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1435 checagens de
integração em 40 arquivos** (eram 1411 em 39; o `triage-rules` antigo segue com 30); `test:images`
com 93 e `test:smoke` com 101; os 95 cenários de tela (1704 checagens).

### 7.5 Pontuação de risco explicável

Junta YARA, ClamAV, alertas do PE, capacidades do capa, IOCs do FLOSS e reputação numa nota com a
lista dos motivos e o peso de cada um. Sugere o veredito; quem decide continua sendo o analista.

### 7.6 Relacionadas: mesmo certificado e mesmo comportamento

"Mesmo certificado" pela impressão digital de quem assinou (coluna indexada, como o imphash) e
"mesmo comportamento" pela parecença (Jaccard) entre os conjuntos de capacidades do capa, que pega
a mesma família recompilada, onde o imphash e o TLSH falham.

### 7.7 Retro-hunt com o capa

Como o retro-hunt de YARA: ao subir a versão das regras do capa, reanalisa as amostras de um
período, na mesma fila.

### 7.8 Desempacotar e extrair

`upx -d` quando o UPX é detectado, `innoextract` e 7-Zip para instaladores NSIS e Inno Setup, e o
extrator de PyInstaller. Cada arquivo de dentro vira amostra filha, como os anexos de e-mail, e
passa por tudo de novo. Num serviço isolado, como o capa.

**Implementado:**
- **Serviço `unpack`** (`apps/unpack`, 191 MB): o mesmo esqueleto do capa e do Ghidra, com os
  desempacotadores como **plugins** (`unpackers/uNN_nome.py`, contrato no `README.md` da pasta: o
  primeiro que reconhece a amostra a desempacota). O dono tem um desempacotador de Themida para
  depois: se ele for estático, entra como um plugin; se executar a amostra (como a maioria), o lugar
  é o sandbox do Proxmox, e o contêiner (sem execução no `/tmp`) não o comportaria.
- **Desempacotadores**, cada um medido antes:
  - UPX (`upx -d` 4.2): os três (x64, x86, DLL). O disfarçado (marca `UPX!` apagada) o `upx` recusa;
    o 7.1 o reconhece pelo código, e a ficha diz por que não saiu.
  - NSIS (7-Zip 25): a carga sai byte a byte igual, e o script do instalador junto.
  - Inno Setup (innoextract 1.9, o último lançamento): medido com os instaladores oficiais, lê o
    formato até o 6.2 e recusa o 6.3, 6.4, 6.7 e 7.1. A falha diz isso.
  - PyInstaller (pyinstxtractor 2026.07, GPL-3.0, um script baixado do commit exato e conferido pelo
    hash): só o `.pyc` do autor; o bootstrap e os runtime hooks do PyInstaller, iguais em todo
    programa, saem do resultado.
  - Arquivo embutido (7-Zip): ZIP, 7z, RAR ou CAB anexado; o que o 7-Zip só vê como o próprio
    executável não conta.
- **Resposta em ZIP sem compressão** com `manifest.json`, lida pelo leitor de ZIP do envio (tamanho,
  CRC e teto por arquivo); tetos de 50 arquivos e 256 MB somados por amostra, e o que passa vira
  "ficou de fora" com o motivo.
- **API** (`lib/unpack.ts`, `routes/unpack.ts`, tabela `UnpackJob`, migração
  `20261228000000_unpack_job`): um teste barato na chegada decide quem vai (empacotador, dados
  anexados ou as marcas de NSIS, Inno e PyInstaller), a fila é a do capa, e **cada arquivo vira
  amostra filha pelo mesmo caminho de um envio** (o `createFileEntry` passou a pedir só o log, não a
  requisição), do mesmo dono e com as tags da mãe. Duas gerações no máximo; arquivo igual à própria
  amostra fica de fora; o nome da filha é só o do arquivo (sem `../`). O analista pede quando a
  chegada não achou nada; de novo, só sem filhas (senão duplicaria).
- **Tela**: seção "Desempacotamento" com a situação, o desempacotador e os arquivos (link para a
  filha com o veredito, ou por que ficou de fora). Status do sistema com os desempacotadores e a fila.

**Um achado no caminho:** o UPX desempacotado é o mesmo programa, não o mesmo arquivo (107 bytes
diferentes em 31 KB: checksum zerado e diretórios do cabeçalho). E o `upx -d` refaz a tabela de
importação em outra ordem de DLLs: **o imphash muda**. O imphash de um binário desempacotado pelo
UPX não liga com o do mesmo programa compilado sem UPX; o conjunto de funções, sim.

**Testes:**
- `unpack.test.ts` (27) contra o serviço real, com o teto em 10 arquivos: quem é candidato; UPX
  (mesmo tamanho e importações do original, dono, tags, análise feita, a filha fora da fila, o
  evento na mãe), NSIS (a carga byte a byte), PyInstaller (só o `painel.pyc`, com a URL dele nas
  sugestões de IOC), Inno 6.2 (10 filhas e o resto pulado), Inno 6.4 (a falha honesta), UPX
  disfarçado, ZIP anexado, um contêiner novo a cada trabalho, as rotas, o limite de gerações e um
  serviço falso hostil (não é ZIP, recusa, arquivo igual à amostra, nome com `../`).
- Os fixtures ganharam um instalador NSIS (`makensis`), um programa PyInstaller 6.22.3 e os
  instaladores oficiais do Inno Setup 6.2.2 e 6.4.3, conferidos pelo SHA-256 publicado.
- `test:images`: configuração do compose, sem root, raiz somente leitura, `/tmp` sem execução, sem
  capacidades, sem internet, token, um ELF empacotado pelo `upx` desempacotado com o manifesto, e o
  contêiner novo depois.
- Cenário de tela `unpack`.
- **Prova inversa:** sem o limite de gerações, sem pular o arquivo igual, sem o motivo do UPX
  disfarçado, com o caminho no nome e sem o filtro do PyInstaller, cada um falha a sua checagem.

**Validação:** `format:check`, `lint` e `build` limpos na API e no web; **1462 checagens de
integração em 41 arquivos** (eram 1435 em 40); 120 testes unitários do web; `test:images` com **102**
(eram 93) e `test:smoke` com 101; os **96 cenários de tela** (1718 checagens), com o novo `unpack`;
Trivy sem achados na imagem do unpack e nos sete Dockerfiles.

**Ficou de fora:** Inno Setup 6.3 em diante (o innoextract não lê; voltar a olhar quando sair uma
versão nova dele), descompilar o `.pyc` do PyInstaller (por ora, as strings dele entram na análise
estática) e os desempacotadores dinâmicos (Themida, VMProtect), que precisam executar a amostra.

### 7.9 Detect It Easy

Compilador, empacotador, instalador e ofuscador .NET por assinaturas maduras (muito além do UPX
pelo código de entrada do 7.1). Tem versão de linha de comando para Linux; num contêiner como o do
capa.

**Implementado:**
- **Detect It Easy 3.21** (MIT; a 4.0.0 saiu 4 dias antes e ficou para depois, pela regra das duas
  semanas), no serviço `unpack`: o pacote oficial para Debian 13, conferido pelo SHA-256 publicado,
  mas só o `diec` e o banco de assinaturas. O pacote pede o Qt5 inteiro (a imagem de sondagem foi
  a 650 MB); o `ldd` mostrou que o `diec` só carrega o Qt Core, o Qt Script e a glib, e o resultado
  saiu **idêntico** nos 11 executáveis de teste com o pacote completo e com o enxuto (a imagem foi de
  191 para 294 MB).
- **O que ele traz** nos executáveis de teste: "MinGW (GCC 13)", "UPX(4.24)[NRV, brute]", o UPX
  disfarçado como "UPX(3.91+)[modified]", o NSIS 3.11, o Delphi 10.3 e a assinatura do instalador
  do Inno Setup, o .NET; e um falso positivo ("Go" no programa PyInstaller), que a tela trata como
  pista.
- **Todo executável vai para a fila** (PE, ELF, Mach-O, APK, JAR), não só os que pareciam
  empacotados: o DIE identifica, e os desempacotadores agem quando reconhecem. A partir da segunda
  geração, `?unpack=0`: só identifica.
- **Sem desempacotador, a ficha diz por quê:** protetor ("precisa de um desempacotador que execute a
  amostra"), empacotador sem desempacotador estático, o UPX alterado, ou "nada a desempacotar".
- **Regra de triagem** "Detect It Easy detectou" (migração `20261229000000_detect_it_easy`, que
  também grava as detecções, a versão e um eventual erro do DIE no trabalho), avaliada quando a
  identificação termina.
- **Um ajuste de desempenho que o teste mostrou:** com a identificação de todo executável, cada
  arquivo extraído voltava para a fila só para ser identificado, e cada rodada custa um contêiner
  novo (10,5 s ou mais): o `unpack.test` passou de 10 minutos. Agora o serviço identifica as filhas
  na mesma rodada (cerca de 150 ms cada) e diz se algum desempacotador as reconhece; a filha nasce
  com o trabalho concluído e só volta para a fila se houver o que desempacotar. Cada
  desempacotamento de verdade continua num contêiner limpo.
- **Atualizar o DIE é à mão:** o `diec` não fica registrado no dpkg (só o binário e o banco saem do
  pacote), então o Trivy varre as bibliotecas do Qt que vêm do Debian, mas não o DIE em si, e o
  Dependabot não vê um `ADD` de release. Ao trocar de versão: URL, SHA-256 e o `health.die` do
  `test:images`, juntos.
- **Um defeito que o teste hostil achou:** no 7.8, o limite de gerações era aplicado na fila (a neta
  não entrava). Com a identificação de todo executável, a neta entra e a API manda `?unpack=0`;
  mas um serviço falso que ignorava o parâmetro e devolvia arquivos criou filha de filha sem fim
  (o teste travou até o tempo do runner). A API agora descarta o que vier com `unpack` desligado,
  sem depender do serviço, e o teste conta as gerações.

**Testes** (`unpack.test.ts`, agora 33): quem vai para a fila; as detecções do UPX (com a versão e o
método) e do NSIS; a regra pelo DIE (vazio e pelo trecho "Nullsoft"), na mãe e não na filha; a
filha identificada na mesma rodada (`attempts` 0); o executável comum e o .NET identificados sem
nada a desempacotar; a neta da terceira geração só identificada; e, com um serviço falso, as notas
de protegido (Themida) e de empacotador sem desempacotador estático (MPRESS) e um serviço que
ignora o `?unpack=0` (a API para em duas gerações). Prova inversa: sem a identificação na mesma
rodada, sem a trava de gerações na API, ou com o valor vazio da regra valendo para qualquer
detecção, cada um derruba a própria checagem (sem a trava, o teste trava). `test:images` confere
a versão do DIE e a detecção do UPX com a raiz somente leitura. Cenários de tela do desempacotamento
(o DIE, o protetor em destaque) e das regras.

### 7.10 Descompilar .NET

`ilspycmd` devolve C# legível das classes que usam as chamadas sensíveis já detectadas no 7.1 e no
7.2. Para .NET serve mais que o Ghidra, que não descompila IL.

### 7.11 Extração de configuração de famílias conhecidas

Extratores no formato *maco* (os do CAPE) tiram C2, chaves e mutex de famílias comuns (AsyncRAT,
Remcos, AgentTesla...). É o IOC mais confiável e vai direto para o feed MISP/TAXII. O custo é
manter os extratores.

### 7.12 Emulação com o Speakeasy

O Speakeasy (Mandiant) emula o PE ou um shellcode e devolve a sequência de chamadas de API, sem VM:
fica entre a análise estática e o sandbox do Proxmox e pode rodar sozinho na fila.

### 7.13 APK, JAR e Mach-O

Já são detectados pelo tipo real, mas não analisados. Androguard dá permissões, componentes e
chamadas sensíveis do APK; o JAR e o Mach-O, o manifesto, as classes e as bibliotecas.

### 7.14 Office e PDF mais fundo

`oletools` (olevba com desofuscação, macros XLM 4.0, DDE) ao lado do parser em TypeScript que já
existe (item 70).

### 7.15 Sugerir regra YARA a partir da amostra

Um rascunho com strings exclusivas, imphash e trechos de código, para o analista revisar e salvar
como regra da equipe.

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

### I. O vuln-0008 não foi fechado na quarta rodada do Strix

O commit 385da17 fechou oito dos nove achados da rodada e deixou o vuln-0008 (X-Forwarded-For
aceito de qualquer vizinho em rede privada). O `TRUST_PROXY` continuou
`loopback,linklocal,uniquelocal`, e o plano não registrou nem a correção nem a decisão de
aceitar o risco. O próprio relatório dizia o que subiria a gravidade: a API dividir rede com
um container não confiável. Era o caso do `capture`, e com o Chromium sem sandbox. O item 6.15
fecha. Lição: ao fechar uma rodada, conferir os achados um por um contra o código, e não pela
mensagem do commit.


### J. Os testes de integração não passam pela checagem de tipos

Achado no 7.1, sem correção. Os testes rodam pelo `tsx`, que não checa tipos, e nem o `build`
nem o CI rodam `tsc -p tests/tsconfig.json`. Esse comando acusa 8 erros em quatro arquivos
antigos (`health`, `integrity-scrub`, `status-token` e `yara-update`: diretivas
`@ts-expect-error` que sobraram e índices sem tipo). O arquivo novo (`pe-analysis.test.ts`) foi
deixado sem erros. Corrigir os quatro e pôr o comando no CI é um item pequeno, se valer a pena.

### K. O MinIO de teste acumulava as amostras de todas as rodadas

Achado no 7.2 e corrigido. Cada arquivo de integração roda num banco novo, mas o MinIO de teste
fica de pé entre rodadas (só o `--clean` o remove), e o bucket guardava tudo: 4,8 GB, 606 MB deles
em `samples/`. O backup com amostras lista o bucket inteiro (por desenho: em produção é o bucket
real) e passou de 512 MB, o maior texto que o `inject` do Fastify monta, e o `backup.test` caiu
com "Cannot create a string longer than 0x1fffffe8 characters". Não era do código: era estado
de rodadas passadas. O `tests/run.mjs` agora recria o MinIO a cada rodada (o contêiner não tem
volume, então volta vazio), e o `backup.test` passou inteiro de novo (81).