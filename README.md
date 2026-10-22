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
| `SESSION_TTL_HOURS` | Validade máxima da sessão (horas), mesmo com uso contínuo | `168` |
| `SESSION_IDLE_MINUTES` | Expira a sessão após N minutos sem atividade do usuário (aviso 2 min antes) | `30` |
| `SLA_WARN_HOURS` | Amostra não concluída há mais de N horas no status atual ganha bolinha laranja (alerta) | `24` |
| `SLA_LATE_HOURS` | Acima de N horas fica vermelha e entra na fila "Atrasadas" | `72` |
| `COOKIE_SECURE` | `true` quando servir somente via HTTPS | `false` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin semeado no primeiro boot | — |
| `MAX_UPLOAD_MB` | Tamanho máximo de upload | `200` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Credenciais do MinIO | `deeplook` |
| `MINIO_CONSOLE_PORT` | Porta (loopback) do console do MinIO no host | `9001` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | Bucket usado pela API | `http://minio:9000` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciais S3 da API | = MinIO root |
| `WEB_PORT` | Porta publicada no host | `8080` |
| `SANDBOX_ENABLED` | Liga o sandbox (VM isolada no Proxmox) | `false` |
| `SANDBOX_CONSOLE_ENABLED` | Habilita o console noVNC (janela dedicada) para o analista | `true` |
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
├─ docs/              # guias: interface-hpsm.md, ux-backlog.md, proxmox.md
├─ scripts/           # smoke tests (PowerShell) e testes visuais (ui-playwright/)
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

## Interface (estilo HP Service Manager 9)

A interface imita o **web client do HP Service Manager 9**, sem modernizar: tema
claro, Tahoma 12px, controles de 24px, masthead azul, **Navegador do Sistema** em
árvore, **abas de documento** para cada tela aberta, barra de mensagens única,
toolbar de ações por registro e formulários com rótulo à esquerda. O comportamento
dos controles vem do Carbon Design System; o visual vem dos tokens e do skin:

| Arquivo | Papel |
| --- | --- |
| `src/styles/_tokens.scss` | tokens `--dl-*` (cores, tipografia, medidas) — fonte única de verdade |
| `src/styles/hpsm.scss` | skin do app logado: realinha os tokens `--cds-*` do Carbon e estiliza os componentes `hpsm-*`/`dl-*` |
| `src/styles/auth.scss` | páginas públicas (home, login, cadastro) |
| `src/styles/app.scss` | entrada dos estilos + layout da casca |

Componentes, convenções (o que usar e o que evitar do Carbon), rotas, preferências do
usuário e a verificação visual estão em
**[`docs/interface-hpsm.md`](docs/interface-hpsm.md)**. Ideias de UX priorizadas:
**[`docs/ux-backlog.md`](docs/ux-backlog.md)**.

### Minha Conta e preferências

O nome do usuário no topo abre um submenu (Minha conta, Alterar senha, Preferências,
Sair). Em `/user` o usuário vê seus dados (somente leitura), troca a senha — o que
**encerra todas as sessões** e exige novo login — e ajusta as preferências: página
inicial (padrão: a **Página Inicial** de boas-vindas, `/inicio`), registros por página
e reabrir as abas da sessão anterior.

| Método | Rota | Função |
|---|---|---|
| PATCH | `/api/me/preferences` | Atualiza preferências (parcial) |
| POST | `/api/me/password` | Troca a senha e encerra todas as sessões |

---

## Sandbox de análise (Proxmox VE)

Analistas podem abrir uma **VM isolada por amostra**: um clone do template é criado
no Proxmox, recebe a amostra como **CD-ROM somente leitura** (uma ISO9660 gerada na
hora, com o arquivo, o SHA-256 e um LEIA-ME) e é acessado por um **console noVNC em
janela dedicada** (popup com a toolbar de controle da VM). Ao encerrar — ou quando o
prazo vence — a VM é desligada, destruída e a ISO é apagada.

```
Analista -> POST /api/entries/:id/sandbox
              │
              ├─ 1. MinIO: baixa a amostra
              ├─ 2. genisoimage: monta a ISO (amostra + SHA256.txt + LEIA-ME.txt)
              ├─ 3. PVE: upload da ISO no storage (streaming multipart)
              ├─ 4. PVE: clone do template (linked clone; cai para cópia cheia se falhar)
              ├─ 5. PVE: config (tags + ide2=<iso>,media=cdrom)  # cdrom ja e somente leitura
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

**Auth VNC:** o `vncproxy` também devolve uma **senha** de console; o
`vncwebsocket` exige auth VNC (a senha nunca vai ao front antes da hora: o noVNC a
busca em `GET /api/sandbox/:id/console/credentials` no handshake).

**Janela do console:** a aba *Análise* só gerencia o ambiente; o console abre em uma
**janela separada** (`/sandbox/entry/:id/console`, via `window.open`) que traz a
**toolbar de controle da VM**: estender prazo, capturar tela e descartar ambiente. A
janela é reaproveitada pelo nome (clicar de novo foca a mesma janela) e, como o
provisionamento leva alguns segundos, ela já abre mostrando as fases e entra no
console sozinha quando a VM sobe. Se o navegador bloquear o pop-up, o painel avisa
como liberar.

**Captura de tela:** o botão "Capturar tela" (na toolbar da janela do console) lê o
**canvas do noVNC** no próprio navegador e abre o PNG numa nova aba — o PVE removeu o
endpoint server-side de screenshot no PVE 9, que agora responde `501`.

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

> 📖 Passo a passo completo — template, permissões (incluindo **Datastore** para o
> upload da ISO), `.env`, rede Docker→PVE, validação e troubleshooting:
> **[`docs/proxmox.md`](docs/proxmox.md)**.

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
| GET | `/api/sandbox/:id/console/credentials` | Senha efêmera do console (auth VNC no handshake) |
| GET | `/api/sandbox/:id/console/ws` | WebSocket (proxy autenticado para o PVE) |
| GET | `/api/sandbox/:id/screenshot` | Captura de tela (PNG) — removido no PVE 9; o painel captura no navegador |

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

Testes visuais sem banco (build do front + API simulada, Playwright em Docker):
screenshots de todas as telas e checagens dos filtros e do fluxo de Minha Conta.

```powershell
cd apps/web; npm run build; cd ../..
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
```

Detalhes em [`docs/interface-hpsm.md`](docs/interface-hpsm.md#7-verificação-visual-playwright).

---

## Roadmap (próximos passos)

Melhorias de interface e usabilidade estão priorizadas em
[`docs/ux-backlog.md`](docs/ux-backlog.md). Outros próximos passos:

- Scanners automáticos (ClamAV e/ou VirusTotal) por hash/URL.
- Múltiplos anexos por envio (comentários já existem como "Atualizações" na aba Histórico).
- Exportação de relatórios (PDF/Markdown).
- 2FA e política de senha.
