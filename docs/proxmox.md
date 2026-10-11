# 🔌 Comunicação com o Proxmox VE (sandbox de análise)

Este guia explica como configurar o DeepLook para falar com um **Proxmox VE (PVE)**
real e abrir a **VM de análise** (sandbox) a partir de uma amostra.

> A integração **já está implementada no código**. Para "ligar" o PVE você só
> precisa **preparar o Proxmox** e **preencher o `.env`** — não há código novo a
> escrever.

---

## 1. Como funciona

Uma amostra vira uma **VM isolada por amostra**: um clone do template é criado no
Proxmox, recebe a amostra como **CD-ROM somente leitura** (uma ISO9660 gerada na
hora) e é acessado pelo **console noVNC** embutido na página da amostra. Ao
encerrar — ou quando o prazo vence — a VM é destruída e a ISO é apagada.

```
Analista -> POST /api/entries/:id/sandbox
              │
              ├─ 1. MinIO: baixa a amostra
              ├─ 2. genisoimage: monta a ISO (amostra + SHA256.txt + LEIA-ME.txt)
              ├─ 3. PVE: upload da ISO no storage (streaming multipart)
              ├─ 4. PVE: clone do template (linked clone; cai p/ cópia cheia se falhar)
              ├─ 5. PVE: config (tags + ide2=<iso>,media=cdrom)  # cdrom ja e somente leitura
              └─ 6. PVE: start -> status RUNNING (console liberado)
```

Componentes envolvidos (nenhum precisa ser alterado):

| Componente | Arquivo |
|---|---|
| Cliente HTTP do PVE (ticket, `pve()`, upload de ISO, tasks, VNC) | `apps/api/src/lib/proxmox.ts` |
| Pipeline de provisionamento + reaper/limpeza | `apps/api/src/lib/sandbox.ts` |
| Rotas REST + WebSocket do console | `apps/api/src/routes/sandbox.ts` |
| Simulador (sem PVE) | `apps/api/src/lib/proxmox-mock.ts` |
| Proxy do WebSocket do console | `apps/web/nginx.conf` (`location /api/sandbox`) |
| `genisoimage` na imagem da API | `apps/api/Dockerfile` |
| Variáveis injetadas no container | `docker-compose.yml` |
| Validação das variáveis | `apps/api/src/env.ts` |

### Por que ISO (e não upload do arquivo)?

A API do Proxmox não tem endpoint para "colocar um arquivo dentro do guest": o
caminho oficial é montar um volume com `content=iso` e anexá-lo como CD-ROM. Um
`.exe` renomeado para `.iso` **não** monta — por isso a API gera uma ISO9660 de
verdade com o `genisoimage` (já instalado na imagem da API).

### Console: por que usuário/senha e não API token?

Os endpoints de console (`vncproxy`/`vncwebsocket`) **não aceitam API token**, só
ticket de usuário. A API então autentica com `PROXMOX_USER`/`PROXMOX_PASSWORD`
(`POST /access/ticket`), guarda o ticket em cache (~2h) e abre o `vncwebsocket`
**no backend**. O navegador só vê `/api/sandbox/<id>/console/ws` (WebSocket nosso,
proxiado pelo nginx). O ticket nunca chega ao front.

Como o ticket do PVE é preso ao IP, o proxy precisa sair do **mesmo container**
que pediu o ticket — por isso o túnel do console é feito pela API, não pelo
navegador.

**Auth VNC:** o `vncproxy` devolve também uma **senha** (`data.password`), e o
`vncwebsocket` do PVE exige **auth VNC** (tipo 2: DES sobre o desafio). O backend
guarda essa senha por sessão e o noVNC a busca em
`GET /api/sandbox/<id>/console/credentials` durante o handshake; o ticket
continua só no backend.

### Captura de tela (screenshot)

O botão **"Capturar tela"** do painel lê os pixels do **canvas do noVNC** direto
no navegador e abre o PNG numa nova aba. Isso é proposital: o PVE **removeu o
endpoint server-side de screenshot** (no PVE 9 a rota
`/nodes/{node}/qemu/{vmid}/screenshot` responde `501 Not implemented`), então a
captura client-side funciona em qualquer versão do PVE. (O endpoint
`GET /api/sandbox/:id/screenshot` do DeepLook continua existindo para PVE ≤ 8.)

---

## 2. Preparando o Proxmox VE

### 2.1 Template da VM de análise

1. Crie uma VM (Windows/Linux) com `qemu-guest-agent`, **rede isolada** (bridge
   sem rota para a LAN) e **sem credenciais corporativas**.
2. Instale as ferramentas de análise que você usa.
3. **Crie um snapshot** (o linked clone usa esse estado como base; sem snapshot o
   DeepLook cai automaticamente para uma cópia cheia, mais lenta).
4. Converta em template: `qm template <vmid>`. Anote o `<vmid>`.

### 2.2 Usuário dedicado e permissões

Crie um usuário dedicado (ex.: `deeplook@pve`) com **senha** — o console exige
usuário/senha, **API token não serve**.

Conceda as permissões abaixo (a de **Datastore** é a mais esquecida — sem ela o
upload da ISO falha com `403`):

| Caminho | Papel sugerido | Cobre |
|---|---|---|
| `/` | `PVEAuditor` | `GET /version` (health) e auditoria geral |
| `/vms` (propagate) | `PVEVMAdmin` | `VM.Audit`, `VM.Allocate` (clone/delete), `VM.Clone`, `VM.Config.*`, `VM.PowerMgmt` (start/stop), `VM.Console` (vncproxy/screenshot) |
| `/storage/<PROXMOX_ISO_STORAGE>` | `PVEDatastoreAdmin` | `Datastore.Audit`, `Datastore.Allocate`, `Datastore.AllocateSpace` (upload/delete da ISO) |

Chamadas que a API faz ao PVE (referência das permissões acima):

- `GET /version`
- `GET /nodes/{node}/qemu` e `GET /nodes/{node}/qemu/{vmid}/status/current`
- `GET /cluster/nextid`
- `POST /nodes/{node}/qemu/{tpl}/clone`
- `PUT /nodes/{node}/qemu/{vmid}/config`
- `POST /nodes/{node}/qemu/{vmid}/status/start` (e `shutdown`)
- `DELETE /nodes/{node}/qemu/{vmid}`
- `POST /nodes/{node}/storage/{storage}/upload`
- `GET/DELETE /nodes/{node}/storage/{storage}/content`
- `GET /nodes/{node}/storage/{storage}/status`
- `POST /nodes/{node}/qemu/{vmid}/vncproxy` + `vncwebsocket`
- `POST /nodes/{node}/qemu/{vmid}/screenshot` *(removido no PVE 9 — a captura no painel passou a ser feita no navegador)*

### 2.3 Storage com `content iso`

O storage onde a ISO será gravada precisa aceitar `content=iso` (ex.: `local`).
No PVE: **Datacenter → Storage → <storage> → Content → marcar "ISO image"**.
O endpoint `/api/sandbox/health` valida isso.

---

## 3. Configurando o `.env`

O `.env` da raiz é lido automaticamente pelo `docker-compose.yml` (não é preciso
editar o compose). Parta do `.env.example` (`cp .env.example .env`) e ajuste o
bloco do sandbox. **Modo real** (aponta para o PVE):

```dotenv
# ---- Sandbox (VM isolada no Proxmox VE) ----
SANDBOX_ENABLED=true
SANDBOX_CONSOLE_ENABLED=true
PROXMOX_MOCK=false                            # desliga o simulador

PROXMOX_API_URL=https://192.168.0.10:8006     # IP real do PVE (porta 8006)
PROXMOX_NODE=pve                              # node do cluster
PROXMOX_USER=deeplook@pve                     # usuário+senha (token NÃO serve p/ console)
PROXMOX_PASSWORD=<senha-forte>
PROXMOX_TEMPLATE_VMID=9000                    # vmid do template (seção 2.1)
PROXMOX_ISO_STORAGE=local                     # storage com content "iso"
PROXMOX_VERIFY_TLS=false                      # false se o cert do PVE for self-signed

SANDBOX_TAG=deeplook-sandbox
SANDBOX_TTL_MINUTES=60
SANDBOX_MAX_ACTIVE=4
SANDBOX_MAX_PER_USER=2
```

> ⚠️ O `.env` de desenvolvimento do repositório costuma vir com
> `PROXMOX_MOCK=true` (simulador em memória). Enquanto ele estiver `true`, **nada
> toca o PVE real**. A primeira mudança é trocar para `false`.

**Validação obrigatória:** quando `SANDBOX_ENABLED=true` e `PROXMOX_MOCK=false`, o
`apps/api/src/env.ts` exige `PROXMOX_API_URL`, `PROXMOX_USER`, `PROXMOX_PASSWORD` e
`PROXMOX_TEMPLATE_VMID`. Se faltar qualquer um, a API **não sobe** e loga o erro
de validação no boot.

---

## 4. Rede (Docker → PVE)

O container `api` roda na bridge `deeplook` e precisa alcançar `https://<pve>:8006`:

- O tráfego sai NATeado pelo host Docker, então o PVE enxerga o **IP do host
  Docker**. O ticket do PVE é preso a esse IP — e como **todas** as chamadas
  (ticket + `vncwebsocket`) partem do mesmo container, isso é consistente.
- Se houver **firewall** no PVE, libere a porta **8006** para o IP do host Docker.
- Use o **IP da LAN** do PVE (não `localhost`, que dentro do container aponta para
  o próprio container).
- `PROXMOX_VERIFY_TLS=false` (padrão) evita erro de certificado self-signed; só
  use `true` se o certificado do PVE for confiável.

---

## 5. Subindo e validando

```powershell
docker compose up -d --build api web
docker compose logs -f api
```

Nos logs deve aparecer algo como:
`[sandbox] habilitado (node pve, template 9000, ttl 60min)`.

Validação:

1. **Diagnóstico** — `GET /api/sandbox/health` (admin) retorna os checks
   `pve-acessivel`, `template`, `storage-iso` e `usuario-console`, além de
   `enabled`, `mock`, `node`, `templateVmid`, `isoStorage` e os limites.
2. **Fluxo completo**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/smoke-sandbox.ps1
   ```
   O script abre o ambiente, acompanha as fases (`gerando-iso` → `enviando-iso`
   → `clonando` → `configurando` → `iniciando`), testa screenshot, valida o
   WebSocket do console (`scripts/ws-console-check.mjs`), estende o prazo e
   descarta a VM.

---

## 6. Referência rápida das variáveis

| Variável | Descrição | Padrão |
|---|---|---|
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

---

## 7. Solução de problemas

| Sintoma | Causa provável / correção |
|---|---|
| API não sobe / erro de env no boot | Faltou `PROXMOX_API_URL`/`USER`/`PASSWORD`/`TEMPLATE_VMID` com `SANDBOX_ENABLED=true` e `MOCK=false` |
| `sandbox/health` → `pve-acessivel: FALHOU` | IP/porta errados, PVE inacessível do container ou firewall na 8006 |
| Upload da ISO falha com `403` | Faltou `PVEDatastoreAdmin` (Datastore.Allocate/AllocateSpace) no storage da ISO |
| `template: false` | `PROXMOX_TEMPLATE_VMID` errado, template inexistente ou sem `VM.Audit`/`VM.Clone` |
| `storage-iso: false` | O storage não tem `content "iso"` habilitado |
| Console não abre | Falta usuário/senha (`usuario-console`) ou o WebSocket do `nginx` foi alterado; confira `location /api/sandbox` |
| Clone lento | Template sem snapshot → cai para cópia cheia. Crie um snapshot |
| VM "presa" em PROVISIONING | A API recupera no boot (marca FAILED após 15 min) e o reaper limpa órfãos a cada minuto |

Sempre comece pelo diagnóstico: **`GET /api/sandbox/health`** (admin).

---

## 8. Modo mock e desligamento

- **Sem PVE (desenvolvimento):** `SANDBOX_ENABLED=true` + `PROXMOX_MOCK=true`
  simula clone, start, tasks, vncproxy e screenshot em memória. Valide com
  `scripts/smoke-sandbox.ps1`.
- **Desligar a feature:** `SANDBOX_ENABLED=false`. O painel do analista mostra
  "não habilitado" e os endpoints respondem `503`, sem exigir nada do PVE.

### Limites, TTL e limpeza

- `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` limitam quantos ambientes existem.
- `SANDBOX_TTL_MINUTES` define o prazo; o **reaper** roda a cada minuto e encerra
  o que venceu.
- No boot a API marca provisionamentos interrompidos como falha, remove VMs com a
  etiqueta `SANDBOX_TAG` sem sessão ativa e ISOs `deeplook-*` órfãos.
- `GET /api/sandbox/health` (admin) mostra o diagnóstico completo.
