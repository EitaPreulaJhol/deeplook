# 🚀 Checklist de implantação (piloto no homelab)

> 🇬🇧 [Read in English](implantacao.md)

Roteiro para subir o DeepLook no homelab e abrir para um grupo pequeno de pessoas testarem.
Cada passo diz **o que fazer**, **como conferir** e, quando já existe, **onde está o detalhe** no
[README](../README.pt-BR.md). Siga na ordem: os primeiros protegem o que vem depois.

> Convenção: `deeplook.seu-dominio.com` é o endereço público; `/srv/deeplook` é onde o projeto
> fica no host; `/mnt/externo` é o disco externo do backup. Troque pelos seus.

---

## 0. Antes de começar

- [ ] **Host Linux com Docker 28 ou mais novo.** O isolamento completo da rede da captura
  (`inhibit_ipv4`) depende disso; num Docker anterior, a rede continua interna, mas o
  próprio host pode seguir alcançável pela bridge.
  ```bash
  docker version --format '{{.Server.Version}}'   # 28.x ou mais
  docker compose version
  ```
- [ ] **Memória:** uns 10 GB livres. O ClamAV usa de 1,5 a 3 GB (a base de assinaturas fica na
  memória), a API tem teto de 4 GB (`API_MEM_LIMIT`), a análise de funções (capa e FLOSS), de
  3 GB (`CAPA_MEM_LIMIT`; só gasta isso durante uma análise), o Ghidra, de 6 GB
  (`GHIDRA_MEM_LIMIT`; só quando um analista pede), o desempacotamento, de 2 GB, o oletools, de 1 GB,
  e a captura, de 1 GB; com o perfil `netcap`, mais 2 GB do Suricata. Tirando o ClamAV e a API, cada
  um só ocupa memória enquanto trabalha (um contêiner novo por trabalho). Disco: as imagens somam
  uns 8 GB (o navegador da captura, uns 2 GB; o Ghidra, 1,4 GB; a API, 1,2 GB).
- [ ] **Disco:** o dos dados (`./data`) e um **disco externo** (ou NAS) para o backup.
- [ ] **User namespaces liberados** (o sandbox do Chromium da captura precisa):
  ```bash
  sysctl user.max_user_namespaces                          # maior que 0
  sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null   # 0, ou ausente
  ```
  Detalhe em README > [Captura da página de um link](../README.pt-BR.md#captura-da-página-de-um-link).

## 1. Código e segredos

- [ ] Clone e prepare o `.env`:
  ```bash
  cd /srv && git clone git@github.com:<voce>/deeplook.git && cd deeplook
  cp .env.example .env && chmod 600 .env
  ```
  **Sem Git no servidor:** baixe o `deeplook-vX.Y.Z.zip` e o `.sha256` da página **Releases** do
  repositório no GitHub (gerados sozinhos a cada versão), ou gere o pacote na máquina de
  desenvolvimento e leve só o `.zip`. Ele sai
  de um commit e traz só o que o `docker compose up -d --build` usa (compose, `.env.example`, o
  código de cada serviço, estes guias e os scripts do servidor), sem `node_modules`, `dist`, dados,
  `.env` nem testes. O `RELEASE.txt` dentro dele diz de qual commit saiu.
  ```bash
  node scripts/package-deploy.mjs          # release/deeplook-<data>-<commit>.zip e .zip.sha256
  # no servidor, com os dois arquivos copiados:
  sha256sum -c deeplook-*.zip.sha256
  cd /srv && unzip ~/deeplook-<data>-<commit>.zip && mv deeplook-<data>-<commit> deeplook && cd deeplook
  cp .env.example .env && chmod 600 .env
  ```
  Para **atualizar** com um pacote novo, extraia fora e sincronize por cima da pasta de sempre:
  os dados ficam em `./data` (banco, MinIO, backups e alertas) e o `.env` ao lado, e uma pasta nova
  a cada versão os deixaria para trás.
  ```bash
  unzip -q deeplook-<data>-<commit>.zip -d /tmp/dl-novo
  rsync -a --delete --exclude=/data/ --exclude=/.env /tmp/dl-novo/deeplook-<data>-<commit>/ /srv/deeplook/
  cd /srv/deeplook && docker compose up -d --build
  ```
  Edite o `.env` como UTF-8 **sem BOM**: com o BOM, o `. ./.env` do shell lê errado a primeira
  linha (o Bloco de Notas antigo do Windows grava com BOM). Cópias como `.env.bak` ficam fora do
  Git (`.env.*` no `.gitignore`), mas guarde-as fora da pasta do projeto, com `chmod 600`.
- [ ] **Gere os segredos** (um por linha; nunca reaproveite entre eles):
  ```bash
  for v in POSTGRES_PASSWORD SESSION_SECRET DATA_KEY CAPTURE_TOKEN CAPA_TOKEN GHIDRA_TOKEN \
    UNPACK_TOKEN OLETOOLS_TOKEN MINIO_ROOT_PASSWORD; do
    echo "$v=$(openssl rand -hex 32)"; done
  ```
  Com a captura de rede (perfil `netcap`, seção 9 do [proxmox.pt-BR.md](proxmox.pt-BR.md)),
  acrescente `NETCAP_TOKEN` e `SURICATA_TOKEN` à lista. `S3_SECRET_KEY` tem de ser **igual** ao `MINIO_ROOT_PASSWORD`. Defina também `ADMIN_EMAIL` e
  um `ADMIN_PASSWORD` próprio: as senhas padrão publicadas são recusadas em produção.
  O mesmo vale para a senha do banco e a do MinIO: com o valor do compose ou do `.env.example`,
  a API **não sobe** e diz qual variável trocar.
- [ ] **Só em instalação que já tem dados** e ainda usa a senha padrão do banco: o Postgres grava
  a senha na criação do volume, e mudar o `.env` sozinho deixaria a API sem conseguir entrar.
  Troque primeiro no banco, depois no `.env`:
  ```bash
  docker compose exec db psql -U deeplook -d deeplook   # os valores de POSTGRES_USER e POSTGRES_DB
  # no psql, digite:  \password deeplook     (pede a senha nova duas vezes, sem mostrá-la)
  # depois ponha a mesma senha em POSTGRES_PASSWORD no .env e:
  docker compose up -d api
  ```
  A do MinIO não precisa disso: ele lê `MINIO_ROOT_PASSWORD` a cada subida; basta trocar as duas
  variáveis (`MINIO_ROOT_PASSWORD` e `S3_SECRET_KEY`) juntas e subir de novo.
- [ ] **Permissões:** se os arquivos vieram de uma cópia do Windows, tire a escrita de "outros":
  ```bash
  find . \( -type f -o -type d \) -perm -o+w -user "$(id -un)" -exec chmod o-w {} +
  ```

## 2. Acesso pela internet: Tunnel, cookie seguro e Cloudflare Access

- [ ] **Cloudflare Tunnel** no host apontando para `http://localhost:8080`. Passo a passo em
  README > [Cloudflare Tunnel](../README.pt-BR.md#cloudflare-tunnel-no-host-fora-do-docker).
- [ ] **`COOKIE_SECURE=true`** no `.env` (o Tunnel serve HTTPS). Sem isso o cookie da sessão
  sai sem `Secure` e sem o prefixo `__Host-`.
- [ ] **Cloudflare Access na frente** (Zero Trust > Access > Applications > *Self-hosted*,
  domínio `deeplook.seu-dominio.com`):
  - política *Allow* só com os e-mails das pessoas do piloto (login por código no e-mail);
  - duração da sessão de, por exemplo, 24 h.

  O DeepLook tem login, 2FA e CAPTCHA, mas recebe malware: não precisa estar aberto para a
  internet inteira. Com o Access, quem não está na lista nem chega à tela de login.
- [ ] **Clientes de máquina passam por service token do Access.** O Uptime Kuma, um MISP ou
  um TIP não fazem o login por e-mail; sem isto, o monitor e o feed param no Access:
  - Zero Trust > Access > Service Auth > *Create Service Token*;
  - na aplicação, uma segunda política, **Service Auth**, com esse token;
  - o cliente manda os dois cabeçalhos **além** do token do DeepLook:
    ```
    CF-Access-Client-Id: <id>.access
    CF-Access-Client-Secret: <segredo>
    Authorization: Bearer dlk_...
    ```
    (o MISP aceita cabeçalhos extras no feed; o Uptime Kuma, em *Headers*).

## 3. Captura de links: sair por VPN

O navegador da captura abre links maliciosos. Sem VPN, ele os abre **pelo IP da sua casa**: o
dono da página vê esse IP, e o seu provedor pode receber denúncia de abuso.

- [ ] **Escolha:** VPN para a captura, **ou** captura desligada no piloto (`CAPTURE_URL=` vazio
  no `.env`; o resto do DeepLook funciona).
- [ ] **Com VPN (WireGuard no host, interface `wg0`):** a rede `capture-egress` tem sub-rede fixa
  (`CAPTURE_EGRESS_SUBNET`, padrão `172.31.252.0/24`). Mande só ela pela VPN, com roteamento por
  origem:
  ```bash
  sudo ip route add default dev wg0 table 252
  sudo ip rule add from 172.31.252.0/24 table 252 priority 252
  ```
  (torne permanente no `PostUp`/`PostDown` do `wg0` ou no gerenciador de rede do host).
- [ ] **Confira** depois de subir (passo 6): o IP de saída da captura é o da VPN, e não o seu.
  ```bash
  docker compose exec egress node -e "require('https').get('https://ifconfig.me/ip',r=>r.pipe(process.stdout))"
  curl -s https://ifconfig.me/ip   # o do host: precisa ser DIFERENTE
  ```
  O DNS do `egress` passa pelo resolvedor embutido do Docker e **pode** sair pelo resolvedor do
  host, fora da VPN (não foi medido). Se o seu provedor não deve ver os domínios capturados,
  confira com `sudo tcpdump -ni <interface da casa> port 53` durante uma captura e, se vazar,
  aponte o `egress` para um DNS da VPN (`dns:` no compose).

## 4. Sandbox (Proxmox): desligado no piloto

- [ ] **`SANDBOX_ENABLED=false`**, a menos que as VMs de análise estejam numa **VLAN sem rota
  para a sua LAN** e com saída controlada. Detalhe em [docs/proxmox.pt-BR.md](proxmox.pt-BR.md); o
  que instalar no template da VM, em [docs/template-windows.pt-BR.md](template-windows.pt-BR.md).
- [ ] **Se for ligar o sandbox**, prepare o usuário dedicado no PVE **antes** de subir a API. Troque
  `<template>`, `<bridge>`, `<iso-storage>` e `<disco-storage>` pelos valores do
  `qm config <template>` (`net0`; `sata0`/`scsi0`/`efidisk0`/`tpmstate0`):
  ```bash
  # o clone usa um VMID novo: VM.Allocate vai em /vms (propagate), não em /vms/<template>
  pveum acl modify /vms --users deeplook@pve --roles PVEVMAdmin --propagate 1
  pveum acl modify /sdn/zones/localnetwork/<bridge> --users deeplook@pve --roles PVESDNUser
  pveum acl modify /storage/<iso-storage> --users deeplook@pve --roles PVEDatastoreAdmin
  pveum acl modify /storage/<disco-storage> --users deeplook@pve --roles PVEDatastoreAdmin
  ```
- [ ] **Confira** o que a conta do PVE enxerga (a lista precisa ter `VM.Allocate` em `/vms`) e a
  integração pelo `GET /api/sandbox/health` (admin), antes de abrir o primeiro ambiente:
  ```bash
  pvesh get /access/permissions --output-format json | grep -A20 '"/vms"'
  ```
  Sem `VM.Allocate` em `/vms`, o clone falha com `403 Permission check failed` **sem caminho** no
  corpo (a checagem `ou` do PVE não detalha o privilégio); o restante está em
  [docs/proxmox.pt-BR.md](proxmox.pt-BR.md).

## 5. Backup fora do disco, agendado e restaurado uma vez

- [ ] **Disco externo montado** com `nofail` (o host sobe mesmo sem ele) e a pasta do DeepLook:
  ```bash
  sudo mkdir -p /mnt/externo/deeplook
  sudo touch /mnt/externo/deeplook/.deeplook-backups   # a marca: sem ela a API recusa gravar
  sudo chown -R 1000:1000 /mnt/externo/deeplook
  ```
  A marca existe para o caso do disco desmontado: o ponto de montagem vira uma pasta vazia **no
  disco principal**, e sem a marca o backup seria gravado ali sem ninguém perceber.
- [ ] No `.env`:
  ```bash
  BACKUP_DIR=/mnt/externo/deeplook
  BACKUP_SCHEDULE_PASSWORD=<openssl rand -base64 24>
  ```
  **Guarde a `BACKUP_SCHEDULE_PASSWORD` fora do servidor** (gerenciador de senhas): sem ela, o
  backup não abre, e um backup que só abre com algo que estava no disco perdido não serve.
- [ ] Depois de subir (passo 6): **Administração > Backup > Backup agendado**, escolha os dias e
  o horário (o calendário mostra as próximas execuções) e salve.
- [ ] **Ensaie a restauração uma vez**, antes de convidar alguém. Gere um backup manual e rode
  o ensaio, que restaura num banco e num bucket temporários, compara as contagens com as do
  `manifest.json` e apaga os dois (README >
  [Backup e restauração](../README.pt-BR.md#backup-e-restauração)):
  ```bash
  scripts/restore.sh /mnt/externo/deeplook/deeplook-backup-*.zip --rehearsal
  ```
  Tem de terminar com `ensaio concluído: o backup volta`.

## 6. Subir

- [ ] Suba e espere tudo saudável:
  ```bash
  docker compose up -d --build
  docker compose ps        # api, web, egress e db "healthy"; os outros "running"
  curl -fsS http://127.0.0.1:8080/api/health/ready && echo pronto
  ```
  O ClamAV leva alguns minutos na primeira vez (baixa a base de assinaturas).

## 7. Primeiro acesso e contas

- [ ] Entre com o `ADMIN_EMAIL` e troque a senha (pedida no primeiro acesso).
- [ ] **Ligue o 2FA** do admin (Minha Conta > 2FA). Detalhe em
  README > [2FA](../README.pt-BR.md#autenticação-em-dois-fatores-2fa).
- [ ] Decida em **Administração > Configurações** se o usuário comum só vê as próprias amostras.
- [ ] **Administração > Chaves de ativação:** uma chave por pessoa. Testadores entram como
  **usuário**; promova a **analista** só quem vai triar e escrever relatório.
- [ ] Se for usar o feed (TAXII/MISP) ou o monitor, libere "Acesso por API" só para o admin que
  gera esses tokens.

## 8. Monitoramento

- [ ] **Token de status** (Minha Conta > Tokens de API > finalidade *Monitoramento*).
- [ ] **Uptime Kuma** (ou Zabbix): monitor HTTP em
  `https://deeplook.seu-dominio.com/api/status?strict=1`, com o `Authorization: Bearer` do
  token e os cabeçalhos do service token do Access (passo 2). O `strict=1` responde **503**
  quando algo está em erro: banco, MinIO, antivírus, um serviço de análise ligado que não responde,
  **backup agendado que falhou ou atrasou**.

## 9. Conferência final

- [ ] **Administração > Status:** nada em erro, e nenhum alerta de "Configuração" (senha padrão,
  `COOKIE_SECURE` desligado ou `TRUSTED_NETWORK` vazio).
- [ ] **Antivírus:** envie um arquivo com o texto de teste do EICAR; a ficha mostra a detecção.
- [ ] **Captura** (se ligada): capture `https://example.com/`; vem print, status 200 e
  certificado, e o IP de saída é o da VPN (passo 3).
- [ ] **Backup:** gere um manual; ele aparece na pasta do disco externo com o `.sha256` ao lado
  (`sha256sum -c` confere).
- [ ] **De fora, sem estar na lista do Access** (celular no 4G, por exemplo): o endereço pede o
  login do Access e não mostra a tela do DeepLook.
- [ ] **Monitor:** derrube a API um minuto (`docker compose stop api`) e veja o alerta chegar;
  suba de novo.

## 10. Operação

- [ ] **Atualizar:**
  ```bash
  git pull                # ou, com o pacote, o rsync do passo 1
  docker compose down && docker compose up -d --build   # o down recria as redes quando mudam
  ```
  As migrações do banco rodam sozinhas na subida da API; os dados ficam em `./data`.
- [ ] **Depois de cada atualização do Playwright** (PR do Dependabot):
  `node scripts/chromium-unsafe-ports.mjs` confere a lista de portas do `egress`.
- [ ] **No GitHub:** acompanhe o CI de cada push, o **Trivy semanal** (*Security scan*) e os PRs
  do **Dependabot**. Uma CVE nova numa imagem base aparece ali.
- [ ] **Logs:** `docker compose logs -f api` (rotação de 10 MB × 3 por serviço, `LOG_MAX_SIZE` e `LOG_MAX_FILE`).

## 11. Combinado com quem vai testar

- [ ] O que for enviado é tratado como **malware real** (é guardado, varrido e, se marcado,
  entra no backup).
- [ ] É um **piloto**: pode haver instabilidade, e os dados podem ser apagados ao fim.
- [ ] Um canal para relatos (grupo, issue no GitHub) e quem responde.
- [ ] Não enviar documento pessoal ou de cliente que não possa ficar guardado no servidor.
