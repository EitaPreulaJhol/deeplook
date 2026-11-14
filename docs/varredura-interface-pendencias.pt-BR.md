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
| 1 | Datas e horas no formato do navegador | 🔴 | P–M | Gerencial / Backup | ⬜ |
| 2 | Ações da tabela de usuários num menu | 🟡 | P–M | Administração | ⬜ |
| 3 | Abas da Administração sem indicação de rolagem | 🟡 | P | Administração | ⬜ |
| 4 | Faixa de avisos gerais sem margem | ⚪ | P | Global | ⬜ |
| 5 | Barra da janela do console fora do padrão | ⚪ | P | Ambiente isolado | ⬜ |
| 6 | Tabelas de campos da documentação da API | ⚪ | P | Documentação da API | ⬜ |
| 7 | Texto em 13 px que sobrou | ⚪ | P | Global | ⬜ |
| 8 | Regra dos botões de formulário no guia | ⚪ | P | Guia de interface | ⬜ |
| 9 | Suíte visual cobrindo as telas corrigidas | 🔴 | M | Testes | ⬜ |
| 10 | Achados manuais viram checagens da varredura | 🔴 | M | Testes | ⬜ |
| 11 | Acessibilidade (axe-core) na varredura | 🟡 | M | Testes / Global | ⬜ |
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

### 2. Ações da tabela de usuários num menu

- **Onde:** Administração > Usuários.
- **Problema:** papel + Suspender + Redefinir senha + Liberar API (+ Desativar 2FA) não cabem numa
  linha nem em 1366x768: cada usuário ocupa duas linhas.
- **Proposta:** manter a seleção de papel na linha e levar as ações para um menu "Ações ▾", como no
  HPSM; as perigosas continuam com confirmação.
- **Pronto quando:** uma linha por usuário em 1366x768 e em 1280x800.

### 3. Abas da Administração sem indicação de rolagem

- **Onde:** Administração, abaixo de 1280 px.
- **Problema:** a fileira de abas rola na horizontal, mas com barra fina (ou sobreposta) quase não se
  vê que existem mais abas: "Configurações" aparece cortada.
- **Proposta:** setas nas pontas quando há aba escondida, ou um "Mais ▾" com as abas que não cabem.
- **Pronto quando:** em 1024x768 dá para ver e alcançar todas as abas sem rolar no escuro.

### 4. Faixa de avisos gerais sem margem

- **Onde:** topo da área de trabalho, quando há aviso geral ativo.
- **Problema:** a faixa encosta nas bordas da área de trabalho; a barra de mensagens logo abaixo tem
  8 px de margem.
- **Proposta:** a mesma margem da barra de mensagens.

### 5. Barra da janela do console fora do padrão

- **Onde:** janela dedicada do console do ambiente isolado.
- **Problema:** "Estender prazo / Capturar tela / Descartar ambiente" ficam num quadro branco,
  diferente da barra em degradê (`HpsmToolbar`) do resto do app.
- **Proposta:** usar a barra padrão, mantendo o layout próprio da janela.

### 6. Tabelas de campos da documentação da API

- **Onde:** Documentação da API, tabelas "Campo / Onde / Tipo / Descrição" de cada rota.
- **Problema:** cabeçalho mais claro e linhas sem a zebra das outras grades.
- **Proposta:** o estilo das grades do app.

### 7. Texto em 13 px que sobrou

- **Onde:** título do card da KB, seletor de idioma do login, mensagens e barra da janela do console.
- **Problema:** depois do item 19 da varredura, esses são os únicos textos em 0,8125rem (13 px).
- **Proposta:** decidir se 13 px é um degrau da escala (título de card, por exemplo) e registrar no
  guia, ou levar para o tamanho do corpo.

### 8. Regra dos botões de formulário no guia

- **Onde:** [`docs/interface-hpsm.pt-BR.md`](interface-hpsm.pt-BR.md).
- **Problema:** na prática, formulários de inclusão (regras de triagem, atribuição, domínios, avisos)
  usam só o botão de rodapé, os de edição usam a barra da seção e a troca de senha usa os dois. A
  regra não está escrita.
- **Proposta:** escrever a regra no guia e alinhar quem fugir dela.

## Para não regredir

### 9. Suíte visual cobrindo as telas corrigidas

- **Onde:** `scripts/ui-visual` (hoje 14 referências).
- **Problema:** a maioria das telas corrigidas na varredura não tem referência visual: backup,
  usuários, caso, artigo e editor da KB, avisos gerais, atribuição, aba Relatórios.
- **Proposta:** referências dessas telas no tamanho de mesa e no compacto.
- **Pronto quando:** a volta de qualquer correção da varredura quebra a suíte.

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

### 11. Acessibilidade (axe-core) na varredura

- **Problema:** contraste do texto de ajuda cinza em 11 px, foco visível e nomes acessíveis nunca
  foram medidos.
- **Proposta:** rodar o axe-core em cada tela da varredura e corrigir o que for real.

### 12. Textos em português fora dos dicionários

- **Onde:** `scripts/check-i18n.mjs` (16 textos em 12 arquivos).
- **Proposta:** revisar um por um; o que aparece na tela vai para o dicionário, e o resto (comentário,
  dado de exemplo) entra na lista de exceções do script.
