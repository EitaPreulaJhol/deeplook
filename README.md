# 🔍 DeepLook

Ferramenta self-hosted (homelab) para que amigos e especialistas em segurança
centralizem **amostras de software e links suspeitos** encontrados na web,
com **triagem e relatórios** feitos pelos analistas.

A interface usa o **Carbon Design System (IBM)** — nada de UI genérica.

Expõe-se à internet via **Cloudflare Tunnel rodando no host (fora do Docker)**.

---

## Arquitetura

```
                 Internet
                    │
        ┌───────────▼────────────┐
        │ Cloudflare Tunnel      │  (FORA do Docker, no host)
        │ cloudflared            │  aponta p/ http://localhost:8080
        └───────────┬────────────┘
                    │ 127.0.0.1:8080 (publicado apenas no loopback)
   ┌────────────────▼──────────────────────────────────────────┐
   │                     docker compose                        │
   │  ┌────────┐  /api   ┌────────┐   SQL   ┌──────────────┐    │
   │  │ web    │────────▶│ api    │────────▶│ db (postgres)│    │
   │  │ nginx  │         │ Fastify│         └──────────────┘    │
   │  │ +React │         │ Prisma │   S3    ┌──────────────┐    │
   │  │ Carbon │         └───┬────┘────────▶│ minio        │    │
   │  └────────┘             │              └──────────────┘    │
   └───────────────────────────────────────────────────────────┘
```

- **web**: nginx servindo o build (React + Carbon) e fazendo proxy de `/api` para a API.
- **api**: Fastify + Prisma. No boot aplica migrações, roda o seed do admin e garante o bucket no MinIO.
- **db**: PostgreSQL 16.
- **minio**: armazenamento S3-compatible das amostras (nunca exposto publicamente).
- Porta publicada no host: **`127.0.0.1:8080`** (consumida pelo Cloudflare Tunnel).

---

## Requisitos

- Docker + Docker Compose (plugin `docker compose`).
- (Opcional, para expor) `cloudflared` instalado **no host**.

---

## Como rodar

```bash
# 1) Configure as variáveis (senhas, segredo de sessão, admin)
cp .env.example .env
# edite o .env, principalmente: POSTGRES_PASSWORD, SESSION_SECRET,
# ADMIN_PASSWORD, MINIO_ROOT_PASSWORD e S3_SECRET_KEY

# 2) Suba tudo
docker compose build
docker compose up
```

Acesse: **http://localhost:8080**

> Dica: rode em segundo plano com `docker compose up -d` e veja os logs com
> `docker compose logs -f`.

---

## Primeiro acesso

O **admin** é criado automaticamente no primeiro boot a partir das variáveis
`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`.

1. Entre em **/login** com essas credenciais.
2. Vá em **Administração → Chaves de ativação** e **gere uma chave**.
3. Compartilhe a chave com o amigo — ele se cadastra em **/register**
   informando a chave (o cadastro só é possível com uma chave válida).

---

## Papéis

| Papel | O que pode fazer |
|---|---|
| **USER** (amigo) | Enviar amostras, ver o histórico global (leitura) e "Meus Uploads". |
| **ANALYST** | Tudo do USER + criar relatórios, definir status/veredito. |
| **ADMIN** | Tudo + gerenciar usuários e chaves de ativação. |

---

## Cloudflare Tunnel (no host, fora do Docker)

O DeepLook publica apenas `127.0.0.1:8080`, então instale o `cloudflared`
oficial no host e aponte o túnel para essa porta:

```bash
# exemplo (ajuste conforme seu SO/gerenciador de pacotes)
cloudflared tunnel login
cloudflared tunnel create deeplook
cloudflared tunnel route dns deeplook deeplook.seu-dominio.com
```

`config.yml` (tipicamente em `/etc/cloudflared/config.yml` ou `~/.cloudflared/config.yml`):

```yaml
tunnel: deeplook
credentials-file: /etc/cloudflared/<UUID>.json
ingress:
  - hostname: deeplook.seu-dominio.com
    service: http://localhost:8080
  - service: http_status:404
```

```bash
cloudflared tunnel run deeplook
# ou instale como serviço:  cloudflared service install
```

Como o tráfego chega por HTTPS até o Cloudflare, defina no `.env`:

```
COOKIE_SECURE=true
```

---

## Variáveis de ambiente

| Variável | Descrição | Padrão |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credenciais do PostgreSQL | `deeplook` |
| `SESSION_SECRET` | Segredo para os cookies de sessão (longo e aleatório) | — |
| `SESSION_TTL_HOURS` | Validade da sessão (horas) | `168` |
| `COOKIE_SECURE` | `true` quando servir somente via HTTPS | `false` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin semeado no primeiro boot | — |
| `MAX_UPLOAD_MB` | Tamanho máximo de upload | `200` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Credenciais do MinIO | `deeplook` |
| `MINIO_CONSOLE_PORT` | Porta (loopback) do console do MinIO no host | `9001` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | Bucket usado pela API | `http://minio:9000` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciais S3 da API | = MinIO root |
| `WEB_PORT` | Porta publicada no host | `8080` |

Console do MinIO (administração, apenas no loopback): http://localhost:9001

---

## Estrutura do projeto

```
deeplook/
├─ docker-compose.yml
├─ .env.example
├─ README.md
├─ apps/
│  ├─ api/            # Fastify + Prisma + S3 (MinIO)
│  │  ├─ prisma/      # schema, migrações, seed
│  │  └─ src/         # env, lib, routes
│  └─ web/            # React + Vite + @carbon/react
│     ├─ nginx.conf
│     └─ src/         # api, auth, components, pages, styles
└─ data/              # volumes (git-ignored): pgdata/, minio/
```

---

## Desenvolvimento local (sem Docker)

```bash
# API
cd apps/api
npm install
npx prisma migrate deploy   # precisa de um Postgres acessível
npm run dev                 # http://localhost:3000

# Web
cd apps/web
npm install
npm run dev                 # http://localhost:5173 (proxy /api -> :3000)
```

---

## Segurança e avisos

- ⚠️ O DeepLook **não executa** as amostras. É armazenamento/triagem, não sandbox.
  Manuseie arquivos baixados em ambiente isolado.
- Os objetos ficam em bucket **privado** no MinIO; o download só ocorre por
  endpoint autenticado da API.
- O cadastro exige **chave de ativação** gerada por um admin.
- Senhas usam **hash bcrypt**; a sessão usa **cookie httpOnly**.

---

## Qualidade de código (lint & format)

Cada app tem **ESLint** (flat config) + **Prettier** configurados:

```bash
# rode dentro de apps/web ou apps/api
npm run lint          # checa (sai com erro se houver problemas)
npm run lint:fix      # corrige automaticamente (ex.: ordem dos imports)
npm run format        # formata com Prettier
npm run format:check  # apenas verifica a formatacao
```

Regras ativas: `typescript-eslint` (recommended), ordenação de imports
(`simple-import-sort`), `react-hooks` (no web) e `eslint-config-prettier`
(desliga regras de estilo que conflitam com o Prettier).

Além disso, o `tsc` roda com **`noUnusedLocals`** e **`noUnusedParameters`** —
ou seja, o `npm run build` **falha** se sobrar variável/import/parâmetro sem uso.

---

## Design system (tokens & skin)

O visual é um tema escuro no estilo **Fluent**, o mesmo desenho das telas de
login/cadastro, aplicado sobre o Carbon Design System:

| Arquivo | Papel |
| --- | --- |
| `src/styles/_tokens.scss` | tokens `--dl-*` (cores, tipografia, formas) — fonte única de verdade |
| `src/styles/auth.scss` | telas de login/cadastro (consome os tokens) |
| `src/styles/fluent.scss` | skin do resto do app: realinha os tokens `--cds-*` do Carbon com a paleta Fluent e ajusta o que token não cobre (Segoe UI, cards, abas, campos sublinhados, tabelas, header, avisos) |
| `src/styles/app.scss` | entrada dos estilos + layout global (header, conteúdo, home, footer, scrollbar) |

Classes de estrutura usadas pelas páginas: `PageHeader`
(`.dl-page-head`/`.dl-page-header`/`.dl-page-subtitle`), `.dl-toolbar`,
`.dl-panel`, `.dl-detail-row`, `.dl-row`, `.dl-note`, `.dl-empty`,
`.dl-mono`, `.dl-taglist`.

---

## Smoke test (com a stack no ar)

Depois de `docker compose up`, rode o teste de ponta a ponta (usa as credenciais
padrão do admin definidas no `.env`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-test.ps1
```

Ele valida: frontend (SPA), health, login do admin, geração de chaves de ativação,
cadastro por chave (usuário e analista), envio de arquivo/link (MinIO),
listagens e busca (inclusive por tag), bloqueios de permissão (403/401),
criação de relatório, atualização de veredito/status e download autenticado.

---

## Roadmap (próximos passos)

- Scanners automáticos (ClamAV e/ou VirusTotal) por hash/URL.
- Comentários nas amostras e múltiplos anexos por envio.
- Exportação de relatórios (PDF/Markdown).
- 2FA e política de senha.
