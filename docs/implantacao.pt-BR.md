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
  (`inhibit_ipv4`, item 6.19) depende disso; num Docker anterior, a rede continua interna, mas o
  próprio host pode seguir alcançável pela bridge.
  ```bash
  docker version --format '{{.Server.Version}}'   # 28.x ou mais
  docker compose version
  ```
- [ ] **Memória:** uns 10 GB livres. O ClamAV usa de 1,5 a 3 GB (a base de assinaturas fica na
  memória), a API tem teto de 4 GB (`API_MEM_LIMIT`), a análise de funções (capa e FLOSS), de
  3 GB (`CAPA_MEM_LIMIT`; só gasta isso durante uma análise), o Ghidra, de 6 GB
  (`GHIDRA_MEM_LIMIT`; só quando um analista pede) e a captura, de 1 GB. Disco: as imagens somam uns
  3,5 GB (o Ghidra sozinho, 1,45 GB).
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
- [ ] **Gere os segredos** (um por linha; nunca reaproveite entre eles):
  ```bash
  for v in POSTGRES_PASSWORD SESSION_SECRET CAPTURE_TOKEN CAPA_TOKEN GHIDRA_TOKEN UNPACK_TOKEN \
    MINIO_ROOT_PASSWORD; do
    echo "$v=$(openssl rand -hex 32)"; done
  ```
  `S3_SECRET_KEY` tem de ser **igual** ao `MINIO_ROOT_PASSWORD`. Defina também `ADMIN_EMAIL` e
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
- [ ] **Permissões:** se os arquivos vieram de uma cópia do Windows, tire a escrita de "outros"
  (item 6.21):
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
  para a sua LAN** e com saída controlada. Detalhe em [docs/proxmox.pt-BR.md](proxmox.pt-BR.md).

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
- [ ] **Restaure uma vez, de verdade**, antes de convidar alguém. Gere um backup manual,
  baixe e siga README > [Backup e restauração](../README.pt-BR.md#backup-e-restauração) num banco à
  parte:
  ```bash
  7z x deeplook-backup-*.zip -o/tmp/restauracao && cd /tmp/restauracao
  sha256sum -c <(python3 -c "import json;[print(f['sha256']+'  '+f['path']) for f in json.load(open('manifest.json'))['files']]")
  docker compose exec -T db createdb -U deeplook deeplook_restaurado
  docker compose exec -T db pg_restore -U deeplook -d deeplook_restaurado --no-owner < db/deeplook.dump
  docker compose exec -T db psql -U deeplook -d deeplook_restaurado -c 'select count(*) from "Entry"'
  docker compose exec -T db dropdb -U deeplook deeplook_restaurado
  ```
  As contagens devem bater com as do `manifest.json`.

## 6. Subir

- [ ] Suba e espere tudo saudável:
  ```bash
  docker compose up -d --build
  docker compose ps        # api, web e egress "healthy"; db, minio, clamav e capture "running"
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
  quando algo está em erro: banco, MinIO, antivírus, **backup agendado que falhou ou atrasou**.

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
  git pull
  docker compose down && docker compose up -d --build   # o down recria as redes quando mudam
  ```
  As migrações do banco rodam sozinhas na subida da API; os dados ficam em `./data`.
- [ ] **Depois de cada atualização do Playwright** (PR do Dependabot):
  `node scripts/chromium-unsafe-ports.mjs` confere a lista de portas do `egress`.
- [ ] **No GitHub:** acompanhe o CI de cada push, o **Trivy semanal** (*Security scan*) e os PRs
  do **Dependabot**. Uma CVE nova numa imagem base aparece ali.
- [ ] **Logs:** `docker compose logs -f api` (rotação de 10 MB × 3 por serviço, item 6.6).

## 11. Combinado com quem vai testar

- [ ] O que for enviado é tratado como **malware real** (é guardado, varrido e, se marcado,
  entra no backup).
- [ ] É um **piloto**: pode haver instabilidade, e os dados podem ser apagados ao fim.
- [ ] Um canal para relatos (grupo, issue no GitHub) e quem responde.
- [ ] Não enviar documento pessoal ou de cliente que não possa ficar guardado no servidor.
