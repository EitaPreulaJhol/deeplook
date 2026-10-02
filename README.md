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
| `SANDBOX_ENABLED` | Liga o sandbox (VM isolada no Proxmox) | `false` |
| `SANDBOX_CONSOLE_ENABLED` | Mostra o console noVNC no painel do analista | `true` |
| `PROXMOX_MOCK` | Simula o Proxmox em memória (sem PVE real) | `false` |
| `PROXMOX_API_URL` | URL da API do PVE (ex.: `https://192.168.0.10:8006`) | — |
| `PROXMOX_NODE` | Node do cluster onde as VMs são criadas | `pve` |
| `PROXMOX_USER` / `PROXMOX_PASSWORD` | Usuário dedicado do PVE (o console não aceita API token) | — |
| `PROXMOX_TEMPLATE_VMID` | VMID do template com `qemu-guest-agent` e rede isolada | `0` |
| `PROXMOX_ISO_STORAGE` | Storage que aceita `content iso` (onde a amostra vira ISO) | `local` |
| `PROXMOX_VERIFY_TLS` | `true` somente se o certificado do PVE for confiável | `false` |
| `SANDBOX_TAG` | Etiqueta das VMs do DeepLook (usada na limpeza) | `deeplook-sandbox` |
| `SANDBOX_TTL_MINUTES` | Tempo de vida do ambiente antes do descarte automático | `60` |
| `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` | Limite de ambientes ativos (total / por analista) | `4` / `2` |
| `SANDBOX_MOCK_VNC_URL` | (modo mock) VNC de teste para validar o console | — |

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

## Sandbox de análise (Proxmox VE)

Analistas podem abrir uma **VM isolada por amostra**: um clone do template é criado
no Proxmox, recebe a amostra como **CD-ROM somente leitura** (uma ISO9660 gerada na
hora, com o arquivo, o SHA-256 e um LEIA-ME) e é acessado pelo **console noVNC
embutido** na página da amostra. Ao encerrar — ou quando o prazo vence — a VM é
desligada, destruída e a ISO é apagada.

```
Analista -> POST /api/entries/:id/sandbox
              │
              ├─ 1. MinIO: baixa a amostra
              ├─ 2. genisoimage: monta a ISO (amostra + SHA256.txt + LEIA-ME.txt)
              ├─ 3. PVE: upload da ISO no storage (streaming multipart)
              ├─ 4. PVE: clone do template (linked clone; cai para cópia cheia se falhar)
              ├─ 5. PVE: config (tags + ide2=<iso>,media=cdrom,ro=1)
              └─ 6. PVE: start -> status RUNNING (console liberado)
```

### Por que ISO (e não upload do arquivo)?

A API do Proxmox não tem endpoint para "colocar um arquivo dentro do guest": o
caminho oficial é montar um volume com `content=iso` e anexá-lo como CD-ROM. Um
`.exe` renomeado para `.iso` **não** monta — por isso a API gera uma ISO9660 de
verdade com o `genisoimage` (já instalado na imagem da API).

### Console: por que um usuário/senha do PVE?

Os endpoints de console (`vncproxy`/`vncwebsocket`) **não aceitam API token**, só
ticket de usuário. A API então:

1. autentica com `PROXMOX_USER`/`PROXMOX_PASSWORD` (`POST /access/ticket`);
2. guarda o ticket em cache (~2h, renovado sozinho);
3. abre o `vncwebsocket` com cookie + `CSRFPreventionToken` **no backend**;
4. expõe ao navegador apenas `/api/sandbox/<id>/console/ws`, um WebSocket nosso
   (no nginx há um `location /api/sandbox/` com `Upgrade`/`Connection`).

O ticket nunca chega ao front. Como o ticket do PVE é preso ao IP, o proxy precisa
sair do **mesmo container** que pediu o ticket.

### Preparando o template no Proxmox

1. Crie uma VM (Windows/Linux) com `qemu-guest-agent`, **rede isolada** (bridge sem
   rota para a LAN) e sem credenciais corporativas.
2. Instale as ferramentas de análise que você usa.
3. **Crie um snapshot** (o linked clone usa esse estado como base; sem snapshot o
   DeepLook cai automaticamente para uma cópia cheia, mais lenta).
4. Converta em template (`qm template <vmid>`).
5. Crie um usuário dedicado (`deeplook@pve`) com `PVEAuditor` + `PVEVMAdmin`
   (`/vms/<vmid do template>` para clonar e `/vms` para gerenciar os clones).
6. Preencha os `PROXMOX_*` no `.env` e ligue com `SANDBOX_ENABLED=true`.

### Modo mock (desenvolvimento sem PVE)

Com `PROXMOX_MOCK=true` a API simula o Proxmox em memória (clone, start, tasks,
vncproxy, screenshot): o fluxo completo — provisionar, console, descartar — roda
sem um PVE real. Valide com `scripts/smoke-sandbox.ps1`.

### Limites, TTL e limpeza

- `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` limitam quantos ambientes existem.
- `SANDBOX_TTL_MINUTES` define o prazo; o **reaper** roda a cada minuto e encerra o
  que venceu.
- No boot a API marca provisionamentos interrompidos como falha, remove VMs com a
  etiqueta `SANDBOX_TAG` sem sessão ativa e ISOs `deeplook-*` órfãos.
- `GET /api/sandbox/health` (admin) mostra o diagnóstico: PVE acessível, template,
  storage com `content iso`, usuário do console e limites configurados.

### Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/api/sandbox/health` | Diagnóstico da integração (admin) |
| GET | `/api/entries/:id/sandbox` | Sessão ativa da amostra (usada no painel) |
| POST | `/api/entries/:id/sandbox` | Abre o ambiente (analista) |
| GET | `/api/sandbox` | Lista ambientes (`?active=true`, `?scope=all` p/ admin) |
| GET | `/api/sandbox/:id` | Detalhe + estado atual da VM (polling do painel) |
| POST | `/api/sandbox/:id/extend` | Estende o prazo |
| POST | `/api/sandbox/:id/power` | Liga/desliga a VM (`{"action":"on"\|"off"}`) |
| DELETE | `/api/sandbox/:id` | Descarta (destrói a VM e apaga o ISO) |
| GET | `/api/sandbox/:id/console` | Caminho do WebSocket do console |
| GET | `/api/sandbox/:id/console/ws` | WebSocket (proxy autenticado para o PVE) |
| GET | `/api/sandbox/:id/screenshot` | Captura de tela (PNG) para o relatório |

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

Para o sandbox (com `SANDBOX_ENABLED=true`), o teste específico abre um ambiente,
acompanha o provisionamento, confere console/screenshot, valida o WebSocket do
console, estende o prazo e descarta a VM:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-sandbox.ps1
```

Checagem visual (screenshot de uma página autenticada via CDP, sem dependências):

```powershell
node scripts/ui-shot.mjs "http://localhost:8080/entries/<id>" data/ui.png "<cookie dl_session>"
```

---

## Roadmap (próximos passos)

- Scanners automáticos (ClamAV e/ou VirusTotal) por hash/URL.
- Comentários nas amostras e múltiplos anexos por envio.
- Exportação de relatórios (PDF/Markdown).
- 2FA e política de senha.
