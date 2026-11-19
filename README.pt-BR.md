# 🔍 DeepLook

> 🇬🇧 [Read in English](README.md)

Ferramenta self-hosted (homelab) para que amigos e especialistas em segurança
centralizem **amostras de software e links suspeitos** encontrados na web,
com **triagem e relatórios** feitos pelos analistas.
 
Expõe-se à internet via **Cloudflare Tunnel rodando no host (fora do Docker)**.

Créditos especiais ao [Dudu](https://github.com/lluiseduardo-silva) na qual forneceu
meios de validar a aplicação com o Strix. Obrigado ❤️.

## Capturas de tela

<table>
<tr><td width="50%"><img src=".github/screenshots/pt-BR/history.png" alt="Histórico Global: todas as amostras enviadas, com filtros, visões salvas e exportação em CSV"><br><sub>Histórico Global: todas as amostras enviadas, com filtros, visões salvas e exportação em CSV</sub></td><td width="50%"><img src=".github/screenshots/pt-BR/sample-reports.png" alt="Ficha da amostra: o relatório do analista, o veredito e os indicadores reconhecidos"><br><sub>Ficha da amostra: o relatório do analista, o veredito e os indicadores reconhecidos</sub></td></tr>
<tr><td width="50%"><img src=".github/screenshots/pt-BR/sandbox-artifacts.png" alt="Ambiente isolado: processos novos, eventos do Sysmon e a captura de rede com os alertas do Suricata"><br><sub>Ambiente isolado: processos novos, eventos do Sysmon e a captura de rede com os alertas do Suricata</sub></td><td width="50%"><img src=".github/screenshots/pt-BR/case.png" alt="Caso: amostras da mesma campanha, com os relatórios e indicadores delas"><br><sub>Caso: amostras da mesma campanha, com os relatórios e indicadores delas</sub></td></tr>
<tr><td width="50%"><img src=".github/screenshots/pt-BR/management.png" alt="Relatório gerencial: entrada, tempo até concluir, vereditos, técnicas ATT&amp;CK e carga por analista"><br><sub>Relatório gerencial: entrada, tempo até concluir, vereditos, técnicas ATT&amp;CK e carga por analista</sub></td><td width="50%"><img src=".github/screenshots/pt-BR/compare.png" alt="Comparação de amostras: o que duas amostras têm em comum e o que as diferencia"><br><sub>Comparação de amostras: o que duas amostras têm em comum e o que as diferencia</sub></td></tr>
</table>

<sub>Capturas com dados de exemplo, geradas pelo <code>scripts/ui-playwright/readme-shots.mjs</code>.</sub>

---

## Arquitetura

```
                                       Internet
                                          │
                           ┌──────────────▼──────────────┐
                           │ Cloudflare Tunnel (host)    │  fora do Docker, para localhost:8080
                           └──────────────┬──────────────┘
                                          │ 127.0.0.1:8080 (só no loopback)
┌─────────────────────────────────────────▼──────────────────────────── docker compose ──┐
│                                                                                        │
│  ┌─────────┐ /api   ┌───────────────┐  SQL    ┌──────────┐                             │
│  │ web     │───────▶│ api           │────────▶│ db       │  PostgreSQL 16              │
│  │ nginx   │        │ Fastify       │  S3     ├──────────┤                             │
│  │ React   │        │ Prisma        │────────▶│ minio    │  arquivos e backups         │
│  │         │        │               │ clamd   ├──────────┤                             │
│  └─────────┘        │               │────────▶│ clamav   │  antivírus                  │
│                     └┬──────┬──────┬┘         └──────────┘                             │
│                      │      │      │                                                   │
│  ┌───────────────────▼┐     │   ┌──▼────────────────────────────────────────────────┐  │
│  │ capture            │     │   │ serviços de análise (internos, sem internet)      │  │
│  │ navegador headless │     │   │ capa · ghidra · unpack · oletools · emulate       │  │
│  └─────────┬──────────┘     │   │ android · extract · dotnet · netcap · suricata    │  │
│            │                │   └───────────────────────────────────▲───────────────┘  │
│  ┌─────────▼──────────┐     │                                       │                  │
│  │ egress             │     │                                       │                  │
│  │ proxy filtrado     │     │                                       │                  │
│  │ para a internet    │     │                                       │                  │
│  └────────────────────┘     │                                       │                  │
│                             │                                       │                  │
└─────────────────────────────┼───────────────────────────────────────┼──────────────────┘
    API do PVE: clones,       │                                       │ TZSP por UDP 37008
    console, guest agent      │                                       │ (cópia do tráfego)
┌─────────────────────────────┼───────────────────────────────────────┼──── Proxmox VE ──┐
│  ┌──────────────────────────▼───────┐             ┌─────────────────┴───────────────┐  │
│  │ VM de análise                    │  bridge     │ MikroTik CHR (opcional)         │  │
│  │ linked clone do template,        │────────────▶│ roteia a rede das VMs; a api    │  │
│  │ amostra num CD-ROM, guest agent  │  isolada    │ liga o sniffer (RouterOS)       │  │
│  └──────────────────────────────────┘             └─────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **web**: nginx servindo o build (React + Carbon) e fazendo proxy de `/api` para a API. Roda
  **sem root** (imagem `nginx-unprivileged`, porta interna 8080), com o sistema de arquivos
  somente leitura, sem capacidades e com limite de memória; o host publica `127.0.0.1:8080`.
- **api**: Fastify + Prisma. No boot aplica migrações, roda o seed do admin e garante o bucket no MinIO.
- **db**: PostgreSQL 16.
- **minio**: armazenamento S3-compatible das amostras (nunca exposto publicamente).
- **clamav**: antivírus ClamAV (`clamd` + `freshclam`), só na rede interna; varre cada
  arquivo enviado.
- **capa**: análise de funções (capa e FLOSS) dos executáveis enviados, numa rede interna só
  com a API, sem internet, sem root e com a raiz somente leitura. Ver
  [Análise de funções](#análise-de-funções-capa-e-floss).
- **ghidra**: o Ghidra headless, sob demanda, no mesmo isolamento do capa. Ver
  [Análise com o Ghidra](#análise-com-o-ghidra).
- **unpack**: identifica os executáveis com o Detect It Easy e desempacota (UPX, instaladores,
  PyInstaller, AutoIt), no mesmo isolamento. Ver [Identificar e desempacotar](#identificar-e-desempacotar).
- **oletools**: macros VBA e XLM 4.0, DDE e objetos de RTF dos documentos do Office, no mesmo
  isolamento. Ver [Documentos do Office (oletools)](#documentos-do-office-oletools).
- **emulate**: emula executáveis do Windows e shellcode com o Speakeasy, no mesmo isolamento. Ver
  [Emulação (Speakeasy)](#emulação-speakeasy).
- **android**: lê APKs com o androguard, no mesmo isolamento. Ver [Android (APK)](#android-apk).
- **extract**: configuração de famílias com os extratores do CAPE e os dumps de memória do sandbox,
  no mesmo isolamento. Ver [Configuração de famílias (CAPE)](#configuração-de-famílias-cape).
- **dotnet**: descompila executáveis .NET com o ILSpy, no mesmo isolamento. Ver
  [Código .NET (ILSpy)](#código-net-ilspy).
- **capture**: navegador isolado que captura a página de um link, numa rede interna só com a API e
  o `egress`. Ver [Captura da página de um link](#captura-da-página-de-um-link).
- **egress**: a única saída para a internet da captura (e do download das regras do Suricata):
  resolve o nome uma vez, recusa rede interna, loopback e metadados de nuvem e conecta no IP
  conferido.
- **netcap** e **suricata** (opcionais, perfil `netcap`): o `netcap` recebe por UDP a cópia do
  tráfego da VM de análise que o sniffer do MikroTik CHR manda (TZSP) e grava um pcap por ambiente;
  o `suricata` lê esse pcap com as regras ET Open, sem rede.
- **Proxmox VE** (fora do Docker): para cada análise, a API faz um linked clone do template, põe a
  amostra num CD-ROM, abre o console da VM pelo próprio WebSocket e conversa com o guest agent. O
  **MikroTik CHR**, uma VM no mesmo Proxmox, roteia a rede isolada das VMs de análise. Ver
  [Sandbox de análise (Proxmox VE)](#sandbox-de-análise-proxmox-ve) e o
  [guia do Proxmox](docs/proxmox.pt-BR.md).
- Portas publicadas no host: **`127.0.0.1:8080`** (web, consumida pelo Cloudflare Tunnel),
  **`127.0.0.1:9001`** (console do MinIO) e, com o perfil `netcap`, **UDP 37008** (libere no
  firewall só o IP do CHR).

---

## Requisitos

- Docker + Docker Compose (plugin `docker compose`).
- (Opcional, para expor) `cloudflared` instalado **no host**.
- (Opcional, para o [sandbox de análise](#sandbox-de-análise-proxmox-ve)) um servidor Proxmox VE 8 ou 9
  e, para a captura de rede, um MikroTik CHR nele.

---

## Como rodar

```bash
# 1) Configure as variáveis (senhas, segredo de sessão, admin)
cp .env.example .env
# edite o .env, principalmente: POSTGRES_PASSWORD, SESSION_SECRET, CAPTURE_TOKEN, CAPA_TOKEN,
# GHIDRA_TOKEN, UNPACK_TOKEN, OLETOOLS_TOKEN, EMULATE_TOKEN, ANDROID_TOKEN, EXTRACT_TOKEN, DATA_KEY, ADMIN_PASSWORD, MINIO_ROOT_PASSWORD e
# S3_SECRET_KEY (com o perfil netcap, também NETCAP_TOKEN e SURICATA_TOKEN)
# (com SESSION_SECRET, um dos tokens ou a senha do banco ou do MinIO no valor padrão, a API não sobe)

# 2) Suba tudo
docker compose build
docker compose up
```

Acesse: **http://localhost:8080**

> **Para abrir a outras pessoas** (homelab, piloto): siga o
> [checklist de implantação](docs/implantacao.pt-BR.md), que cobre Cloudflare Access, a VPN da captura,
> o backup fora do disco restaurado uma vez e o monitoramento.

> **Pacote para o servidor:** `node scripts/package-deploy.mjs` gera `release/deeplook-<data>-<commit>.zip`
> (e o `.sha256`) a partir de um commit, só com o que o `docker compose up -d --build` precisa: sem
> `node_modules`, `dist`, dados, `.env` nem testes. `--list` mostra o que entraria e `--ref` escolhe
> o commit. Como instalar e atualizar com ele está no [checklist](docs/implantacao.pt-BR.md), passo 1.
>
> **Versões no GitHub:** ao subir uma tag `vX.Y.Z` (`git tag -a v1.2.0 -m "DeepLook 1.2.0" && git push
> origin v1.2.0`), a action [`release.yml`](.github/workflows/release.yml) gera o mesmo pacote,
> confere o `.zip` extraído e publica uma Release com `deeplook-v1.2.0.zip`, o `.sha256`, os passos de
> instalação e as notas das mudanças. Tag com hífen (`v1.2.0-rc1`) sai como pré-release; pela aba
> Actions dá para refazer o pacote de uma tag que já existe.

> Dica: rode em segundo plano com `docker compose up -d` e veja os logs com
> `docker compose logs -f`.

---

## Primeiro acesso

O **admin** é criado automaticamente no primeiro boot a partir das variáveis
`ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`.

1. Entre em **/login** com essas credenciais e defina uma senha nova, pedida no primeiro
   acesso. Em produção, o login com as senhas padrão publicadas (`admin12345`,
   `change-me-admin-password`) é recusado, porque qualquer um que as conheça trocaria a senha
   antes de você: defina `ADMIN_PASSWORD` no `.env` e reinicie (o seed troca a senha padrão
   pela do `.env`).
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

### Restringir o que o usuário comum vê

Por padrão, todos veem e exportam as amostras de todos. Em **Administração > Configurações**, a opção
"Usuários comuns veem só as amostras que eles mesmos enviaram" fecha isso, na hora e com registro
na Auditoria. Vale também para o token de API.

- **O que fica de fora:** amostra de outra pessoa responde "não encontrada". Listas, CSV, busca,
  ficha de indicador, relacionadas, mapa, avisos e favoritos ficam só com as dele, e o Histórico
  Global sai do menu.
- **O que continua:** a base de conhecimento, inteira. Analistas e admins seguem vendo tudo.

## Política de senha

- **Formato:** mínimo de 8 caracteres, com ao menos um número e um caractere especial
  (o que não é letra, inclusive acentuada, número nem espaço), e no máximo 72 bytes (o
  bcrypt ignora o que vem depois; acentos contam 2). Vale no cadastro, em
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
- **Grupos dentro de grupos:** só valem com `LDAP_NESTED_GROUPS=true`, porque ligar pode dar
  papel a mais gente. A conta de serviço precisa ler o `memberOf` dos grupos. Limites: até 200
  grupos por login, e grupo primário ("Domain Users") e grupos de outro domínio não entram.
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
  - segredo guardado cifrado (AES-GCM) com a chave de dados: o `DATA_KEY` do `.env` ou, sem ele,
    uma chave derivada do `SESSION_SECRET`;
  - códigos de recuperação só como hash;
  - um código não vale duas vezes;
  - 5 tentativas a cada 5 minutos na etapa do código;
  - tudo entra na auditoria.
- **Chave de dados (`DATA_KEY`):** defina-a (`openssl rand -hex 32`, diferente do
  `SESSION_SECRET`) e guarde-a junto do backup. Na subida seguinte a API recifra com ela os 2FA
  já ativados, e a partir daí o `SESSION_SECRET` pode ser trocado sem afetar o 2FA. Para trocar
  o próprio `DATA_KEY`, ponha a chave nova em `DATA_KEY` e a antiga em `DATA_KEY_PREVIOUS`,
  reinicie e, quando o status do sistema (Configuração) disser que a troca terminou, apague o
  `DATA_KEY_PREVIOUS`.
- **Sem `DATA_KEY`** (modo antigo), trocar o `SESSION_SECRET` invalida os 2FA já ativados,
  porque o segredo não decifra mais; o status do sistema avisa enquanto houver conta nessa
  situação. O login avisa que o 2FA precisa ser reconfigurado; os códigos de recuperação
  continuam valendo, e o admin pode desativar o 2FA para a pessoa ativar de novo.
- **Tokens de API** não passam pelo 2FA (são para scripts).

## Passkeys (login alternativo)

Opcional, por usuário, em **Minha Conta > Passkeys**. Uma passkey (WebAuthn) deixa a pessoa entrar com a
biometria, o PIN ou a chave de segurança do aparelho, sem digitar a senha:

- **Cadastro:** só depois de entrar, com a conta já criada. Pede de novo a senha (e o código do 2FA, se a
  conta usa 2FA), porque a passkey entra sem senha. Até 10 por conta; cada uma tem nome, data de cadastro e
  último uso. Remover uma impede que ela entre.
- **Entrar:** a tela de login tem **Entrar com passkey**. O aparelho lista as contas dele e a pessoa escolhe
  uma; não se digita o e-mail. A senha continua valendo como antes.
- **Senha e 2FA:** a passkey exige a verificação do usuário (biometria ou PIN), então vale por senha e
  segundo fator: entrando com ela, o código do 2FA não é pedido. Conta do AD entra pelo AD e não tem passkeys.
- **Admin:** redefinir a senha de um usuário também remove as passkeys dele. Todo cadastro, remoção e
  login recusado vai para a auditoria.
- **Endereço:** a passkey fica amarrada ao endereço em que foi cadastrada, e os navegadores só a oferecem
  em HTTPS (ou `localhost`). Defina `WEBAUTHN_ORIGIN` (ex.: `https://deeplook.empresa.com`; vários,
  separados por vírgula) para fixar o endereço aceito; vazio, vale o da própria página. `WEBAUTHN_RP_ID`
  muda o domínio da credencial (padrão: o host do primeiro endereço). Trocar o domínio faz as passkeys
  cadastradas deixarem de funcionar.

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

### Monitoramento: o status do sistema por token

Um monitor externo (Uptime Kuma, Zabbix...) lê o mesmo status da tela **Administração >
Status**, sem raspar HTML, com um token de finalidade **Monitoramento**:

1. Um **admin** com o "Acesso por API" liberado gera o token em **Minha Conta > Tokens de
   API**, escolhendo a finalidade *Monitoramento: só ler o status do sistema* (só
   administradores veem essa opção).
2. O monitor consulta:

```bash
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/status"
# 503 quando a situação geral é "error" (para monitor que só olha o código HTTP)
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/status?strict=1"
```

- A resposta traz `overall` (`ok`, `warn` ou `error`, a pior das verificações), `checkedAt` e a
  lista `checks` (banco, MinIO, antivírus, filas, **integridade dos arquivos**...).
- **Só leitura e só esta rota:** o token de status não alcança amostras, administração nem
  qualquer outra rota, e o token de amostras não lê o status. Se o dono deixar de ser admin,
  o token para de valer na hora.
- **Cache de 10 s** (e uma verificação por vez): `checkedAt` mostra a idade, e um monitor que
  pergunta de segundos em segundos não vira uma enxurrada de consultas ao banco, ao MinIO, ao
  ClamAV e ao LDAP. Use `GET`; `HEAD` não vale para token.
- Não confundir com `/api/health/ready`, que é pública e só diz *ok* ou *não* (usada pelo
  compose): o status por token é autenticado e traz o detalhe (endereços, versões, latências).

### Feed de indicadores: TAXII 2.1 e MISP

Outra ferramenta busca os indicadores sozinha, sem ninguém exportar arquivo, com um token de
finalidade **Feed de indicadores** (só **admin** gera, com o "Acesso por API" liberado):

- **TAXII 2.1** (OpenCTI, Microsoft Sentinel e outros): descoberta em `/api/taxii2/`, raiz
  `/api/taxii2/deeplook/` e uma coleção, **Indicadores do DeepLook**. Ela tem os objetos (com
  `added_after`, `limit`, `next`, `match[type]` e `match[id]`), o objeto, as versões e o
  manifesto. Autenticação por `Authorization: Bearer <token>` ou **Basic** com qualquer usuário e
  o token como senha (o conector TAXII do Sentinel só fala Basic). O Basic vale só nestas rotas.
- **Feed MISP**: no MISP, *Sync Actions > Feeds > Add Feed*, formato **MISP Feed**, URL
  `https://deeplook.exemplo/api/feeds/misp` e, em *Headers*, `Authorization: Bearer <token>`.
  O MISP lê o `manifest.json` e busca um evento por amostra.

```bash
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/taxii2/"
curl -u "feed:dlk_..." "https://deeplook.exemplo/api/taxii2/deeplook/collections/"
curl -H "Authorization: Bearer dlk_..." "https://deeplook.exemplo/api/feeds/misp/manifest.json"
```

- **O que sai:** só os indicadores de amostras **maliciosas ou suspeitas**, fora da lixeira, e
  **nunca** os da lista de permitidos nem os **domínios da empresa** (com subdomínios, e-mails e
  URLs deles). Um indicador que também aparece numa amostra limpa sai com o veredito da pior.
- **Os mesmos ids** dos arquivos `.stix.json` e `.misp.json` da ficha: quem já importou um
  arquivo não ganha duplicata.
- **Atualização:** a versão de cada indicador é a última mudança das amostras dele, então quem
  busca com `added_after` recebe também a amostra que **virou** maliciosa depois. O conjunto é
  recalculado no máximo a cada minuto. Quando uma amostra deixa de ser maliciosa, o indicador
  some da coleção, mas o TAXII não avisa quem já o tinha.
- **Endereço público:** os links da descoberta usam `https` quando `COOKIE_SECURE=true` (atrás
  do Tunnel, o nginx recebe `http`).
- **Limite:** 1200 pedidos por minuto para este token (o MISP busca um arquivo por evento); os
  outros seguem com 120. Se o dono deixar de ser admin, o token para de valer.

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
  - o contêiner `capture` fica só na rede `capture`, sem banco, MinIO ou ClamAV. A API o
    chama por essa rede, mas recusa conexões que venham dela;
  - a rede `capture` é **interna**: sem rota para fora, sem DNS externo e, com a opção
    `inhibit_ipv4` (Docker 28 ou mais novo), sem IP do host na bridge, então nem a LAN nem o
    próprio host são alcançáveis de lá. A única saída é o serviço **`egress`**, um proxy só de
    Node (sem navegador) que fica nessa rede e numa rede com saída. Assim a regra abaixo vale
    mesmo que o navegador seja comprometido e deixe de obedecer ao proxy dele. Num Docker
    anterior ao 28 a opção não foi conferida: a rede continua interna, mas o host pode seguir
    alcançável pelo IP da bridge;
  - o Chromium roda com o **sandbox próprio**: cada página é renderizada num processo com
    namespaces de usuário, PID e rede próprios e com o filtro seccomp do Chromium, então uma
    falha explorada no renderizador fica presa ali, sem chegar ao container. Para isso o
    `capture` usa um perfil seccomp próprio (`apps/capture/seccomp-chromium.json`): o padrão
    do Docker mais só o que o sandbox precisa (criar namespaces de usuário, PID e rede, e
    `chroot`). Montagens e os demais namespaces continuam barrados. O perfil é gerado por
    `node scripts/seccomp-chromium.mjs`, não edite à mão;
  - todo o tráfego do navegador passa pelo `egress`, que resolve o nome uma vez e **recusa
    endereços privados, loopback, link-local e de metadados de nuvem** (169.254.169.254),
    sem nova resolução de DNS. O que ele recusa volta para a ficha da captura;
  - WebRTC e QUIC desligados, sem downloads, contexto novo a cada captura;
  - roda como usuário sem privilégios, com `no-new-privileges`;
  - **um container por captura:** a raiz é somente leitura e o Chromium só escreve em `/tmp`
    (em memória, sem executáveis). Depois de responder, o processo sai e o Docker sobe um
    container limpo, então nem arquivo nem processo deixado por uma página chega à captura
    seguinte. Enquanto o container troca, a API espera a vez (até 2 minutos). Duas capturas
    seguidas ficam com pelo menos uns 10 s entre si, porque o Docker atrasa cada vez mais o
    reinício de um container que viveu menos que isso.
- **Saída para a internet:** o servidor precisa alcançar os links. Sem VPN, a captura abre
  links maliciosos **pelo IP da sua casa**. A rede `capture-egress` tem sub-rede fixa
  (`CAPTURE_EGRESS_SUBNET`) para o host mandá-la por uma VPN com roteamento por origem; o
  passo a passo está em [docs/implantacao.pt-BR.md](docs/implantacao.pt-BR.md), passo 3.
- **Atualizar uma instalação:** `docker compose down` antes do `up -d --build`, porque o Docker
  não transforma em interna uma rede que já existe.
- **HTML:** só baixa como texto (`.html.txt`), nunca abre no navegador.
- **Páginas com a mesma aparência:** a captura guarda um hash perceptual do topo da página (o que
  a pessoa vê ao abrir, 1280×800), calculado no próprio serviço `capture` numa miniatura de
  17×16 em tons de cinza. Na aba **Relacionadas**, amostras cujas páginas diferem em até 10% dos
  bits aparecem como *Página com a mesma aparência (captura)*, mesmo em domínios, IPs e HTML
  diferentes: é o que liga o mesmo kit de phishing hospedado em vários lugares. Vale a captura
  mais recente da amostra contra todas as das outras; página quase em branco (erro, "site
  suspenso") fica sem hash, para não ligar todas as vazias entre si. Capturas feitas antes desta
  versão não têm o hash: capture de novo para entrar na comparação.
- **Limites:** 20 s para abrir a página, print de até 6.000 px de altura, HTML de até 2 MB,
  uma captura por vez (por container).
- **Desligar:** `CAPTURE_URL=` (vazio) no `.env`; o serviço `capture` pode sair do compose.
- **Host sem user namespaces:** se a captura responder "o sandbox do Chromium não subiu neste
  host", o kernel não deixa criar namespaces de usuário sem privilégio. Pode acontecer, por
  exemplo, no Ubuntu 24.04 com `kernel.apparmor_restrict_unprivileged_userns=1`, ou com
  `user.max_user_namespaces=0`. Libere no host. Só como saída de emergência,
  `CAPTURE_CHROMIUM_SANDBOX=false` no `.env` volta ao modo sem sandbox.
- **Token:** troque o `CAPTURE_TOKEN` (16+ caracteres), que vale para a API e para o
  serviço.

## Conteúdo do arquivo (hexadecimal)

Na aba Detalhes, para analistas, a seção **Conteúdo (hex)** mostra o arquivo em hexadecimal e texto,
de 4 em 4 KB, com o cabeçalho conhecido (MZ, ELF, PK, %PDF...) destacado. Nada é baixado nem
executado: a API lê do MinIO só a faixa pedida.
- **Buscar no arquivo:** por **texto** (sem diferenciar maiúsculas, em ASCII/UTF-8 e em UTF-16, o
  das strings do Windows) ou por **bytes** em hexadecimal (`4D 5A 90 00`). A API lê o arquivo
  inteiro em fluxo e devolve até 200 posições; cada uma abre o trecho dela, com os bytes destacados.
- **Ir para a posição:** em hexadecimal (`0x1A30`) ou decimal; "Mostrar os 4 KB anteriores" e
  "Mostrar mais 4 KB" andam a partir dali.

## Análise estática de executáveis do Windows

Todo arquivo enviado passa pela análise estática (só leitura de bytes, numa thread com limite
de tempo e memória). Nos executáveis do Windows (PE), a seção **Análise estática** da ficha
mostra, além de seções, imports e empacotador:

- **Alertas** por gravidade: assinatura que não confere com o arquivo, executável escondido
  num recurso, seção gravável e executável, ponto de entrada fora do lugar, poucas
  importações com `GetProcAddress`/`LoadLibrary`, data de compilação no futuro, Rich header
  editado, manifesto que pede administrador, "diz ser da Microsoft" sem assinatura.
- **imphash** e **hash do Rich header**, iguais aos do `pefile` (e do VirusTotal). A aba
  **Relacionadas** liga amostras com o mesmo imphash ou o mesmo Rich header. O imphash só liga
  com tabela própria: .NET (todo ele importa só `_CorExeMain`) e tabelas de empacotador
  (menos de 10 funções) ficam de fora, senão ligariam amostras sem relação nenhuma.
- **Hashes de pivô**, cada um na aba **Relacionadas**:
  - **authentihash**: o SHA-256 do Authenticode, que não muda com a assinatura. Liga o mesmo programa
    assinado por outro certificado, e é o hash que o LOLDrivers e o VirusTotal publicam;
  - **exphash**: o MD5 dos nomes exportados, igual ao do `pefile` (só com 3 nomes ou mais);
  - **ícone principal**: um dHash de 64 bits da maior imagem do primeiro ícone. Liga o ícone igual ou
    quase igual (até 4 bits de diferença); um ícone que mais de 50 amostras usam (o padrão do Visual
    Studio, o de um instalador) não liga;
  - nos executáveis Linux, o **telfhash** da Trend Micro (o TLSH das funções globais, distância até 50),
    e nos de macOS, o **symhash** de cada arquitetura (o MD5 dos símbolos importados, como o do
    VirusTotal).
- **Abuso conhecido**, em todo arquivo:
  - **driver do [LOLDrivers](https://www.loldrivers.io)** (vulnerável, usado para desligar o antivírus
    a partir do kernel, ou malicioso), pelo authentihash ou pelo SHA-256: alerta alto;
  - **ferramenta de acesso remoto legítima do [LOLRMM](https://lolrmm.io)** (AnyDesk, ScreenConnect,
    TeamViewer...), pelo produto, pelo nome original, pelo assinante ou pelos domínios de relay nas
    strings. Sozinha é só informação; entregue dentro de outro arquivo (anexo de e-mail, pacote), é o
    golpe do falso suporte e conta no risco;
  - **binário do sistema usado para baixar ou executar carga** (certutil, mshta, regsvr32, rundll32,
    bitsadmin, msiexec remoto, wmic, msbuild..., e as shells reversas do Linux), na linha de comando
    do script, do atalho, das ações do MSI ou das strings do executável. Só conta com o argumento que
    denuncia o abuso, com o link para a página do LOLBAS ou do GTFOBins.

  As listas do LOLDrivers e do LOLRMM (Apache-2.0) ficam em `apps/api/src/lib/lol/` e são
  atualizadas por `node apps/api/scripts/vendor-lol.mjs <drivers.json> <rmm_tools.json>`. O LOLBAS e o
  GTFOBins são GPL-3.0: a lista de binários é escrita no próprio projeto (`lolbins.ts`).
- **Criptografia e codificação** (em todo PE, ELF e Mach-O): as constantes de AES (S-box e tabelas),
  ChaCha/Salsa20, RC5/RC6, TEA, Blowfish, MD5, SHA-1, SHA-256 e CRC32, com a posição no arquivo, e
  as chaves RSA embutidas (blob do CryptoAPI ou do CNG, PEM), que viram alerta. Um **alfabeto Base64
  próprio** (64 caracteres únicos que não são o padrão) também vira alerta, e as strings do arquivo
  que ele decodifica em texto ou num executável aparecem ao lado: é o texto que a extração comum não
  vê.
- **Ferramentas do Rich header**: cada entrada com a ferramenta (C, C++, ASM, linker...) e a
  versão do Visual Studio, pela tabela do [richprint](https://github.com/dishather/richprint)
  (BSD-2-Clause, em `apps/api/src/lib/rich-products.json`; `node apps/api/scripts/vendor-richprint.mjs`
  a atualiza).
- **Depuração (PDB)**: o caminho do PDB que o linker gravou, com o **usuário** e o **projeto** tirados
  dele (`C:\Users\<usuário>\...\<projeto>\obj\Release\...`), a identificação da compilação (GUID e age,
  como no servidor de símbolos) e os tipos de entrada (POGO, REPRO...). O mesmo caminho ou a mesma
  compilação ligam amostras na aba **Relacionadas**.
- **Datas gravadas**: a do cabeçalho, a do diretório de debug, a das exportações e a dos recursos. Quem
  forja a data costuma trocar só a do cabeçalho, e a diferença vira o alerta de **data de compilação
  alterada** (timestomping). A compilação reprodutível (REPRO), que grava um hash no lugar da data, e a
  data fixa do Delphi não alertam.
- **Assinatura Authenticode**: quem assinou, quem emitiu, validade, impressão digital, carimbo
  de tempo e a cadeia que veio no arquivo. A situação diz se o arquivo foi **alterado depois de
  assinado** e se a assinatura confere com o certificado. A cadeia **não** é conferida contra
  as raízes confiáveis do Windows (a API não as tem): "íntegra" quer dizer íntegra, não
  confiável.
- **Recursos** (tipo, idioma, tamanho, entropia e o que há dentro), **informações de versão**
  (empresa, nome original...), **manifesto**, **exports** (com encaminhamentos), **TLS
  callbacks**, **dados anexados** (overlay, fora a assinatura) e **checksum**.
- **.NET**: runtime, assembly, referências, as funções nativas chamadas por **P/Invoke**,
  chamadas sensíveis (`Assembly.Load`, `WebClient`, `Process.Start`...), marcas de ofuscador e os
  **recursos embutidos** no assembly (nome, tamanho, entropia e conteúdo).
- **Baixar os recursos separados**: quem enviou e os analistas baixam cada recurso da lista (Win32 e
  .NET), ou todos de uma vez. O ícone e o cursor saem remontados como `.ico` e `.cur` (o executável os
  guarda aos pedaços), e o bitmap sai como `.bmp`, com o cabeçalho de arquivo refeito: abrem em
  qualquer visualizador. Imagens saem como arquivo; o resto (executável, binário, script) sai dentro
  do ZIP com a senha `infected`, como a amostra. Cada download vai para a Auditoria.
- O **UPX** é reconhecido também pelo código de entrada, com as seções renomeadas.

As amostras enviadas antes ganham a análise nova em segundo plano, uma de cada vez, depois que
a API sobe; um analista também pode pedir **Analisar de novo** na ficha. A comparação de
amostras (A × B) mostra imphash, Rich header e quem assinou.

## Canais de exfiltração

Para onde a amostra manda o que rouba e com que credencial: é o C2 e a prova ao mesmo tempo. A seção
**Canais de exfiltração** da ficha junta o que as análises acharam nas strings, nas camadas
decodificadas dos scripts, nas strings do FLOSS, no código do ILSpy e do CFR, na emulação e na
configuração do CAPE:
- token de bot do Telegram e o `chat_id`;
- webhook do Discord e do Slack, e webhooks de coleta (webhook.site, Pipedream);
- servidor SMTP, e o usuário e a senha de e-mail quando o código os passa juntos
  (`NetworkCredential`, `PasswordAuthentication`);
- FTP (com a credencial na URL, quando há);
- sites de paste (Pastebin, paste.ee, rentry, gist), túneis (ngrok, Cloudflare Tunnel, serveo,
  playit) e chaves de nuvem e de API (AWS, Google, GitHub, Slack).

Detalhes:
- **Nada é consultado.** Um token dá o controle do bot a quem o usa, e o chat costuma guardar os
  dados das vítimas.
- **A credencial inteira é só para analistas.** Para os outros, o token, a senha e o segredo do
  webhook saem cortados em qualquer lugar da ficha: na lista, nas camadas do script, nas URLs, nos
  IOCs sugeridos e nas strings do FLOSS.
- **Risco:** canal com credencial soma +30 (+5 por tipo a mais, teto 40). Túnel ou webhook sem
  credencial soma +10. O host próprio (SMTP, túnel) vai para os IOCs sugeridos.

## Análise de funções (capa e FLOSS)

Cada executável do Windows ou do Linux enviado (até `CAPA_MAX_MB`, 32 MB) entra numa fila, e o
serviço `capa` o analisa em segundo plano, `CAPA_WORKERS` de cada vez (2 por padrão, um
contêiner por análise), os arquivos menores primeiro; quem espera há mais de 30 minutos passa à
frente. Um executável grande ou em Go prende o seu contêiner por até 15 minutos (os tetos do capa e
do FLOSS) sem parar a fila inteira. Nada é executado: as duas ferramentas da Mandiant leem e emulam
o código.

- **[capa](https://github.com/mandiant/capa)** diz o que as funções fazem ("injeta thread em
  outro processo", "contém strings montadas na pilha", "carrega assembly .NET"), com o grupo, as
  técnicas **ATT&CK**, o **MBC** e os endereços das funções. As técnicas viram o botão **Inserir
  técnicas sugeridas pelo capa** no Novo relatório.
- **[FLOSS](https://github.com/mandiant/flare-floss)** recupera as strings que só existem na
  execução (montadas na pilha ou decifradas), que a extração comum não vê. Os indicadores nelas
  entram nas sugestões de IOC. Só em executáveis do Windows.
- **Na ficha:** seção **Análise de funções (capa)** com a situação (na fila, analisando,
  concluída, falhou e por quê), as capacidades (as de risco em destaque), as técnicas e as strings
  escondidas. Analistas pedem **Analisar de novo**; todos que veem a amostra veem a análise. Por
  token de API: `GET /api/entries/:id/capa`.
- **Tempo:** de segundos a minutos. Cada ferramenta tem um teto (`CAPA_TIMEOUT_S`,
  `FLOSS_TIMEOUT_S`); um executável com milhares de funções pode estourar, e a falha diz
  "tempo esgotado". Em executáveis do Windows de até `CAPA_REUSE_MAX_MB`, o FLOSS carrega a análise
  que o capa acabou de fazer em vez de refazê-la: o mesmo resultado, uns 15% mais rápido nos
  comuns, e num executável em Go de 2 MB o FLOSS caiu de 299 s (estourava o teto) para 191 s.
- **Só o nível do arquivo:** se a análise de funções de um executável do Windows não termina (tempo
  ou memória), o serviço ainda roda as regras do nível do arquivo (o backend `pefile` do capa:
  importações, strings, seções), em segundos e com teto `CAPA_FILE_TIMEOUT_S`. A ficha mostra
  "só o nível do arquivo", o motivo da completa e as capacidades sem endereços de função. Num Go de
  8,7 MB que gastava os 600 s e saía vazio, vieram 5 regras em 11 s. Nos executáveis do Linux não há
  essa alternativa; a ficha explica por que a análise não terminou.
- **Isolamento:** contêiner sem rede nenhuma (rede interna `analysis`, só com a API), sem root,
  sem capacidades, raiz somente leitura e `/tmp` em memória sem execução. Como a captura, um
  **contêiner novo a cada análise**: a API espera o novo estar livre antes de mandar o próximo
  arquivo. Serviço fora do ar: a análise volta para a fila e tenta de novo (até 3 vezes).
- **Status do sistema:** linha "Análise de funções (capa)" com as versões, cada réplica (livre,
  ocupada ou sem resposta), a fila (esperando e analisando), a espera do mais antigo e as análises
  em 24 h. Fica em aviso com uma réplica sem resposta ou com o mais antigo esperando há mais de 1 h.
- **Versões:** capa 10.0.0 e FLOSS 3.2.0, com as regras e as assinaturas da mesma versão do capa,
  baixadas no build e conferidas pelo hash. As dependências Python ficam travadas com hash em
  `apps/capa/requirements.txt` (gerado de `requirements.in`). Para subir o capa, troque a versão
  no `requirements.in`, regenere o lockfile e troque no `Dockerfile` as URLs, os hashes e
  `CAPA_RULES_VERSION`; o Dependabot não sobe o capa nem o FLOSS sozinho.
- **Desligar:** `CAPA_URL=` (vazio) no `.env`; o serviço `capa` pode sair do compose.

## Análise com o Ghidra

Um analista pede **Analisar com o Ghidra** na seção da ficha; o serviço `ghidra` roda o Ghidra
headless (12.2) em segundo plano, um por vez, e a ficha mostra:

- o **programa** (formato, processador, compilador, base e entrada) e quantas funções há;
- o **pseudo-C** do ponto de entrada e das funções que mais chamam **APIs sensíveis** (injeção,
  rede, persistência, criptografia, antianálise; a lista está em `apps/ghidra/sensitive-apis.txt`),
  com quem chama cada uma. Importação por ordinal do ws2_32 vira o nome, pela mesma tabela do
  `pefile` que o imphash usa;
- as **maiores funções**, com complexidade e as APIs que chamam;
- o **pseudo-C de todas as funções**, numa janela aberta por **Ver todas as funções**: a lista à
  esquerda, com busca por nome ou endereço, "só as que chamam APIs sensíveis", "esconder as de
  biblioteca" e ordem; à direita, o código com números de linha e realce, as APIs que a função chama
  e quem a chama. O nome de uma função chamada no código leva a ela, com voltar e avançar. A **Busca
  no código** procura um texto no pseudo-C de todas as funções e lista, por função, as linhas em que
  ele aparece; cada linha abre a função nela, com as ocorrências marcadas. Cada bloco do pseudo-C da
  ficha tem **Abrir na janela**;
- o **projeto `.gzf`**, para abrir no Ghidra local já analisado.

Detalhes:

- **Só executáveis do Windows e do Linux**, até `GHIDRA_MAX_MB`. **.NET fica de fora**: o Ghidra não
  descompila o código intermediário (IL), e o resultado seria só o stub do CLR.
- **Tempo:** de 12 a 20 s nos executáveis de teste (o Java sobe a cada análise). Num executável
  grande, a análise automática para em 70% de `GHIDRA_TIMEOUT_S` e o resumo ainda sai, parcial.
- **Binários grandes:** cada processo do descompilador nativo tem teto de memória
  (`GHIDRA_DECOMPILER_MAX_MB`): numa função em que ele cresceria sem limite, só ela fica sem
  pseudo-C, em vez de o contêiner esgotar a memória e não sair nada. Acima de `GHIDRA_LIGHT_MB`, a
  análise começa sem o analisador de `switch`, que dobra o tempo; a ficha mostra "Mais leve, pelo
  tamanho do binário", e o código alcançado só por tabelas de salto pode ficar de fora (de 2% a 3%
  das funções nos medidos). No `python3.13` (6,8 MB), que antes passava de 10 GB e não terminava:
  320 s, 2,4 GB, 6403 funções e o pseudo-C de todas menos 31.
- **Pseudo-C de todas as funções:** sai na mesma passada, em paralelo (o ponto de entrada e as que
  chamam APIs sensíveis primeiro, as de biblioteca por último), com prazo de `GHIDRA_TIMEOUT_S` menos
  90 s. O que não couber no prazo, ou passar de `GHIDRA_MAX_PSEUDO_MB` de código somado, aparece na
  lista sem código e com o motivo; a lista para em 20 000 funções, e cada uma em 256 mil caracteres.
  Medido no Ghidra 12.2: o `bash` (2041 funções) sai inteiro em 70 s, com 750 KB. O texto mora no
  MinIO **fora de `samples/`** (não tem os bytes da amostra): fica depois da retenção, entra no
  backup sem amostras e sai na exclusão definitiva ou ao analisar de novo. Ver e navegar: quem vê a
  amostra, como o resumo (a API de tokens também lê a lista, cada função e a busca). A busca lê o
  texto em fluxo, sem índice: texto literal, até 200 funções e 10 linhas por função na resposta, 10 s
  de prazo, 30 buscas por minuto por sessão e 4 ao mesmo tempo na API. **Baixar tudo (.c)**: só
  quem enviou e os analistas, na Auditoria, como o `.gzf`. Análises anteriores mostram "analise de
  novo para ver todas as funções".
- **O `.gzf` tem os bytes da amostra.** Baixá-lo segue a regra de baixar a amostra (quem enviou e os
  analistas) e fica na Auditoria. Ele mora no MinIO junto das amostras: o backup sem amostras o
  deixa de fora, e a retenção e a exclusão definitiva o apagam com o arquivo.
- **Isolamento:** como o capa, rede interna só com a API, sem root, sem capacidades, raiz somente
  leitura, `/tmp` em memória sem execução e um contêiner novo a cada análise.
- **Imagem:** 1,45 GB (Debian, OpenJDK 25 sem os `jmods` e o Ghidra sem documentação, extensões,
  servidor e depurador). O pacote é conferido pelo SHA-256 publicado. O guava 32.1.3 que o Ghidra 12.2
  traz tem CVE alta; o build o troca pelo 33.7.2, conferido pelo hash. Ao subir o Ghidra, troque no
  `Dockerfile` a URL, o hash e `GHIDRA_VERSION`, e veja se a troca do guava ainda é necessária.
- **Memória:** o contêiner tem teto de 6 GB, mas só gasta durante uma análise (700 MB nos
  executáveis de teste; de 1,1 a 1,5 GB em executáveis de 1 a 4 MB, com o pseudo-C de todas as
  funções).
- **Desligar:** `GHIDRA_URL=` (vazio) no `.env`; o serviço `ghidra` pode sair do compose.

## Regras YARA

### Pacotes de regras

O DeepLook já vem com regras de fontes confiáveis, em `apps/api/rules`, sem baixar nada ao subir:

| Pacote | Autor | Licença | Situação |
|---|---|---|---|
| ReversingLabs (310 conjuntos) | ReversingLabs | MIT | ligado |
| bartblaze (89, sem a pasta `generic`) | bartblaze | MIT | ligado |
| signature-base (752) | Florian Roth (Neo23x0) | DRL 1.1 | desligado |
| ESET (24 arquivos, uma pasta por campanha) | ESET Research | BSD-2-Clause | desligado |
| Volexity (26 arquivos, um por artigo do blog) | Volexity | BSD-2-Clause | desligado |

- **Ligar e desligar:** em **Administração > Configurações**. Desligar não apaga nada; as regras só
  saem da varredura dos próximos arquivos.
- **Instalação:** cada pacote instala uma vez, ao subir ou ao ligar. O que for desativado ou excluído
  na tela Regras YARA não volta sozinho.
- **Regra de pacote não se edita:** para mudar, escreva uma regra da equipe.
- **Autoria:** a ficha mostra o autor e o pacote de cada detecção. A DRL 1.1 exige isso.
- **Variáveis das regras:** `filename`, `extension` e `filetype` vêm da amostra. `filepath` e `owner`
  ficam vazios, porque um envio não tem pasta nem dono: regra que exige um caminho não dispara. As
  regras `Suspicious_Size_*` ficam ignoradas, porque marcam arquivos legítimos do Windows. Regras da
  equipe também podem usar essas variáveis.
- **Atualização automática:** ligada por padrão, em **Administração > Configurações**. Toda semana a API
  procura no GitHub (`api.github.com` e `codeload.github.com`) a versão mais nova com pelo menos 7 dias
  dos pacotes ligados. Sem internet, nada muda.
  - **Entra sozinho** o que passa nos filtros: licença idêntica; até 20% de conjuntos alterados ou
    removidos; nenhuma regra nova disparando nas 100 amostras recentes com veredito Limpo; compilação até
    2x mais lenta. Arquivo que não compila fica de fora.
  - **Fica retido** para um admin aprovar ou descartar o que não passa, com o motivo na tela.
  - **Voltar a versão:** a última aplicada volta com um clique, e aquela versão não é reaplicada sozinha.
  - **Respeita as escolhas:** regra desativada continua desativada, e regra excluída não volta.
- **Versão de fábrica:** `node scripts/vendor-yara-packs.mjs <pasta com os clones> [id do pacote...]`
  atualiza a cópia em `apps/api/rules`, usada só nas instalações novas. Com ids, só esses pacotes são
  copiados de novo, e os outros ficam como estão no `packs.json`. ESET e Volexity guardam as regras em
  pastas espalhadas pela raiz do repositório, então a pasta de origem deles é o repositório inteiro.
- **YARA Forge (opcional, no servidor):** o pacote core do [YARA Forge](https://github.com/YARAHQ/yara-forge)
  junta regras de dezenas de repositórios, filtradas por qualidade e pontuação. Cada conjunto mantém a
  licença dele (GPL, DRL, MIT, e alguns sem licença declarada), e por isso o pacote não vem no
  repositório: quem quiser roda `node apps/api/scripts/vendor-yara-forge.mjs --tag <release>` (ou com o
  `.zip` baixado). O script separa as regras por repositório de origem, tira os conjuntos que já são
  pacotes dedicados (signature-base, ESET, Volexity, ReversingLabs, bartblaze), deixa só o que compila
  e grava `apps/api/rules/yara-forge/` e `apps/api/rules/local-packs.json`, ambos fora do Git. Depois,
  `docker compose build api` e ligar o pacote em Configurações. Ele não se atualiza sozinho: para
  atualizar, rode o script de novo.
- **Amostras antigas:** os pacotes valem para os próximos arquivos. Para as antigas, use "Aplicar às
  amostras".

### Regras da equipe

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

## Documentos do Office (oletools)

Cada documento do Office (antigo ou novo) e cada RTF enviado vai, sozinho e em segundo plano, para
o serviço **`oletools`**, que mostra na ficha a seção **Documento (oletools)**. Ela fica ao lado da
análise de documentos que já existia (em TypeScript, no envio), e traz o que aquela não vê:

- **macros VBA** com o código de cada módulo (recolhido) e as palavras-chave suspeitas, com a
  **desofuscação** do olevba (Base64, hexadecimal, `StrReverse`, `Chr()`...);
- o veredito do **MacroRaptor**: macro suspeita quando executa ao abrir **e** grava arquivos ou
  executa programas;
- **macros XLM 4.0** (Excel 4), que muito malware usa justamente porque escapam de quem só olha VBA,
  e **VBA stomping** (o código-fonte não bate com o compilado);
- **campos DDE**, que executam comandos sem macro;
- **objetos de um RTF**, com destaque para o Equation Editor (CVE-2017-11882);
- os indicadores do **oleid** (cifrado, macros, objetos externos).

Os alertas altos entram na **pontuação de risco**. O serviço segue o isolamento do `capa`: sem
rede nenhuma, raiz somente leitura, sem capacidades e sem root, um contêiner por análise, e a
análise roda num processo filho com tempo-limite (`OLETOOLS_TIMEOUT_S`, padrão 120 s), então um
documento que trave o parser derruba só aquele processo. **Nada do documento é executado.**
Analistas pedem de novo pela seção. Defina `OLETOOLS_TOKEN` (16+ caracteres) no `.env`; com o
valor padrão, a API não sobe em produção. `OLETOOLS_URL=` (vazio) desliga.

### QR code

Phishing por QR code (inclusive boleto) passa pelos filtros de e-mail porque o link não está no
texto. O mesmo serviço lê QR codes (zxing-cpp, com o pdfium para as páginas do PDF), em segundo
plano:

- em toda **imagem** (PNG, JPEG, GIF) e todo **PDF** enviados, inclusive os anexos de um `.eml`, que
  viram amostras;
- no **print da página** de uma amostra de link, a cada captura.

A ficha mostra a seção **QR codes**, com o conteúdo e de onde veio (a imagem, a página do PDF ou o
print). Um endereço entra nos IOCs sugeridos, ganha o botão **Analisar este link** (uma amostra de
link nova, que cita a de origem) e soma na **pontuação de risco**. Os tetos são explícitos: as 5
primeiras páginas do PDF, 40 milhões de pixels por imagem ou página e 20 códigos por amostra. Nada
é executado: o PDF só é renderizado, sem JavaScript.

## Scripts (PowerShell, lote, VBScript, JScript, AutoIt)

Scripts enviados (`.ps1`, `.bat`, `.cmd`, `.vbs`, `.vbe`, `.js`, `.jse`, `.wsf`, `.hta`, `.au3`, ou
reconhecidos pelo conteúdo) ganham a seção **Script** na ficha. Ela mostra as chamadas suspeitas
(com o porquê), as URLs e as **camadas decodificadas**. Nada é executado: tudo é feito sobre o
texto.

- **Codificação:** `-EncodedCommand`, `FromBase64String` (também com GZip/Deflate), `atob`,
  `fromCharCode`, `unescape`, `Chr() & Chr()`, blocos Base64 soltos e listas de bytes.
- **XOR de um byte:** um bloco Base64 ou uma lista de bytes que vira script com uma chave de 1 byte
  (o `-bxor` com chave fixa) aparece como camada, com a chave.
- **Script Encoder** (`#@~^`, `.vbe` e `.jse`): o texto decodificado é a primeira camada.
- **Normalização:** o texto sem a ofuscação que não é codificação vira a camada "normalizada", com
  as técnicas desfeitas no título:
  - PowerShell: crases, concatenação de literais, operador `-f`, `[char]` e `[char[]] -join`,
    `-replace` e `.Replace()`, texto invertido e variáveis atribuídas uma vez com um literal;
  - lote: circunflexos, `set` com `%var%` e `!var!`, as fatias `%var:~a,b%` (também das variáveis
    do Windows, como `%COMSPEC%`) e a troca `%var:x=y%`;
  - VBScript: `Chr()` no meio do texto, `&`, `StrReverse` e `Replace`;
  - JScript: escapes `\x41` e `\u0041`, `+`, `.split('').reverse().join('')` e `.replace()`.

As regras de chamadas suspeitas olham o texto original e as camadas. O achado diz em qual camada
apareceu. Os tetos são de 12 camadas, 5 níveis e 2 MB de texto, e nenhuma regex com retrocesso
quadrático (o fuzz `npm run test:fuzz -- --target deobfuscate` cobre a normalização).

**Shell e Python** (`.sh`, `.bash`, `.py`, ou pelo shebang e pelo jeito do conteúdo), com regras
próprias:
- shell: `curl`/`wget`, `| sh` e `eval`, `chmod +x`, `/dev/tcp` (shell reversa), cron, systemd e
  `rc.local`, apagar histórico e logs, desligar firewall, um binário por arquitetura (botnet de IoT,
  como o Mirai) e minerador. As camadas `echo … | base64 -d`, `$'\x41…'` e `printf '\x41…'` são
  decodificadas;
- Python: `exec`/`eval` de algo decodificado, `marshal.loads`, `subprocess`/`os.system`,
  `urllib`/`requests`, `pty.spawn`/`os.dup2`, shellcode por `ctypes`, PyArmor, dados de navegador e
  carteira, e persistência. As camadas `b64decode` (com `zlib`), `bytes.fromhex` e rot13 são
  decodificadas.

**AutoIt.** O script que sai de um executável compilado com o AutoIt (ver [Identificar e
desempacotar](#identificar-e-desempacotar)) ganha regras próprias, que só valem nele (em outra
linguagem, `Run(` é um nome qualquer):
- `Run`/`ShellExecute`, `InetGet`/`InetRead` e `RegWrite` na chave `Run`;
- `DllCall` de `VirtualAlloc`, `CallWindowProc` e afins (código posto na memória e executado) e o
  `DllStructCreate("byte[...]")` que recebe o shellcode;
- `BinaryToString`/`_Crypt_DecryptData`, `FileInstall` e `#NoTrayIcon`.

O binário `0x...` longo vira camada quando é texto e o achado **PE em binário 0x** quando é um
executável.

## OneNote, HTML smuggling e MSI

Três formatos que escondem a carga dentro de um arquivo de aparência inofensiva. A análise estática
lê os bytes, sem executar nada. Cada carga achada vira **amostra filha**, com a análise completa, e
a seção do formato na ficha diz de onde ela saiu (com o link). Ao abrir, o risco alto aparece no
topo da ficha.
- **OneNote (`.one`)**, reconhecido pelo GUID do cabeçalho: cada objeto anexado
  (`FileDataStoreObject`). As imagens ficam de fora, e o nome sai do tipo (`embutido-2.hta`). Um
  executável ou script anexado é **alto**. Imagem junto do anexo (o "clique duas vezes para ver")
  é **médio**. O `.onepkg` é um CAB, e o `unpack` o abre.
- **HTML e SVG**: literais Base64 longos, `data:` URIs binárias e listas de bytes
  (`new Uint8Array([...])`). O que decodifica para executável, arquivo compactado, documento,
  atalho, imagem de disco ou script vira filha. Com `Blob`, `URL.createObjectURL`,
  `msSaveOrOpenBlob` ou o atributo `download` na página, o alerta é **alto** (HTML smuggling: a
  página monta o arquivo e entrega como download). O JavaScript das tags `<script>` passa pela
  [análise de scripts](#scripts-powershell-lote-vbscript-jscript-autoit).
- **MSI**: as tabelas do instalador (o pool de strings, `_Columns`, `Property`, `CustomAction`,
  `Binary` e `File`), com o produto, o fabricante e a versão. Cada **ação personalizada** aparece
  com o tipo traduzido (DLL ou EXE da tabela Binary, EXE com linha de comando, script embutido...) e
  as flags (como SYSTEM, adiada). Script na ação, ou da tabela Binary, é **alto**. EXE com linha de
  comando suspeita (PowerShell, `cmd /c`, URL...) é **alto**. DLL ou EXE da tabela Binary é
  **médio**. Os itens da tabela Binary, o script embutido numa ação (como `.js` ou `.vbs`) e os CABs
  de mídia viram filhas, e o `unpack` abre o CAB. A linha de comando das ações também entra nos IOCs
  sugeridos.
- **PDF**: cada arquivo anexado (`/EmbeddedFile`) vira filha, com o nome da especificação; executável,
  pacote ou script anexado é **alto**. O JavaScript dos `/JS` (em string ou em stream, também dentro de
  objetos comprimidos em ObjStm) passa pela [análise de scripts](#scripts-powershell-batch-vbscript-jscript-autoit).
  A análise do PDF também aponta `SubmitForm` (envia o formulário para fora), `GoToR`/`GoToE`,
  `ImportData`, `RichMedia`, imagem `JBIG2` e link `javascript:`. O PDF cifrado com a **senha de usuário
  vazia** (abre sem pedir senha, mas a leitura comum vê só bytes cifrados) é decifrado antes: RC4 e
  AES-128 (revisões 2 a 4) e AES-256 (revisão 6). Com senha de verdade, fica como está, com o aviso.
- **Formatos pequenos**, que o Windows abre com um clique e não trazem carga, só o destino ou o
  comando. A seção mostra os destinos, que também vão para os IOCs sugeridos:
  - `.msc` (GrimResource com `res://apds.dll` e script embutido, que passa pela análise de scripts);
  - `.url`/`.website` e `.scf`, com destino ou ícone numa pasta remota, que vaza o hash NTLM;
  - `.library-ms` e `.search-ms`, com pasta remota (WebDAV);
  - `.appinstaller`, que instala um MSIX baixado da URL;
  - `.iqy` (consulta web do Excel) e `.slk` com `EXEC`;
  - `.reg` com chave de inicialização ou de defesa;
  - `.inf` com `RegisterOCXs` (abuso do cmstp), `.sct` (scriptlet) e `.settingcontent-ms`.

  O `.xll`, um PE com `xlAutoOpen`, ganha o alerta alto na análise do executável.
- **Limites:** 40 arquivos e 128 MB por amostra (o resto aparece como "pulado", com o motivo), três
  níveis de aninhamento e arquivos de até 64 MB. Carga cifrada de outro jeito (XOR, Base64 invertido)
  não é decodificada. Com Blob e download na página, o alerta avisa que a carga não foi decodificada.
- **Pontuação de risco:** formato de entrega de risco alto vale 35, e médio, 15. Cada filha tem o
  próprio risco.

## Emulação (Speakeasy)

Todo executável do Windows (PE) que chega vai, em segundo plano, para o serviço `emulate`. Ele roda
o [Speakeasy](https://github.com/mandiant/speakeasy) (Mandiant, MIT) num contêiner sem rede, sem
root, com a raiz somente leitura e um contêiner por análise. O Speakeasy **emula** o programa: nada
roda no processador de verdade, e a rede, o disco e o registro que o programa vê são simulados.
Rodam todos os pontos de entrada (callbacks TLS, o principal e as exportações de uma DLL), dentro de
`EMULATE_RUN_S` (padrão 60 s).

A seção **Emulação (Speakeasy)** mostra:

- as chamadas de API na ordem, com a contagem e os argumentos da primeira chamada;
- a rede que o programa tentou alcançar (DNS, HTTP e sockets);
- os processos criados, a memória escrita em outro processo e as threads remotas (injeção);
- os arquivos gravados (caminho, tamanho e SHA-256), os arquivos e as chaves de registro tocados e as
  strings montadas em memória;
- onde a emulação parou (uma API que o emulador não implementa, uma instrução inválida).

Os alertas (injeção, rede seguida de outro programa, chaves de inicialização, antidepuração, código
gerado em memória) somam na pontuação de risco, e os destinos vão para os IOCs sugeridos. Um
analista também pode emular **qualquer arquivo como shellcode**, escolhendo x86 ou x64. Um programa
que percebe o emulador pode parar cedo: a emulação complementa o sandbox, não o substitui.

## Android (APK)

Todo APK que chega vai, em segundo plano, para o serviço `android`
([androguard](https://github.com/androguard/androguard), Apache-2.0, no mesmo isolamento). Ele só
lê o manifesto, os certificados e a tabela de strings dos DEX, e nada do aplicativo roda. A seção
**Android (APK)** mostra:

- o pacote, a versão, o SDK mínimo e o alvo e a atividade principal;
- as permissões (as perigosas em destaque) e os componentes exportados, com as ações;
- os certificados (titular, SHA-256, validade, certificado de depuração) e a assinatura v1/v2/v3;
- as APIs sensíveis (SMS, acessibilidade, administrador do dispositivo, `DexClassLoader`,
  `Runtime.exec`, captura de tela, notificações);
- as URLs, os IPs e os domínios do código, as bibliotecas nativas e as cargas escondidas em
  `assets/`.

Os alertas cobrem as combinações típicas, como acessibilidade com SMS (trojan bancário),
administrador do dispositivo, código carregado em tempo de execução, sobreposição de telas e APK sem
assinatura. Eles somam na pontuação de risco, e os endereços vão para os IOCs sugeridos.

## Configuração de famílias (CAPE)

Todo executável do Windows vai para o serviço `extract`, inclusive as amostras filhas do
desempacotador e as tiradas da memória do sandbox. As regras YARA dele (as do CAPEv2, guardadas em
`apps/extract/rules` num commit fixo) identificam a família, e o extrator **daquela família** do
[CAPE-parsers](https://github.com/CAPESandbox/CAPE-parsers) tira a configuração: C2, chaves,
campanha, mutex e identificador do bot. Os extratores só leem os bytes, cada um com tempo-limite.

A seção **Configuração extraída (CAPE)** mostra as regras que casaram e cada configuração em
tabela. Uma configuração extraída é a identificação mais certa que há: vale +60 na pontuação de
risco (família reconhecida só pela regra vale +35), e os C2 vão para os IOCs sugeridos.

O CAPE-parsers e as regras do CAPEv2 são **GPL-3.0**, por isso ficam dentro do contêiner `extract`,
e a API só conversa com ele por HTTP.

## Código .NET (ILSpy)

Todo executável .NET que chega (até `DOTNET_MAX_MB`, padrão 30 MB) vai, em segundo plano, para o
serviço `dotnet`. Ele roda o [ILSpy](https://github.com/icsharpcode/ILSpy) (`ilspycmd` 11.2, MIT),
o binário nativo, sem o runtime do .NET. O ILSpy só lê o IL e os metadados, e nada é executado. O
contêiner não tem rede nem root, a raiz é somente leitura e há um contêiner por análise. Executáveis
que chegaram antes, ou um PE que a análise estática não reconheceu como .NET, podem ser pedidos por
um analista na seção **Código .NET (ILSpy)** da ficha.
- **Tipos:** o projeto C# que o ILSpy monta, com um arquivo por tipo. A lista tem filtro. O código
  de um tipo abre ao lado, com o número das linhas e as linhas dos achados marcadas. **Baixar o
  projeto (.zip)** traz tudo e fica na auditoria. O código fica no armazenamento
  (`dotnet/<amostra>.json.gz`, até 16 MB de fonte), e não no banco. Ele sai junto com a amostra
  quando ela é excluída. Só quem enviou e os analistas veem o código.
- **Achados**, por regra sobre o C#, com o arquivo e a linha:
  - carga em memória (`Assembly.Load`) e chamada por reflexão;
  - download (`WebClient`, `HttpClient`) e `Process.Start`;
  - chave `Run`, decifra (`RijndaelManaged`, `CreateDecryptor`) e `FromBase64String`;
  - memória de outros processos (`VirtualAlloc`, `WriteProcessMemory`, `CreateRemoteThread`);
  - anti-análise (depurador, VM, sandbox);
  - dados de navegador e carteira, teclas, print da tela, Telegram/Discord e o Defender.
- **Ofuscadores** reconhecidos pelos atributos e nomes: ConfuserEx, .NET Reactor, SmartAssembly,
  Eazfuscator.NET, Babel, Dotfuscator, Agile.NET e Crypto Obfuscator. Sem um nome conhecido, quando
  mais da metade dos nomes é ilegível, o alerta diz isso. O de4dot não entra: está parado e só roda
  no .NET Framework.
- **Recursos embutidos:** a lista, com o tipo e a entropia. Os que são PE ou ZIP viram **amostras
  filhas** (é onde um loader guarda a carga). Um recurso grande e cifrado (64 KB ou mais, entropia
  acima de 7,2) é alerta médio.
- **IOCs:** as URLs do código vão para os IOCs sugeridos.
- **Risco:** como na emulação. Achado alto vale 25, mais 5 por alerta alto a mais (teto 35). Só
  médios (ofuscador, recurso cifrado, anti-análise) valem 10, mais 3 por alerta (teto 16).
- **Status do sistema:** a linha **Descompilação de .NET (ILSpy)**, com a fila e as análises em 24 h.
- O ILSpy sobe à mão (o pacote `ilspycmd.linux-x64` do NuGet, com a versão e o SHA-256 no
  `apps/dotnet/Dockerfile`).

## Código Java (CFR)

Todo JAR e todo `.class` solto que chega (até `JAR_MAX_MB`, padrão 30 MB) vai, em segundo plano,
para o serviço `jar`. Ele roda o [CFR](https://github.com/leibnitz27/cfr) 0.152 (MIT) numa JRE
headless. O CFR só lê o bytecode, e nada é executado. O contêiner não tem rede nem root, a raiz é
somente leitura e há um contêiner por análise. Um ZIP que tenha classes Java pode ser pedido por um
analista na seção **Código Java (CFR)** da ficha.
- **Classes:** o fonte Java que o CFR monta, com um arquivo por classe, visto e baixado como o
  código .NET (mesmas permissões, download na auditoria). O código fica no armazenamento
  (`jar/<amostra>.json.gz`, até 16 MB de fonte), e não no banco, e sai junto com a amostra.
- **Módulo:** classe principal, agente Java (`Premain-Class` / `Agent-Class`), versão do bytecode,
  o `Created-By` do manifesto e o número de classes.
- **Achados**, por regra sobre o Java, com o arquivo e a linha (os `import` são ignorados):
  - início de processo (`Runtime.exec`, `ProcessBuilder`) e carga de classes a partir de bytes ou URL;
  - reflexão, acesso à rede, `Cipher`/`SecretKeySpec`, `Base64`, código nativo e `Unsafe`;
  - motores de script, consultas JNDI (estilo Log4Shell) e desserialização com `ObjectInputStream`;
  - locais de inicialização (persistência), prints de tela e teclas, dados de navegador e carteira;
  - Telegram/Discord, token de sessão do Minecraft (roubo de conta) e antiVM.
- **Ofuscadores:** Allatori, Zelix KlassMaster, Stringer, DashO, Skidfuscator, Paramorphism, Radon e
  Qprotect pelas marcas; nomes curtos no estilo ProGuard (mais da metade das classes com 1 ou 2
  letras); e um alerta de "nomes ilegíveis" para o resto. As classes que o CFR não descompilou por
  completo entram num alerta informativo.
- **Arquivos embutidos:** PE, ELF, Mach-O, ZIP e scripts dentro do JAR viram **amostras filhas**
  (executável escondido num JAR é alerta alto); blobs grandes e cifrados são alerta médio.
- **Limites:** 50 mil entradas e 192 MB de classes descompactadas (contra bomba de descompressão).
- **IOCs:** as URLs do código vão para os IOCs sugeridos.
- **Risco:** os mesmos pesos do código .NET (alto 25 + 5 por extra, teto 35; médio 10 + 3, teto 16).
- **Status do sistema:** a linha **Descompilação de Java (CFR)**, com a fila e as análises em 24 h.
- O CFR é atualizado à mão (o JAR do Maven Central, com a versão e o SHA-256 em
  `apps/jarcfr/Dockerfile`).

## Identificar e desempacotar

Todo executável que chega (Windows, Linux, macOS, APK e JAR, e os CABs, até `UNPACK_MAX_MB`) passa pelo
serviço `unpack` em segundo plano:

1. O **[Detect It Easy](https://github.com/horsicq/DIE-engine)** 3.21 (MIT) o identifica pelas
   assinaturas: compilador ("MinGW", "Delphi 10.3"), empacotador ("UPX 4.24", inclusive o UPX
   alterado), protetor ("Themida"), instalador ("NSIS 3.11"), assinatura digital, .NET. A ficha
   mostra a lista, com empacotador e protetor em destaque. É uma pista, não um veredito: o DIE
   também erra (num programa PyInstaller, por exemplo, ele vê "Go").
2. Se um desempacotador o reconhece, ele é desempacotado, e **cada arquivo que sai vira uma
   amostra filha** ("Extraído de:" na ficha), com toda a análise de novo: estática, antivírus, YARA,
   capa e o Ghidra sob demanda. É assim que o capa e o Ghidra veem o código de verdade, e não o
   descompactador do UPX nem o instalador. A filha já sai identificada da mesma rodada e só volta
   para a fila se houver o que desempacotar nela.
3. Se nada desempacota, a ficha diz por quê, com o que o DIE viu: "protegido com Themida: precisa
   de um desempacotador que execute a amostra", "empacotado com MPRESS: nenhum desempacotador
   estático para ele", ou "nada a desempacotar".

As regras de triagem ganham a condição **Detect It Easy detectou** (trecho como `Themida`, `Inno
Setup` ou `Delphi`; vazio = qualquer empacotador ou protetor).

| Desempacotador | Ferramenta | O que sai |
|---|---|---|
| UPX | `upx -d` 4.2 | o executável original (funcionalmente; ver abaixo) |
| AutoIt | autoit-ripper 1.2.0 | o script (`script.au3`, o AutoIt 3.0 em diante e o AutoHotkey antigo) e os arquivos do `FileInstall`, com o nome original |
| PyInstaller | pyinstxtractor 2026.07 | só o script do autor (`.pyc`), sem a biblioteca padrão nem o bootstrap |
| Inno Setup | innoextract 1.9 | os arquivos do instalador (formato até o Inno Setup 6.2) |
| NSIS | 7-Zip 25 | os arquivos e o script do instalador (`[NSIS].nsi`) |
| Arquivo embutido | 7-Zip 25 | o que há no ZIP, 7z, RAR ou CAB anexado ao executável |
| CAB | 7-Zip 25 | o que há num CAB solto (a mídia de um MSI, por exemplo) |

- **Desempacotar por emulação** (unipacker 1.0.8, GPL-2.0, instalado na imagem, fora do
  repositório): quando o Detect It Easy aponta ASPack, FSG, MEW, MPRESS, PEtite, PECompact, YZPack ou
  o UPX disfarçado (sem a marca `UPX!`, que o `upx -d` recusa), o stub do empacotador é emulado no
  unicorn até o salto para o programa, e o despejo sai com a tabela de importação refeita. Nada roda
  no processador. Só PE32: o unipacker não emula 64 bits, e o UPX disfarçado de 64 bits segue com o
  motivo na ficha. O teste cobre o UPX disfarçado; os outros empacotadores são comerciais e ficam sem
  amostra no repositório.
- **Magika** (1.1.0, Apache-2.0, do Google): o tipo do arquivo por aprendizado de máquina, com a
  confiança. Além dos executáveis, todo arquivo sem tipo pela assinatura (texto, script, desconhecido)
  de 16 bytes a 10 MB vai à fila só para identificar. Quando o Magika, com 90% ou mais, discorda do
  tipo detectado ou da extensão (o `fatura.pdf` que é PowerShell), a ficha avisa e a condição de
  triagem **Magika identificou** (vazia) casa; com valor, casa o rótulo (`powershell`). No texto que
  a análise estática não reconheceu como script, a análise de scripts roda na linguagem que ele disse.
- **Go** (GoReSym 3.4.1, MIT, da Mandiant): num executável Go, mesmo sem símbolos, a ficha mostra a
  versão do Go, o módulo principal (que vira pivô em Relacionadas: o mesmo projeto liga as variantes),
  as dependências com versão, a configuração do build, as funções do próprio programa (sem a biblioteca
  padrão) e os arquivos-fonte do projeto, que costumam trazer a pasta de quem compilou.
- **Rust** (na análise estática): os crates com versão, o commit do `rustc` e os fontes do projeto,
  tirados dos caminhos que o compilador grava nas mensagens de panic.
- **Nada é executado**: as ferramentas só leem e extraem. Contêiner sem rede, sem root, sem
  capacidades, raiz somente leitura e `/tmp` em memória sem execução; um contêiner por trabalho.
- **Limites**: até `UNPACK_MAX_FILES` arquivos e `UNPACK_MAX_TOTAL_MB` somados por amostra (o resto
  aparece como "ficou de fora", com o motivo), e duas gerações de desempacotamento (um instalador
  com um UPX dentro); dali em diante o arquivo só é identificado.
- **O que não funciona, e a ficha diz**: o UPX disfarçado (com a marca `UPX!` apagada) o 7.1
  reconhece pelo código, mas o `upx` não desempacota sem ela; o Inno Setup 6.3 em diante o
  innoextract 1.9 (o último lançamento) não lê.
- **O UPX desempacotado é o mesmo programa, não o mesmo arquivo**: o `upx -d` zera o checksum e
  refaz a tabela de importação em outra ordem de DLLs. O conjunto de funções é o mesmo, mas o
  imphash muda.
- Amostras enviadas antes: um analista pede **Identificar e desempacotar** na seção da ficha.
- **Novos desempacotadores** entram como um arquivo em `apps/unpack/unpackers/`; o contrato está no
  `README.md` de lá. Os que precisam **executar** a amostra (como a maioria dos de Themida e
  VMProtect) não cabem nesse contêiner: o lugar deles é o sandbox do Proxmox.
- **Desligar:** `UNPACK_URL=` (vazio) no `.env`; o serviço `unpack` pode sair do compose.

## Regras de triagem

Analistas mantêm na tela **Regras de triagem** (pasta Detecção) regras do tipo "quando a análise
achar X, incluir as tags Y e subir a prioridade para Z". Todas as que casarem valem; nenhuma tira
tag nem baixa prioridade, e cada uma fica no histórico da amostra.

| Condição | Valor | Vale a partir de |
|---|---|---|
| Tipo real, executável disfarçado, macro, script ou documento com risco alto, atalho suspeito | tipo real (só nele) | a chegada |
| Domínio do link, remetente do e-mail, parecido com domínio da empresa | domínio ou endereço | a chegada |
| Regra YARA casou, antivírus detectou | parte do nome (opcional) | o fim da varredura |
| **Assinatura digital não confere** (adulterada ou inválida; a ilegível não conta) | — | a chegada |
| **Executável empacotado** | empacotador, ex.: UPX (opcional) | a chegada |
| **Alerta do executável** | trecho do alerta (vazio = qualquer alerta alto) | a chegada |
| **O capa encontrou a capacidade** | parte do nome (`inject`) ou grupo (`persistence`); vazio = qualquer capacidade de risco | o fim da análise de funções |
| **Técnica ATT&CK (pelo capa)** | código, ex.: `T1055` (vale também para as subtécnicas) | o fim da análise de funções |
| **Indicador em string escondida (FLOSS)** | domínio ou trecho (opcional) | o fim da análise de funções |
| **Detect It Easy detectou** | trecho, ex.: `Themida` (vazio = qualquer empacotador ou protetor) | o fim da identificação |

As regras também rodam de novo quando um analista pede **Analisar de novo** na análise estática.

## Pontuação de risco

Na ficha da amostra, **só para analistas**, a seção **Pontuação de risco** junta o que as análises
já encontraram numa nota de 0 a 100, com a lista dos motivos e o peso de cada um. É uma sugestão
para a triagem: **quem dá o veredito continua sendo o analista**, e nada muda sozinho na amostra.

| Origem | Motivo | Peso |
|---|---|---|
| Antivírus | o ClamAV detectou | +60 |
| Reputação externa | malicioso em algum serviço · suspeito · limpo | +60 · +25 · −10 |
| YARA | conjuntos de regras que casaram | +35, mais 5 por conjunto além do primeiro (teto 50) |
| Script | risco alto · médio | +35 · +15 |
| Documento | risco alto · contém macros · risco médio | +35 · +15 · +10 |
| Formato de entrega (OneNote, HTML, MSI) | carga escondida · arquivo embutido suspeito | +35 · +15 |
| Domínio parecido | imita um domínio da empresa | +35 |
| Tipo do arquivo | executável ou script disfarçado com outra extensão | +30 |
| Atalho | `.lnk` com alertas | +25 |
| Executável | alertas altos · médios | +12 cada (teto 30) · +4 cada (teto 12) |
| Assinatura | não confere · válida | +20 · −15 |
| Análise de funções | grupos de capacidades de risco do capa · indicadores em strings ofuscadas | +6 por grupo (teto 30) · +10 |
| Empacotamento | empacotado ou protegido | +10 |
| Sigma (sandbox) | regras que casaram nos processos da amostra: crítico · alto · médio | +40 · +30 · +15, mais 5 por regra a mais (teto 50) |
| Emulação | alertas altos · só médios | +25, mais 5 por alerta a mais (teto 35) · +10, mais 3 por alerta a mais (teto 16) |
| .NET | alertas altos · só médios | +25, mais 5 por alerta a mais (teto 35) · +10, mais 3 por alerta a mais (teto 16) |
| Android | alertas altos · só médios | +30, mais 5 por alerta a mais (teto 40) · +10, mais 3 por alerta a mais (teto 20) |
| Configuração | configuração da família extraída · família reconhecida só pela regra do CAPE | +60 · +35 |
| Canais de exfiltração | canal com credencial · túnel ou webhook sem credencial | +30, mais 5 por tipo a mais (teto 40) · +10 |
| LOLDrivers | driver malicioso · vulnerável | +60 · +40 |
| LOLRMM | ferramenta de acesso remoto entregue dentro de outro arquivo | +25 |
| Binários do sistema | abuso de LOLBin | +15, mais 5 por binário a mais (teto 25) |

- **Sugestão:** a partir de 70, *Malicioso*; de 35 a 69, *Suspeito*; abaixo disso, nenhuma.
- **Nunca sugere "limpo":** a nota só soma evidência de que a amostra é ruim. Nota baixa quer dizer
  que nada foi detectado, não que a amostra é segura, e a tela diz isso.
- **Cada origem tem teto**, para vinte alertas da mesma análise não valerem mais do que um
  antivírus e uma regra YARA juntos. A reputação conta uma vez, pelo pior veredito.
- **Análises em andamento** aparecem no aviso, e a nota se atualiza sozinha quando terminam.
- Os pesos são fixos (`apps/api/src/lib/risk-score.ts`). Para agir sobre os mesmos sinais de forma
  automática (tags, prioridade), use as **regras de triagem** acima.

---

## Rascunho do relatório por IA (opcional)

Desligado por padrão. Com `LLM_PROVIDER`, o editor de **relatório novo** ganha o botão **Rascunho por
IA**. Ele preenche o resumo, os achados, os IOCs, o veredito sugerido e as técnicas ATT&CK a partir
do que as análises já disseram. Uma faixa avisa que o texto foi gerado, e **nada é salvo nem
publicado sozinho**: o analista revisa e salva.

- **`LLM_PROVIDER=anthropic`:** a API da Anthropic, pelo SDK oficial, com `LLM_API_KEY` (aceita
  `_FILE`). O modelo padrão é o `claude-opus-5-5`, com saída estruturada (JSON Schema) e esforço
  `medium`. Com os modelos que aceitam, o fallback do servidor (`fallbacks: "default"`) fica ligado,
  porque texto sobre malware às vezes cai no classificador de segurança.
- **`LLM_PROVIDER=openai`:** qualquer servidor compatível com `/v1/chat/completions`, com `LLM_URL`
  (ex.: `http://ollama:11434/v1`) e `LLM_MODEL`. É o caminho para quem quer que nada saia da casa.
- **O que vai para o modelo:** só um JSON com o que as análises produziram: os motivos da pontuação
  de risco, o YARA, o capa e o ATT&CK, os alertas (documento, script, emulação, APK), a configuração
  de famílias, as detecções Sigma da amostra e os IOCs candidatos. **Nunca** vão o arquivo, a
  memória, os prints ou os relatórios de outros analistas. O **Status do sistema** diz o provedor, o
  modelo e o destino.
- **Controles:**
  - as técnicas que não existem no ATT&CK embutido saem, e a tela avisa;
  - há um limite por analista (`LLM_DAILY_LIMIT`, padrão 30 em 24 h);
  - cada pedido entra na auditoria com o modelo e o destino;
  - recusa, tempo esgotado e resposta fora do formato aparecem com o motivo.

## Casos

Analistas agrupam amostras da mesma campanha em **casos** (`CASO-0001`), pela ficha
("Mais ▾ > Adicionar a caso…") ou pelas amostras marcadas na lista. O caso tem status,
responsável, as amostras com os relatórios publicados delas e uma linha do tempo com
comentários. Uma amostra pode estar em vários casos; um caso nunca fica vazio.

### Pacote STIX do caso

Para levar um caso inteiro a outro DeepLook, a um TIP ou a um parceiro, e para trazer o de lá:

- **Exportar > Pacote do caso (STIX 2.1):** os indicadores (os mesmos da exportação de IOCs), as
  amostras como observáveis (arquivo pelo SHA-256, link pela URL), as técnicas ATT&CK dos
  relatórios publicados, cada relatório publicado como nota presa à amostra e um `report` do caso
  apontando para tudo. Rascunhos e relatórios em revisão não saem.
- **Exportar > Importar pacote STIX…:** escolha o arquivo e veja, antes de confirmar, o que
  acontece com cada link e cada arquivo do pacote:
  - **link** vira amostra nova do caso (até 50 por importação), ou entra a amostra que já existe
    com o mesmo link; as novas passam pelo caminho normal de um envio (reputação, regras de
    triagem, atribuição, avisos de quem segue o indicador);
  - **arquivo** só entra se o mesmo SHA-256 já foi enviado ao DeepLook, porque o pacote não traz
    o arquivo;
  - domínios, IPs e e-mails do pacote só são contados: para segui-los, use **Importar
    indicadores**.

  O resumo do que entrou e do que ficou de fora vai para a linha do tempo do caso. Importar o
  mesmo pacote de novo não duplica nada; caso encerrado não importa.

## E-mail suspeito (.eml)

Envie o `.eml` de um phishing como arquivo comum. A ficha mostra a seção **E-mail**:
remetente, Responder para, destinatários, SPF/DKIM/DMARC, o caminho dos servidores, os
links (só como texto) e o corpo em texto; o HTML nunca é exibido. Cada anexo vira uma
amostra própria ("Anexo de: …"), com antivírus, reputação e YARA. A leitura usa a
`postal-mime` (sem dependências).

**Anexo cifrado:** o golpe manda o anexo com senha para o filtro não abrir, e a senha vai no corpo
("senha: 1234", "Password - X"). As senhas citadas no corpo e no assunto (mais `infected`, `malware`,
`virus`, `1234`...) abrem o **ZIP com senha** anexado, cujo conteúdo vira amostra filha (a senha que
abriu aparece no anexo), e o **Office cifrado**: o serviço `oletools` tenta a `VelvetSweatshop` (a que
o Excel usa sem perguntar) e essas senhas com o `msoffcrypto`. O documento decifrado vira amostra filha,
com a análise inteira.

O **`.msg` do Outlook** (o "Encaminhar como anexo", comum nos relatos de empresa) também entra, pelo
nome ou pelo conteúdo. Os cabeçalhos de transporte que ele guarda passam pelo mesmo leitor do `.eml`
(remetente, SPF/DKIM/DMARC, saltos e links), e os anexos viram amostras, inclusive os de um e-mail
anexado dentro dele. Sem cabeçalhos (rascunho salvo), os campos vêm das propriedades do Outlook.

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
| Arquivo: **só o SHA-256** | VirusTotal, MalwareBazaar, ThreatFox, YARAify, hashlookup (CIRCL) |
| Link: **só o domínio** | VirusTotal, URLhaus, ThreatFox |
| Link cujo host é um IP | VirusTotal, URLhaus, ThreatFox, AbuseIPDB, InternetDB (Shodan) |

- **Família por consenso** (no VirusTotal): os rótulos dos antivírus passam pelo
  [AVclass](https://github.com/malicialab/avclass) (MIT), que tira os genéricos ("Trojan", "Generic",
  "Agent"), troca os apelidos pelo nome da família ("Agensla" → agenttesla) e só aceita o que dois ou
  mais antivírus dizem. A família aparece no resumo do VirusTotal ("família agenttesla (5 antivírus)").
  Os dados ficam em `apps/api/src/lib/avclass.json` e são atualizados por
  `node apps/api/scripts/vendor-avclass.mjs <pasta avclass/data>`.
- **YARAify** (abuse.ch, a mesma `ABUSECH_AUTH_KEY`): as regras YARA públicas e o ClamAV que rodaram
  sobre a amostra lá, inclusive sobre o que o desempacotador deles tirou dela. ClamAV é malicioso;
  regra sozinha, suspeito.
- **hashlookup** (CIRCL, sem chave, liga com `HASHLOOKUP_ENABLED=true`): o arquivo está num conjunto de
  arquivos conhecidos (NSRL, pacotes de distribuições). Conta como reputação limpa, −10 no risco, e
  separa o arquivo legítimo que sai de um instalador.
- **InternetDB** (Shodan, sem chave, liga com `INTERNETDB_ENABLED=true`): portas abertas, tags e CVEs do
  IP, atualizado por semana. É informação; a tag `c2` ou `malware` da Shodan vira suspeito.

- **O que sai do servidor:** só o indicador. O arquivo nunca sai, nem a URL completa (com
  caminho, e-mail ou token da vítima).
- **Cache de 24 h** por serviço e indicador; analistas têm "Consultar de novo".
- **Limites:** o VirusTotal gratuito permite 4 consultas por minuto, e a fila respeita
  isso (envios em lote esperam a vez). A API pública dele é só para uso não comercial.
- **Falhas** (chave recusada, limite, tempo esgotado) aparecem na linha do serviço e em
  Status do sistema.
- **Atenção:** mesmo só o hash revela a terceiros que a amostra está sendo analisada.

### Enriquecimento de links

Na mesma seção, os links ganham três consultas que não são de reputação, e sim de contexto. Também
só o domínio (ou o IP) sai, nunca a URL:

| Linha | O que mostra | Liga com |
|---|---|---|
| **Registro (RDAP)** | quando o domínio foi registrado, o registrador e o vencimento (para IP: a faixa, o dono e o país). Consulta o servidor RDAP do próprio registro do TLD, achado pela lista pública da IANA, sem intermediário, e pelo domínio registrável (`login.banco.com.br` → `banco.com.br`) | `RDAP_ENABLED=true` |
| **Certificados (crt.sh)** | quantos certificados públicos o host teve, o primeiro e o último, e as autoridades (Certificate Transparency) | `CT_ENABLED=true` |
| **DNS passivo (VirusTotal)** | para que IPs o domínio apontou (ou que domínios apontaram para o IP) | a `VT_API_KEY`; `PASSIVE_DNS_ENABLED=false` desliga |

- **Desligados por padrão** os dois que não pedem chave: sem a opção no `.env`, nenhum domínio sai
  para um serviço que você não escolheu. O DNS passivo usa o VirusTotal, que já recebe o domínio,
  e divide a cota e a fila dele (4 consultas por minuto no plano gratuito).
- **Resultado informativo** (cinza): dados, sem veredito. Duas exceções viram **Suspeito**, e
  entram na pontuação de risco: domínio registrado há menos de 30 dias e primeiro certificado
  do host há menos de 14 dias, os sinais clássicos de página de phishing recém-montada.
- **Cache de 24 h**, "Consultar de novo" e falhas na linha, como os outros serviços. O crt.sh é
  um serviço comunitário e às vezes lento ou fora do ar: a consulta tem 20 s, e a falha não
  atrapalha as outras.

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
- O ZIP fica até vencer (`BACKUP_RETENTION_DAYS`, padrão 7 dias): na **pasta de backup**, se
  `BACKUP_DIR` estiver definido (abaixo), ou no bucket (`backups/`), no mesmo disco dos dados.
- Só baixa com admin logado (token de API não serve).
- **Senha do ZIP:** informada ao gerar (12 caracteres ou mais), em AES-256 no padrão WinZip,
  que o **7-Zip** abre (o `unzip` comum não). Ela não fica guardada: sem ela, o backup não abre.
  Os nomes dos arquivos dentro do ZIP não são cifrados. Exportar sem senha exige marcar a opção
  e confirmar.
- Gerar, baixar e excluir vão para a Auditoria.

> **Com os arquivos das amostras, o ZIP contém malware real.** Guarde-o como as amostras.
> O manifesto diz o que entrou (`containsMalware`).

### Backup agendado

Em **Administração > Backup**, a seção **Backup agendado** liga a geração automática: dias da
semana (todos os dias é marcar os sete) ou um dia do mês (1 a 28), e o horário. O horário vale
no fuso do navegador de quem salvou. Um calendário com este mês e o próximo marca os dias e lista
as próximas execuções antes de salvar.

- **Senha:** o ZIP agendado sai sempre com a senha `BACKUP_SCHEDULE_PASSWORD` do `.env` (12+
  caracteres). A da tela não fica guardada, por isso o agendamento usa esta. Sem ela, o
  agendamento não liga; com menos de 12 caracteres, a API não sobe e diz por quê. **Guarde a
  senha fora do servidor**: sem ela, o backup não abre.
- **Conteúdo:** leva os arquivos das amostras (malware), protegidos pela senha.
- **Destino:** o mesmo dos demais. Com `BACKUP_DIR`, vai para a pasta fora do disco (abaixo); sem
  ele, fica no bucket, no mesmo disco dos dados.
- **API fora do ar na hora marcada:** o backup sai uma vez quando ela volta, e o calendário segue.
  Com outro backup em andamento, ele espera e sai no minuto seguinte ao término.
- Na lista, aparece com **Agendado** em "Por"; a mudança do agendamento vai para a Auditoria.
- **Quando algo dá errado, avisa.** Com o agendamento ligado, a verificação **Backup** da página
  de status fica em **erro** (vermelho) quando:
  - o último agendado falhou;
  - passou a hora marcada (com 6 h de folga) sem nenhum backup pronto;
  - a pasta de backup tem problema;
  - falta a senha.

  A aba Backup mostra o mesmo motivo. Um monitor com o token de status e `?strict=1` recebe
  **503**, então o Uptime Kuma ou o Zabbix avisam sem configuração nova. Horários anteriores a
  ligar o agendamento não contam. Com o agendamento desligado, nada disso vira erro.

### Pasta de backup fora do disco

Sem configuração, o ZIP fica no bucket, e o bucket e o Postgres ficam no mesmo disco
(`./data`): perder o disco perde os dados **e** o backup. Com `BACKUP_DIR` no `.env`, o ZIP é
gravado numa pasta do host, que você aponta para um disco externo ou um NAS montado. **Levar
essa pasta para fora do disco é responsabilidade de quem configura o ambiente**; o DeepLook
só grava nela.

```bash
sudo mkdir -p /mnt/externo/deeplook
sudo touch /mnt/externo/deeplook/.deeplook-backups   # a marca: veja abaixo
sudo chown -R 1000:1000 /mnt/externo/deeplook         # a API roda como uid 1000
echo 'BACKUP_DIR=/mnt/externo/deeplook' >> .env
docker compose up -d                                  # recria a API com a pasta montada
```

- **A marca `.deeplook-backups`:** com o disco desmontado, o ponto de montagem vira uma pasta
  vazia **no disco principal**, e o backup seria gravado ali sem ninguém perceber. Sem a marca
  na pasta, a API recusa gravar e diz por quê, na aba Backup e na página de status
  (**Backup**).
- **No disco:** `deeplook-backup-AAAA-MM-DD-<id>.zip` e um `.sha256` ao lado, para conferir uma
  cópia com `sha256sum -c`. Os dois só são legíveis pelo uid 1000. O ZIP é montado com nome
  provisório (`.<nome>.partial`) e renomeado no fim, então quem sincroniza a pasta nunca copia
  um ZIP pela metade (exclua `*.partial` do `rsync`).
- **Vencimento e exclusão** apagam da pasta só o ZIP e o `.sha256` que a API gravou. O resto
  da pasta (cópias suas, outros arquivos) não é tocado.
- **Backups anteriores** à configuração continuam no bucket e baixando normalmente até vencer.
- Arquivo sumido da pasta (disco desmontado, movido) faz **Baixar** responder com o motivo, em
  vez de erro.

Para restaurar, use o `scripts/restore.sh`. Ele roda na imagem da API (no host só é preciso o
Docker), pede a senha do ZIP (ou lê `RESTORE_PASSWORD`) e sempre confere o ZIP inteiro com o
`manifest.json` antes de escrever qualquer coisa:

```bash
scripts/restore.sh deeplook-backup-AAAA-MM-DD-xxxxxx.zip --check       # só confere; não muda nada
scripts/restore.sh deeplook-backup-AAAA-MM-DD-xxxxxx.zip --rehearsal   # ensaio (abaixo)
scripts/restore.sh deeplook-backup-AAAA-MM-DD-xxxxxx.zip               # restaura nesta instalação
```

- **`--check`:** abre o ZIP e confere o tamanho e o SHA-256 de cada arquivo. ZIP adulterado,
  truncado ou com a senha errada é recusado com o motivo.
- **`--rehearsal` (ensaio):** restaura num banco e num bucket temporários, compara as contagens
  de amostras, relatórios, usuários e casos com as do manifesto e apaga os dois. Prova que o
  backup volta sem tocar na instalação, e pode rodar com o DeepLook no ar. Vale repetir de tempos
  em tempos: backup que nunca foi restaurado é uma suposição.
- **Sem opção:** para a API e o web, substitui o banco (numa transação só: se falhar no meio, o
  banco fica como estava) e devolve os arquivos ao bucket. Pede confirmação; numa instalação que
  já tem amostras, exige `--force`. Depois, `docker compose up -d`: as migrações mais novas
  rodam sozinhas.
- O ZIP precisa ser legível pelo usuário da API (uid 1000), como os que ela grava na pasta de
  backup.

À mão, sem o script, o `LEIA-ME-RESTAURACAO.txt` de dentro do ZIP traz o passo a passo com
`7z`, `pg_restore` e `mc`.

- **Chave de dados:** use a mesma da instalação de origem, porque ela não vai no ZIP: o
  `DATA_KEY` ou, se a origem não o tinha, o `SESSION_SECRET`. Com outra, os 2FA ativados param
  de funcionar (só os códigos de recuperação valem).
- **Backup sem as amostras:** as fichas voltam, mas os arquivos não. Baixar responde "arquivo
  não está no armazenamento"; a análise já feita continua na ficha.

## Integridade dos arquivos

Cada arquivo guardado tem de ter o SHA-256 (e o tamanho) que a ficha gravou no envio. Isso
pega corrupção silenciosa do armazenamento e adulteração do bucket por fora da API.

- **No download:** o SHA-256 é calculado enquanto os bytes saem, sem ler o arquivo duas vezes.
  O arquivo é **entregue de qualquer jeito** (recusar tiraria do analista a única cópia que
  resta); o que muda é o registro.
- **Divergência:** a amostra fica marcada, a ficha mostra um aviso vermelho (e o campo
  **Integridade**, em Detalhes, a data da última conferência), a **Auditoria** registra
  *Arquivo divergente do SHA-256 da ficha* com o hash esperado e o calculado, e os downloads
  seguintes saem com o cabeçalho `X-DeepLook-Integrity: mismatch`. A auditoria só sai na
  *mudança* de estado: conferir de novo o mesmo arquivo estragado não enche a trilha.
- **Download interrompido** no meio não tem veredito e não marca nada.
- **Verificação periódica:** em segundo plano, o servidor lê as amostras e confere o SHA-256,
  começando pelas nunca conferidas e seguindo pelas conferidas há mais tempo, até gastar o
  orçamento da rodada. Pega a corrupção sem esperar alguém baixar. Um objeto que **sumiu** do
  bucket também é marcado. Falha de leitura (MinIO fora) não marca ninguém.
- **Voltou a conferir** (o objeto foi restaurado): a marca sai e a Auditoria registra.
- **O que fazer com uma amostra marcada:** restaurar o objeto do backup (o ZIP traz o SHA-256
  de cada arquivo) ou reenviar a amostra; o scrub e o próximo download limpam a marca.
- **Status:** a verificação *Integridade dos arquivos* fica laranja com amostras divergentes e
  aparece no status por token (`/api/status`).
- Ajuste com `INTEGRITY_SCRUB_INTERVAL_MINUTES` (padrão 60; `0` desliga) e
  `INTEGRITY_SCRUB_MAX_MB` (padrão 512 por rodada).

---

## Auditoria com encadeamento de hash

Cada registro da **Auditoria** leva um número de sequência, o hash do registro anterior e o
próprio hash (SHA-256 sobre os campos que não mudam depois de gravados). Quem alterar um
registro direto no banco quebra o hash dele; quem apagar um do meio quebra a sequência.

- **Conferência:** na subida e de hora em hora, a API percorre a cadeia. A aba **Auditoria**
  mostra `Cadeia íntegra` com a ponta (sequência e início do hash) ou um erro com o primeiro
  registro que não confere; o status do sistema (**Auditoria**) fica vermelho, e o
  `/api/status` por token leva o mesmo.
- **Histórico anterior:** os registros de antes desta versão entram na cadeia na primeira subida,
  na ordem em que foram gravados.
- **CSV:** o **Exportar CSV** traz a sequência e o hash de cada registro.
- **Âncoras de fora do banco:** a ponta vai no `manifest.json` de cada backup e no log da API a
  cada conferência. A restauração (`scripts/restore.sh`, inclusive o ensaio) confere a cadeia
  do banco restaurado contra a ponta do manifesto.
- **O que não cobre:** quem controla o banco pode reescrever a cadeia inteira, ou apagar os
  últimos registros, e ela continua coerente por dentro. Só a comparação com uma ponta guardada
  fora (backup levado para outro lugar, log) pega isso. A conferência periódica também acusa se a
  cadeia encolher abaixo da maior ponta que a API já viu desde que subiu.

---

## Cloudflare Tunnel (no host, fora do Docker)

Em produção, com o Tunnel, defina `COOKIE_SECURE=true`. Ao ligar, o cookie muda de nome para
`__Host-dl_session` e quem estava logado entra de novo uma vez. O IP real vem do `CF-Connecting-IP`,
aceito só do gateway da rede `deeplook` (é como o `cloudflared` do host chega pela porta publicada)
e do loopback; de outro container ele é ignorado. Trocou `DEEPLOOK_SUBNET`, ou roda o `cloudflared`
em container? Ajuste `REAL_IP_FROM` no `.env`. Não publique a porta do web em outro endereço além
de `127.0.0.1` sem rever isso (`set_real_ip_from` em `apps/web/nginx.conf`).

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
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Credenciais do PostgreSQL. Com a senha padrão (`deeplook` ou a do `.env.example`) a API não sobe em produção; num banco que já existe, troque-a com `ALTER USER` antes de mudar o `.env` ([checklist](docs/implantacao.pt-BR.md)) | `deeplook` |
| `DATA_KEY` | Chave de dados: cifra o segredo do 2FA no banco (32+ caracteres, diferente do `SESSION_SECRET`; guarde com o backup). Vazia, a chave sai do `SESSION_SECRET` | — |
| `DATA_KEY_PREVIOUS` | Só durante a troca do `DATA_KEY`: a chave antiga, para a subida recifrar com a nova | — |
| `SESSION_SECRET` | Segredo para os cookies de sessão (longo e aleatório, mínimo de 32 caracteres em produção); com o valor padrão a API não sobe | — |
| `SESSION_TTL_HOURS` | Validade máxima da sessão (horas), mesmo com uso contínuo | `168` |
| `SESSION_IDLE_MINUTES` | Expira a sessão após N minutos sem atividade do usuário (aviso 2 min antes) | `30` |
| `SLA_WARN_HOURS` | Amostra não concluída há mais de N horas no status atual ganha bolinha laranja (alerta) | `24` |
| `SLA_LATE_HOURS` | Acima de N horas fica vermelha e entra na fila "Atrasadas" | `72` |
| `SLA_P1_HOURS` · `SLA_P2_HOURS` · `SLA_P4_HOURS` | prazos das prioridades P1, P2 e P4 ("alerta/atraso" em horas); o P3 usa `SLA_WARN_HOURS`/`SLA_LATE_HOURS` | `2/4` · `8/24` · `72/120` |
| `SLA_ESCALATE_PRIORITY` | ao entrar em alerta o responsável é avisado (sem responsável, os analistas); ao atrasar, também os admins. `true`: ao atrasar, a prioridade sobe um nível | `false` |
| `REPORT_REVIEW_REQUIRED` | `true`: relatório só é publicado com a aprovação de outro analista (quatro olhos) | `false` |
| `RETENTION_DAYS` | apaga o **arquivo** das amostras concluídas há mais de N dias (ficha, relatórios, IOCs e hash ficam); `0` desliga | `0` |
| `BACKUP_RETENTION_DAYS` | dias até o ZIP do backup (Administração > Backup) expirar e sair do bucket ou da pasta | `7` |
| `BACKUP_PG_DUMP` | comando do `pg_dump` usado no backup (versão 16 ou mais nova; a imagem da API já traz) | `pg_dump` |
| `BACKUP_SCHEDULE_PASSWORD` | senha do ZIP do backup agendado (12+ caracteres; dias e horário na aba Backup). Vazia, o agendamento não liga | — |
| `ALERT_LOG_DIR` | pasta do host do log centralizado de alertas (`deeplook-alerts.jsonl`, uma linha JSON por alerta); precisa ser gravável pelo uid 1000. Vazio: desligado | — |
| `BACKUP_DIR` | pasta do host onde o ZIP do backup é gravado (disco externo, NAS); precisa ser gravável pelo uid 1000 e ter o arquivo `.deeplook-backups`. Vazio: o ZIP fica no bucket, no mesmo disco dos dados | — |
| `INTEGRITY_SCRUB_INTERVAL_MINUTES` | de quantos em quantos minutos o servidor confere o SHA-256 dos arquivos guardados; `0` desliga | `60` |
| `INTEGRITY_SCRUB_MAX_MB` | quanto ler por rodada da conferência periódica (um arquivo maior que isso ainda é conferido, sozinho) | `512` |
| `WEBAUTHN_ORIGIN` · `WEBAUTHN_RP_ID` | passkeys: endereço(s) do DeepLook como o navegador o mostra e o domínio da credencial (vazio: o endereço da própria página e o host dele) | — · — |
| `LDAP_URL` · `LDAP_STARTTLS` · `LDAP_TLS_CA` | login pelo AD (vazio desliga); `ldaps://` ou `ldap://` + StartTLS; PEM da CA que assina o certificado do AD | — · `false` · — |
| `LDAP_BIND_DN` · `LDAP_BIND_PASSWORD` · `LDAP_BASE_DN` | conta de serviço e base da busca | — |
| `LDAP_USER_FILTER` · `LDAP_ATTR_NAME` · `LDAP_ATTR_MAIL` | filtro (`{login}` = o digitado) e atributos de nome e e-mail | padrão do AD · `displayName` · `mail` |
| `LDAP_ANALYST_GROUP` · `LDAP_ADMIN_GROUP` | DNs dos grupos que dão o papel (sem grupo, usuário comum) | — |
| `LDAP_NESTED_GROUPS` | `true`: grupos dentro desses grupos também dão o papel | `false` |
| `PASSWORD_MAX_AGE_DAYS` | validade da senha em dias (admins não expiram); `0` desliga | `90` |
| `VT_API_KEY` | chave do VirusTotal (reputação externa); vazio desliga | — |
| `ABUSECH_AUTH_KEY` | chave da abuse.ch: liga MalwareBazaar, URLhaus e ThreatFox | — |
| `ABUSEIPDB_API_KEY` | chave do AbuseIPDB (IPs) | — |
| `RDAP_ENABLED` | `true`: consulta o registro do domínio (RDAP) dos links; só o domínio sai | `false` |
| `HASHLOOKUP_ENABLED` | `true`: consulta o SHA-256 no hashlookup da CIRCL (arquivo conhecido) | `false` |
| `INTERNETDB_ENABLED` | `true`: consulta o IP dos links no InternetDB da Shodan | `false` |
| `CT_ENABLED` | `true`: consulta os certificados do host no crt.sh (Certificate Transparency) | `false` |
| `PASSIVE_DNS_ENABLED` | `false`: não pede as resoluções do domínio ao VirusTotal (com a `VT_API_KEY`) | `true` |
| `CLAMAV_HOST` | host do `clamd` (serviço `clamav` do compose); vazio desliga o antivírus | `clamav` |
| `CLAMAV_PORT` | porta do `clamd` | `3310` |
| `CAPTURE_URL` | serviço do navegador isolado (captura de página de link); vazio desliga | `http://capture:3100` |
| `CAPTURE_TOKEN` | token compartilhado entre a API e o serviço `capture` (16+ caracteres) | — |
| `CAPA_URL` | serviço de análise de funções (capa e FLOSS); vazio desliga | `http://capa:3200` |
| `CAPA_TOKEN` | token compartilhado entre a API e o serviço `capa` (16+ caracteres) | — |
| `CAPA_MAX_MB` | executáveis maiores não vão para o capa (o serviço tem o mesmo teto) | `32` |
| `CAPA_TIMEOUT_S` / `FLOSS_TIMEOUT_S` | tempo máximo de cada ferramenta, no serviço | `600` / `300` |
| `CAPA_FILE_TIMEOUT_S` | executável do Windows cuja análise de funções não terminou: teto das regras só do nível do arquivo; `0` desliga | `60` |
| `CAPA_REQUEST_TIMEOUT_S` | quanto a API espera uma análise (acima da soma dos três) | `1100` |
| `CAPA_MEM_LIMIT` | memória de cada contêiner `capa` | `3g` |
| `CAPA_WORKERS` | análises do capa ao mesmo tempo (contêineres `capa`; cada um com até `CAPA_MEM_LIMIT`) | `2` |
| `CAPA_REUSE_MAX_MB` | executáveis do Windows até este tamanho: o FLOSS reaproveita a análise do capa em vez de refazê-la (mesmo resultado, mais rápido); `0` desliga | `8` |
| `CAPA_RECYCLE` | um container novo a cada análise; `false` = processo de longa vida | `true` |
| `GHIDRA_URL` | serviço do Ghidra (sob demanda); vazio desliga | `http://ghidra:3300` |
| `GHIDRA_TOKEN` | token compartilhado entre a API e o serviço `ghidra` (16+ caracteres) | — |
| `GHIDRA_MAX_MB` | executáveis maiores não vão para o Ghidra | `32` |
| `GHIDRA_TIMEOUT_S` | teto da análise no serviço (a análise automática para em 70% dele e o resumo ainda sai) | `900` |
| `GHIDRA_REQUEST_TIMEOUT_S` | quanto a API espera uma análise | `1300` |
| `GHIDRA_HEADLESS_MAXMEM` / `GHIDRA_MEM_LIMIT` | heap do Java e memória do contêiner | `3G` / `6g` |
| `GHIDRA_DECOMPILER_MAX_MB` | memória de cada processo do descompilador nativo (até dois, fora o heap); `0` desliga | `1024` |
| `GHIDRA_LIGHT_MB` | executáveis acima disto são analisados sem o analisador de `switch` (mais rápido); `0` desliga | `5` |
| `GHIDRA_RECYCLE` | um container novo a cada análise; `false` = processo de longa vida | `true` |
| `GHIDRA_MAX_PSEUDO_MB` | teto do pseudo-C de todas as funções (código somado), no serviço e na API | `32` |
| `UNPACK_URL` | serviço de desempacotamento; vazio desliga | `http://unpack:3400` |
| `UNPACK_TOKEN` | token compartilhado entre a API e o serviço `unpack` (16+ caracteres) | — |
| `UNPACK_MAX_MB` | executáveis maiores não vão para o desempacotador | `64` |
| `UNPACK_TIMEOUT_S` | tempo máximo de um desempacotador, no serviço | `180` |
| `UNPACK_REQUEST_TIMEOUT_S` | quanto a API espera por um trabalho (acima do `UNPACK_TIMEOUT_S`) | `400` |
| `UNPACK_MAX_FILES` / `UNPACK_MAX_TOTAL_MB` | quantos arquivos (de 1 a 100, o máximo que a API aceita numa resposta; fora disso o serviço ajusta e avisa no log) e quantos MB somados saem de uma amostra | `50` / `256` |
| `UNPACK_MEM_LIMIT` / `UNPACK_RECYCLE` | memória do contêiner; um container novo a cada trabalho | `2g` / `true` |
| `OLETOOLS_URL` | serviço de análise de documentos (oletools); vazio desliga | `http://oletools:3500` |
| `OLETOOLS_TOKEN` | token compartilhado entre a API e o serviço `oletools` (16+ caracteres) | — |
| `OLETOOLS_MAX_MB` | documentos maiores não vão para o oletools | `32` |
| `OLETOOLS_TIMEOUT_S` / `OLETOOLS_MEM_LIMIT` | teto de uma análise e memória do contêiner | `120` / `1g` |
| `OLETOOLS_REQUEST_TIMEOUT_S` | quanto a API espera por uma análise (acima do `OLETOOLS_TIMEOUT_S`) | `300` |
| `OLETOOLS_RECYCLE` | um contêiner novo para cada análise; `false` = processo duradouro | `true` |
| `EMULATE_URL` / `EMULATE_TOKEN` | serviço de emulação (Speakeasy); URL vazia desliga; token com 16+ caracteres | `http://emulate:3600` / — |
| `EMULATE_MAX_MB` / `EMULATE_RUN_S` | maior arquivo emulado e tempo de emulação | `32` / `60` |
| `EMULATE_TIMEOUT_S` / `EMULATE_REQUEST_TIMEOUT_S` / `EMULATE_MEM_LIMIT` | teto de uma análise, espera da API e memória do contêiner | `180` / `300` / `1g` |
| `ANDROID_URL` / `ANDROID_TOKEN` | serviço de APK (androguard); URL vazia desliga | `http://android:3700` / — |
| `ANDROID_MAX_MB` / `ANDROID_TIMEOUT_S` / `ANDROID_MEM_LIMIT` | maior APK, teto de uma análise e memória do contêiner | `100` / `180` / `1g` |
| `EXTRACT_URL` / `EXTRACT_TOKEN` | serviço de configuração e memória (CAPE); URL vazia desliga | `http://extract:3800` / — |
| `EXTRACT_MAX_MB` / `EXTRACT_TIMEOUT_S` / `EXTRACT_MEM_LIMIT` | maior arquivo, teto de uma análise e memória do contêiner | `64` / `300` / `2g` |
| `DOTNET_URL` / `DOTNET_TOKEN` | serviço de descompilação de .NET (ILSpy); URL vazia desliga | `http://dotnet:3900` / — |
| `DOTNET_MAX_MB` / `DOTNET_TIMEOUT_S` / `DOTNET_DECOMPILE_S` / `DOTNET_MEM_LIMIT` | maior assembly, teto de uma análise, teto do ILSpy e memória do contêiner | `30` / `240` / `200` / `2g` |
| `JAR_URL` / `JAR_TOKEN` | serviço de descompilação de Java (CFR); URL vazia desliga | `http://jar:4000` / — |
| `JAR_MAX_MB` / `JAR_TIMEOUT_S` / `JAR_DECOMPILE_S` / `JAR_MEM_LIMIT` | maior JAR, teto de uma análise, teto do CFR e memória do contêiner | `30` / `240` / `200` / `2g` |
| `SANDBOX_MEMDUMP_MAX_MB` / `SANDBOX_MEMDUMP_MAX_PROCESSES` / `SANDBOX_MEMDUMP_DELAY_S` | dump de memória: teto por processo (`0` desliga), processos por captura, espera depois da execução automática | `512` / `4` / `120` |
| `LLM_PROVIDER` | rascunho do relatório por IA: `anthropic`, `openai` (servidor compatível) ou vazio (desligado) | — |
| `LLM_URL` / `LLM_API_KEY` / `LLM_MODEL` | servidor (obrigatório no `openai`), chave (obrigatória no `anthropic`) e modelo (padrão `claude-opus-5-5` no `anthropic`) | — |
| `LLM_TIMEOUT_S` / `LLM_DAILY_LIMIT` | espera do modelo e rascunhos por analista em 24 h | `180` / `30` |
| `COMPOSE_PROFILES` | `netcap` sobe os serviços `netcap` e `suricata` (captura de rede do sandbox) | — |
| `MIKROTIK_URL` / `MIKROTIK_USER` / `MIKROTIK_PASSWORD` | API REST do RouterOS 7 do CHR, para o sniffer da captura de rede do sandbox; vazio desliga a captura | — |
| `MIKROTIK_VERIFY_TLS` · `MIKROTIK_SNIFFER_INTERFACE` | `true` só se o certificado do CHR for confiável; interface em que o sniffer escuta (vazio: todas) | `false` · — |
| `NETCAP_URL` / `NETCAP_TOKEN` / `NETCAP_STREAM_TARGET` | serviço netcap (perfil `netcap` do compose) e o `IP:porta` deste host como o CHR o vê | — |
| `NETCAP_TZSP_PORT` · `NETCAP_TZSP_BIND` · `NETCAP_TZSP_SOURCES` | porta UDP publicada no host, endereço do host onde ela é publicada (o voltado ao CHR) e os IPs de quem aceitar o TZSP (o do CHR; vazio aceita de todos) | `37008` · `0.0.0.0` · — |
| `NETCAP_MAX_MB` / `NETCAP_TMPFS` | teto do pcap por ambiente e a pasta em memória do serviço | `200` / `1g` |
| `SURICATA_URL` / `SURICATA_TOKEN` | Suricata sobre o pcap (ET Open); vazio: fica só o pcap | — |
| `SURICATA_MAX_MB` / `SURICATA_TIMEOUT_S` | maior pcap lido e teto de uma leitura | `256` / `600` |
| `SURICATA_REQUEST_TIMEOUT_S` | quanto a API espera por uma leitura (acima do `SURICATA_TIMEOUT_S`) | `660` |
| `SURICATA_UPDATE_HOURS` | de quanto em quanto tempo as regras ET Open são baixadas de novo (pelo `egress`) | `24` |
| `SURICATA_MEM_LIMIT` / `SURICATA_RECYCLE` | memória do contêiner; um contêiner novo para cada leitura | `2g` / `true` |
| `CAPTURE_RECYCLE` | um container novo a cada captura; `false` volta ao processo de longa vida, que atende capturas em fila sem trocar | `true` |
| `CAPTURE_CHROMIUM_SANDBOX` | sandbox do próprio Chromium na captura; `false` só como saída de emergência num host sem user namespaces | `true` |
| `CLAMAV_IMAGE` | imagem do contêiner do ClamAV, fixada por tag e digest (como a do Postgres; `node scripts/pin-images.mjs` confere e `--write` atualiza) | `clamav/clamav:1.5@sha256:…` |
| `COOKIE_SECURE` | `true` quando servir somente via HTTPS; o cookie da sessão passa a ser `__Host-dl_session` (quem estava logado entra de novo uma vez) | `false` |
| `CAPTURE_EGRESS_SUBNET` | Sub-rede fixa da rede de saída da captura (`capture-egress`), para o host mandá-la por uma VPN com roteamento por origem (`docs/implantacao.pt-BR.md`, passo 3). Mudar exige `docker compose down` antes do `up` | `172.31.252.0/24` |
| `REAL_IP_FROM` | endereço em que o nginx confia para o IP do cliente (`X-Forwarded-For`): o gateway da `DEEPLOOK_SUBNET`, que é como o cloudflared do host chega. Troque junto com a `DEEPLOOK_SUBNET`, ou ponha o endereço de um cloudflared em contêiner | `172.31.250.1` |
| `DEEPLOOK_SUBNET` | Sub-rede fixa da rede interna `deeplook`, a única de onde a API aceita conexão e o IP do cliente (vira o `TRUSTED_NETWORK` da API). Troque só se colidir com outra rede do host, e rode `docker compose down` antes do `up` para recriar a rede | `172.31.250.0/24` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin semeado no primeiro boot; troca a senha no primeiro acesso. Com a senha padrão, o login dele é recusado em produção | — |
| `ALLOW_INSECURE_DEFAULTS` | `true`: sobe mesmo com `SESSION_SECRET`/`CAPTURE_TOKEN`/`CAPA_TOKEN`/`GHIDRA_TOKEN`/`UNPACK_TOKEN`/`OLETOOLS_TOKEN`/`NETCAP_TOKEN`/`SURICATA_TOKEN` padrão, com a senha padrão do banco ou do MinIO, e aceita o login com a senha padrão do admin (só para demonstração local) | `false` |
| `MAX_UPLOAD_MB` | Tamanho máximo de upload | `200` |
| `MAX_UPLOAD_MEMORY_MB` | soma dos envios em análise na memória. O envio vai para o disco enquanto chega e só entra na memória depois de inteiro; sem espaço, espera a vez por até 30 s e então responde 503 "tente de novo em instantes" | `600` |
| `MAX_UPLOAD_SPOOL_MB` | soma dos envios que estão chegando, em disco (`/tmp` da API); acima, 503. Cada pessoa ocupa no máximo metade (além disso, 429) | `2048` |
| `API_MEM_LIMIT` | limite de memória do container da API | `4g` |
| `API_PIDS_LIMIT` | limite de processos e threads da API (pico medido: 32, com amostra e backup) | `256` |
| `WEB_MEM_LIMIT` | limite de memória do container do web (nginx) | `256m` |
| `LOG_MAX_SIZE` · `LOG_MAX_FILE` | rotação dos logs do Docker, em todos os serviços: tamanho de cada arquivo e quantos ficam | `10m` · `3` |
| `UPLOAD_DAILY_LIMIT` | Envios por usuário comum nas últimas 24 horas (arquivo, link, cada arquivo de um `.zip`); analistas e admins sem limite; `0` desliga | `20` |
| `MINIO_IMAGE` | imagem compatível com o MinIO, fixada por digest (o `.env.example` lista as alternativas) | `pgsty/silo@sha256:…` |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Credenciais do MinIO | `deeplook` |
| `MINIO_CONSOLE_PORT` | Porta (loopback) do console do MinIO no host | `9001` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | Bucket usado pela API | `http://minio:9000` |
| `S3_FORCE_PATH_STYLE` | bucket no caminho, e não no nome do host (o que o MinIO espera) | `true` |
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
| `SANDBOX_ARTIFACT_INTERVAL_S` / `SANDBOX_ARTIFACT_MAX_SHOTS` | de quantos em quantos segundos coletar o print e a lista de processos (`0` desliga) e quantos prints guardar por ambiente | `60` / `60` |

Console do MinIO (administração, apenas no loopback): http://localhost:9001

### Segredos por arquivo (`NOME_FILE`)

Cada segredo aceita `NOME_FILE` ao lado de `NOME`: o valor sai do arquivo (sem a quebra de linha do
fim) e não aparece no `docker inspect` nem no `docker compose config`. Vale para `DATABASE_URL`,
`SESSION_SECRET`, `DATA_KEY`, `DATA_KEY_PREVIOUS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`ADMIN_PASSWORD`, `LDAP_BIND_PASSWORD`, `PROXMOX_PASSWORD`, `MIKROTIK_PASSWORD`,
`BACKUP_SCHEDULE_PASSWORD`, `RESTORE_PASSWORD`, os tokens dos serviços (`CAPTURE_TOKEN`,
`CAPA_TOKEN`, `GHIDRA_TOKEN`, `UNPACK_TOKEN`, `OLETOOLS_TOKEN`, `NETCAP_TOKEN`, `SURICATA_TOKEN`) e
as chaves de reputação. Com os dois definidos, vale o arquivo. O
Postgres e o MinIO já aceitam `POSTGRES_PASSWORD_FILE` e `MINIO_ROOT_PASSWORD_FILE` por conta
própria.

O compose padrão não muda; quem quiser usa um `compose.override.yaml`, por exemplo:

```yaml
services:
  api:
    environment:
      SESSION_SECRET_FILE: /run/secrets/session_secret
    secrets: [session_secret]
secrets:
  session_secret:
    file: ./secrets/session_secret
```

Sem o Swarm, o Docker Compose monta o arquivo do host com o mesmo dono e a mesma permissão, e
ignora `uid`, `gid` e `mode`: o arquivo precisa ser legível pelo usuário do contêiner (a API roda
como `node`, uid 1000). Arquivo que não existe ou vazio impede a subida, com o nome do segredo no
log. A proteção principal continua sendo o `.env` com permissão `600`.

---

## Estrutura do projeto

```
deeplook/
├─ docker-compose.yml
├─ .env.example
├─ README.md          # English (principal)
├─ README.pt-BR.md    # Português (pt-BR)
├─ LICENSE            # MIT
├─ SECURITY.md        # como relatar uma vulnerabilidade
├─ RELEASE.txt        # versão e commit, preenchidos pelo git archive no pacote de implantação
├─ .github/           # CI (ci.yml), varredura de CVE das imagens (security-scan.yml), releases
│                     # (release.yml), Dependabot e as capturas de tela do README
├─ apps/
│  ├─ api/            # Fastify + Prisma + S3 (MinIO)
│  │  ├─ prisma/      # schema, migrações, seed (configuração em prisma.config.ts)
│  │  ├─ rules/       # pacotes de regras YARA de fábrica
│  │  ├─ tests/       # unitários, fuzzing e integração (Postgres, MinIO e OpenLDAP reais)
│  │  └─ src/         # env, lib, routes (generated/prisma: cliente gerado, fora do git)
│  ├─ capa/           # capa e FLOSS (Python) para a análise de funções, sem rede
│  ├─ ghidra/         # Ghidra headless (Java 25), scripts de exportação e o servidor, sem rede
│  ├─ unpack/         # Detect It Easy e os desempacotadores (um plugin por arquivo em unpackers/)
│  ├─ oletools/       # olevba, MacroRaptor, msodde, oleid e rtfobj; QR code (qr.py, zxing-cpp)
│  ├─ capture/        # navegador isolado que captura a página de um link, e o egress
│  ├─ netcap/         # recebe o TZSP do CHR e grava um pcap por ambiente do sandbox
│  ├─ suricata/       # Suricata sobre o pcap, com as regras ET Open
│  └─ web/            # React + Vite + @carbon/react
│     ├─ nginx.conf   # servidor do build e proxy de /api (a configuração real)
│     ├─ vitest.config.ts # testes unitários e piso de cobertura
│     └─ src/         # api, auth, components, pages, styles
├─ docs/              # guias (EN: *.md; pt-BR: *.pt-BR.md): implantacao, proxmox, template-windows
├─ scripts/           # pacote de implantação (package-deploy.mjs), restore.sh, smoke tests, testes de
│                     # tela e visuais (ui-playwright/, ui-visual/), conferências do CI (check-*.mjs,
│                     # trivy.mjs) e os arquivos do template Windows (template-windows/)
├─ trivy.yaml         # severidade, exceções justificadas e o que reprova o scan de imagens
└─ data/              # volumes (git-ignored): pgdata/, minio/, clamav/, backups/, alerts/
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

## Monitoramento (Administração › Monitoramento)

Uma aba só para administradores, atualizada a cada 10 s, para ver a carga da operação e parar o que
for preciso. Toda ação vai para a auditoria.

- **Ambientes do sandbox:**
  - **o que mostra:** os ambientes ativos, com quem abriu, a amostra, a fase, desde quando, quanto
    falta para expirar (laranja nos últimos 10 min) e a CPU e a memória de cada VM;
  - **limites:** quantos ambientes estão em uso de `SANDBOX_MAX_ACTIVE` e quem está no limite de
    `SANDBOX_MAX_PER_USER`;
  - **nó do Proxmox:** CPU, memória e disco. Isso pede a leitura do nó (`Sys.Audit`, o
    `PVEAuditor` em `/`; ver [docs/proxmox.pt-BR.md](docs/proxmox.pt-BR.md)). Sem ela, a tela avisa
    e o resto funciona;
  - **órfãs:** VMs e ISOs órfãs desta instalação, contadas pela mesma regra da limpeza automática,
    com o botão **Limpar agora**. O template e as VMs sem a etiqueta desta instalação nunca entram;
  - **encerrar** um, os selecionados ou **todos**. "Todos" pede para digitar o número de ambientes.
    O encerramento faz a última coleta de artefatos e apaga a VM. Quem abriu recebe um aviso, com o
    motivo opcional, e a ficha registra "encerrado pela administração".
- **Filas de análise:** capa, Ghidra, desempacotar, oletools, QR, emulação, APK, configuração, .NET,
  Suricata e dump de memória.
  - **cada linha mostra:** pendentes (e as tentativas agendadas), em andamento (e há quanto tempo),
    concluídas e falhas em 24 h, tempo médio e p95, e o serviço no Status do sistema;
  - **Pausar:** a fila para de pegar trabalho novo, e o que está em andamento termina. A pausa
    sobrevive ao reinício da API, e o Status do sistema fica laranja enquanto durar;
  - **Trabalhos:** a lista dos pendentes, em andamento e falhos.
    - **Cancelar** um pendente o deixa como falho, com o motivo "cancelado pela administração".
    - Num trabalho em andamento, a API interrompe o pedido. O serviço percebe a conexão fechada e
      mata a ferramenta em cerca de 1 s. No unpack, que roda dentro do próprio processo, o container
      sai e volta limpo (com `UNPACK_RECYCLE`, o padrão).
    - **Refazer** volta uma falha (ou as das últimas 24 h) para a fila, do zero.
- **Plataforma:**
  - a API: memória, atraso do event loop e reinícios do worker da análise estática;
  - a reavaliação Sigma e as varreduras YARA retroativas;
  - o tamanho do banco e do MinIO (este calculado a cada 15 min).
- **Histórico:** uma amostra por minuto, guardada por 7 dias, com gráficos de 24 h (intervalos de
  15 min) e 7 dias (de 1 h). Mostra os ambientes ativos e o limite, a fila, as análises em andamento,
  concluídas e falhas, a memória da API, o event loop e o nó do Proxmox. Também traz o tempo de cada
  fila por dia. Cada gráfico tem a tabela equivalente.

| Método | Rota | Função |
|---|---|---|
| GET | `/api/admin/monitor` | A foto: sandbox, filas e plataforma |
| GET | `/api/admin/monitor/history` | Histórico (`range=24h\|7d`) e tempo das filas por dia |
| POST | `/api/admin/monitor/sandbox/stop` | Encerra ambientes (`{ ids }` ou `{ all: true }`, `reason` opcional) |
| POST | `/api/admin/monitor/sandbox/orphans/sweep` | Limpa agora as VMs e ISOs órfãs desta instalação |
| PATCH | `/api/admin/monitor/queues/:queue` | Pausa ou retoma a fila (`{ paused }`) |
| GET | `/api/admin/monitor/queues/:queue/jobs` | Trabalhos da fila (`state=pending\|running\|failed`, `page`) |
| POST | `/api/admin/monitor/queues/:queue/cancel` | Cancela trabalhos (`{ ids }` ou `{ allPending: true }`) |
| POST | `/api/admin/monitor/queues/:queue/retry` | Refaz falhas (`{ ids }` ou `{ failedSinceHours }`) |

## Log centralizado de alertas

Com `ALERT_LOG_DIR` no `.env`, a API grava em `deeplook-alerts.jsonl`, nessa pasta, uma linha JSON
por alerta, para um coletor (Filebeat, Fluent Bit, rsyslog, Wazuh) levar ao SIEM. Sem a variável,
nada é gravado. Cada linha traz `time`, `level` (`info`, `warn` ou `error`), `code`, `message` (em
português) e `context`:

| `code` | Quando |
|---|---|
| `backup.failed` | um backup (agendado ou pela tela) falhou |
| `status.down` / `status.recovered` | um componente do status do sistema passou a erro / voltou (conferido a cada 5 min) |
| `audit.chain_broken` / `audit.chain_ok` | a cadeia da auditoria quebrou / voltou a conferir (conferida de hora em hora) |
| `integrity.mismatch` | um arquivo guardado não confere com o SHA-256 da ficha (no download ou na conferência periódica) |
| `yara.update_held` | uma atualização de regras YARA ficou retida para aprovação |

O mesmo estado não se repete: um componente fora do ar gera uma linha ao cair e outra ao voltar. O
arquivo é aberto em modo de acréscimo a cada linha, então o `logrotate` (com `create` ou
`copytruncate`) funciona sem reiniciar a API. Falha ao gravar vai só para o log da API.

## Segurança e avisos

- ⚠️ O servidor do DeepLook **nunca executa** as amostras: os serviços de análise só as leem, sem
  rede. Uma amostra só roda dentro do [sandbox de análise](#sandbox-de-análise-proxmox-ve), uma VM
  descartável do Proxmox numa rede isolada, quando um analista o abre. Manuseie arquivos baixados
  em ambiente isolado também.
- Os objetos ficam em bucket **privado** no MinIO; o download só ocorre por
  endpoint autenticado da API.
- **"Baixar amostra" entrega um ZIP com a senha `infected`** (cifra ZipCrypto, que o Explorer do
  Windows abre sem instalar nada), para o antivírus da máquina não apagar o arquivo e ninguém
  executá-lo com um clique duplo. A senha é pública: a cifra é só embalagem. O arquivo original
  fica em **Mais ▸ Baixar arquivo original…**, com confirmação. Na API:
  `GET /api/entries/{id}/download?format=zip` (sem `format`, o arquivo cru, como antes). A
  Auditoria registra o formato de cada download.
- O cadastro exige **chave de ativação** gerada por um admin.
- Senhas usam **hash bcrypt**; a sessão usa **cookie httpOnly**. O banco guarda só o SHA-256
  do cookie (como nos tokens de API), então nem o banco nem um backup entregam sessões válidas.
  Com `COOKIE_SECURE=true` o cookie se chama `__Host-dl_session`: outro subdomínio do mesmo
  domínio não consegue gravá-lo nem trocá-lo.
- Pedido que muda alguma coisa vindo de **outro site**, inclusive de outro subdomínio do seu
  domínio, é recusado com 403 (o navegador informa isso em `Sec-Fetch-Site`). O mesmo vale para
  o WebSocket do console. Scripts com token de API não mandam esse cabeçalho e não são afetados.
- A API só aceita conexão da **rede interna `deeplook`** (sub-rede fixa, `DEEPLOOK_SUBNET`) e do
  próprio container. O navegador isolado da captura fica em outra rede e não alcança a API,
  mesmo que uma página maliciosa o comprometa; só o nginx dessa rede informa o IP do cliente.
- A rede da captura é interna e sai só pelo `egress`: um navegador comprometido não chega à
  LAN, ao host nem a um endereço interno, porque não há rota fora do proxy.
- Os logs da API e do nginx guardam o caminho sem a query string, porque a busca e a ficha do
  indicador levam URLs de vítima, com token ou e-mail.
- O `web`, a API, o capture, o egress e os serviços de análise rodam **sem root e sem capacidades**, com o sistema de
  arquivos **somente leitura** e limite de processos. A API grava só no `/tmp`, que é um volume
  em disco (`api-tmp`) e não memória, porque sem `BACKUP_DIR` o ZIP inteiro do backup é montado
  ali. As sobras de um backup ou ISO interrompido são apagadas na subida. A telemetria do Prisma
  CLI está desligada (`CHECKPOINT_DISABLE`). As imagens finais não trazem o `npm`. O nginx não revela a
  versão, manda `Permissions-Policy`, `Cross-Origin-Opener-Policy` e
  `Cross-Origin-Resource-Policy`, e os assets com hash saem com um ano de cache.
- O banco, o MinIO e o ClamAV rodam com `no-new-privileges` e **só as capacidades que o
  entrypoint de cada um precisa** (medidas uma a uma: subir, gravar e reiniciar com os próprios
  dados). O banco fica com `CHOWN`, `DAC_OVERRIDE`, `SETGID` e `SETUID`. O MinIO fica só com
  `DAC_OVERRIDE`. O ClamAV, que lê arquivo malicioso, fica com essas quatro mais `FOWNER`. As
  demais capacidades padrão do Docker, como `NET_RAW`, `MKNOD` e `SYS_CHROOT`, saem.
- O `egress` recusa as 80 portas que o próprio Chromium recusa (SMTP, SSH, IRC, NFS...),
  medidas no navegador da imagem, mesmo que o navegador seja comprometido. Nenhuma outra porta é
  barrada, porque phishing em porta alta precisa ser capturado.
- O `Cross-Origin-Opener-Policy` só vale em origem confiável (HTTPS ou `localhost`), que são os
  dois caminhos de acesso (o Tunnel e a porta em `127.0.0.1`). Por HTTP em outro nome o navegador
  o ignora e escreve um aviso no console, sem efeito funcional.
- A **CSP** só executa script do próprio DeepLook (sem script inline, sem `eval`) e liga o **Trusted
  Types** (`require-trusted-types-for 'script'; trusted-types 'none'`): `innerHTML`, `document.write` e
  afins recusam qualquer string, e nenhuma política pode ser criada para contornar. A interface nunca
  escreve HTML a partir de string (o React monta os elementos), então um script injetado num desses
  pontos é barrado pelo navegador. Navegador sem Trusted Types (Firefox antes do 148, Safari antes do 26)
  ignora as duas diretivas e mantém o resto da CSP. Os cenários de tela e a suíte visual rodam com a CSP
  de produção e reprovam qualquer violação.
- O `includeSubDomains` do HSTS vale para os subdomínios do endereço que serve o DeepLook: use
  um nome dedicado (por exemplo, `deeplook.exemplo`), e não o domínio raiz, se outros
  subdomínios ainda atendem por HTTP.

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

O CSS do Carbon é **seletivo** (o `app.scss` importa só os módulos dos componentes usados):
`node scripts/check-carbon-css.mjs` reprova se um componente importado ficar sem o módulo
correspondente — o CI roda esse passo no job `check`.

---

## Idioma da interface

A interface existe em **português** e em **inglês**. O idioma é escolhido em **Minha Conta >
Preferências > Idioma** (vale para a conta, em qualquer máquina) ou, antes de entrar, no seletor da
barra azul das páginas públicas (fica guardado nesta máquina). Sem escolha, é português, mesmo com o
navegador em inglês. Datas e números seguem o idioma (`13/11/2026` ou `11/13/2026`).

- **Telas:** todas passam pelos dicionários de `apps/web/src/i18n`, um arquivo por área (`entry`,
  `analysis`, `cases`, `admin`...) com o português e o inglês lado a lado em cada linha; o
  TypeScript só aceita as chaves da área, e o teste reprova texto vazio ou `{valores}` diferentes
  entre os idiomas.
- **Erros da API:** a interface manda `Accept-Language` com o idioma dela, e a API traduz `error` e
  `details` das respostas de erro (`apps/api/src/lib/messages-en.ts`, mais de 300 mensagens). Scripts
  que não mandam o cabeçalho continuam recebendo português; para inglês, `Accept-Language: en`.
  O teste `tests/unit/messages-coverage.test.ts` lê o código da API e reprova mensagem de erro sem
  tradução.
- **Status, risco e análises:** o status do sistema, a pontuação de risco e o que as análises
  gravaram (alertas, achados de script, tipo do arquivo, motivos de falha) saem no idioma de quem
  pede (`Accept-Language`), inclusive pelo token de status. O banco guarda o português, e a API
  traduz na saída; registros antigos também saem traduzidos. Ao trocar o idioma, a interface busca
  de novo o que estava em cache.
- **Histórico, notificações e auditoria:** o detalhe que o sistema escreve sai no idioma de quem
  pede; o CSV da auditoria segue o idioma da interface (o link manda `?lang=`, que a API aceita em
  qualquer rota).
- **CSVs e especificação:** os CSVs (lista de amostras, auditoria, relatório gerencial,
  indicadores) seguem o idioma da interface, inclusive o separador (`;` em português, `,` em
  inglês para o Excel), e a especificação OpenAPI sai no idioma de quem pede.
- **Continua em português:** o que as pessoas escrevem (comentários, resoluções, títulos) e as
  exportações STIX e MISP.
- `node scripts/check-i18n.mjs` conta o texto em português solto no código (`--texts` lista cada um)
  e reprova `t()` no topo do módulo ou dentro de `useMemo` sem `locale` nas dependências (o texto não
  acompanharia a troca de idioma). Tabelas de rótulos no topo do módulo usam `localized()`. O CI roda
  com `--max 0`: texto que não é de interface (erro só para quem desenvolve, valor gravado pela API)
  leva um comentário `i18n-ok` com o motivo, na linha ou na anterior.

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
| `src/styles/app.scss` | entrada dos estilos + layout da casca; lista os módulos do Carbon usados (CSS seletivo) |
| `src/styles/_carbon-theme.scss` | tokens do tema claro `g10`, emitidos antes do skin do HPSM |

### Minha Conta e preferências

O nome do usuário no topo abre um submenu (Minha conta, Alterar senha, Preferências,
Sair). Em `/user` o usuário vê seus dados (somente leitura), troca a senha — o que
**encerra todas as sessões** e exige novo login — e ajusta as preferências: página
inicial (padrão: a **Página Inicial** de boas-vindas, `/inicio`), registros por página
e reabrir as abas da sessão anterior. Na aba **Notificações**, cada pessoa escolhe que avisos chegam
à Caixa de entrada; os que pedem ação (atribuição, atraso, relatório devolvido, resolução, pacotes
YARA) sempre chegam.

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

**Cursor:** como no console do Proxmox, o cursor do sistema fica visível sobre a tela da VM
quando ela não manda um cursor próprio, ou manda um transparente (o Windows com o vídeo VGA
padrão desenha o cursor na imagem, que só anda no ritmo dos quadros). Quando a VM manda um
cursor visível, ele aparece no lugar, com o formato dela.

### Preparando o template no Proxmox

1. Crie uma VM (Windows/Linux) com `qemu-guest-agent`, **rede isolada** (bridge sem
   rota para a LAN) e sem credenciais corporativas.
2. Instale as ferramentas de análise que você usa.
3. **Crie um snapshot** (o linked clone usa esse estado como base; sem snapshot o
   DeepLook cai automaticamente para uma cópia cheia, mais lenta).
4. Converta em template (`qm template <vmid>`).
5. Crie um usuário dedicado (`deeplook@pve`) com `PVEVMAdmin` em `/vms` (o clone
   recebe um VMID novo, então a permissão vai em `/vms`, não em
   `/vms/<vmid do template>`), `PVEDatastoreAdmin` no storage da ISO e em cada
   storage que tem disco do template, e `PVESDNUser` na bridge do template.
   Detalhes em [`docs/proxmox.pt-BR.md`](docs/proxmox.pt-BR.md).
6. Preencha os `PROXMOX_*` no `.env` e ligue com `SANDBOX_ENABLED=true`.

> 📖 Passo a passo completo — template, permissões (incluindo **Datastore** para o
> upload da ISO), `.env`, rede Docker→PVE, validação e troubleshooting:
> **[`docs/proxmox.pt-BR.md`](docs/proxmox.pt-BR.md)**.

### Modo mock (desenvolvimento sem PVE)

Com `PROXMOX_MOCK=true` a API simula o Proxmox em memória (clone, start, tasks,
vncproxy, screenshot): o fluxo completo — provisionar, console, descartar — roda
sem um PVE real. Valide com `scripts/smoke-sandbox.ps1`.

### Artefatos do ambiente

Enquanto o ambiente roda, a API guarda a cada `SANDBOX_ARTIFACT_INTERVAL_S` (padrão 60 s; `0`
desliga) um **print da tela** da VM e a **lista de processos**, e faz uma última coleta ao
encerrar. Ficam com a amostra depois que a VM é destruída, para qualquer analista, na aba
**Análise**: as miniaturas com a hora e os **processos que surgiram** desde a primeira listagem,
com o processo pai e a linha de comando (a amostra rodando, o PowerShell que ela abriu).

- **Print:** pelo endpoint de screenshot do PVE quando ele existe e, no PVE 9 (que o tirou), pelo
  próprio console VNC: a API faz o que o noVNC faz, pede um quadro da tela e fecha, sem mandar
  teclado nem mouse, e sem derrubar quem está no console. Até `SANDBOX_ARTIFACT_MAX_SHOTS` por
  ambiente (padrão 60): o primeiro e os mais recentes. Vão para o MinIO, entram no backup e saem
  junto com a amostra ao esvaziar a lixeira.
- **Processos:** pelo `qemu-guest-agent`, que o template já exige: no Windows, o
  `Get-CimInstance Win32_Process` (com a linha de comando); no Linux, o `ps`. É o que o próprio
  sistema da VM informa, e um malware pode esconder processos. Precisa da permissão de usar o
  agente no PVE (`VM.GuestAgent.Unrestricted` no PVE 9, `VM.Monitor` no 8; o papel `PVEVMAdmin`
  em `/vms` cobre). Sem o agente ou sem a permissão, ficam só os prints, e o motivo aparece na
  tela.
- **Sysmon (opcional):** num template Windows com o Sysmon instalado (passo no
  [guia do Proxmox](docs/proxmox.pt-BR.md#21-template-da-vm-de-análise)), cada coleta lê pelo mesmo
  agente os eventos **novos** do canal `Microsoft-Windows-Sysmon/Operational` (a partir do último
  guardado, até 2000 por leitura e 20 000 por ambiente): processos (1), conexões (3), arquivos
  criados (11), registro (12 a 14) e DNS (22). Assim o comportamento tardio da amostra não cai fora
  do teto de uma leitura. A tela mostra a **árvore de processos**, as listas e a **linha do tempo da
  execução**: processos, rede, DNS, arquivos e registro numa sequência só, com as marcas do ambiente
  (no ar, amostra aberta, prints, fim). Por padrão ela mostra só a amostra e o que ela abriu (a
  árvore pelo `ParentProcessGuid` do Sysmon, a partir do processo com o nome do arquivo); "Tudo"
  inclui o ruído do Windows. As horas saem no relógio da API (a VM isolada não sincroniza a hora).
  Os domínios e os IPs públicos entram nos IOCs sugeridos do relatório. Sem o Sysmon, ou num guest
  Linux, nada muda, e o motivo aparece na tela.
- **Execuções anteriores:** cada ambiente que a amostra já teve fica na seção, recolhido, com os
  próprios prints, processos, Sysmon, linha do tempo e captura (rodar de novo não esconde a anterior).
- **Comparar execuções:** com duas ou mais execuções, o bloco **Comparar execuções** mostra, para
  duas delas (a atual entra na escolha), o que só uma fez e o que as duas fizeram: processos,
  consultas DNS, destinos de rede, arquivos criados, registro, detecções Sigma e alertas do
  Suricata. Antes da comparação, a API tira o que muda à toa de uma execução para outra: PIDs,
  GUIDs, o perfil e o SID do usuário (`HKU\S-1-5-21-…` vira `HKCU`), `%TEMP%`/`%APPDATA%` e nomes
  temporários (`tmp1A2B.tmp`). Por padrão a comparação usa só a amostra e o que ela abriu, e
  **Tudo** inclui o Windows. Serve para ver o que a amostra faz de diferente com e sem rede, com
  outro tempo de espera ou em outro template.
- **Fora da tela:** a linha do tempo sai em **CSV** ou **JSON** com os filtros da tela (o CSV abre
  no Excel com acentos, e o que viraria fórmula ganha um apóstrofo). Para analistas, a **ficha
  impressa** e o **Markdown dos relatórios** trazem o resumo da última execução: quando, quem, a
  execução automática, o Sysmon, os processos da amostra e, sem repetir, DNS, conexões, arquivos e
  registro. Console e credenciais nunca entram.
- **Tráfego de rede (opcional):** com o tráfego das VMs passando por um MikroTik CHR, o sniffer
  dele manda os pacotes de cada VM (filtrados pelo MAC) ao serviço `netcap`, que grava um pcap por
  ambiente. Ao encerrar, o pcap vai para o MinIO e o **Suricata** o lê com as regras **ET Open**
  (baixadas pela saída controlada, uma vez por dia). A seção "Tráfego de rede" mostra os alertas,
  as consultas DNS, os pedidos HTTP, as conexões TLS e o download do pcap (registrado na
  auditoria); os domínios e os IPs entram nos IOCs sugeridos, e um alerta soma na pontuação de
  risco. Liga com `COMPOSE_PROFILES=netcap` e as variáveis `MIKROTIK_*`, `NETCAP_*` e `SURICATA_*`
  ([guia do Proxmox, seção 9](docs/proxmox.pt-BR.md#9-captura-de-rede-pelo-mikrotik-chr-opcional)).
  Sem elas, o sandbox segue igual. O pcap tem o tráfego da amostra, inclusive o que ela baixou: o
  backup com os arquivos o leva junto.

### Regras Sigma no Sysmon

Com o Sysmon no template, cada coleta passa os eventos **novos** pelas regras Sigma da
[SigmaHQ](https://github.com/SigmaHQ/sigma), em três coleções:

| Coleção | Origem na release | Situação |
|---|---|---|
| Principal | `sigma_core+.zip`: níveis crítico, alto e médio | ligada |
| Ameaças emergentes | `sigma_emerging_threats_addon.zip`, sem as experimentais | ligada |
| Caça | a pasta `rules-threat-hunting` no mesmo tag, sem as experimentais | desligada; ligue regra a regra |

A SigmaHQ diz que as regras de caça não são para alertar, por isso vêm desligadas. Entram só as
regras de Windows que o Sysmon cobre: criação de processo, rede, arquivos,
registro, DNS, DLL carregada, thread remota, acesso a processo, pipes, WMI, drivers e arquivos
apagados. Para essas regras, a leitura do Sysmon também traz os eventos 6 a 10, 15, 17 a 21, 23, 25 e
26. O resumo e a linha do tempo continuam com os cinco tipos de sempre.

- **Onde aparece:** o bloco **Detecções Sigma** de cada execução mostra o nível, a regra, as
  técnicas ATT&CK (links para o Histórico Global filtrado), o processo, quantas vezes casou e
  quando. Ao abrir a linha aparecem a descrição, o evento que casou, os falsos positivos conhecidos
  e o link da regra na versão usada. Por padrão só aparecem os processos da amostra e os que ela
  abriu, pela mesma árvore da linha do tempo. **Tudo** mostra também o que casou no resto do
  Windows.
- **Pontuação de risco:** só as detecções nos processos da amostra contam. Crítico vale 40, alto 30
  e médio 15, mais 5 por regra a mais, com teto de 50.
- **Avaliação:** os eventos são avaliados uma vez só. **Avaliar de novo** refaz a execução do zero.
  Quando as regras mudam (outra release vendorizada), a API reavalia todos os ambientes guardados
  na subida, em segundo plano.
- **Avaliador:** fica na própria API (`src/lib/sigma.ts`), sem serviço novo. Cobre:
  - os modificadores `contains`, `startswith`, `endswith`, `all`, `re`, `base64`, `base64offset`,
    `wide`, `windash`, `cidr`, `exists`, `gt`/`gte`/`lt`/`lte`, `cased` e `fieldref`;
  - o valor `null`;
  - as condições com `and`, `or`, `not`, parênteses, `1 of`/`all of` e `them`.

  Ficam de fora `keywords`, agregações e correlações. Uma regra assim não entra, e o motivo fica no
  manifesto.
- **Atualizar as regras:**
  1. Baixe e extraia o `sigma_core+.zip` e o `sigma_emerging_threats_addon.zip` da release. Faça o
     checkout do mesmo tag do repositório (basta um sparse checkout de `rules-threat-hunting`); o
     `LICENSE` usado é o dele.
  2. Rode `node --import tsx scripts/vendor-sigma.mjs <tag> <LICENSE> <core+> <ameaças emergentes> <repositório>`
     em `apps/api`.
  3. O script grava `apps/api/sigma/sigmahq/`, `sigmahq-et/`, `sigmahq-hunting/` e o `manifest.json`
     (versão, coleções, contagens e exclusões).

  As regras seguem a **DRL 1.1**, e o nome e o link de cada uma aparecem na tela.

#### Regras da equipe e o catálogo (Navegador › Regras Sigma)

Analistas e administradores mantêm as regras próprias da equipe e escolhem quais regras da SigmaHQ
valem no ambiente:
- **Regra da equipe:** o YAML da regra, com **Validar** (o mesmo avaliador das detecções diz o que
  entendeu: título, nível, eventos do Sysmon e técnicas, ou o motivo de não compilar) e **Testar
  numa execução**. O teste mostra quantos eventos casaram e os primeiros 20, com o processo e se ele
  é da amostra, e não grava nada. O `title` do YAML é o nome da regra, e o `id` é obrigatório.
- **Ao salvar, ligar ou desligar:** as detecções da regra são refeitas em segundo plano em todas as
  execuções guardadas, e a lista mostra "avaliando". Nada conta duas vezes: cada execução é refeita
  com a coleta travada, e os eventos que ainda não foram avaliados passam pela regra na coleta
  normal. Desligar ou excluir tira as detecções dela de todas as execuções.
- **Catálogo SigmaHQ:** busca por título, id, caminho ou técnica, filtro por nível, por coleção e por
  ligada ou desligada, e quantas execuções cada regra disparou. **Desligar** uma regra que só faz ruído no
  ambiente tira as detecções dela de todas as execuções. **Ligar** de novo refaz.
- **Na execução:** a detecção de uma regra da equipe aparece com "da equipe" e leva ao editor, no
  lugar do link do GitHub. Ela pesa no risco pelo nível, como as outras.
- **Auditoria:** criar, alterar (inclusive ligar e desligar, também as da SigmaHQ) e excluir.

### Busca nos eventos do sandbox

**Navegador › Busca no sandbox** procura nos eventos do Sysmon de **todas** as execuções guardadas:
quem rodou um comando, gravou um caminho, consultou um domínio ou carregou uma DLL. É só para
analistas e administradores.
- **Filtros** (ficam no endereço da página):
  - o campo: qualquer um, processo, linha de comando, arquivo, registro, rede, DNS, hash, DLL
    carregada ou pipe;
  - o operador: contém, é igual a, começa com, termina com ou expressão regular (a do Postgres, sem
    diferenciar maiúsculas, até 200 caracteres);
  - o tipo de evento, o período das execuções e os processos (todos ou só os da amostra).
- **Resultado por execução**, da mais recente para a mais antiga: a amostra, quando rodou, quantos
  eventos casaram e os três primeiros. **Ver os eventos** abre a lista paginada dos que casaram.
  **Abrir a execução** leva à ficha da amostra com aquela execução aberta.
- **Só os da amostra** usa a mesma árvore de processos da linha do tempo, montada para cada execução.
  As execuções sem nenhum evento da amostra saem antes de montar a página.
- **Limites:** as 300 execuções mais recentes que casam (a tela avisa quando chega nele) e 15 s por
  consulta. Uma regex inválida ou uma busca lenta demais voltam com o motivo. O CSV traz até 10 mil
  eventos.
- **Da linha do tempo:** ao passar o mouse num evento, **buscar em outras execuções** abre a busca
  com o processo, o destino, a consulta DNS, o arquivo ou a chave daquele evento.
- **Desempenho:** um índice de trigramas (`pg_trgm`) sobre o texto do evento atende os operadores de
  texto. Com 500 mil eventos em mil execuções, a busca leva cerca de 4 ms com o índice, contra 0,25
  a 2,6 s sem ele. A expressão regular não usa o índice. Se o usuário do banco não puder criar a
  extensão, a migração segue sem o índice e a busca funciona, só mais lenta.

### Dump de memória dos processos da amostra

A memória inteira da VM não sai pelo Proxmox sem dar ao DeepLook o monitor do QEMU (`Sys.Modify` em
`/`, quase administrador do nó) e acesso ao disco do host. Em vez disso, o dump é dos **processos da
amostra**, dentro do clone, pelo mesmo agente do Sysmon:

1. **Processos:** saem da árvore da amostra no Sysmon e são conferidos vivos na lista do agente,
   pelo nome e pelo processo pai. O Windows reaproveita PIDs: no teste real, um `conhost` que tinha
   sido da amostra já era o console do próprio agente. O `conhost.exe` nunca é despejado.
2. **Dump:** `MiniDumpWriteDump` com a memória inteira e as informações das regiões, compactado com
   gzip em `%TEMP%`.
3. **Transferência:** o gzip é lido em pedaços de 768 KB (Base64 na saída do agente; com 2 MB o
   qemu-ga do Windows cai), conferido pelo SHA-256, guardado no MinIO e apagado da VM.

O serviço `extract` então lê o minidump:

- as **regiões privadas executáveis** (código que não veio de um arquivo do disco), com a proteção,
  a entropia e os primeiros bytes;
- os **PEs dentro delas** (desempacotados ou injetados), realinhados para o formato de arquivo. Cada
  um vira **amostra filha** e passa pelo YARA, pelo capa, pela emulação e pela configuração como
  qualquer envio;
- as **URLs** da memória privada;
- a **configuração de famílias** nas regiões (as regras e os extratores do CAPE).

**Como pedir:**

- na janela de abertura, a caixa **Capturar a memória da amostra depois de executá-la** (junto com
  a execução automática) agenda a captura para `SANDBOX_MEMDUMP_DELAY_S` (padrão 120 s) depois de a
  amostra rodar;
- com o ambiente no ar, o botão **Capturar memória agora**, no bloco **Memória dos processos da
  amostra**.

O bloco mostra cada dump (processo, tamanho, regiões suspeitas, amostras filhas e URLs) e o link do
`.dmp.gz`. O download fica na auditoria. Tetos: `SANDBOX_MEMDUMP_MAX_MB` (padrão 512 MB por processo;
`0` desliga) e `SANDBOX_MEMDUMP_MAX_PROCESSES` (padrão 4). No teste real, o dump de um processo
pequeno levou cerca de 20 s (11 MB, 4 MB com gzip). O Volatility 3 não lê minidump: a busca das
regiões é a do `malfind`, feita no próprio dump.

### Execução automática da amostra

O ambiente abre pelo botão **"Abrir ambiente isolado"** da barra de ferramentas da amostra (analistas,
arquivo presente, nenhum ambiente ativo). Ele mostra um diálogo com as opções de início e o botão
**"Iniciar ambiente"**, que abre a janela do console e leva à aba Análise; um erro (como o limite de
ambientes) aparece no próprio diálogo. Com um ambiente ativo, o mesmo lugar da barra vira **"Abrir
console"** (no ar) ou **"Ir para o ambiente"** (subindo ou encerrando). O "Abrir novo ambiente" da
janela do console usa o mesmo diálogo, e a própria janela passa a mostrar o ambiente novo. O
diálogo também escolhe a **duração** (de 15 min até `SANDBOX_TTL_MINUTES`, o padrão; o painel ainda
estende) e, com a captura de rede configurada, se **este ambiente** grava o tráfego (marcada por
padrão). A caixa **"Executar a amostra automaticamente"** do diálogo
(lembrada no navegador) pede que o DeepLook rode a amostra sozinho, para uma análise rápida: abrir, esperar e ler os artefatos.
Depois que o Windows sobe e o Sysmon está no ar, a API, pelo `qemu-guest-agent`, copia a amostra do
CD para a pasta temporária do usuário logado e a abre **na sessão dele**, por uma tarefa agendada
interativa: ela aparece no console e nos prints, como se o analista a tivesse aberto. A amostra é
aberta pela associação do Windows; o `.ps1` roda pelo PowerShell e o `.msi` pelo `msiexec`. O painel
mostra o estado (aguardando, executada às HH:MM na sessão de quem, ou a falha com o motivo), e o
histórico da amostra registra a execução e quem a pediu.

- Sem o Sysmon no template, a amostra roda depois de 3 minutos de espera, e o painel avisa que a
  árvore de processos, a rede e o DNS não foram registrados.
- Sem usuário logado na VM, ela roda como SYSTEM e não aparece no console. Para vê-la, configure o
  login automático no template ([guia do Proxmox](docs/proxmox.pt-BR.md#21-template-da-vm-de-análise)).
- Só em VMs Windows. Sem o agente respondendo em 10 minutos, desiste com o motivo.
- Antes de abrir a amostra, o console do usuário vira o clássico (`conhost`) naquela VM descartável
  (o template não muda). No Windows 11, o console de um programa vai para o Windows Terminal, e a
  entrega logo depois da do lançador às vezes se perdia: a amostra ficava parada antes da primeira
  instrução, e o Sysmon só mostrava o ruído do Windows (visto no teste contra o Proxmox real).
- Os artefatos (prints, processos, Sysmon, captura) ficam na seção do ambiente depois que ele
  acaba, também com o arquivo expurgado pela retenção ou com o sandbox desligado.
- Com a amostra ocupando a VM, o agente demora, e o Proxmox desiste em uns 10 s ("got timeout"). As
  leituras (processos, Sysmon, andamento) repetem dentro do prazo delas em vez de perder a coleta;
  o pedido que executa a amostra não repete (rodaria duas vezes), e a falha manda conferir no console.
- A lista de processos de referência sai antes da amostra (uma coleta na hora, se ainda não houver
  nenhuma): "processos que surgiram" compara com ela.

### Limites, TTL e limpeza

- `SANDBOX_MAX_ACTIVE` / `SANDBOX_MAX_PER_USER` limitam quantos ambientes existem.
- `SANDBOX_TTL_MINUTES` define o prazo; o **reaper** roda a cada minuto e encerra o
  que venceu.
- No boot a API marca provisionamentos interrompidos como falha e remove as VMs e ISOs órfãs **que
  ela criou**: cada instalação guarda no banco um identificador, que vai na etiqueta `dl-<id>` das
  VMs (além da `SANDBOX_TAG`) e no nome das ISOs (`deeplook-<id>-*`). Duas instalações no mesmo
  Proxmox não apagam mais os ambientes uma da outra; o que é de outra (ou de antes da marca) fica
  e aparece no log. Um backup restaurado em outro servidor leva o identificador junto.
- `GET /api/sandbox/health` (admin) mostra o diagnóstico: PVE acessível, template,
  storage com `content iso`, usuário do console e limites configurados.

### Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/api/sandbox/health` | Diagnóstico da integração (admin) |
| GET | `/api/entries/:id/hex` | Bytes do arquivo (`offset`, `length` até 4 KB), em base64 (analistas) |
| GET | `/api/entries/:id/hex/search` | Busca no arquivo inteiro (`q`, `kind=text\|bytes`): até 200 posições |
| GET | `/api/entries/:id/sandbox` | Sessão ativa da amostra (usada no painel) |
| POST | `/api/entries/:id/sandbox` | Abre o ambiente (analista); `{"autoRun":true}` executa a amostra sozinho, `minutes` (5 até `SANDBOX_TTL_MINUTES`) dá a duração e `{"capture":false}` desliga a captura de rede |
| GET | `/api/sandbox` | Lista ambientes (`?active=true`, `?scope=all` p/ admin) |
| GET | `/api/sandbox/:id` | Detalhe + estado atual da VM (polling do painel) |
| POST | `/api/sandbox/:id/extend` | Estende o prazo |
| POST | `/api/sandbox/:id/power` | Liga/desliga a VM (`{"action":"on"\|"off"}`) |
| DELETE | `/api/sandbox/:id` | Descarta (destrói a VM e apaga o ISO) |
| GET | `/api/sandbox/:id/console` | Caminho do WebSocket do console |
| GET | `/api/sandbox/:id/console/credentials` | Senha efêmera do console (auth VNC no handshake) |
| GET | `/api/sandbox/:id/console/ws` | WebSocket (proxy autenticado para o PVE) |
| GET | `/api/sandbox/:id/screenshot` | Captura de tela (PNG) — removido no PVE 9; o painel captura no navegador |
| GET | `/api/sandbox/:id/artifacts` | Artefatos do ambiente: prints, processos, Sysmon, tráfego de rede e Suricata |
| GET | `/api/sandbox/:id/artifacts/:artifactId` | Um print guardado (PNG) |
| GET | `/api/sandbox/:id/timeline` | Linha do tempo do Sysmon (`scope=sample\|all`, `kinds`, `page`) e as marcas do ambiente |
| GET | `/api/sandbox/:id/timeline/export` | A linha do tempo inteira para baixar (`format=csv\|json`, `scope`, `kinds`) |
| GET | `/api/sandbox/:id/sigma` | Detecções Sigma da execução (regra, nível, ATT&CK, processo, se é da amostra) |
| POST | `/api/sandbox/:id/sigma/reevaluate` | Avalia de novo, do zero, os eventos da execução |
| GET/POST | `/api/sigma/rules` | Regras Sigma da equipe (lista, com as execuções que dispararam) e criar |
| PATCH/DELETE | `/api/sigma/rules/:id` | Editar, ligar/desligar (`{ enabled }`) e excluir uma regra da equipe |
| POST | `/api/sigma/validate` | Compila o YAML sem salvar |
| POST | `/api/sigma/test` | Testa o YAML numa execução (`sessionId`), sem gravar |
| GET | `/api/sigma/catalog` | Regras da SigmaHQ (`q`, `level`, `state=all\|on\|off`, `page`) |
| PATCH | `/api/sigma/catalog/:ruleId` | Liga ou desliga uma regra da SigmaHQ |
| GET | `/api/sandbox/hunt` | Busca nos eventos de todas as execuções (`field`, `op`, `value`, `kind`, `scope`, `from`, `to`, `offset`) |
| GET | `/api/sandbox/hunt/:sessionId` | Os eventos que casam numa execução (os mesmos filtros e `page`) |
| GET | `/api/sandbox/hunt/export` | O resultado em CSV (até 10 mil eventos) |
| GET | `/api/sandbox/:id/compare/:other` | Diff entre duas execuções da mesma amostra (`scope=sample\|all`) |
| GET | `/api/sandbox/:id/memory` | Dumps de memória da execução (processos, regiões, amostras filhas) |
| POST | `/api/sandbox/:id/memory` | Captura agora a memória dos processos da amostra (ambiente no ar) |
| GET | `/api/sandbox/:id/memory/:dumpId/download` | O `.dmp.gz` (na auditoria) |
| GET | `/api/sandbox/:id/summary` | Resumo da execução: processos da amostra, DNS, conexões, arquivos e registro |
| GET | `/api/entries/:id/sandbox/sessions` | Execuções (ambientes) da amostra, a mais recente primeiro |
| GET | `/api/sandbox/:id/pcap` | Baixa o pcap do ambiente (registrado na auditoria) |

---

## Testes

Precisam só do Docker ligado; sobem o que usam e não mexem na stack em execução.

```bash
cd apps/api
npm run test:unit                   # bibliotecas puras, sem banco nem Docker (menos de 1 s)
npm run test:fuzz                   # fuzzing dos parsers, rodada curta (-- --iterations 40000 para a longa)
npm run test:integration            # API contra Postgres, MinIO e OpenLDAP reais
npm run test:integration -- ldap    # só os arquivos com "ldap" no nome
npm run typecheck:tests             # tipos dos testes (o tsx que os roda não checa tipos)
npm run test:images                 # imagens reais: lockfile, web e API sem root, cabeçalhos, captura
npm run test:smoke                  # navegador real contra as imagens do web e da API

cd ../web
npm run test:unit                   # Vitest: lógica pura, hooks e componentes (jsdom)
npm run test:coverage               # o mesmo, com o piso de cobertura do vitest.config.ts

cd ../netcap
npm test                            # decodificação do TZSP, gravação do pcap e as rotas do serviço

# da raiz do repositório
node scripts/check-playwright-version.mjs   # pacote, imagem e testes na mesma versão do Playwright
node scripts/trivy.mjs image deeplook-api   # CVE numa imagem (o mesmo comando do CI)
node scripts/trivy.mjs sbom deeplook-api sbom/api.cdx.json   # SBOM (CycloneDX) de uma imagem; o CI guarda um por imagem como artefato
```

- **Unitários da API** (`apps/api/tests/unit`, `node:test`): o que não precisa de banco nem de
  MinIO, como CSV, entropia, normalização de indicadores, ZIP (gravador e os dois leitores),
  TLSH, tipo de arquivo, TOTP, CAPTCHA, política de senha, limite de falhas do login e rede
  confiável. Rodam sem Docker; o resto fica com os de integração.
- **Fuzzing dos parsers** (`apps/api/tests/fuzz`): mutação a partir de sementes sobre o que lê
  entrada hostil: a análise estática inteira (PE, ELF, LNK, OLE, PDF, RTF, scripts, imagens de
  disco), o leitor de ZIP, o de e-mail, a limpeza de imagens de evidência, a importação de
  indicadores e o TLSH. Cada caso roda numa thread à parte e reprova por exceção inesperada, por
  passar de 1,5 s (`FUZZ_SLOW_MS`) ou por resultado gigante. O gerador é determinístico
  (`--seed`), o que quebrar é gravado em `tests/fuzz/crashes/` com o comando para repetir, e o
  que já foi corrigido fica em `tests/fuzz/corpus/`, repassado a cada rodada. Usa também os
  executáveis e imagens que os testes de integração geram em `tests/.tmp`, se existirem. Não é
  guiado por cobertura: acha o erro raso em cabeçalhos e tabelas, não o que exige um arquivo
  válido por inteiro.
- **Integração** (`apps/api/tests/integration`): cada arquivo roda num banco novo, com o mesmo app
  da produção (`buildApp()`, em `apps/api/src/app.ts`: todas as rotas, o tratador de erro, o 404, o
  idioma dos erros e a proteção contra pedido de outro site). As imagens
  de disco e os certificados são gerados na hora, em `tests/.tmp`. `--clean` remove os
  containers ao terminar.
  Os executáveis do `pe-analysis` são compilados num Debian (mingw-w64, mcs, upx, osslsigncode)
  com o gabarito do `pefile`, do `dnfile` e do `osslsigncode` (`tests/fixtures/pe/gen.sh`); a
  primeira rodada leva cerca de 40 s a mais, e eles só são refeitos quando as fontes mudam.
- **Teste rápido** (`test:smoke`): com Postgres e MinIO reais, faz o caminho principal (primeiro
  acesso, envio, triagem em massa, usuário comum) e abre as telas. Erro inesperado da API, no
  console ou da CSP reprova. Pega o que a API simulada das telas esconde.
- **Telas** (`scripts/ui-playwright/run-all.sh`, no Windows `run.ps1`): cenários no navegador com a API simulada. Roda
  todos e lista os que falharam.
- **Suíte visual** (`scripts/ui-visual`): compara as telas de layout crítico com capturas
  versionadas. Não olha o comportamento (isso é dos cenários acima), e sim o que a tela
  *parece*: espaço, alinhamento, tabela, tipografia, densidade. 23 telas no desktop (entre elas as
  corrigidas na varredura visual de novembro de 2026), quatro delas também em
  1024 px e seis em 1366x768. Roda na imagem do Playwright, a mesma que gerou as baselines, com
  relógio congelado, sem animação e sem cursor: o resultado não depende da máquina.

```bash
cd apps/web && npm run build        # o dist é o que a suíte serve
sh scripts/ui-visual/run.sh         # compara (no Windows: run.ps1)
sh scripts/ui-visual/run.sh --update-snapshots   # regrava as baselines de propósito
```

  Se uma captura divergir, o `test-results/` traz o `actual`, o `expected` e o `diff`; no CI eles
  sobem como artefato. Mudança de tela intencional atualiza a baseline **no mesmo PR**, e a
  revisão do diff é a revisão da mudança visual.
- **Imagens** (`test:images`): o `web` roda com a configuração **lida do compose** (somente
  leitura, sem capacidades, limites, healthcheck): o teste exercita o que vai para produção.
  Confere os cabeçalhos de segurança no `/`, num asset e numa resposta de erro, o cache, o
  gzip e o 404 de asset que não existe.
- **Web unitário** (Vitest): `api/client.ts`, os módulos de lógica, os hooks e o
  `ErrorBoundary`. O piso de cobertura vale só para os módulos que já têm teste; ao ganhar
  teste, o módulo entra na lista do `vitest.config.ts`.
- **CI** (`.github/workflows`): `ci.yml` roda lint, formatação, build e testes do web e da API,
  os testes do capture (com a conferência do Playwright), os do netcap, a integração, os testes das
  imagens (`images`, em todo PR), a suíte visual (`visual`) e o teste rápido com navegador (`smoke`,
  fora de PR); o `audit` barra vulnerabilidade alta. `security-scan.yml` roda toda segunda o
  **Trivy** nas dez imagens do projeto, nas de terceiros do compose e nos Dockerfiles. Reprova em severidade alta ou
  crítica **com correção disponível**; exceção se justifica em `trivy.yaml`.

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

---

## Créditos

- **Ícones:** os ícones da interface (`apps/web/public/icons`) tiveram origem nos ícones **Silk**, do
  [FamFamFam](http://www.famfamfam.com/lab/icons/silk/), de Mark James, licenciados sob
  [Creative Commons Attribution 2.5](https://creativecommons.org/licenses/by/2.5/). Obrigado!
- **Pacotes de regras YARA:** cada pacote em `apps/api/rules/` mantém a licença dos autores (`LICENSE`
  na pasta do pacote; resumo na seção Regras YARA).
- **AVclass:** a taxonomia e as regras de apelido do [malicialab/avclass](https://github.com/malicialab/avclass),
  sob a licença MIT, convertidas em `apps/api/src/lib/avclass.json`.
- **LOLDrivers e LOLRMM:** as listas do [magicsword-io](https://github.com/magicsword-io), sob a licença
  Apache-2.0, convertidas em `apps/api/src/lib/lol/`.
- **Versões do Visual Studio no Rich header:** a tabela `comp_id.txt` do
  [richprint](https://github.com/dishather/richprint), de dishather, sob a licença BSD-2-Clause, convertida
  em `apps/api/src/lib/rich-products.json`.

## Licença

O DeepLook é distribuído sob a [Licença MIT](LICENSE). Componentes de terceiros mantêm as próprias
licenças: os pacotes de regras YARA e os ícones Silk acima.

## Segurança

Achou uma vulnerabilidade? Relate em sigilo, como descrito no [SECURITY.md](SECURITY.md), e não numa
issue pública.
