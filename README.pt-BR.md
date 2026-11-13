# 🔍 DeepLook

> 🇬🇧 [Read in English](README.md)

Ferramenta self-hosted (homelab) para que amigos e especialistas em segurança
centralizem **amostras de software e links suspeitos** encontrados na web,
com **triagem e relatórios** feitos pelos analistas.
 
Expõe-se à internet via **Cloudflare Tunnel rodando no host (fora do Docker)**.

Créditos especiais ao [Dudu](https://github.com/lluiseduardo-silva) na qual forneceu
meios de validar a aplicação com o Strix. Obrigado ❤️.

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
   │  ┌────────┐  /api   ┌────────┐   SQL   ┌──────────────┐   │
   │  │ web    │────────▶│ api    │────────▶│ db (postgres)│   │
   │  │ nginx  │         │ Fastify│         └──────────────┘   │
   │  │ +React │         │ Prisma │   S3    ┌──────────────┐   │
   │  │ Carbon │         └───┬────┘────────▶│ minio        │   │
   │  └────────┘             │              └──────────────┘   │
   │                         │  clamd :3310 ┌──────────────┐   │
   │                         └─────────────▶│ clamav       │   │
   │                                        └──────────────┘   │
   └───────────────────────────────────────────────────────────┘
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
  PyInstaller), no mesmo isolamento. Ver [Identificar e desempacotar](#identificar-e-desempacotar).
- **oletools**: macros VBA e XLM 4.0, DDE e objetos de RTF dos documentos do Office, no mesmo
  isolamento. Ver [Documentos do Office (oletools)](#documentos-do-office-oletools).
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
# edite o .env, principalmente: POSTGRES_PASSWORD, SESSION_SECRET, CAPTURE_TOKEN, CAPA_TOKEN,
# GHIDRA_TOKEN, UNPACK_TOKEN, OLETOOLS_TOKEN, DATA_KEY, ADMIN_PASSWORD, MINIO_ROOT_PASSWORD e
# S3_SECRET_KEY
# (com SESSION_SECRET, um dos tokens ou a senha do banco ou do MinIO no valor padrão, a API não sobe)

# 2) Suba tudo
docker compose build
docker compose up
```

Acesse: **http://localhost:8080**

> **Para abrir a outras pessoas** (homelab, piloto): siga o
> [checklist de implantação](docs/implantacao.pt-BR.md), que cobre Cloudflare Access, a VPN da captura,
> o backup fora do disco restaurado uma vez e o monitoramento.

> Dica: rode em segundo plano com `docker compose up -d` e veja os logs com
> `docker compose logs -f`.

> **Atualizando uma instalação anterior à rede confiável:** a rede `deeplook` ganhou uma
> sub-rede fixa, e o Docker não altera uma rede que já existe. Rode `docker compose down` antes
> do `docker compose up -d --build` (os dados ficam em `./data`, nada se perde). A migração
> troca o id das sessões pelo hash sem derrubar ninguém.

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
- **Assinatura Authenticode**: quem assinou, quem emitiu, validade, impressão digital, carimbo
  de tempo e a cadeia que veio no arquivo. A situação diz se o arquivo foi **alterado depois de
  assinado** e se a assinatura confere com o certificado. A cadeia **não** é conferida contra
  as raízes confiáveis do Windows (a API não as tem): "íntegra" quer dizer íntegra, não
  confiável.
- **Recursos** (tipo, idioma, tamanho, entropia e o que há dentro), **informações de versão**
  (empresa, nome original...), **manifesto**, **exports** (com encaminhamentos), **TLS
  callbacks**, **dados anexados** (overlay, fora a assinatura) e **checksum**.
- **.NET**: runtime, assembly, referências, as funções nativas chamadas por **P/Invoke**,
  chamadas sensíveis (`Assembly.Load`, `WebClient`, `Process.Start`...) e marcas de ofuscador.
- O **UPX** é reconhecido também pelo código de entrada, com as seções renomeadas.

As amostras enviadas antes ganham a análise nova em segundo plano, uma de cada vez, depois que
a API sobe; um analista também pode pedir **Analisar de novo** na ficha. A comparação de
amostras (A × B) mostra imphash, Rich header e quem assinou.

## Análise de funções (capa e FLOSS)

Cada executável do Windows ou do Linux enviado (até `CAPA_MAX_MB`, 32 MB) entra numa fila, e o
serviço `capa` o analisa em segundo plano, um por vez. Nada é executado: as duas ferramentas da
Mandiant leem e emulam o código.

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
  "tempo esgotado".
- **Isolamento:** contêiner sem rede nenhuma (rede interna `analysis`, só com a API), sem root,
  sem capacidades, raiz somente leitura e `/tmp` em memória sem execução. Como a captura, um
  **contêiner novo a cada análise**: a API espera o novo estar livre antes de mandar o próximo
  arquivo. Serviço fora do ar: a análise volta para a fila e tenta de novo (até 3 vezes).
- **Status do sistema:** linha "Análise de funções (capa)" com as versões, a fila e as análises
  em 24 h.
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
- o **projeto `.gzf`**, para abrir no Ghidra local já analisado.

Detalhes:

- **Só executáveis do Windows e do Linux**, até `GHIDRA_MAX_MB`. **.NET fica de fora**: o Ghidra não
  descompila o código intermediário (IL), e o resultado seria só o stub do CLR.
- **Tempo:** de 12 a 20 s nos executáveis de teste (o Java sobe a cada análise). Num executável
  grande, a análise automática para em 70% de `GHIDRA_TIMEOUT_S` e o resumo ainda sai, parcial.
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
  executáveis de teste).
- **Desligar:** `GHIDRA_URL=` (vazio) no `.env`; o serviço `ghidra` pode sair do compose.

## Regras YARA

### Pacotes de regras

O DeepLook já vem com regras de fontes confiáveis, em `apps/api/rules`, sem baixar nada ao subir:

| Pacote | Autor | Licença | Situação |
|---|---|---|---|
| ReversingLabs (310 conjuntos) | ReversingLabs | MIT | ligado |
| bartblaze (89, sem a pasta `generic`) | bartblaze | MIT | ligado |
| signature-base (752) | Florian Roth (Neo23x0) | DRL 1.1 | desligado |

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
- **Versão de fábrica:** `node scripts/vendor-yara-packs.mjs <pasta com os clones>` atualiza a cópia em
  `apps/api/rules`, usada só nas instalações novas.
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

## Identificar e desempacotar

Todo executável que chega (Windows, Linux, macOS, APK e JAR, até `UNPACK_MAX_MB`) passa pelo
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
| PyInstaller | pyinstxtractor 2026.07 | só o script do autor (`.pyc`), sem a biblioteca padrão nem o bootstrap |
| Inno Setup | innoextract 1.9 | os arquivos do instalador (formato até o Inno Setup 6.2) |
| NSIS | 7-Zip 25 | os arquivos e o script do instalador (`[NSIS].nsi`) |
| Arquivo embutido | 7-Zip 25 | o que há no ZIP, 7z, RAR ou CAB anexado ao executável |

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
| Domínio parecido | imita um domínio da empresa | +35 |
| Tipo do arquivo | executável ou script disfarçado com outra extensão | +30 |
| Atalho | `.lnk` com alertas | +25 |
| Executável | alertas altos · médios | +12 cada (teto 30) · +4 cada (teto 12) |
| Assinatura | não confere · válida | +20 · −15 |
| Análise de funções | grupos de capacidades de risco do capa · indicadores em strings ofuscadas | +6 por grupo (teto 30) · +10 |
| Empacotamento | empacotado ou protegido | +10 |

- **Sugestão:** a partir de 70, *Malicioso*; de 35 a 69, *Suspeito*; abaixo disso, nenhuma.
- **Nunca sugere "limpo":** a nota só soma evidência de que a amostra é ruim. Nota baixa quer dizer
  que nada foi detectado, não que a amostra é segura, e a tela diz isso.
- **Cada origem tem teto**, para vinte alertas da mesma análise não valerem mais do que um
  antivírus e uma regra YARA juntos. A reputação conta uma vez, pelo pior veredito.
- **Análises em andamento** aparecem no aviso, e a nota se atualiza sozinha quando terminam.
- Os pesos são fixos (`apps/api/src/lib/risk-score.ts`). Para agir sobre os mesmos sinais de forma
  automática (tags, prioridade), use as **regras de triagem** acima.

---

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
| `BACKUP_DIR` | pasta do host onde o ZIP do backup é gravado (disco externo, NAS); precisa ser gravável pelo uid 1000 e ter o arquivo `.deeplook-backups`. Vazio: o ZIP fica no bucket, no mesmo disco dos dados | — |
| `INTEGRITY_SCRUB_INTERVAL_MINUTES` | de quantos em quantos minutos o servidor confere o SHA-256 dos arquivos guardados; `0` desliga | `60` |
| `INTEGRITY_SCRUB_MAX_MB` | quanto ler por rodada da conferência periódica (um arquivo maior que isso ainda é conferido, sozinho) | `512` |
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
| `CAPA_REQUEST_TIMEOUT_S` | quanto a API espera uma análise (acima da soma dos dois) | `1000` |
| `CAPA_MEM_LIMIT` | memória do contêiner `capa` | `3g` |
| `CAPA_RECYCLE` | um container novo a cada análise; `false` = processo de longa vida | `true` |
| `GHIDRA_URL` | serviço do Ghidra (sob demanda); vazio desliga | `http://ghidra:3300` |
| `GHIDRA_TOKEN` | token compartilhado entre a API e o serviço `ghidra` (16+ caracteres) | — |
| `GHIDRA_MAX_MB` | executáveis maiores não vão para o Ghidra | `32` |
| `GHIDRA_TIMEOUT_S` | teto da análise no serviço (a análise automática para em 70% dele e o resumo ainda sai) | `900` |
| `GHIDRA_REQUEST_TIMEOUT_S` | quanto a API espera uma análise | `1300` |
| `GHIDRA_HEADLESS_MAXMEM` / `GHIDRA_MEM_LIMIT` | heap do Java e memória do contêiner | `3G` / `6g` |
| `GHIDRA_RECYCLE` | um container novo a cada análise; `false` = processo de longa vida | `true` |
| `UNPACK_URL` | serviço de desempacotamento; vazio desliga | `http://unpack:3400` |
| `UNPACK_TOKEN` | token compartilhado entre a API e o serviço `unpack` (16+ caracteres) | — |
| `UNPACK_MAX_MB` | executáveis maiores não vão para o desempacotador | `64` |
| `UNPACK_TIMEOUT_S` | tempo máximo de um desempacotador, no serviço | `180` |
| `UNPACK_MAX_FILES` / `UNPACK_MAX_TOTAL_MB` | quantos arquivos (de 1 a 100, o máximo que a API aceita numa resposta; fora disso o serviço ajusta e avisa no log) e quantos MB somados saem de uma amostra | `50` / `256` |
| `UNPACK_MEM_LIMIT` / `UNPACK_RECYCLE` | memória do contêiner; um container novo a cada trabalho | `2g` / `true` |
| `OLETOOLS_URL` | serviço de análise de documentos (oletools); vazio desliga | `http://oletools:3500` |
| `OLETOOLS_TOKEN` | token compartilhado entre a API e o serviço `oletools` (16+ caracteres) | — |
| `OLETOOLS_MAX_MB` | documentos maiores não vão para o oletools | `32` |
| `OLETOOLS_TIMEOUT_S` / `OLETOOLS_MEM_LIMIT` | teto de uma análise e memória do contêiner | `120` / `1g` |
| `CAPTURE_RECYCLE` | um container novo a cada captura; `false` volta ao processo de longa vida, que atende capturas em fila sem trocar | `true` |
| `CAPTURE_CHROMIUM_SANDBOX` | sandbox do próprio Chromium na captura; `false` só como saída de emergência num host sem user namespaces | `true` |
| `CLAMAV_IMAGE` | imagem do contêiner do ClamAV, fixada por tag e digest (como a do Postgres; `node scripts/pin-images.mjs` confere e `--write` atualiza) | `clamav/clamav:1.5@sha256:…` |
| `COOKIE_SECURE` | `true` quando servir somente via HTTPS; o cookie da sessão passa a ser `__Host-dl_session` (quem estava logado entra de novo uma vez) | `false` |
| `CAPTURE_EGRESS_SUBNET` | Sub-rede fixa da rede de saída da captura (`capture-egress`), para o host mandá-la por uma VPN com roteamento por origem (`docs/implantacao.pt-BR.md`, passo 3). Mudar exige `docker compose down` antes do `up` | `172.31.252.0/24` |
| `DEEPLOOK_SUBNET` | Sub-rede fixa da rede interna `deeplook`, a única de onde a API aceita conexão e o IP do cliente (vira o `TRUSTED_NETWORK` da API). Troque só se colidir com outra rede do host, e rode `docker compose down` antes do `up` para recriar a rede | `172.31.250.0/24` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Admin semeado no primeiro boot; troca a senha no primeiro acesso. Com a senha padrão, o login dele é recusado em produção | — |
| `ALLOW_INSECURE_DEFAULTS` | `true`: sobe mesmo com `SESSION_SECRET`/`CAPTURE_TOKEN`/`CAPA_TOKEN`/`GHIDRA_TOKEN`/`UNPACK_TOKEN`/`OLETOOLS_TOKEN` padrão, com a senha padrão do banco ou do MinIO, e aceita o login com a senha padrão do admin (só para demonstração local) | `false` |
| `MAX_UPLOAD_MB` | Tamanho máximo de upload | `200` |
| `MAX_UPLOAD_MEMORY_MB` | soma dos envios em análise na memória. O envio vai para o disco enquanto chega e só entra na memória depois de inteiro; sem espaço, espera a vez por até 30 s e então responde 503 "tente de novo em instantes" | `600` |
| `MAX_UPLOAD_SPOOL_MB` | soma dos envios que estão chegando, em disco (`/tmp` da API); acima, 503. Cada pessoa ocupa no máximo metade (além disso, 429) | `2048` |
| `API_MEM_LIMIT` | limite de memória do container da API | `4g` |
| `API_PIDS_LIMIT` | limite de processos e threads da API (pico medido: 32, com amostra e backup) | `256` |
| `WEB_MEM_LIMIT` | limite de memória do container do web (nginx) | `256m` |
| `LOG_MAX_SIZE` · `LOG_MAX_FILE` | rotação dos logs do Docker, em todos os serviços: tamanho de cada arquivo e quantos ficam | `10m` · `3` |
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
├─ README.md          # English (principal)
├─ README.pt-BR.md    # Português (pt-BR)
├─ .github/           # CI (ci.yml), varredura de CVE das imagens (security-scan.yml) e Dependabot
├─ apps/
│  ├─ api/            # Fastify + Prisma + S3 (MinIO)
│  │  ├─ prisma/      # schema, migrações, seed (configuração em prisma.config.ts)
│  │  ├─ rules/       # pacotes de regras YARA de fábrica
│  │  ├─ tests/       # integração (Postgres, MinIO e OpenLDAP reais)
│  │  └─ src/         # env, lib, routes (generated/prisma: cliente gerado, fora do git)
│  ├─ capa/           # capa e FLOSS (Python) para a análise de funções, sem rede
│  ├─ ghidra/         # Ghidra headless (Java 25), scripts de exportação e o servidor, sem rede
│  ├─ unpack/         # Detect It Easy e os desempacotadores (um plugin por arquivo em unpackers/)
│  ├─ oletools/       # olevba, MacroRaptor, msodde, oleid e rtfobj (analyze.py num processo filho)
│  ├─ capture/        # navegador isolado que captura a página de um link, e o egress
│  └─ web/            # React + Vite + @carbon/react
│     ├─ nginx.conf   # servidor do build e proxy de /api (a configuração real)
│     ├─ vitest.config.ts # testes unitários e piso de cobertura
│     └─ src/         # api, auth, components, pages, styles
├─ docs/              # guias (EN: *.md; pt-BR: *.pt-BR.md): implantacao, interface-hpsm, ux-backlog, plano-melhorias, proxmox, revisao-2026-11, plano-2026-11
├─ icons/             # biblioteca de ícones (estilo HPSM)
├─ scripts/           # testes visuais (ui-playwright/), Trivy (trivy.mjs) e conferência do Playwright
├─ trivy.yaml         # severidade, exceções justificadas e o que reprova o scan de imagens
└─ data/              # volumes (git-ignored): pgdata/, minio/, clamav/
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
- O `web`, a API, o capture e o egress rodam **sem root e sem capacidades**, com o sistema de
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
- **Continua em português:** o que a API grava como dado e mostra como está (alertas da análise
  estática, achados de script, motivos da pontuação de risco, detalhes do histórico e do status do
  sistema), o CSV da auditoria, a especificação OpenAPI e o que as pessoas escrevem.
- `node scripts/check-i18n.mjs` conta o texto em português que ainda está solto no código e reprova
  `t()` no topo do módulo ou dentro de `useMemo` sem `locale` nas dependências (o texto não
  acompanharia a troca de idioma). Tabelas de rótulos no topo do módulo usam `localized()`.

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

Componentes, convenções (o que usar e o que evitar do Carbon), rotas, preferências do
usuário e a verificação visual estão em
**[`docs/interface-hpsm.pt-BR.md`](docs/interface-hpsm.pt-BR.md)**. Ideias de UX priorizadas:
**[`docs/ux-backlog.pt-BR.md`](docs/ux-backlog.pt-BR.md)**.

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
- **Tráfego de rede (pcap):** ainda não. A VM sai pela rede isolada atrás do Mikrotik CHR, e a
  captura deve sair dele.

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

# da raiz do repositório
node scripts/check-playwright-version.mjs   # pacote, imagem e testes na mesma versão do Playwright
node scripts/trivy.mjs image deeplook-api   # CVE numa imagem (o mesmo comando do CI)
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
- **Integração** (`apps/api/tests/integration`): cada arquivo roda num banco novo. As imagens
  de disco e os certificados são gerados na hora, em `tests/.tmp`. `--clean` remove os
  containers ao terminar.
  Os executáveis do `pe-analysis` são compilados num Debian (mingw-w64, mcs, upx, osslsigncode)
  com o gabarito do `pefile`, do `dnfile` e do `osslsigncode` (`tests/fixtures/pe/gen.sh`); a
  primeira rodada leva cerca de 40 s a mais, e eles só são refeitos quando as fontes mudam.
- **Teste rápido** (`test:smoke`): com Postgres e MinIO reais, faz o caminho principal (primeiro
  acesso, envio, triagem em massa, usuário comum) e abre as telas. Erro inesperado da API, no
  console ou da CSP reprova. Pega o que a API simulada das telas esconde.
- **Telas** (`scripts/ui-playwright/run.ps1`): cenários no navegador com a API simulada. Roda
  todos e lista os que falharam.
- **Suíte visual** (`scripts/ui-visual`): compara as telas de layout crítico com capturas
  versionadas. Não olha o comportamento (isso é dos cenários acima), e sim o que a tela
  *parece*: espaço, alinhamento, tabela, tipografia, densidade. Dez telas no desktop e quatro
  delas também em 1024 px. Roda na imagem do Playwright, a mesma que gerou as baselines, com
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
  os testes do capture (com a conferência do Playwright), a integração, os testes das imagens
  (`images`, em todo PR) e o teste rápido com navegador (`smoke`, fora de PR); o `audit` barra
  vulnerabilidade alta. `security-scan.yml` roda toda segunda o **Trivy** nas três imagens do
  projeto, nas de terceiros do compose e nos Dockerfiles. Reprova em severidade alta ou
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

Detalhes em [`docs/interface-hpsm.pt-BR.md`](docs/interface-hpsm.pt-BR.md#7-verificação-visual-playwright).

---

## Roadmap (próximos passos)

Melhorias de interface e usabilidade estão priorizadas em
[`docs/ux-backlog.pt-BR.md`](docs/ux-backlog.pt-BR.md). Outros próximos passos:

- Notificações por e-mail (SMTP).

Já entregues a partir desta lista: ClamAV e reputação externa (VirusTotal e outros),
envio em lote, exportação de relatórios (Markdown; PDF pela ficha impressa), 2FA
opcional, política de senha, a pasta de backup fora do disco (`BACKUP_DIR`) e o backup
agendado.

---

## Créditos

- **Ícones:** a pasta [`icons/`](icons/) teve origem nos ícones **Silk**, do
  [FamFamFam](http://www.famfamfam.com/lab/icons/silk/), de Mark James, licenciados sob
  [Creative Commons Attribution 2.5](https://creativecommons.org/licenses/by/2.5/). Obrigado!
