# 🔍 Varredura visual da interface (novembro de 2026)

> 🇬🇧 [Read in English](varredura-interface.md)

Todas as telas da interface web foram capturadas com o Playwright, contra a API simulada, em quatro
resoluções: **1440x900** (referência), **1366x768**, **1280x720** e **1024x768**. Cada achado abaixo
foi corrigido num commit próprio.

## Como foi feita

- **Captura:** `scripts/ui-playwright/sweep.mjs` passa por todas as rotas e abas internas (57 telas:
  as rotas da aplicação, as 6 abas da ficha da amostra, as 8 da conta e as 9 da administração),
  tira o print de página inteira e roda checagens no navegador: rolagem horizontal, texto cortado
  (com ou sem reticências), botão ou aba com o texto em mais de uma linha, controles sobrepostos,
  elemento fora da tela, texto comum maior que o padrão da interface, imagem quebrada ou distorcida e
  erros do console.
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

## Descartados (não são problemas)

- **Rótulos só para leitor de tela** (`cds--visually-hidden`), cortados de propósito.
- **Botão "mostrar senha" dentro do campo de senha**, sobreposto de propósito.
- **Erros 401 no login e no cadastro** (sem sessão) e o **WebSocket do console**, que não existe na
  API simulada.
