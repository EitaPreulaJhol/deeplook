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
   │                         │  clamd :3310 ┌──────────────┐    │
   │                         └─────────────▶│ clamav       │    │
   │                                        └──────────────┘    │
   └───────────────────────────────────────────────────────────┘
```

- **web**: nginx servindo o build (React + Carbon) e fazendo proxy de `/api` para a API.
- **api**: Fastify + Prisma. No boot aplica migrações, roda o seed do admin e garante o bucket no MinIO.
- **db**: PostgreSQL 16.
- **minio**: armazenamento S3-compatible das amostras (nunca exposto publicamente).
- **clamav**: antivírus ClamAV (`clamd` + `freshclam`), só na rede interna; varre cada
  arquivo enviado.
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
# edite o .env, principalmente: POSTGRES_PASSWORD, SESSION_SECRET, CAPTURE_TOKEN,
# ADMIN_PASSWORD, MINIO_ROOT_PASSWORD e S3_SECRET_KEY
# (com SESSION_SECRET ou CAPTURE_TOKEN no valor padrão, a API não sobe)

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

1. Entre em **/login** com essas credenciais e defina uma senha nova, pedida no primeiro
   acesso.
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

## Política de senha

- **Formato:** mínimo de 8 caracteres, com ao menos um número e um caractere especial
  (o que não é letra, inclusive acentuada, número nem espaço). Vale no cadastro, em
  Alterar senha e na tela "Definir nova senha"; senhas antigas fora da regra continuam
  valendo até a próxima troca.
- **Validade:** 90 dias desde a última troca (`PASSWORD_MAX_AGE_DAYS`; `0` desliga).
  Admins não expiram.
  - **Antes de vencer:** nos últimos 7 dias, o topo do app avisa "Sua senha expira em N
    dias. Alterar senha", e a aba Senha mostra a validade.
  - **Vencida:** o login leva à tela "Definir nova senha". Até trocar, o resto do sistema
    e os tokens de API da pessoa ficam bloqueados.
- **Administração:** a aba Usuários mostra "senha expirada".
- **Ao instalar a versão com a política,** a validade das contas existentes começa a
  contar a partir daquele dia.

## Login pelo AD/LDAP (opcional)

Sem `LDAP_URL`, nada muda. Com o AD configurado, a chave de ativação e o cadastro normal
continuam valendo.

- **Quem entra:**
  - quem tem conta local entra como sempre;
  - quem não tem entra com o usuário (ou e-mail) e a senha da rede. A conta é criada no
    primeiro acesso, com nome e e-mail do AD.
- **Papel pelos grupos:** `LDAP_ADMIN_GROUP` dá admin, `LDAP_ANALYST_GROUP` dá
  analista; sem grupo, usuário comum. O papel é atualizado a cada login e a mudança vai
  para a Auditoria.
- **Senha e 2FA:** contas do AD não têm senha local. Troca, validade e redefinição
  ficam no AD; o 2FA do DeepLook continua valendo.
- **Segurança:**
  - só com TLS: `ldaps://`, ou `ldap://` com `LDAP_STARTTLS=true`, e certificado
    verificado (`LDAP_TLS_CA` com o PEM da CA interna, montado no container da API);
  - a busca usa a conta de serviço, com o valor digitado escapado no filtro;
  - toda falha mostra "Credenciais inválidas", e o motivo real vai para a Auditoria;
  - vale o mesmo limite de tentativas do login;
  - conta suspensa no DeepLook não entra, mesmo com a senha certa;
  - se o e-mail do AD já é de uma conta local, o AD **não** assume essa conta.
- **Quem sai do AD:** de hora em hora, a conta removida ou desativada no AD é suspensa, com
  sessões e tokens revogados, e o evento vai para a Auditoria. Reativar é com o admin. Com o AD
  fora do ar nada muda; se a maioria das contas parecer sumida, o provável é erro de
  configuração, e ninguém é suspenso.
- **Status:** o Status do sistema mostra a linha "AD/LDAP" (conexão, TLS e quantas
  contas do AD existem).

```env
LDAP_URL=ldaps://dc01.empresa.local:636
LDAP_TLS_CA=/run/secrets/ca-empresa.pem
LDAP_BIND_DN=CN=svc-deeplook,OU=Servicos,DC=empresa,DC=local
LDAP_BIND_PASSWORD=...
LDAP_BASE_DN=DC=empresa,DC=local
LDAP_ANALYST_GROUP=CN=SOC-Analistas,OU=Grupos,DC=empresa,DC=local
LDAP_ADMIN_GROUP=CN=SOC-Admins,OU=Grupos,DC=empresa,DC=local
# opcional: LDAP_USER_FILTER (padrão: sAMAccountName, userPrincipalName ou mail = {login})
```

## Autenticação em dois fatores (2FA)

Opcional, por usuário, em **Minha Conta > 2FA**:

1. **Ativar 2FA** mostra um QR code (e a chave para digitar à mão) para um aplicativo
   autenticador: Google Authenticator, Microsoft Authenticator, Aegis, 1Password etc.
2. Um código de 6 dígitos do aplicativo confirma a ativação.
3. Aparecem **10 códigos de recuperação**, uma única vez, com Copiar e Baixar. Cada um
   substitui o código do aplicativo em um login (ex.: celular perdido).

- **Login:** com 2FA ativo, depois da senha vem a etapa "Código". A sessão só é criada com
  o código certo. Quem entra com um código de recuperação é levado à aba 2FA com um aviso.
- **Gerar novos códigos** e **Desativar 2FA** pedem a senha e um código.
- **Admin:** a aba Usuários mostra quem tem 2FA e tem **Desativar 2FA** para quem perdeu
  o celular e os códigos (confirme a identidade antes).
- **Segurança:**
  - padrão TOTP (RFC 6238);
  - segredo guardado cifrado (AES-GCM, chave derivada do `SESSION_SECRET`);
  - códigos de recuperação só como hash;
  - um código não vale duas vezes;
  - 5 tentativas a cada 5 minutos na etapa do código;
  - tudo entra na auditoria.
- **Trocar o `SESSION_SECRET`** invalida os 2FA já ativados, porque o segredo não decifra
  mais. O login avisa que o 2FA precisa ser reconfigurado; os códigos de recuperação
  continuam valendo, e o admin pode desativar o 2FA para a pessoa ativar de novo.
- **Tokens de API** não passam pelo 2FA (são para scripts).

## Acesso por API (tokens pessoais)

Scripts podem enviar e consultar amostras com um token pessoal, sem passar pelo navegador.

1. Um **admin** libera o usuário em Administração > Usuários > **Liberar API**. Sem essa
   liberação, nenhum token vale.
2. O usuário gera o token em **Minha Conta > Tokens de API** (validade de até 90 dias).
   O token aparece uma única vez.
3. Use no cabeçalho `Authorization`:

```bash
# listar as próprias amostras
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/entries?scope=mine"
# enviar um arquivo
curl -H "Authorization: Bearer dlk_..." -F file=@amostra.exe -F tags=phishing \
  "https://deeplook.exemplo/api/entries/file"
# enviar um link
curl -H "Authorization: Bearer dlk_..." -H "Content-Type: application/json" \
  -d '{"url":"https://site-suspeito.exemplo","title":"Link do e-mail"}' \
  "https://deeplook.exemplo/api/entries/url"
```

- **Permitido:** enviar arquivos, `.zip` (`/api/entries/zip`) e links; listar e consultar
  amostras, relatórios, histórico e IOCs.
- **Fora do token (403):** baixar o arquivo, triagem, relatórios, conta e administração.
- **Documentação:** Minha Conta > Tokens de API > **Documentação da API** (`/user/api`)
  lista as rotas, os campos e exemplos. A especificação OpenAPI 3.1 está em
  `/api/openapi.json` (com sessão ou token) e é gerada das validações das rotas.
- **Limite:** 120 requisições por minuto por token.
- **Troca de senha:** trocar a senha ou tê-la redefinida pelo admin revoga os tokens; a troca
  por validade vencida, não.
- **Revogação:** o usuário revoga em Minha Conta; o admin revoga um token na aba Tokens de
  API ou retira a liberação, o que revoga todos de uma vez. Suspender a conta também corta
  o acesso.

## Antivírus (ClamAV)

O serviço `clamav` do `docker-compose.yml` roda o `clamd` e o `freshclam` (que atualiza
as assinaturas sozinho; a base fica em `./data/clamav`). A API conversa com ele pela rede
interna (porta 3310, sem expor para fora), enviando o conteúdo pelo protocolo
`INSTREAM`: nada é gravado em disco na API.

- **Automático:** cada arquivo enviado (inclusive os extraídos de um `.zip`) é varrido
  em segundo plano, sem atrasar o envio.
- **Na ficha:** seção **Antivírus (ClamAV)** com Limpo / Infectado (nome da assinatura) /
  Falha, motor, base e data. "Infectado" também aparece no topo. Analistas têm
  "Escanear de novo" (ou "Escanear agora" para arquivos anteriores ao antivírus).
- **Status do sistema:** linha "Antivírus (ClamAV)" com `clamd` respondendo, motor, base
  de assinaturas (alerta com mais de 2 dias) e varreduras e infectados em 24 h.
- **Memória:** o ClamAV usa cerca de 1,5 a 3 GB de RAM por causa da base.
- **Primeira subida:** o `freshclam` baixa a base (alguns minutos). Se o `clamd` subir
  antes de a base nova chegar, ele fica com a anterior até recarregar sozinho; o Status
  do sistema avisa "base de assinaturas desatualizada" enquanto isso. Para recarregar na
  hora: `docker compose exec clamav clamdscan --reload`.
- **Limite:** arquivos acima do `StreamMaxLength` do `clamd` (100 MB na imagem atual,
  menor que o `MAX_UPLOAD_MB` padrão de 200) aparecem como "Falha: arquivo maior que o
  limite do ClamAV". O resto do envio segue normal.
- **Desligar:** `CLAMAV_HOST=` (vazio) no `.env`; o serviço `clamav` pode sair do compose.
- O resultado não muda o veredito: quem decide continua sendo o analista.

## Captura da página de um link

Nas amostras do tipo link, o analista clica em **Capturar página** e um navegador isolado
(serviço `capture`, Chromium do Playwright) abre o link. Ficam guardados o print, o HTML,
os redirecionamentos, o certificado e o que foi bloqueado.

- **Isolamento:**
  - o contêiner `capture` fica só na rede `capture`, junto da API, sem banco, MinIO ou
    ClamAV;
  - todo o tráfego do navegador passa por um proxy interno que resolve o nome uma vez e
    **recusa endereços privados, loopback, link-local e de metadados de nuvem**
    (169.254.169.254), sem nova resolução de DNS;
  - WebRTC e QUIC desligados, sem downloads, contexto novo a cada captura;
  - roda como usuário sem privilégios, com `no-new-privileges`.
- **Saída para a internet:** o servidor precisa alcançar os links. Para sair por um proxy
  ou VPN, use a rede do contêiner `capture`.
- **HTML:** só baixa como texto (`.html.txt`), nunca abre no navegador.
- **Limites:** 20 s para abrir a página, print de até 6.000 px de altura, HTML de até 2 MB,
  uma captura por vez.
- **Desligar:** `CAPTURE_URL=` (vazio) no `.env`; o serviço `capture` pode sair do compose.
- **Token:** troque o `CAPTURE_TOKEN` (16+ caracteres), que vale para a API e para o
  serviço.

## Regras YARA

Analistas mantêm regras YARA na tela **Regras YARA** (pasta Detecção do navegador). A
API valida e aplica as regras com o **YARA-X** (`@virustotal/yara-x`, WebAssembly, sem
binário nem serviço extra). Regra com erro de sintaxe é recusada na hora, com a linha do
erro, e nunca chega a ser usada.

- **Automático:** cada arquivo enviado passa pelas regras ativas em segundo plano. Regra
  nova vale para os próximos envios; para uma amostra antiga, use "Escanear de novo".
- **Na ficha:** seção **Regras YARA** com as regras que casaram (conjunto, tags,
  descrição, ocorrências); o topo mostra "YARA: ...".
- **Limites:** 10 s por varredura e 100 ocorrências por string; cada conjunto tem até
  64 KB.
- Criar, alterar e excluir regras fica na Auditoria.

## Casos

Analistas agrupam amostras da mesma campanha em **casos** (`CASO-0001`), pela ficha
("Mais ▾ > Adicionar a caso…") ou pelas amostras marcadas na lista. O caso tem status,
responsável, as amostras com os relatórios publicados delas e uma linha do tempo com
comentários. Uma amostra pode estar em vários casos; um caso nunca fica vazio.

## E-mail suspeito (.eml)

Envie o `.eml` de um phishing como arquivo comum. A ficha mostra a seção **E-mail**:
remetente, Responder para, destinatários, SPF/DKIM/DMARC, o caminho dos servidores, os
links (só como texto) e o corpo em texto; o HTML nunca é exibido. Cada anexo vira uma
amostra própria ("Anexo de: …"), com antivírus, reputação e YARA. A leitura usa a
`postal-mime` (sem dependências).

## Base de conhecimento

Artigos em Markdown sobre famílias de malware, golpes, técnicas e procedimentos
(**Base de conhecimento**, no topo do navegador). Todos leem; analistas e admins escrevem,
com pré-visualização. Os relatórios citam artigos, e cada artigo lista os relatórios
publicados que o citam. O Markdown é desenhado sem HTML, e URLs soltas não viram link.

## MITRE ATT&CK

Os relatórios podem citar técnicas do **MITRE ATT&CK** (Enterprise v20.0), por código ou
nome. As técnicas viram links e filtro (`?attack=T1566`) nas listas e aparecem no Painel
("mais vistas"). A lista vem embutida em `apps/api/src/lib/attack-enterprise.json`,
extraída de [mitre-attack/attack-stix-data](https://github.com/mitre-attack/attack-stix-data);
nada é consultado fora. Para atualizar a versão, troque o arquivo e publique a API.

ATT&CK® é marca registrada da The MITRE Corporation; o conteúdo é © MITRE e usado conforme
os [termos de uso do ATT&CK](https://attack.mitre.org/resources/legal-and-branding/terms-of-use/).

## Reputação externa

Com as chaves no `.env`, cada amostra enviada é consultada **automaticamente** nos serviços
ligados, em segundo plano, sem atrasar o envio. O resultado aparece na seção **Reputação
externa** da ficha e num resumo no topo, por exemplo "malicioso em 2 de 3 serviços".

| Indicador | Serviços |
|---|---|
| Arquivo: **só o SHA-256** | VirusTotal, MalwareBazaar, ThreatFox |
| Link: **só o domínio** | VirusTotal, URLhaus, ThreatFox |
| Link cujo host é um IP | VirusTotal, URLhaus, ThreatFox, AbuseIPDB |

- **O que sai do servidor:** só o indicador. O arquivo nunca sai, nem a URL completa (com
  caminho, e-mail ou token da vítima).
- **Cache de 24 h** por serviço e indicador; analistas têm "Consultar de novo".
- **Limites:** o VirusTotal gratuito permite 4 consultas por minuto, e a fila respeita
  isso (envios em lote esperam a vez). A API pública dele é só para uso não comercial.
- **Falhas** (chave recusada, limite, tempo esgotado) aparecem na linha do serviço e em
  Status do sistema.
- **Atenção:** mesmo só o hash revela a terceiros que a amostra está sendo analisada.

## Backup e restauração

Em **Administração > Backup** (só admin), **Gerar backup** monta em segundo plano um ZIP
com:
- o banco (`pg_dump`, formato custom);
- os arquivos do MinIO: evidências, capturas e, se marcado, os arquivos das amostras;
- um `manifest.json` com versão, data, contagens e o SHA-256 de cada parte;
- um `LEIA-ME-RESTAURACAO.txt`.

Funcionamento:
- Um backup por vez. A tela mostra a etapa e o progresso, e **Baixar** aparece quando
  termina.
- O ZIP fica no bucket (`backups/`) até vencer (`BACKUP_RETENTION_DAYS`, padrão 7 dias).
- Só baixa com admin logado (token de API não serve).
- **Senha do ZIP:** informada ao gerar (12 caracteres ou mais), em AES-256 no padrão WinZip,
  que o **7-Zip** abre (o `unzip` comum não). Ela não fica guardada: sem ela, o backup não abre.
  Os nomes dos arquivos dentro do ZIP não são cifrados. Exportar sem senha exige marcar a opção
  e confirmar.
- Gerar, baixar e excluir vão para a Auditoria.

> **Com os arquivos das amostras, o ZIP contém malware real.** Guarde-o como as amostras.
> O manifesto diz o que entrou (`containsMalware`).

Para restaurar, com o DeepLook parado:

```bash
7z x deeplook-backup-AAAA-MM-DD-xxxxxx.zip -obackup && cd backup   # pede a senha, se houver
sha256sum db/deeplook.dump            # confira com o manifest.json
docker compose up -d db minio
docker compose exec -T db createdb -U deeplook deeplook_restaurado
docker compose exec -T db pg_restore -U deeplook -d deeplook_restaurado --no-owner < db/deeplook.dump
# arquivos: copie objects/ para o bucket mantendo os caminhos (ex.: mc cp --recursive)
```

Depois aponte `DATABASE_URL` para o banco restaurado (ou renomeie-o) e suba o resto. As
migrações mais novas rodam sozinhas.

- **`SESSION_SECRET`:** use o mesmo da instalação de origem, porque ele não vai no ZIP. Com
  outro, os 2FA ativados param de funcionar (só os códigos de recuperação valem).
- **Backup sem as amostras:** as fichas voltam, mas os arquivos não. Baixar responde "arquivo
  não está no armazenamento"; a análise já feita continua na ficha.

## Cloudflare Tunnel (no host, fora do Docker)

Em produção, com o Tunnel, defina `COOKIE_SECURE=true`. O IP real vem do `CF-Connecting-IP`,
aceito só de conexões de rede privada, como a do `cloudflared` local. Não publique a porta do web
em outro endereço além de `127.0.0.1` sem rever isso (`set_real_ip_from` em `apps/web/nginx.conf`).

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
| `SESSION_SECRET` | Segredo para os cookies de sessão (longo e aleatório); com o valor padrão a API não sobe | — |
| `SESSION_TTL_HOURS` | Validade máxima da sessão (horas), mesmo com uso contínuo | `168` |
| `SESSION_IDLE_MINUTES` | Expira a sessão após N minutos sem atividade do usuário (aviso 2 min antes) | `30` |
| `SLA_WARN_HOURS` | Amostra não concluída há mais de N horas no status atual ganha bolinha laranja (alerta) | `24` |
| `SLA_LATE_HOURS` | Acima de N horas fica vermelha e entra na fila "Atrasadas" | `72` |
| `SLA_P1_HOURS` · `SLA_P2_HOURS` · `SLA_P4_HOURS` | prazos das prioridades P1, P2 e P4 ("alerta/atraso" em horas); o P3 usa `SLA_WARN_HOURS`/`SLA_LATE_HOURS` | `2/4` · `8/24` · `72/120` |
| `SLA_ESCALATE_PRIORITY` | ao entrar em alerta o responsável é avisado (sem responsável, os analistas); ao atrasar, também os admins. `true`: ao atrasar, a prioridade sobe um nível | `false` |
| `REPORT_REVIEW_REQUIRED` | `true`: relatório só é publicado com a aprovação de outro analista (quatro olhos) | `false` |
| `RETENTION_DAYS` | apaga o **arquivo** das amostras concluídas há mais de N dias (ficha, relatórios, IOCs e hash ficam); `0` desliga | `0` |
| `BACKUP_RETENTION_DAYS` | dias até o ZIP do backup (Administração > Backup) expirar e sair do bucket | `7` |
| `BACKUP_PG_DUMP` | comando do `pg_dump` usado no backup (versão 16 ou mais nova; a imagem da API já traz) | `pg_dump` |
| `LDAP_URL` · `LDAP_STARTTLS` · `LDAP_TLS_CA` | login pelo AD (vazio desliga); `ldaps://` ou `ldap://` + StartTLS; PEM da CA que assina o certificado do AD | — · `false` · — |
| `LDAP_BIND_DN` · `LDAP_BIND_PASSWORD` · `LDAP_BASE_DN` | conta de serviço e base da busca | — |
| `LDAP_USER_FILTER` · `LDAP_ATTR_NAME` · `LDAP_ATTR_MAIL` | filtro (`{login}` = o digitado) e atributos de nome e e-mail | padrão do AD · `displayName` · `mail` |
| `LDAP_ANALYST_GROUP` · `LDAP_ADMIN_GROUP` | DNs dos grupos que dão o papel (sem grupo, usuário comum) | — |
| `PASSWORD_MAX_AGE_DAYS` | validade da senha em dias (admins não expiram); `0` desliga | `90` |
| `VT_API_KEY` | chave do VirusTotal (reputação externa); vazio desliga | — |
| `ABUSECH_AUTH_KEY` | chave da abuse.ch: liga MalwareBazaar, URLhaus e ThreatFox | — |
| `ABUSEIPDB_API_KEY` | chave do AbuseIPDB (IPs) | — |
| `CLAMAV_HOST` | host do `clamd` (serviço `clamav` do compose); vazio desliga o antivírus | `clamav` |
| `CLAMAV_PORT` | porta do `clamd` | `3310` |
| `CAPTURE_URL` | serviço do navegador isolado (captura de página de link); vazio desliga | `http://capture:3100` |
| `CAPTURE_TOKEN` | token compartilhado entre a API e o serviço `capture` (16+ caracteres) | — |
| `CLAMAV_IMAGE` | imagem do contêiner do ClamAV | `clamav/clamav:stable` |
| `COOKIE_SECURE` | `true` quando servir somente via HTTPS | `false` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin semeado no primeiro boot; troca a senha no primeiro acesso | — |
| `ALLOW_INSECURE_DEFAULTS` | `true`: sobe mesmo com `SESSION_SECRET`/`CAPTURE_TOKEN` padrão (só para demonstração local) | `false` |
| `MAX_UPLOAD_MB` | Tamanho máximo de upload | `200` |
| `MAX_UPLOAD_MEMORY_MB` | soma dos envios simultâneos em memória; acima, responde 503 "tente de novo em instantes" | `600` |
| `API_MEM_LIMIT` | limite de memória do container da API | `4g` |
| `UPLOAD_DAILY_LIMIT` | Envios por usuário comum nas últimas 24 horas (arquivo, link, cada arquivo de um `.zip`); analistas e admins sem limite; `0` desliga | `20` |
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
│  │  ├─ prisma/      # schema, migrações, seed (configuração em prisma.config.ts)
│  │  └─ src/         # env, lib, routes (generated/prisma: cliente gerado, fora do git)
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
# API (Prisma 7: as variáveis vêm do ambiente; o .env não é lido sozinho)
cd apps/api
npm install
export DATABASE_URL=postgresql://deeplook:deeplook@localhost:5432/deeplook
export SESSION_SECRET=troque-por-um-segredo-com-20-caracteres
npx prisma generate         # cliente em src/generated/prisma (rodar após mudar o schema)
npx prisma migrate deploy   # precisa de um Postgres acessível
npx prisma db seed          # cria o admin (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run dev                 # http://localhost:3000

# Web
cd apps/web
npm install
npm run dev                 # http://localhost:5173 (proxy /api -> :3000)
```

**Nova migração:** altere o `schema.prisma` e gere o SQL contra um banco sombra vazio
(`SHADOW_DATABASE_URL`, usado só aqui):

```bash
export SHADOW_DATABASE_URL=postgresql://postgres:pg@localhost:55432/shadow
mkdir prisma/migrations/AAAAMMDDHHMMSS_nome
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma \
  --script > prisma/migrations/AAAAMMDDHHMMSS_nome/migration.sql
npx prisma generate
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

## Testes

Precisam só do Docker ligado; sobem o que usam e não mexem na stack em execução.

```bash
cd apps/api
npm run test:integration            # API contra Postgres, MinIO e OpenLDAP reais
npm run test:integration -- ldap    # só os arquivos com "ldap" no nome
npm run test:images                 # imagens reais: lockfile, API sem root, captura
```

- **Integração** (`apps/api/tests/integration`): cada arquivo roda num banco novo. As imagens
  de disco e os certificados são gerados na hora, em `tests/.tmp`. `--clean` remove os
  containers ao terminar.
- **Telas** (`scripts/ui-playwright/run.ps1`): cenários no navegador com a API simulada. Roda
  todos e lista os que falharam.

## Smoke test (com a stack no ar)

Depois de `docker compose up`, entre uma vez como admin para trocar a senha e rode o teste
de ponta a ponta com ela em `SMOKE_ADMIN_PASSWORD`:

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

- Notificações por e-mail (SMTP).

Já entregues a partir desta lista: ClamAV e reputação externa (VirusTotal e outros),
envio em lote, exportação de relatórios (Markdown; PDF pela ficha impressa), 2FA
opcional e política de senha.
