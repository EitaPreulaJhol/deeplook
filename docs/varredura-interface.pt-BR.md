# 🔍 Varredura visual da interface (novembro de 2026)

> 🇬🇧 [Read in English](varredura-interface.md)

Todas as telas da interface web foram capturadas com o Playwright, contra a API simulada, em quatro
resoluções: **1440x900** (referência), **1366x768**, **1280x720** e **1024x768**. Cada achado abaixo
foi corrigido num commit próprio.

## Como foi feita

- **Captura:** `scripts/ui-playwright/sweep.mjs` passa por todas as rotas e abas internas (58 telas:
  as rotas da aplicação, as 6 abas da ficha da amostra, as 8 da conta e as 9 da administração),
  tira o print de página inteira e roda checagens no navegador: rolagem horizontal, texto cortado
  (com ou sem reticências), botão ou aba com o texto em mais de uma linha, controles sobrepostos,
  elemento fora da tela, texto comum maior que o padrão da interface, imagem quebrada ou distorcida,
  erros do console e, em inglês, "por/em/às" fixos no código antes de nome ou data. Depois da
  varredura entraram texto acima do corpo, recuo dobrado e rótulo empilhado, e o modo
  `SWEEP_AXE=1` (axe-core, WCAG A/AA).
- **Telas com dados próprios** (gerencial, atribuição, avisos, domínios, regras de triagem, backup,
  documentação da API e captura de página): os cenários dedicados, com a resolução trocada por
  `SWEEP_VIEWPORT=LxA`.
- **Revisão visual** de cada print, atrás do que as checagens não pegam: espaçamento, alinhamento e
  consistência entre telas.

Para repetir (no container do Playwright, como os cenários):

```
node sweep.mjs                                    # todas as telas, nas 4 resoluções
SWEEP_SIZES=1366x768 SWEEP_ONLY=admin node sweep.mjs
SWEEP_LANG=en node sweep.mjs                      # em inglês (textos mais longos)
SWEEP_AXE=1 node sweep.mjs                        # com axe-core (npm i axe-core@4.10.3 antes)
SWEEP_VIEWPORT=1366x768 OUT_DIR=/work/out/1366 node management.mjs
```

Os prints ficam em `out/sweep/<resolução>/` e o relatório em `out/sweep/report.json`.

## Achados e correções

| # | Tela | Problema | Resoluções | Correção |
|---|---|---|---|---|
| 1 | Listas de amostras (Histórico Global, Meus Uploads, filas) | A coluna Amostra era a primeira a encolher: o nome quebrava no meio ("instalador_suspei…", "relatorio_trimestral.d / ocm") e a data, em duas linhas, enquanto as colunas curtas sobravam. Corrigido isso, em 1280 e 1366 a tabela completa não cabia e Relatórios e Data iam para uma rolagem horizontal escondida | 1366, 1280 | Largura mínima para o título (o `overflow-wrap: anywhere`, necessário para nomes enormes, deixava a coluna encolher até um caractere) e três níveis de colunas secundárias, remedidos: em 1366 sai só Relatórios; em 1280, Tipo também; em 1024, ainda Responsável, Idade e Data |
| 2 | Troca de senha obrigatória (e qualquer quadro de autenticação com texto de abertura) | O texto de abertura saía em 16px, herdado do parágrafo, maior que todo o resto da interface (12-13px) | todas | O texto de abertura usa a fonte do corpo (12px, linha 1.5) |
| 3 | Troca de senha obrigatória | O rótulo "Senha atual ou temporária:" ("Current or temporary password:") quebrava em duas linhas, com o asterisco desalinhado do campo | todas, nos dois idiomas | Só nesse quadro, a coluna de rótulos e a caixa ficam mais largas (o campo mantém o tamanho); login e cadastro, de rótulos curtos, não mudam |
| 4 | Painel | Nos cartões de indicadores, o rótulo descia nos cartões sem linha de apoio (as linhas da grade esticavam até a altura do cartão mais alto): "Pendentes" e "Em análise" ficavam mais baixos que os vizinhos | todas | O conteúdo do cartão fica no topo: rótulos na mesma altura |
| 5 | 23 telas e componentes (Painel, Caso, Comparar, Busca, YARA, artigo da KB, documentação da API, gerencial, regras de triagem, avisos, atribuição, domínios, configurações, backup, seções da ficha da amostra: documento, script, disco, e-mail, captura, relatórios) | O espaço entre seções variava entre 8 px e 32 px: 36 seções tinham uma margem extra de 24 px (`dl-mt-lg`), as demais não. No Painel, "Técnicas ATT&CK" ficava a 32 px do gráfico; na ficha, as seções a 8 px | todas | Seções vizinhas sempre a 8 px (a margem padrão de `.hpsm-section`); a margem extra saiu das seções (fica só em tabelas e blocos que não são seção) |
| 6 | Artigos e cartões da base de conhecimento, relatórios na tela do Caso, documentação da API, dica do ambiente isolado | Parágrafos em 16px no meio de texto em 12-13px: o Carbon dá a todo `<p>` o tamanho `body-02`. No artigo, os parágrafos e a citação saíam maiores que os itens de lista do mesmo texto | todas | Na base do tema, o parágrafo herda o tamanho do contexto (a altura de linha continua a do Carbon). A varredura ganhou a checagem de fonte fora do padrão |
| 7 | Histórico Global e Enviar Amostra | A barra de ações ("Pegar a próxima"; "Enviar arquivo / Cancelar") vinha abaixo do cabeçalho da página, enquanto nas outras 12 telas (Painel, Caixa de entrada, ficha da amostra, Caso, YARA…) vem acima: a barra mudava de lugar de uma tela para outra | todas | As duas telas seguem o padrão (barra no topo, acima do cabeçalho), e o guia de interface (`interface-hpsm`), que descrevia o contrário do que o sistema faz, foi corrigido |
| 8 | Todos os formulários (Indicadores permitidos, triagem da ficha, ficha da amostra, conta…) | Rótulo e campo centralizados pelo bloco campo + texto de ajuda: com ajuda embaixo, o rótulo descia ("SHA-256:" 9 px abaixo do texto do campo) e, numa linha de duas colunas, o campo vizinho ficava desalinhado ("Tipo" 7 px abaixo de "Indicador"; "Responsável" abaixo de "Prioridade") | todas | Campos alinhados pelo topo, e o rótulo centralizado no controle de 24 px por um recuo fixo; o mesmo vale para a primeira linha da área de texto |
| 9 | Ficha da amostra, aba Análise: painel "Ambiente isolado" | O painel era um quadro do Carbon (`Tile`), sem a faixa de título das outras seções da ficha, com um título próprio e outra borda; com o arquivo expurgado, o mesmo painel já aparecia como seção HPSM | todas | O painel virou uma seção HPSM, como o resto da ficha; dentro de seção, a barra de botões não tem moldura própria |
| 10 | Caso (relatórios, linha do tempo, novo comentário), artigo da base de conhecimento, anexos do e-mail | O bloco repetia o recuo do corpo da seção (`0.5rem 0.75rem` dentro de outro igual): o texto começava 12 px mais à direita e 8 px mais abaixo que o das outras seções | todas | Sem recuo próprio nesses blocos: o texto alinha com o resto da tela |
| 11 | Todos os campos de texto (filtros, formulários, Caso, KB, envio de amostra, indicadores permitidos) | O texto dos campos de uma linha encostava na borda (recuo 0: o Carbon tira o recuo de um token de densidade que o app não define), enquanto a área de texto recuava 6 px e a seleção 16 px: no mesmo formulário o texto começava em três posições | todas | Recuo de 0,4rem em campo de texto, campo numérico e seleção (o lado da seta continua livre), o mesmo da área de texto |
| 12 | Base de conhecimento, novo artigo e edição | O bloco "Texto" + pré-visualização tinha recuo lateral próprio (dentro do corpo da seção) e nenhum espaço acima: o rótulo "Texto" e o editor ficavam 10 px à direita dos outros rótulos e campos e colados no campo Tags | todas | Sem recuo lateral próprio e com o espaço entre linhas do formulário: rótulo, editor e pré-visualização alinham com os campos de cima |
| 13 | Barras de filtro (Histórico Global, filas, Meus Uploads, casos, KB e outras listas) | Os botões (Limpar, Salvar visão, Compartilhar visão, Exportar CSV) quebravam de linha um a um: em 1366x768 "Exportar CSV" ficava sozinho na terceira linha; e ficavam a 1rem um do outro, o espaço entre filtros, contra 0,5rem nas barras de ferramentas | 1366x768 e menores | Os botões ficam num bloco que quebra inteiro, com 0,5rem entre eles |
| 14 | Ficha da amostra, aba Relatórios: linha "Evidências" | O campo de legenda tinha um rótulo empilhado ("Legenda (opcional)") no meio de um formulário de rótulos à esquerda: o rótulo "Evidências" alinhava com essa legenda e o campo, o botão e a ajuda ficavam 20 px abaixo | todas | A legenda virou texto de exemplo dentro do campo (o rótulo continua para leitores de tela); campo, botão e ajuda numa linha centralizada com o rótulo |
| 15 | Caso: "Incluir amostra" e "Novo comentário" | Os dois campos tinham rótulo empilhado do Carbon, enquanto o resto da tela (Dados do caso) e a atualização da ficha usam rótulo à esquerda; "Incluir amostra (ID ou link)" repetia o que o texto de exemplo já mostra | todas | Rótulo à esquerda ("Incluir amostra:", "Novo comentário:") com campo e botão ao lado e a ajuda embaixo, como na ficha |
| 16 | Ficha da amostra, caso, IOC e artigo da KB: barra de resumo | A barra de resumo tinha 1,5rem abaixo (24 px + o recuo das abas: 28 px até as abas ou a primeira seção), enquanto cabeçalho, barra de ferramentas e seções ficam a 8 px um do outro | todas | 0,5rem abaixo da barra, na própria regra dela, nas quatro telas |
| 17 | Administração > Usuários | Em 1366x768 os nomes quebravam em duas linhas ("Ana / Souza"), o cabeçalho "Acesso por API" também, e a seleção de papel esticava conforme o espaço: cada linha quebrava os botões num ponto diferente, com um vão entre a seleção e os botões | 1366x768 | Seleção de papel com 7,5rem em toda linha e sem esticar; nome e cabeçalhos sem quebra de 1280 px para cima (abaixo disso, a quebra continua para a tabela caber) |
| 18 | Administração > Backup (gerar e agendado) | A aba fugia do padrão das outras: rótulos empilhados do Carbon ("Senha do ZIP", "Repetir", "Dias da semana", "Horário"), botões grandes no meio do conteúdo ("Gerar backup", "Salvar agendamento") em vez da barra da seção, texto em 0,8–0,85rem (o corpo é 0,75rem), a lista "Próximas execuções" recuada em relação ao título, o "Carregando o agendamento..." solto entre as seções e, na coluna Ações, "Baixar" sem sublinhado ao lado de "Excluir" sublinhado | todas | Campos com rótulo à esquerda (Conteúdo, Proteção, Senha do ZIP, Agendamento, Repetir, Dias da semana, Horário); ações na barra de cada seção; textos, calendário e lista no tamanho do corpo; carregamento dentro da seção; "Baixar" e "Excluir" com o mesmo estilo de link |
| 19 | Artigo e editor da KB, relatórios em Markdown, pontuação de risco, análise estática (DIE, desempacotamento, imports, macros), artefatos do ambiente isolado e Sysmon, mapa, cadeia da auditoria, documentação da API | O texto corrido desses blocos usava 13 px (0,8125rem) ou 12,8 px (0,8rem), contra 12 px no resto da tela: no artigo da KB, o corpo do artigo ficava maior que a seção "Citado em" logo abaixo | todas | Texto corrido e listas no tamanho do corpo (`--dl-font-size`); títulos continuam maiores. Saiu a regra do título do painel do ambiente isolado, sem uso desde o item 9 |
| 20 | Ficha da amostra, ambiente isolado: árvore de processos do Sysmon | Os itens da árvore tinham entrelinha ~1: a linha de comando em monoespaçado encostava no nome do processo acima | todas | Entrelinha 1,5 nos itens da árvore |
| 21 | Atribuição automática (incluir regra, novo grupo) e outras seções com tabela seguida de formulário | O primeiro campo do formulário encostava na tabela logo acima (2 px), sem o espaço que separa a grade dos campos no caso | todas | 0,75rem entre a tabela e o formulário que vem logo depois dela |
| 22 | Avisos gerais: lista de avisos | Em 1366x768, "Dispensado por" quebrava em duas linhas, assim como "Bruno / Lima" e as datas de "Vale até", enquanto a coluna do texto do aviso sobrava larga | 1366x768 | Só o texto do aviso quebra; nome, datas e cabeçalhos numa linha de 1280 px para cima |
| 23 | Domínios da empresa: variações vistas | Os domínios ("ernpresa.com.b / r") quebravam no meio, com espaço sobrando em outras colunas: a fonte monoespaçada quebra em qualquer caractere, e a grade espremia a coluna até o mínimo | todas | Nas colunas de domínio, quebra só se não couber (hashes longos continuam quebrando em qualquer ponto) |
| 24 | Análise estática (strings por categoria, PE, ELF, capa, Ghidra), macros VBA do documento, comparar amostras, busca, amostras do retroscan YARA | Mais blocos repetiam o recuo lateral do corpo da seção: títulos, listas e colunas começavam 10 a 12 px à direita dos campos e do texto das outras seções (mesma causa do item 10) | todas | Sem recuo lateral próprio nesses blocos (os diálogos, com corpo próprio, continuam como estão) |
| 25 | Regras YARA > Pacotes de regras: busca nas regras do pacote aberto | O campo tinha rótulo empilhado do Carbon ("Buscar regra do pacote"), e a contagem "N conjunto(s)" vinha solta embaixo, enquanto a seção "Nova regra" logo acima usa rótulo à esquerda | todas | Rótulo à esquerda ("Buscar regra:") e a contagem como ajuda do campo |
| 26 | Caso (resumo e coluna Incluída), artigo da KB, indicadores permitidos, retroscans YARA (interface em inglês) | "por" fixo no código antes do nome: em inglês aparecia "10/24/2026, 9:00:00 AM por Ana Souza" | todas, em inglês | Texto pelo dicionário ("by Ana Souza"); a varredura em inglês passou a acusar "por/em/às" antes de nome ou data |
| 27 | Painel e Relatório gerencial: gráfico diário, vereditos e técnicas ATT&CK | Gráfico e listas de barras repetiam o recuo do corpo da seção: legenda, "Ver em tabela" e as listas começavam 10 px à direita do resto (achado depois, pela checagem automática de recuo dobrado) | todas | Sem recuo lateral próprio no gráfico e nas listas de barras |

## Descartados (não são problemas)

- **Rótulos só para leitor de tela** (`cds--visually-hidden`), cortados de propósito.
- **Botão "mostrar senha" dentro do campo de senha**, sobreposto de propósito.
- **Erros 401 no login e no cadastro** (sem sessão) e o **WebSocket do console**, que não existe na
  API simulada.
- **Título da aba do caso com reticências** ("CASO-0001 · Campanha do bol…"): as abas de documento
  têm no máximo 14rem e mostram o título inteiro na dica.
- **Abas da Administração cortadas em 1024x768**: a fileira rola na horizontal, com setas
  nas pontas que têm aba escondida.
- **Cabeçalho "Acesso por API" em duas linhas em 1024x768**: abaixo de 1280 px a tabela de usuários
  deixa nome e cabeçalhos quebrarem para caber (item 17).
- **"Salvar" no rodapé da Alterar senha, além da barra**: o rodapé (`HpsmFormActions`) complementa a
  barra em formulário crítico; a regra completa está no
  [guia de interface](interface-hpsm.pt-BR.md) ("Onde fica o botão de gravar").
- **Barra de Sessões fora da seção**: o guia aceita barra de aba ou de seção; as ações valem para a
  lista inteira.
- **Formulários de uma coluna estreitos** (Preferências, Notificações, Senha, 2FA, Gerar backup): a
  coluna `dl-form-col` é proposital; os de duas colunas usam a largura toda.
- **Rótulos empilhados nos diálogos** (importar indicadores, decodificador): é o padrão dos modais.
- **Erros 404 da varredura** (backup, atribuição, avisos, domínios, gerencial, regras de triagem,
  capturas, OpenAPI): rotas que a API simulada da varredura não tem; essas telas foram conferidas
  pelos cenários dedicados (`backup.mjs`, `assignment.mjs`, `broadcasts.mjs` e outros).
