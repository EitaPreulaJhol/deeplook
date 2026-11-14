# 🧹 Pendências da varredura visual

> 🇬🇧 [Read in English](varredura-interface-pendencias.md)

O que ficou depois da [varredura visual de novembro de 2026](varredura-interface.pt-BR.md): problemas
vistos e não corrigidos naquela leva, ajustes de consistência e o que falta para os mesmos problemas
não voltarem.

**Legenda** — Prioridade: 🔴 alta · 🟡 média · ⚪ baixa. Esforço: **P** (horas), **M** (1–2 dias).
Status: ✅ feito · ⬜ pendente.

**Ordem de execução:** primeiro 9 e 10, que protegem as 26 correções da varredura; depois 1 e 2, os
que o analista mais vê no dia a dia; o resto na ordem da tabela.

## Resumo

| # | Pendência | Prioridade | Esforço | Área | Status |
|---|---|---|---|---|---|
| 1 | Datas e horas no formato do navegador | 🔴 | P–M | Gerencial / Backup | ✅ |
| 2 | Ações da tabela de usuários num menu | 🟡 | P–M | Administração | ✅ |
| 3 | Abas da Administração sem indicação de rolagem | 🟡 | P | Administração | ✅ |
| 4 | Faixa de avisos gerais sem margem | ⚪ | P | Global | ✅ |
| 5 | Barra da janela do console fora do padrão | ⚪ | P | Ambiente isolado | ✅ |
| 6 | Tabelas de campos da documentação da API | ⚪ | P | Documentação da API | ✅ |
| 7 | Texto em 13 px que sobrou | ⚪ | P | Global | ✅ |
| 8 | Regra dos botões de formulário no guia | ⚪ | P | Guia de interface | ✅ |
| 9 | Suíte visual cobrindo as telas corrigidas | 🔴 | M | Testes | ✅ |
| 10 | Achados manuais viram checagens da varredura | 🔴 | M | Testes | ✅ |
| 11 | Acessibilidade (axe-core) na varredura | 🟡 | M | Testes / Global | ✅ |
| 12 | Textos em português fora dos dicionários | 🟡 | P–M | i18n | ⬜ |

## Problemas que ficaram

### 1. Datas e horas no formato do navegador

- **Onde:** Relatório gerencial (campos "De" e "Até") e agendamento do backup ("Horário").
- **Problema:** os campos nativos (`type="date"` e `type="time"`) seguem o idioma do navegador, não o
  do app: com a interface em português aparecem "10/16/2026" e "02:00 AM".
- **Proposta:** `lang` do idioma do app nesses campos; se o Chromium continuar ignorando, um campo de
  texto com máscara (dd/mm/aaaa, 24 h), validado como hoje.
- **Pronto quando:** em português as datas aparecem dd/mm/aaaa e a hora em 24 h; em inglês, o formato
  americano.

**Implementado.** O `lang` não resolve (o Chromium usa o idioma do navegador no campo nativo), então:

- **Datas:** componente `HpsmDateInput` (`components/HpsmDateInput.tsx`), um campo de texto no
  formato do idioma do app, com a ordem de dia, mês e ano tirada do `Intl` (`components/dateField.ts`,
  com testes). Aceita `/`, `-` ou `.`, recusa data fora do calendário (31/02) e fora de min/max; com
  texto inválido o campo fica marcado, não consulta nada, e volta para a data em vigor ao sair. O
  botão de calendário ao lado abre o seletor do navegador (`showPicker`) por um campo nativo escondido.
- **Hora do backup agendado:** campo de texto HH:MM (24 h), validado como antes.

**Conferido** no cenário `management.mjs`, num navegador em inglês com o app em português: a data
aparece dd/mm/aaaa, a digitada vira o período, a inválida fica marcada sem consulta e volta ao sair,
e o dia escolhido no calendário também muda o período.

### 2. Ações da tabela de usuários num menu

- **Onde:** Administração > Usuários.
- **Problema:** papel + Suspender + Redefinir senha + Liberar API (+ Desativar 2FA) não cabem numa
  linha nem em 1366x768: cada usuário ocupa duas linhas.
- **Proposta:** manter a seleção de papel na linha e levar as ações para um menu "Ações ▾", como no
  HPSM; as perigosas continuam com confirmação.
- **Pronto quando:** uma linha por usuário em 1366x768 e em 1280x800.

**Implementado.** Na linha ficam a seleção de papel e o botão "Ações ▾" (`HpsmMenuButton`, extraído
do "Mais ▾" da barra). O menu traz Suspender/Reativar, Redefinir senha, Desativar 2FA (quando ativo) e
Liberar/Retirar API; as perigosas em vermelho, todas com a mesma confirmação de antes. O motivo de
"Redefinir senha" estar desativado (a própria conta, conta do AD) virou a dica do item. Uma linha por
usuário de 1280 px para cima; abaixo, o menu desce para baixo da seleção, sem ser cortado pela
grade. Os cenários `actions`, `two-factor`, `api-tokens` e `ldap-login` passaram a usar o menu.

### 3. Abas da Administração sem indicação de rolagem

- **Onde:** Administração, abaixo de 1280 px.
- **Problema:** a fileira de abas rola na horizontal, mas com barra fina (ou sobreposta) quase não se
  vê que existem mais abas: "Configurações" aparece cortada.
- **Proposta:** setas nas pontas quando há aba escondida, ou um "Mais ▾" com as abas que não cabem.
- **Pronto quando:** em 1024x768 dá para ver e alcançar todas as abas sem rolar no escuro.

**Implementado** no `HpsmTabs`, então vale para toda faixa de abas (ficha, conta, administração):
setas ‹ › sobre as pontas, só do lado que tem aba escondida, que rolam a faixa. As setas são só do
mouse (fora do Tab e do leitor de tela); pelo teclado, a aba focada rola para a vista. A aba ativa ou
focada para a 1,5rem da ponta, para não ficar embaixo da seta. Cenário novo: `tab-arrows.mjs`.

### 4. Faixa de avisos gerais sem margem

- **Onde:** topo da área de trabalho, quando há aviso geral ativo.
- **Problema:** a faixa encosta nas bordas da área de trabalho; a barra de mensagens logo abaixo tem
  8 px de margem.
- **Proposta:** a mesma margem da barra de mensagens.

**Implementado.** O bloco das faixas tem o recuo da barra de mensagens (0,4rem em cima, 0,5rem nas
laterais), e cada faixa o mesmo recuo interno de uma mensagem: bordas e ícones alinham com a mensagem
logo abaixo e com o conteúdo.

### 5. Barra da janela do console fora do padrão

- **Onde:** janela dedicada do console do ambiente isolado.
- **Problema:** "Estender prazo / Capturar tela / Descartar ambiente" ficam num quadro branco,
  diferente da barra em degradê (`HpsmToolbar`) do resto do app.
- **Proposta:** usar a barra padrão, mantendo o layout próprio da janela.

**Implementado.** As três ações foram para um `HpsmToolbar` no topo da janela, acima do título, como
nas telas do app: "Estender prazo" e "Capturar tela", um separador e "Descartar ambiente". Para
manter o aviso de ação perigosa, o `HpsmToolbarButton` ganhou `danger` (texto em vermelho). A
confirmação ao descartar continua a mesma.

### 6. Tabelas de campos da documentação da API

- **Onde:** Documentação da API, tabelas "Campo / Onde / Tipo / Descrição" de cada rota.
- **Problema:** cabeçalho mais claro e linhas sem a zebra das outras grades.
- **Proposta:** o estilo das grades do app.

**Implementado.** A `.dl-apidoc__fields` passou a usar o desenho das grades: cabeçalho em degradê com
divisórias e texto em negrito, linhas em zebra, o recuo de 1rem das células e as mesmas cores de borda.

### 7. Texto em 13 px que sobrou

- **Onde:** título do card da KB, seletor de idioma do login, mensagens e barra da janela do console.
- **Problema:** depois do item 19 da varredura, esses são os únicos textos em 0,8125rem (13 px).
- **Proposta:** decidir se 13 px é um degrau da escala (título de card, por exemplo) e registrar no
  guia, ou levar para o tamanho do corpo.

**Implementado.** 13 px não é degrau da escala: o guia já dizia "12px no app inteiro". Foram para o
corpo o título do card da KB, as mensagens e o campo de colar do console, o seletor de idioma do
login, o título da resolução e os subtítulos dos artefatos do ambiente isolado ("Sysmon da VM" estava
em 14 px, contra 12 px de "Strings por categoria"). A tabela de tipografia do guia agora diz o que
pode ser maior: título da página, títulos de Markdown, de rota da API e da impressão, números dos
indicadores e o texto da resolução em destaque. A checagem `fonte-acima-do-corpo` deixou de abrir
exceção para a janela do console e não acusa nada na interface.

### 8. Regra dos botões de formulário no guia

- **Onde:** [`docs/interface-hpsm.pt-BR.md`](interface-hpsm.pt-BR.md).
- **Problema:** na prática, formulários de inclusão (regras de triagem, atribuição, domínios, avisos)
  usam só o botão de rodapé, os de edição usam a barra da seção e a troca de senha usa os dois. A
  regra não está escrita.
- **Proposta:** escrever a regra no guia e alinhar quem fugir dela.

**Implementado.** A regra está no guia ("Onde fica o botão de gravar"): na barra (da página ou da
seção); só no rodapé quando o formulário mora na seção de uma lista; barra e rodapé só em formulário
crítico ou assistente; colado ao campo na inclusão de campo único. Fugiam dela três formulários com
seção própria e botão só no rodapé: Nova regra de triagem, Novo aviso e Resolução para quem enviou.
Os três passaram a ter a ação na barra da seção, e o contador da resolução foi para a ajuda do campo,
como na atualização da aba Histórico.

## Para não regredir

### 9. Suíte visual cobrindo as telas corrigidas

- **Onde:** `scripts/ui-visual` (hoje 14 referências).
- **Problema:** a maioria das telas corrigidas na varredura não tem referência visual: backup,
  usuários, caso, artigo e editor da KB, avisos gerais, atribuição, aba Relatórios.
- **Proposta:** referências dessas telas no tamanho de mesa e no compacto.
- **Pronto quando:** a volta de qualquer correção da varredura quebra a suíte.

**Implementado.** 13 telas novas na suíte (`scripts/ui-visual/screens.spec.mjs`, bloco "varredura
visual"): caso, ficha nas abas Análise (com ambiente isolado) e Relatórios, artigo e editor da KB,
usuários, backup, avisos gerais, atribuição, domínios, comparar, busca e regras YARA com um pacote
aberto. Um projeto novo, `notebook` (1366x768), roda as marcadas com `@notebook`: histórico, caso,
relatórios, usuários, avisos e domínios. São 33 capturas ao todo.

Os dados vêm de `scripts/ui-playwright/screen-data.mjs`, que a varredura também passou a usar: caso,
artigo, ambiente isolado e listas da comparação no estado do mock, e rotas só de leitura de backup,
atribuição, avisos e domínios (antes eram 404 na varredura). O prazo do ambiente isolado conta do
relógio congelado, e a varredura passou a rodar no fuso `America/Sao_Paulo`, o mesmo da suíte.

**Conferido:** com o `hpsm.scss` de antes da varredura, 25 das 33 capturas quebram, e cada tela nova
quebra em pelo menos uma resolução. Ficam fora da suíte: a árvore do Sysmon (item 20, só nos dados do
cenário `sandbox-artifacts`), a troca de senha (item 3) e o texto em inglês (item 26, que a varredura
em inglês acusa).

### 10. Achados manuais viram checagens da varredura

- **Onde:** `scripts/ui-playwright/sweep.mjs`.
- **Problema:** os achados mais repetidos da varredura só foram pegos olhando os prints.
- **Proposta:** três checagens novas:
  - **recuo dobrado:** bloco de conteúdo começando à direita do recuo do corpo da seção (apareceu em
    mais de 10 lugares);
  - **tamanhos misturados:** texto corrido de uma tela em mais de um tamanho;
  - **rótulo empilhado:** rótulo visível do Carbon fora de diálogo.
- **Pronto quando:** as checagens acusam os casos da varredura (conferido contra o código anterior)
  e não acusam nada na interface de hoje.

**Implementado.** Três checagens novas na `inspect()` do `sweep.mjs`:

- **`fonte-acima-do-corpo`:** texto corrido maior que `--dl-font-size` (até 15 px; acima disso já
  havia a `fonte-grande`). Ficam de fora títulos, cabeçalho da página e das seções, a janela do
  console, o destaque da resolução e símbolos soltos ("×" de fechar).
- **`recuo-dobrado`:** dentro do corpo de uma seção, soma padding, margem e borda do caminho até cada
  texto e acusa a partir de 6 px. Recuo legítimo: quadro com borda ou fundo, lista com marcador,
  célula de tabela, controle de formulário, diálogo, ou a coluna dos campos (rótulo + 0,5rem). O
  achado sai pelo bloco que causa o recuo.
- **`rotulo-empilhado`:** rótulo visível do Carbon (`label` ou `legend`) fora de diálogo.

**Conferido** com o web de antes da varredura (`0605267`), em 1366x768: acusa o texto do backup, a
nota de risco, os exemplos da API, as listas do caso, comparar, o artigo da KB, o backup agendado e
os rótulos do backup, das evidências e do caso. Na interface de hoje sobram dois: o título do card da
KB (item 7, ainda pendente) e os gráficos do Painel e do Gerencial, um recuo dobrado que a revisão
manual não tinha visto, corrigido em seguida.

### 11. Acessibilidade (axe-core) na varredura

- **Problema:** contraste do texto de ajuda cinza em 11 px, foco visível e nomes acessíveis nunca
  foram medidos.
- **Proposta:** rodar o axe-core em cada tela da varredura e corrigir o que for real.

**Implementado.** `SWEEP_AXE=1` roda o axe-core 4.10.3 (WCAG 2.0/2.1, A e AA) em cada tela da
varredura; o cenário novo `a11y-states.mjs` roda nos estados que a varredura não vê (menu de ações
aberto, "Mais ▾" aberto, diálogo de confirmação, caixa de atalhos, formulário com campo inválido). O
axe entra pelo protocolo do navegador, fora da CSP do app. Os dois precisam do pacote no container
(`npm i --no-save --no-package-lock axe-core@4.10.3`).

O contraste do texto de ajuda cinza em 11 px e os nomes acessíveis passaram. Corrigido o que acusou:

- **Calendário do backup:** os dias passados usavam o tom de placeholder, abaixo de 4,5:1; agora o
  cinza do texto apagado.
- **Link do caso em Avisos gerais e na faixa do topo:** no meio do texto, só a cor o distinguia;
  agora é sublinhado (`.dl-link--inline`, a mesma regra dos links dentro de parágrafo).
- **Item perigoso do menu e da barra** (criados nos itens 2 e 5): o vermelho de status ficava abaixo
  de 4,5:1 sobre o fundo azul do foco; agora é o vermelho escuro das mensagens de erro.

Resultado: nenhuma violação nas 58 telas (português em 1366x768, inglês em 1024x768) nem nos cinco
estados.

### 12. Textos em português fora dos dicionários

- **Onde:** `scripts/check-i18n.mjs` (16 textos em 12 arquivos).
- **Proposta:** revisar um por um; o que aparece na tela vai para o dicionário, e o resto (comentário,
  dado de exemplo) entra na lista de exceções do script.
