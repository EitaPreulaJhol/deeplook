# 🔎 Revisão de novembro de 2026: achados, correções e sugestões

> 🇺🇸 [Read in English](revisao-2026-11.md)

Revisão do projeto inteiro atrás de problemas e falhas, feita em 12/11/2026, com a lista do que
valeria adicionar. O código foi lido por amostragem nas áreas de maior risco (autenticação, rede,
upload, sandbox, serviços isolados e compose), não linha a linha.

Status: ✅ corrigido · ⬜ pendente · ❓ depende de decisão do dono.

## 1. O que foi rodado

| Checagem | Resultado |
|---|---|
| `tsc`, ESLint e Prettier (API e web), tipos dos testes | limpos |
| Testes unitários do web (Vitest) | 120 passaram |
| Testes do `capture` | 13 passaram |
| Integração da API no Docker (Postgres, MinIO, OpenLDAP, capa, Ghidra, unpack) | 1478 checagens em 41 arquivos, tudo ok |
| `docker compose config` | válido |
| `npm audit` | `capture` com 0; API e web com 10 moderadas cada, todas na cadeia do `typescript-eslint` (só desenvolvimento) |

Não foram rodados: `test:images`, `test:smoke` e a suíte visual do Playwright.

Depois das correções: `tsc`, ESLint, Prettier e `typecheck:tests` limpos na API, os 13 testes do
`capture` e os arquivos de integração afetados (`console-access`, `login-security` e `unpack`,
71 checagens) verdes. A bateria inteira não foi repetida depois das correções.

## 2. Achados e correções

Nenhuma falha grave. Com exceção do 2.2, os achados vêm de leitura do código, sem reprodução
antes da correção.

### 2.1 Console do sandbox derrubava a API com o banco fora — ✅

Em `apps/api/src/routes/sandbox.ts`, o WebSocket do console rodava numa função assíncrona sem
`catch`, com o `loadUser` e o `getSession` fora de qualquer `try`. Com o Postgres reiniciando, a
promessa rejeitava sem tratamento e o Node encerrava o processo. É a mesma classe do item 8.1 do
[plano de melhorias](plano-melhorias.pt-BR.md); este ponto tinha ficado de fora.

**Correção:** `catch` na função, que registra o erro e fecha o console com `erro interno`.
**Teste:** `console-access.test.ts`, com o `findUnique` da sessão rejeitando: o console fecha com
esse motivo e não há rejeição sem tratamento.

### 2.2 `.env` legível por qualquer usuário da máquina — ✅

O arquivo estava com permissão 644; o `docs/implantacao.pt-BR.md` pede 600. **Correção:**
`chmod 600 .env`. É da máquina, não do Git: quem clonar de novo repete o passo.

### 2.3 CI, Dependabot e Trivy não rodam — ❓

O repositório não tem remoto (item 8.9 do plano, já pendente). Enquanto isso, as 10 moderadas do
`npm audit` e as CVEs de imagem não geram aviso. Falta só o endereço do remoto.

### 2.4 Tempos de espera da API fora do compose — ✅

`CAPA_REQUEST_TIMEOUT_S`, `GHIDRA_REQUEST_TIMEOUT_S`, `UNPACK_REQUEST_TIMEOUT_S` e
`BACKUP_PG_DUMP` existiam no `env.ts`, mas o `docker-compose.yml` não os repassava: quem
aumentasse `CAPA_TIMEOUT_S` ou `GHIDRA_TIMEOUT_S` no `.env` via a API desistir antes do serviço.

**Correção:** as quatro variáveis entraram no compose, com os mesmos padrões do `env.ts`, e as
três de espera no `.env.example`, junto de `ALLOW_INSECURE_DEFAULTS` e `CLAMAV_IMAGE`, que também
faltavam ali.

### 2.5 nginx aceita `CF-Connecting-IP` de qualquer endereço privado — ✅

Em `apps/web/nginx.conf`, o `set_real_ip_from` cobre todas as faixas privadas. Outro container da
rede, ou um proxy reverso local que repasse o cabeçalho do cliente, permite forjar o IP, o que
fura os limites de login por IP e suja a auditoria.

**Correção (fase 0.1):** o `cloudflared` roda no host e chega pela porta publicada; medido, o
nginx o vê como o gateway da rede `deeplook`. O cabeçalho passou a valer só desse endereço
(`REAL_IP_FROM`, padrão `172.31.250.1`) e do loopback. O `nginx.conf` virou um modelo que o
entrypoint da imagem preenche e grava em `/tmp` (a raiz é somente leitura). **Teste:** no
`test:images`, o cabeçalho forjado de outro container é ignorado e o caminho do túnel segue valendo.

### 2.6 Console aberto não era revalidado — ✅

O WebSocket só conferia a sessão ao conectar: sair, expirar por inatividade ou perder o papel não
fechava um console já aberto. O buffer das mensagens que chegam antes de o Proxmox responder
também não tinha teto (mensagens de até 16 MB cada).

**Correção:** a cada 30 s, no mesmo tique do ping, a API confere se a sessão do cookie continua
válida e se a pessoa ainda pode operar o ambiente; se não, fecha com `sessão encerrada`. Falha do
banco nessa conferência não fecha o console: ela se repete no tique seguinte. O buffer ganhou teto
de 1 MB. **Sem teste automático:** a revalidação depende de um console aberto contra o Proxmox.

### 2.7 Memória do limitador de login sem limpeza — ✅

O `FailureWindow` (`apps/api/src/lib/rate-limit.ts`) só removia uma chave quando ela era
consultada de novo: e-mails aleatórios, tentados uma vez, ficavam para sempre.

**Correção:** acima de 5.000 chaves, cada falha nova varre as janelas vencidas. **Teste:** em
`console-access.test.ts`, 6.000 chaves vencidas somem na falha seguinte.

### 2.8 Serviço `unpack`: link quebrado e nome vindo da amostra — ✅

- Em `apps/unpack/server.py`, o `os.path.getsize` vinha antes do teste de link simbólico: um link
  quebrado na extração fazia o trabalho inteiro falhar. **Correção:** o teste vem antes.
- Em `unpackers/u20_pyinstaller.py`, o nome do ponto de entrada vem do índice da amostra e era
  juntado ao caminho sem conferência. **Correção:** o caminho resolvido precisa ficar dentro da
  pasta extraída, e o `server.py` passou a recusar, para qualquer desempacotador, arquivo fora da
  pasta de saída. O impacto era baixo: container descartável, sem rede e somente leitura.

### 2.9 Endurecimento menor

| Item | Status |
|---|---|
| Token do `capture` comparado com `!==`; agora em tempo constante, como nos serviços em Python | ✅ |
| `PROXMOX_VERIFY_TLS` vem `false` por padrão: mudar o padrão quebraria quem usa certificado autoassinado | ❓ |
| Imagens base dos Dockerfiles por tag, não por digest (as do compose estão fixadas); o Dependabot cuidaria disso, com o remoto | ⬜ |
| CSP com `connect-src ws: wss:` aberto para qualquer host: trocado por `'self'` (fase 0.2). O teste rápido com navegador abre o WebSocket do console pelo nginx e confere que a CSP não o barra. Só em Chromium: o Safari fica para conferência manual | ✅ |
| `pe-ordinals.json` duplicado em `apps/api` e `apps/ghidra`: `scripts/check-pe-ordinals.mjs` reprova a divergência no CI (fase 0.3) | ✅ |

### 2.10 `SESSION_SECRET` é a raiz de tudo — ✅

Ele assina os cookies e o CAPTCHA e cifra os segredos do 2FA: trocá-lo quebra o 2FA de todas as
contas. Não era defeito, era desenho. **Resolvido na fase 1.1:** com `DATA_KEY` no `.env`, o 2FA
depende só dela, e o `SESSION_SECRET` pode ser trocado.

## 3. Sugestões de adição (a validar)

Nada daqui foi iniciado. E-mail e webhooks ficaram de fora: o plano os marca como fora de escopo.

### 3.1 Operação e segurança

- [ ] Repositório num remoto privado (item 8.9): liga CI, Dependabot e Trivy de uma vez.
- [ ] Script de restauração com teste automático; hoje restaurar é um passo a passo manual.
- [ ] Chave de dados separada do `SESSION_SECRET`, com versão, para rotação sem quebrar o 2FA.
- [ ] Métricas Prometheus (item 3.1 do plano, pendente).
- [ ] Envio da auditoria para syslog/SIEM.
- [ ] Auditoria com encadeamento de hash, para evidenciar adulteração.
- [ ] SBOM e assinatura das imagens.
- [ ] Login por OIDC/SSO.
- [ ] Passkeys (WebAuthn) como segundo fator.

### 3.2 Análise

- [ ] Itens já planejados, na ordem sugerida: 7.5 (pontuação de risco explicável) e 7.14
      (Office/PDF com oletools) primeiro, pelo retorno por esforço.
- [ ] Sandbox: coleta automática de artefatos da VM (pcap, lista de processos, capturas de tela
      periódicas).
- [ ] Links: enriquecimento com WHOIS, DNS passivo e Certificate Transparency.
- [ ] Links: hash perceptual das capturas de tela, para agrupar kits de phishing.
- [ ] Importação e exportação de pacote STIX por caso.
- [ ] Envio ativo de indicadores para o MISP.

### 3.3 Qualidade

- [ ] Fuzzing dos parsers (PE, ELF, LNK, documentos, ZIP, EML), que leem entrada hostil.
- [ ] Testes unitários das bibliotecas da API; hoje só há integração.
- [ ] Mais cobertura no web: os 95% contam só os módulos que já têm teste.
- [ ] Upload em streaming direto para o S3 com hash em trânsito, em vez de montar o arquivo em
      memória.
- [ ] Interface em inglês (i18n), já que a documentação tem versão en-US.

## 4. Próximos passos

1. Decidir os três itens ❓: remoto (2.3), faixa do `CF-Connecting-IP` (2.5) e padrão do
   `PROXMOX_VERIFY_TLS` (2.9).
2. Validar quais sugestões da seção 3 entram, e em que ordem.
3. Rodar `test:images`, `test:smoke` e a bateria de integração inteira antes de publicar as
   correções desta revisão.

## 5. Plano de ação

Decidido em 12/11/2026 pelo dono: entram a faixa do `CF-Connecting-IP` (2.5), o CSP e o
`pe-ordinals.json` (2.9), três itens da 3.1 (restauração, chave de dados, auditoria encadeada) e
todas as sugestões da 3.2 e da 3.3. Ficam de fora, por ora: remoto, métricas, syslog/SIEM, SBOM,
OIDC e passkeys.

Como trabalhar: um item por commit, direto na `main`; cada um só fecha com lint, tipos e os testes
afetados verdes, e com o status atualizado nesta anotação. A bateria inteira (integração,
`test:images`, `test:smoke`) roda no fim de cada fase. Tamanhos: **P** até meio dia, **M** 1–2
dias, **G** vários dias.

### Fase 0 — Fechar a revisão — ✅

Feita em 12/11/2026 (commits `ed36f2d` e `498104a`). O segundo corrige o primeiro: ao separar os
commits por trecho, o bloco do `REAL_IP_FROM` foi parar algumas linhas fora do lugar no
`docker-compose.yml` e no `.env.example`. A pasta de trabalho, contra a qual os testes rodaram,
estava certa; os commits `ed36f2d`, `fffa85d` e `b9dd294` não devem ser usados sozinhos.

| # | Item | Como | Tam. |
|---|---|---|---|
| 0.1 | Faixa do `CF-Connecting-IP` (2.5) | O `cloudflared` roda no host, fora de container, e chega pela porta publicada em `127.0.0.1`; o nginx deve vê-lo como o gateway da rede `deeplook`. Medir o endereço de verdade antes de fechar, e confiar só nele (e no loopback), com uma variável para quem publicar de outro jeito. A raiz do `web` é somente leitura: a configuração gerada vai para o `/tmp`. Teste no `test:images`: cabeçalho forjado de outro container é ignorado. | P |
| 0.2 | CSP `connect-src 'self'` (2.9) | Trocar `ws: wss:` por `'self'` e validar o console do sandbox pelo nginx (modo simulado, `scripts/ws-console-check.mjs` e o teste rápido com navegador). Limite: aqui só há Chromium; o Safari fica para conferência manual. | P |
| 0.3 | `pe-ordinals.json` (2.9) | Manter as duas cópias (cada Dockerfile só enxerga a própria pasta) e reprovar a divergência com um script de conferência no CI, no molde dos `scripts/check-*.mjs`. | P |

### Fase 1 — Operação e segurança — ✅

Feita em 12/11/2026: 1.1 no commit `fffa85d`, 1.2 no `b9dd294` e 1.3 no seguinte. Diferenças
para o planejado:

- **1.1:** além do `v2`, o dado cifrado leva o id da chave, e existe `DATA_KEY_PREVIOUS` para
  trocar o próprio `DATA_KEY`. Sem `DATA_KEY`, nada muda (modo antigo).
- **1.2:** o restaurador roda na imagem da API (`scripts/restore.sh` chama
  `docker compose run`), com `--check`, `--rehearsal` e a restauração de verdade. O script em si
  só teve a sintaxe conferida: o caminho pelo compose não foi exercitado numa instalação no ar.
  O ensaio roda na imagem de produção dentro do `test:images`.
- **1.3:** além do planejado, o evento guarda o id de quem fez e do alvo fora da chave
  estrangeira (entra no hash e sobrevive à conta apagada), a aba Auditoria mostra o estado da
  cadeia, e a restauração confere a cadeia do banco restaurado contra a ponta do manifesto.

| # | Item | Como | Tam. |
|---|---|---|---|
| 1.1 | Chave de dados separada | `DATA_KEY` no `.env`, com versão no dado cifrado (`v2`). Os segredos do 2FA em `v1` (derivados do `SESSION_SECRET`) continuam legíveis e são recifrados na subida. Cookies e CAPTCHA seguem no `SESSION_SECRET`, que passa a poder ser trocado sem quebrar o 2FA. Status do sistema avisa se faltar a chave. | M |
| 1.2 | Script de restauração | `scripts/restore.mjs`: recebe o ZIP e a senha, confere o manifesto (SHA-256 de cada arquivo), restaura o banco com `pg_restore` e devolve os objetos ao bucket; modo de ensaio que restaura num banco e bucket à parte. Teste automático: backup, restauração e comparação de contagens e hashes. Vem depois do 1.1 porque o restaurado depende das mesmas chaves, e o LEIA-ME do backup passa a dizer isso. | M |
| 1.3 | Auditoria com encadeamento de hash | Número de sequência, hash anterior e hash próprio em cada evento, gravados sob trava para a ordem ser única; o hash cobre só os campos que não mudam (o ator apagado vira nulo hoje). Migração que encadeia o histórico, conferência periódica com aviso no status do sistema e a ponta da cadeia no manifesto do backup. Limite a registrar: evidencia edição e remoção de linhas, não uma reescrita completa por quem controla o banco e os backups. | M |

### Fase 2 — Qualidade — em andamento

- **2.1 ✅** (commit `d8b708d`): 52 testes unitários em `apps/api/tests/unit`, com `node:test`,
  em menos de um segundo e sem Docker; passo próprio no CI.
- **2.2 ✅**: fuzzer em `apps/api/tests/fuzz` (`npm run test:fuzz`), com sete alvos, rodada curta
  no CI e corpus de regressão. **Achado e corrigido:** um arquivo OLE de 1,5 KB com a FAT em laço
  custava cerca de 1 s de CPU e 100 MB por cadeia lida no `doc-analysis.ts` (200 mil voltas);
  agora a leitura não repete setor nem passa do tamanho do arquivo, e o caso leva 1 ms. Depois
  da correção, 280 mil casos em duas sementes sem achado. Limite: o fuzzer não é guiado por
  cobertura; o alvo do ZIP, por exemplo, rejeita cedo quase todas as mutações.
- **2.3 ✅**: o envio vai para o disco (`/tmp` da API) enquanto chega, com SHA-256 e tamanho
  calculados em trânsito, e só entra na memória depois de inteiro, com a reserva feita pelo
  tamanho real. **O que muda na prática:** antes a memória era reservada ao começar, pelo tamanho
  declarado, e ficava presa enquanto o corpo chegava: três envios lentos de 200 MB deixavam todo
  mundo recebendo 503. Agora o que está chegando ocupa disco (`MAX_UPLOAD_SPOOL_MB`), cada pessoa
  ocupa no máximo metade dele, e quem já enviou tudo espera a vez da memória por até 30 s em vez
  de ser mandado enviar de novo. **Diferença para o planejado:** a análise continua lendo o
  arquivo inteiro para a memória (os parsers trabalham sobre um Buffer), e o MinIO recebe a partir
  dela; "streaming direto para o S3" não foi feito. **Regressão pega pela bateria e corrigida
  antes do commit:** a primeira versão limitava a 4 envios simultâneos por pessoa, o que quebrava
  o lote de 30 arquivos; o limite passou a ser por espaço em disco.
- **2.4 ✅**: testes para os módulos de lógica do web que não tinham (política de senha, página
  inicial, sequência Anterior/Próxima, estados e contadores do sandbox, favoritos, exportação de
  amostra e de caso, base de conhecimento, visões da equipe, "pegar a próxima"): de 120 para 175
  testes. **Diferença para o planejado:** o piso de cobertura passou a contar toda a lógica fora
  de componente (os `.ts` de `api`, `auth` e `components`), e não todos os módulos: as telas
  (`.tsx`) continuam com os cenários do Playwright. Medido: 87,3% das instruções; piso em 84%.
- **2.5:** pendente (fica para depois da fase 3).

Vem antes das funcionalidades de análise porque os testes e o fuzzing protegem o que a fase 3 mexe.

| # | Item | Como | Tam. |
|---|---|---|---|
| 2.1 | Testes unitários das bibliotecas da API | `node:test` com `tsx`, sem Docker, para as bibliotecas puras (normalização de IOC, CSV, ZIP, entropia, TLSH, política de senha, regras de triagem); job próprio no CI. | M |
| 2.2 | Fuzzing dos parsers | Mutação a partir das fixtures que já existem (PE, ELF, LNK, documentos, ZIP, EML), com três invariantes: só erro tipado, tempo e memória dentro do teto. Sementes que quebrarem viram teste fixo. Rodada curta no CI e longa sob demanda. | M |
| 2.3 | Upload em streaming | Hoje o arquivo inteiro vai para a memória (`part.toBuffer()`). Passa a ir para o disco (`/tmp` da API) com o SHA-256 calculado em trânsito, e as análises leem dali. É a mudança de maior risco do plano: mexe em envio, ZIP, cota, antivírus, YARA e análise estática. | G |
| 2.4 | Cobertura do web | Testes para os módulos com lógica ainda sem teste e o piso de cobertura passando a contar todos os módulos, não só os testados. | M |
| 2.5 | Interface em inglês (i18n) | 33 páginas e cerca de 90 componentes com texto em português, mais as mensagens de erro da API. Em etapas: infraestrutura e seletor de idioma, depois extração tela a tela; os erros da API passam a levar código, e o texto fica no front. Por ser o maior item, fica por último (depois da fase 3). | G |

### Fase 3 — Análise — ✅ (menos o 3.6, adiado)

Bateria do fim da fase, com a árvore do commit `c76b3b9`: 79 testes unitários, fuzzing curto,
1.668 checagens de integração em 49 arquivos, `test:images`, `test:smoke` e os 95 cenários de
tela, todos verdes.

- **3.1 ✅**: pontuação de risco explicável. A nota (0 a 100) é calculada na hora pela API a
  partir dos mesmos sinais que as regras de triagem já leem, mais a reputação externa; cada motivo
  aparece na ficha com o peso que teve, e a tabela de pesos está no README. Só analistas veem.
  **Decisões que valem conferir:** a sugestão nunca é "limpo"; antivírus sozinho (60) sugere
  *Suspeito*, não *Malicioso*; os pesos são fixos no código, não configuráveis pela tela.
- **3.4 ✅**: hash perceptual (dHash de 256 bits) do topo do print, calculado no serviço
  `capture` com o próprio Chromium (a miniatura é feita num contexto novo, sem rede e sem o
  JavaScript da página capturada), guardado na captura e comparado na aba Relacionadas
  (*Página com a mesma aparência*, a partir de 90%) e no mapa de relações. Página quase em branco
  fica sem hash. **Diferença para o planejado:** nenhuma biblioteca nova, nem na API nem na
  captura. **Achado no caminho:** `capture-recycle.test.ts` só passava porque outro arquivo de
  teste criava o bucket antes; rodando sozinho, falhava com `NoSuchBucket`. O teste agora cria o
  bucket.
- **3.3 ✅**: enriquecimento de links como três novas linhas da reputação externa: **Registro
  (RDAP)**, consultado direto no servidor do registro do TLD pela lista da IANA; **Certificados
  (crt.sh)**; e **DNS passivo**, pelas resoluções do VirusTotal (decisão do dono). Só o domínio ou
  o IP sai. **Diferença para o planejado:** RDAP e crt.sh não pedem chave e por isso ficam
  **desligados por padrão** (`RDAP_ENABLED`, `CT_ENABLED`), para nenhum domínio sair para um
  serviço que a pessoa não escolheu; o DNS passivo liga com a chave do VirusTotal e divide a cota
  dele. Domínio com menos de 30 dias e primeiro certificado com menos de 14 viram *Suspeito* e
  entram na pontuação de risco. **Achado no caminho:** a reputação externa não tinha teste de
  integração; `reputation.test.ts` cobre agora o enriquecimento e o que sai do DeepLook.
- **3.5 ✅**: pacote STIX do caso. A exportação de IOCs do caso já existia; o novo formato
  `stix-case` leva também as amostras (observáveis), as técnicas ATT&CK, os relatórios publicados
  (notas) e um `report` do caso. A importação num caso (com prévia) cria amostras para os links e
  traz as amostras que já existem pelo link ou pelo SHA-256. **Decisões que valem conferir:**
  arquivo do pacote que nunca foi enviado fica de fora (o pacote não traz o arquivo); domínio, IP
  e e-mail só são contados (seguir já existe em Importar indicadores); no máximo 50 links novos
  por importação. A criação de amostra de link saiu da rota para `lib/entry-create.ts`, e o envio
  pela tela e a importação usam o mesmo caminho.
- **3.2 ✅**: oletools num serviço novo (`apps/oletools`), no mesmo isolamento do capa (sem rede,
  somente leitura, sem root, um contêiner por análise) e com a análise num processo filho com
  tempo-limite. Fila persistida como a do capa; cada documento do Office ou RTF vai sozinho; a ficha
  ganha a seção **Documento (oletools)**; os alertas altos entram na pontuação de risco; o status do
  sistema ganha o componente. **Limite do teste:** sem o Office não deu para montar um `.doc` com
  VBA aqui. O caminho das macros foi conferido de duas formas: rodando o `analyze.py` da imagem num
  código VBA solto (MacroRaptor `A-X`, palavras-chave e desofuscação) e num SYLK com XLM 4.0, e, na
  API, com um serviço falso. Com o contêiner real, o teste de integração cobre DOCX com DDE e RTF com
  o objeto do Equation Editor. **Ação do dono:** defina `OLETOOLS_TOKEN` no `.env` antes de subir
  esta versão; com o valor padrão a API se recusa a subir em produção (como os outros tokens).
  **Achado no caminho:** o checklist de implantação não gerava o `DATA_KEY` da fase 1; agora gera.
- **3.7 ✅** (sem o pcap, adiado pelo dono): enquanto o ambiente roda, prints periódicos da tela e
  a lista de processos pelo `qemu-guest-agent`, e uma última coleta ao encerrar; na aba Análise,
  as miniaturas e os processos que surgiram desde o início. **Achado que mudou o desenho:** o PVE 9
  tirou o endpoint de screenshot (o README já registrava; o botão "Capturar tela" lê o canvas no
  navegador). A API passou a tirar o print pelo próprio console VNC (`lib/vnc-snapshot.ts`, um
  cliente RFB mínimo, só leitura, compartilhado); o endpoint continua sendo tentado primeiro, para
  o PVE 8. **Limite do teste:** sem um Proxmox aqui, o caminho real (vncwebsocket do PVE e
  `agent/exec`) não foi exercitado; o leitor VNC foi testado contra um servidor RFB com senha e
  contra o VNC simulado do projeto, e a coleta inteira contra o Proxmox simulado. Vale confirmar no
  seu PVE que o papel `PVEVMAdmin` dá o uso do agente (`VM.GuestAgent.Unrestricted` no PVE 9).
- **3.6** adiado pelo dono.

| # | Item | Como | Tam. |
|---|---|---|---|
| 3.1 | Pontuação de risco explicável (7.5) | Nota com a lista de motivos e pesos (YARA, ClamAV, alertas do PE, capa, FLOSS, reputação); sugere o veredito, quem decide é o analista. | M |
| 3.2 | Office e PDF mais fundo (7.14) | `oletools` num serviço isolado no molde do `capa` e do `unpack` (sem rede, somente leitura, um container por trabalho). | M |
| 3.3 | Enriquecimento de links | RDAP (o WHOIS atual, sem chave) e Certificate Transparency ao lado da reputação, com o mesmo cuidado: só o domínio sai. DNS passivo pelas resoluções do VirusTotal, com a chave que já existe. | M |
| 3.4 | Hash perceptual das capturas | Calculado no próprio container da captura (o navegador já reduz a imagem), sem biblioteca nova na API; entra nas Relacionadas como "página parecida". | P–M |
| 3.5 | STIX por caso | Exportar e importar o pacote STIX 2.1 de um caso, reaproveitando o que o feed TAXII já gera. | M |
| 3.6 | Envio para o MISP — ⏸ adiado pelo dono | Enviar os indicadores de um caso ou relatório publicado a um MISP configurado (URL e chave), sob demanda. | M |
| 3.7 | Artefatos do sandbox | Lista de processos pelo `qemu-guest-agent` (o template já o exige) e capturas de tela periódicas pela API do Proxmox, guardadas na amostra. O pcap fica adiado (decisão abaixo). Só dá para testar contra o modo simulado: a validação real precisa do Proxmox do dono. | M–G |

### Decisões tomadas (12/11/2026)

1. **DNS passivo (3.3):** começa pelas resoluções do VirusTotal, com a chave que já existe.
2. **Pcap do sandbox (3.7):** adiado. A VM do sandbox fica atrás de um Mikrotik CHR, que faz o
   isolamento lógico; a captura pode sair dele, a desenhar depois. Entram processos e capturas de
   tela.
3. **Envio para o MISP (3.6):** adiado, sem código.
4. **Correções da seção 2:** commitadas antes da fase 0.

## 6. Achados no caminho (dependem do dono)

- **A suíte visual está sem as capturas de referência.** O commit `7f4bb5d` (10/11, "remove
  obsolete UI screenshots") apagou os 14 PNGs de `scripts/ui-visual/__screenshots__`, que são as
  baselines da comparação. Sem eles, `sh scripts/ui-visual/run.sh` falha nos 14 testes (a primeira
  rodada grava as capturas e reprova), e o job *Suíte visual* do CI reprovaria. Não foram
  recriados aqui porque a remoção foi uma escolha recente: se foi engano, basta
  `cd apps/web && npm run build && cd ../.. && sh scripts/ui-visual/run.sh --update-snapshots` e
  commitar os PNGs (a ficha da amostra já sai com a seção de pontuação de risco); se foi de
  propósito, o job do CI e a pasta `scripts/ui-visual` podem sair juntos.
