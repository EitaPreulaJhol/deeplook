# 🔌 Comunicação com o Proxmox VE (sandbox de análise)

> 🇬🇧 [Read in English](proxmox.md)

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

O botão **"Capturar tela"** da toolbar da janela do console lê os pixels do
**canvas do noVNC** direto no navegador e abre o PNG numa nova aba. Isso é
proposital: o PVE **removeu o endpoint server-side de screenshot** (no PVE 9 a rota
`/nodes/{node}/qemu/{vmid}/screenshot` responde `501 Not implemented`), então a
captura client-side funciona em qualquer versão do PVE. (O endpoint
`GET /api/sandbox/:id/screenshot` do DeepLook continua existindo para PVE ≤ 8.)

---

## 2. Preparando o Proxmox VE

### 2.1 Template da VM de análise

1. Crie uma VM (Windows/Linux) com `qemu-guest-agent`, **rede isolada** (bridge
   sem rota para a LAN) e **sem credenciais corporativas**.
2. Instale as ferramentas de análise que você usa. Sugestões do que instalar, com os links
   oficiais e as configurações do Windows, estão em [`template-windows.pt-BR.md`](template-windows.pt-BR.md).
   - **Sysmon (opcional, Windows):** com ele, os artefatos do ambiente trazem a árvore de
     processos, as conexões, os arquivos criados, o registro alterado e as consultas DNS. Baixe o
     Sysmon da Microsoft (Sysinternals) e uma configuração pronta: recomendamos a
     [sysmon-modular](https://github.com/olafhartong/sysmon-modular) (`sysmonconfig.xml`), de Olaf
     Hartong; a da [SwiftOnSecurity](https://github.com/SwiftOnSecurity/sysmon-config) também serve.
     Num PowerShell como administrador:
     ```powershell
     .\Sysmon64.exe -accepteula -i sysmonconfig.xml
     # o canal precisa existir (o DeepLook le os eventos 1, 3, 11, 12, 13, 14 e 22)
     Get-WinEvent -ListLog Microsoft-Windows-Sysmon/Operational
     ```
     A configuração precisa registrar o evento 22 (DNS) e o 3 (rede): as duas citadas registram.
     Aumente o tamanho do log se a amostra for barulhenta
     (`wevtutil sl Microsoft-Windows-Sysmon/Operational /ms:67108864`). O DeepLook não instala nada
     na VM: sem o Sysmon, ficam os prints e a lista de processos.
   - **Sysmon a cada sessão (recomendado):** instalado com `-i`, o Sysmon já é um serviço que sobe
     em todo boot, mas o log guarda o que aconteceu enquanto o template era preparado, e um serviço
     parado passaria despercebido. O
     [`scripts/template-windows/sysmon.bat`](../scripts/template-windows/sysmon.bat)
     roda a cada boot de cada ambiente e: instala o Sysmon se o serviço não existir (com até 3
     tentativas, desfazendo a que falhou), ou só reaplica
     a configuração (trocar o XML não exige refazer a instalação), aumenta o log para 64 MB,
     limpa o log, para o ambiente começar sem eventos antigos, e confere que o serviço está rodando.
     O que fez fica em `sysmon.log`, na mesma pasta (em inglês, como o resto do arquivo).
     1. Ponha numa pasta do template, sem espaços nem parênteses no caminho (ex.:
        `C:\Tools\Sysmon\`): o `Sysmon64.exe`, o `sysmonconfig.xml` e o `sysmon.bat`.
     2. Num prompt como administrador, registre a tarefa que roda na inicialização, como SYSTEM.
        O `/delay` e a espera dentro do `.bat` existem porque, no boot, a tarefa pode rodar antes
        do serviço Log de Eventos do Windows, de que o Sysmon precisa para registrar o canal (sem
        ele, a instalação falha com o código 13):
        ```bat
        schtasks /create /tn "DeepLook\Sysmon" /tr "\"C:\Tools\Sysmon\sysmon.bat\"" /sc onstart /delay 0000:30 /ru SYSTEM /rl HIGHEST /f
        ```
     3. Rode uma vez para conferir (`schtasks /run /tn "DeepLook\Sysmon"`), veja o
        `sysmon.log` terminar em "Sysmon running, log cleared" e reinicie a VM para conferir
        que ele roda sozinho no boot.
     4. Desligue a VM e converta em template. O `node scripts/sandbox-real-check.mjs` confere a
        leitura do Sysmon num ambiente de verdade (fase 4).

     A limpeza é só para começar do zero: o DeepLook lê os eventos desde o início de cada ambiente.
   - **Login automático (recomendado):** com o template entrando sozinho num usuário comum (sem
     privilégio de administrador), a execução automática da amostra roda na sessão dele e aparece no
     console. Configure com o `netplwiz` ou com o
     [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon) da Sysinternals. Sem
     usuário logado, a amostra roda como SYSTEM, fora da tela.
3. **Crie um snapshot** (o linked clone usa esse estado como base; sem snapshot o
   DeepLook cai automaticamente para uma cópia cheia, mais lenta).
4. Converta em template: `qm template <vmid>`. Anote o `<vmid>`.

### 2.2 Usuário dedicado e permissões

Crie um usuário dedicado (ex.: `deeplook@pve`) com **senha** — o console exige
usuário/senha, **API token não serve**.

Conceda as permissões abaixo (as de **Datastore** são as mais esquecidas — sem
elas o upload da ISO **ou** o clone falham com `403`):

| Caminho | Papel sugerido | Cobre |
|---|---|---|
| `/` | `PVEAuditor` | `GET /version` (health) e auditoria geral |
| `/vms` (propagate) | `PVEVMAdmin` | `VM.Audit`, `VM.Allocate` (clone/delete), `VM.Clone`, `VM.Config.*`, `VM.PowerMgmt` (start/stop), `VM.Console` (vncproxy/screenshot), o uso do agente da VM (`VM.GuestAgent.Unrestricted` no PVE 9, `VM.Monitor` no 8) para a lista de processos dos artefatos |
| `/storage/<PROXMOX_ISO_STORAGE>` | `PVEDatastoreAdmin` | `Datastore.Audit`, `Datastore.AllocateTemplate` (upload da ISO), `Datastore.Allocate` (apagar a ISO) |
| `/storage/<storage dos discos do template>` | `PVEDatastoreAdmin` | `Datastore.AllocateSpace` para o clone criar os discos |
| `/sdn/zones/<zona>/<bridge do template>` | `PVESDNUser` | `SDN.Use` para o clone reutilizar a rede do template |

> **`/vms`, nunca `/vms/<vmid>`.** O clone recebe um **VMID novo** e o PVE confere
> `VM.Allocate` em `/vms/<vmid novo>`; uma permissão dada só no template
> (`/vms/1000`) não vale para o clone. Nesse caso o PVE responde apenas
> `Permission check failed` (sem caminho), porque a checagem do `clone` é um `ou`.

> **Rede:** a checagem de `SDN.Use` usa a zona `localnetwork` para bridges
> clássicas (`vmbr1` → `/sdn/zones/localnetwork/vmbr1`). A bridge do template
> aparece no `qm config <template>` (linha `net0`).

Com os valores do seu template (troque `<template>`, os storages e a bridge
pelos que aparecem no `qm config <template>`):

```bash
# 1. VMs: o clone usa um VMID novo, entao a permissao vai em /vms (propagate).
pveum acl modify /vms --users deeplook@pve --roles PVEVMAdmin --propagate 1
# 2. Rede do template (linha net0): bridge classica fica na zona localnetwork.
pveum acl modify /sdn/zones/localnetwork/<bridge> --users deeplook@pve --roles PVESDNUser
# 3. Storage da ISO e cada storage que tem disco no template.
pveum acl modify /storage/<iso-storage> --users deeplook@pve --roles PVEDatastoreAdmin
pveum acl modify /storage/<disco-storage> --users deeplook@pve --roles PVEDatastoreAdmin
```

Para conferir o que a conta realmente enxerga (o PVE mostra os privilégios
efetivos por caminho):

```bash
pvesh get /access/permissions --output-format json | grep -A20 '"/vms"'
```

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

---

## 7. Solução de problemas

| Sintoma | Causa provável / correção |
|---|---|
| API não sobe / erro de env no boot | Faltou `PROXMOX_API_URL`/`USER`/`PASSWORD`/`TEMPLATE_VMID` com `SANDBOX_ENABLED=true` e `MOCK=false` |
| `sandbox/health` → `pve-acessivel: FALHOU` | IP/porta errados, PVE inacessível do container ou firewall na 8006 |
| Upload da ISO falha com `403` | Faltou `PVEDatastoreAdmin` no storage da ISO: `Datastore.AllocateTemplate` no upload e `Datastore.Allocate` ao apagar |
| Clone falha com `403` e a mensagem é só `Permission check failed` (sem caminho) | Falta `VM.Allocate` em `/vms`: a permissão foi concedida em `/vms/<template>`. O clone usa um VMID novo e a checagem `ou` do PVE não detalha o caminho |
| Clone falha com `403 (/sdn/zones/..., SDN.Use)` | Falta `PVESDNUser` (ou `SDN.Use`) na bridge do template — bridges clássicas ficam na zona `localnetwork` |
| Clone falha com `403 (/storage/<id>, Datastore.AllocateSpace)` | Faltou `PVEDatastoreAdmin` no storage dos discos do template (`qm config <template>`: `sata0`, `scsi0`, `efidisk0`, `tpmstate0`...), não só no storage da ISO |
| Clone falha com `500 (only root can set 'hostpci0' …)` (ou `'args'`) | O template tem uma opção que, no PVE, só o `root@pam` aplica: PCI repassado sem mapeamento (`hostpci`, ex.: uma vGPU GVT-g) ou `args` (ex.: SMBIOS falso contra detecção de VM). Para o `hostpci`, crie um mapeamento em Datacenter > Resource Mappings, use `mapping=<nome>` no template e dê `Mapping.Use` ao usuário do DeepLook em `/mapping/pci/<nome>`. Para o `args`, tire do template (o `smbios1` cobre parte do SMBIOS sem root) ou use um template só para o DeepLook. Não use o `root@pam` no DeepLook |
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

## 9. Captura de rede pelo MikroTik CHR (opcional)

Com o tráfego das VMs passando por um MikroTik CHR (RouterOS 7), o DeepLook grava um **pcap por
ambiente** e o passa ao **Suricata** com as regras **ET Open**. O resultado aparece na seção do
ambiente: alertas, consultas DNS, pedidos HTTP, conexões TLS e o download do pcap. Os domínios e os
IPs entram nos IOCs sugeridos, e um alerta soma na pontuação de risco. Sem esta configuração, o
sandbox segue igual.

```
VM de análise ──(bridge isolada)── CHR ──► internet controlada
                                    │ sniffer (TZSP, UDP 37008)
                                    ▼
                    host do DeepLook: netcap ──pcap──► MinIO ──► suricata
```

Como funciona: ao abrir um ambiente, antes de ligar a VM, a API lê o MAC dela (`net0` do clone),
abre uma sessão no serviço `netcap` e põe o MAC no `filter-mac-address` do `/tool/sniffer` do CHR,
pela API REST, com o envio por TZSP para o `netcap`. Ao encerrar, tira o MAC, busca o pcap, guarda no
MinIO (entra no backup e sai com a amostra na lixeira) e o manda ao Suricata. O sniffer é um só no
roteador: cada mudança o para, reconfigura e liga de novo com a lista de todos os ambientes
capturando, o que dá uma pausa de alguns milissegundos na captura dos outros.

### 9.1 No RouterOS

1. Ligue a API REST (serviço `www-ssl`, com certificado) só para o IP do DeepLook:
   ```
   /certificate add name=rest common-name=chr.lab days-valid=3650 key-usage=tls-server
   /certificate sign rest
   /ip service set www-ssl disabled=no certificate=rest address=<IP do DeepLook>/32
   ```
2. Um grupo e um usuário só para o DeepLook. O REST exige `read` e `write` (que valem para toda a
   configuração), então restrinja o usuário ao IP do DeepLook:
   ```
   /user group add name=deeplook policy=read,write,rest-api,sniff,!local,!telnet,!ssh,!ftp,!reboot,!policy,!test,!winbox,!password,!web,!sensitive,!api,!romon
   /user add name=deeplook group=deeplook address=<IP do DeepLook>/32 password=<senha forte>
   ```
3. Se as VMs saem por uma interface só, diga qual em `MIKROTIK_SNIFFER_INTERFACE` (ex.: `ether2`);
   vazio, o sniffer escuta todas.

O DeepLook mexe só no `/tool/sniffer`. Não deixe outra captura configurada nele: a lista de MACs é
substituída a cada ambiente.

### 9.2 No host do DeepLook

1. No `.env`:
   ```
   COMPOSE_PROFILES=netcap
   MIKROTIK_URL=https://<IP do CHR>
   MIKROTIK_USER=deeplook
   MIKROTIK_PASSWORD=<senha>
   NETCAP_URL=http://netcap:3700
   NETCAP_TOKEN=<openssl rand -hex 24>
   NETCAP_STREAM_TARGET=<IP deste host, como o CHR o vê>:37008
   NETCAP_TZSP_SOURCES=<IP do CHR>
   SURICATA_URL=http://suricata:3800
   SURICATA_TOKEN=<openssl rand -hex 24>
   ```
   A senha e os tokens aceitam `NOME_FILE` (Docker secrets).
2. **Firewall:** o TZSP é UDP sem autenticação. A porta publicada pelo Docker não passa pelo `ufw`
   do host, então limite de três jeitos:
   - `NETCAP_TZSP_BIND=<IP da interface voltada ao CHR>` publica a porta só nessa interface;
   - `NETCAP_TZSP_SOURCES` faz o netcap descartar o que não vier do CHR;
   - uma regra na cadeia `DOCKER-USER`:
     ```
     iptables -I DOCKER-USER -p udp --dport 37008 ! -s <IP do CHR> -j DROP
     ```
3. `docker compose up -d --build`. Na primeira subida, o `suricata` baixa as regras ET Open pelo
   `egress` (a saída controlada); depois, uma vez por dia. Até lá, ele roda só com a regra de teste
   do DeepLook e ainda tira DNS, HTTP e TLS do tráfego.

### 9.3 Validando

1. **Administração > Status do sistema:** "Captura de rede (MikroTik)" mostra a versão do RouterOS,
   e "Suricata" mostra quantas regras ET Open foram baixadas.
2. Abra um ambiente. Na VM, rode `nslookup deeplook-teste.invalid` (o domínio nunca resolve).
3. Encerre o ambiente. Na seção "Tráfego de rede" aparecem o pcap e o alerta **"DEEPLOOK teste da
   captura de rede"**. Ele confere o caminho inteiro (sniffer, netcap, MinIO e Suricata) e não soma
   no risco.

A parte automatizável do teste contra o Proxmox real (console, agente, processos, Sysmon, execução
automática e limpeza) roda com `node scripts/sandbox-real-check.mjs`; as opções estão no cabeçalho do
script.

Problemas comuns:

| Sintoma | Causa provável |
|---|---|
| "o RouterOS recusou o usuário ou a senha" | usuário, senha ou `address` do usuário no RouterOS |
| "sem conexão com o RouterOS" | `www-ssl` desligado, `address` do serviço, ou certificado com `MIKROTIK_VERIFY_TLS=true` |
| pcap com 0 pacotes | o CHR não alcança `NETCAP_STREAM_TARGET`, firewall, ou `NETCAP_TZSP_SOURCES` com outro IP (o status mostra o último pacote recebido) |
| Suricata "sem as regras ET Open" | o `egress` sem saída para `rules.emergingthreats.net` |

Limites: `NETCAP_MAX_MB` por ambiente (padrão 200 MB; passou, o fim fica de fora e a tela avisa),
`SURICATA_MAX_MB` (256 MB) e `SURICATA_TIMEOUT_S` (600 s).
