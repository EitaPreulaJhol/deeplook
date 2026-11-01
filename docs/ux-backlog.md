# 🧭 Backlog de UX e usabilidade

Ideias levantadas depois da reformulação visual no estilo HP Service Manager 9
(ver [`docs/interface-hpsm.md`](interface-hpsm.md)). Todas seguem o mesmo princípio:
**melhorar o uso sem modernizar o visual** — os padrões citados (diálogo de
confirmação, filas com contadores, aba de atividades, Anterior/Próximo) existem no
próprio HPSM.

**Legenda** — Prioridade: 🔴 alta · 🟡 média · ⚪ baixa. Esforço: **P** (horas),
**M** (1–2 dias), **G** (vários dias, envolve banco). Status: ✅ feito · ⬜ pendente.

## Resumo

| # | Ideia | Prioridade | Esforço | Área | Status |
|---|---|---|---|---|---|
| 1 | Redefinição de senha pelo admin | 🔴 | P–M | Admin / API | ✅ |
| 2 | Confirmação ao salvar a triagem | 🔴 | P | Amostra | ✅ |
| 3 | Diálogo de confirmação em ações destrutivas | 🔴 | M | Admin / Sandbox | ✅ |
| 4 | Aviso de alterações não salvas | 🔴 | M | Formulários | ✅ |
| 5 | Filtros, ordenação e página na URL | 🔴 | P–M | Listas | ✅ |
| 6 | "Minha fila" com contadores no navegador | 🟡 | M | Navegador / API | ✅ |
| 7 | Atribuição de amostra a um analista | 🟡 | G | Amostra / banco | ✅ |
| 8 | Aba "Histórico" (auditoria) na amostra | 🟡 | G | Amostra / banco | ✅ |
| 9 | Anterior / Próximo na ficha da amostra | 🟡 | M | Amostra | ✅ |
| 10 | Detecção de duplicata pelo SHA-256 | 🟡 | M | Envio / API | ✅ |
| 11 | Arrastar e soltar o arquivo | ⚪ | P | Envio | ✅ |
| 12 | Botões de copiar (hash, URL, IOCs) | ⚪ | P | Amostra / Relatórios | ✅ |
| 13 | Avisos ao entrar ("suas amostras concluídas") | ⚪ | M | Página Inicial / API | ✅ |
| 14 | Prazo do sandbox à vista | ⚪ | P–M | Sandbox | ✅ |
| 15 | Atalhos de teclado | ⚪ | P | Global | ✅ |
| 16 | Linhas da grade navegáveis pelo teclado | ⚪ | P | Listas | ✅ |
| 17 | Exportar CSV da lista filtrada | ⚪ | M | Listas / API | ✅ |
| 18 | Limite de tentativas no login e na troca de senha | 🔴 | P | Segurança / API | ✅ |

**Todos os 18 itens foram implementados** — cada item abaixo traz um bloco
**Implementado** com o que mudou e os limites conhecidos.

As levas seguintes também foram concluídas e estão mais abaixo:
[Segunda leva — ideias 19 a 30](#segunda-leva--ideias-19-a-30),
[Terceira leva — ideias 31 a 45](#terceira-leva--ideias-31-a-45) e
[Quarta leva — ideias 46 a 50](#quarta-leva--ideias-46-a-50), além do item avulso
[51. Política de senha](#51-política-de-senha),
[Quinta leva — ideias 52 a 65](#quinta-leva--ideias-52-a-65) e
[Sexta leva — ideias 67 a 80](#sexta-leva--ideias-67-a-80) (o 79 está adiado: não há
SMTP). A [Sétima leva — ideias 81 a 94](#sétima-leva--ideias-81-a-94) está implementada, e a
[Oitava leva — itens 95 a 124](#oitava-leva--itens-95-a-124) vem da varredura de 31/10/2026.

---

## 🔴 Alta prioridade

### 1. Redefinição de senha pelo admin
- **Problema:** o login diz "Peça a um administrador para redefinir a sua senha", mas
  o Admin não tem essa ação.
- **Proposta:** botão **Redefinir senha** na linha do usuário (Admin › Usuários) que
  gera uma senha temporária, mostra-a uma única vez na barra de mensagens (como a
  chave de ativação criada) e encerra as sessões do usuário. Opcional: obrigar a
  troca no próximo login.
- **Onde mexer:** `apps/api/src/routes/admin.ts` (novo
  `POST /api/admin/users/:id/reset-password`, reaproveitando `hashPassword` e o
  `session.deleteMany` de `routes/me.ts`); `apps/web/src/pages/AdminPage.tsx`.
- **Cuidados:** ação destrutiva → usar o diálogo da ideia 3; não registrar a senha
  em log.
- ✅ **Implementado:** `POST /api/admin/users/:id/reset-password` (recusa a própria
  conta, gera senha de 14 caracteres com `generateTemporaryPassword`, encerra as
  sessões); botão **Redefinir senha** em Admin › Usuários, com confirmação e a senha
  temporária mostrada uma vez na barra de mensagens. A troca obrigatória no próximo
  login veio depois, no item 48.

### 2. Confirmação ao salvar a triagem
- **Problema:** em Amostra › Análise, mudar Status ou Veredito grava na hora, sem
  retorno — o usuário fica sem saber se salvou.
- **Proposta:** após o `PATCH`, mostrar `HpsmMessage kind="success"` "Registro
  atualizado." na barra de mensagens (padrão do HPSM).
- **Onde mexer:** `quickUpdate` em `apps/web/src/pages/EntryDetailPage.tsx`.
- ✅ **Implementado:** "Registro atualizado." após cada mudança de Status/Veredito.

### 3. Diálogo de confirmação em ações destrutivas
- **Problema:** Revogar chave, Suspender usuário e Descartar VM executam com um
  clique.
- **Proposta:** componente `HpsmConfirm` no estilo HPSM (caixa com cabeçalho em
  gradiente, ícone de aviso, botões cinza **Sim** / **Não**, Esc = Não, foco inicial
  em Não) e um hook `useConfirm()` que devolve uma `Promise<boolean>`.
- **Onde mexer:** novo `components/HpsmConfirm.tsx`; usos em `AdminPage.tsx`,
  `SandboxPanel.tsx` e `SandboxConsoleWindowPage.tsx`.
- ✅ **Implementado:** `ConfirmProvider` (em `main.tsx`) + `useConfirm()`. Pedem
  confirmação: Revogar chave, Suspender usuário, Redefinir senha e Descartar ambiente
  (painel e janela do console). Reativar não pede.

### 4. Aviso de alterações não salvas
- **Problema:** fechar a aba de documento ou navegar no meio de um relatório ou
  envio perde o que foi digitado.
- **Proposta:** hook `useUnsavedChanges(dirty)` que (a) pergunta "Salvar as
  alterações?" ao fechar a aba de documento, (b) ativa o `beforeunload` do navegador.
- **Onde mexer:** `components/workspace.tsx` (o `close` consulta as abas "sujas"),
  `SubmitPage.tsx`, `EntryReportsTab.tsx` e `UserPage.tsx`.
- **Cuidados:** o app usa `<BrowserRouter>`/`<Routes>`; o `useBlocker` do React Router
  exige um *data router*. Começar pelo fechamento de aba e pelo `beforeunload`, ou
  migrar para `createBrowserRouter`.
- ✅ **Implementado:** `main.tsx` migrou para `createBrowserRouter` (uma rota `*` que
  renderiza o `App`; as `<Routes>` continuam iguais). Hook
  `components/useUnsavedChanges.ts` (`useBlocker` + `beforeunload`) com o diálogo
  "Alterações não salvas — [Descartar] [Continuar editando]". Vale para trocar de
  tela, trocar de aba interna (`?tab=`), Voltar e fechar a aba de documento — a aba
  ativa só sai da faixa quando a navegação acontece. Aplicado em Enviar Amostra, Novo
  relatório, Alterar senha e Preferências. O "Sair" também pergunta desde o item 47.

### 5. Filtros, ordenação e página na URL
- **Problema:** ao trocar de aba de documento a página é recriada e perde busca,
  filtros, ordenação e página.
- **Proposta:** guardar `q`, `type`, `status`, `verdict`, `sort`, `dir` e `offset` em
  `?query` (o `workspace.tsx` já reabre cada aba na última URL). De quebra, o link de
  uma busca pode ser compartilhado.
- **Onde mexer:** `GlobalHistoryPage.tsx` e `MyUploadsPage.tsx` (trocar os `useState`
  por `useSearchParams`, mantendo o *debounce* da busca).
- ✅ **Implementado:** hook `components/useEntryListState.ts`, usado pelas duas listas.
  Valores padrão não aparecem na URL; "Limpar" zera busca e filtros e mantém a
  ordenação.

### 18. Limite de tentativas no login e na troca de senha
- **Problema:** não há limite de tentativas em `/api/auth/login` nem em
  `/api/me/password`.
- **Proposta:** `@fastify/rate-limit` nessas rotas (ex.: 5 tentativas / 5 min por IP +
  e-mail) com a mensagem "Muitas tentativas. Tente novamente em alguns minutos."
- **Onde mexer:** `apps/api/src/index.ts`, `routes/auth.ts`, `routes/me.ts`.
- **Cuidados:** atrás do Cloudflare Tunnel, configurar `trustProxy` para pegar o IP
  real.
- ✅ **Implementado:** `@fastify/rate-limit` (só nas rotas que pedem) com o helper
  `lib/rate-limit.ts`: 5 tentativas a cada 5 min, chave por **e-mail** no login e por
  **sessão** na troca de senha — não por IP, porque o `X-Forwarded-For` pode ser
  forjado. Resposta 429 "Muitas tentativas. Tente novamente em N minutos."
  Efeito colateral aceito: alguém pode travar o login de um e-mail por 5 minutos.

---

## 🟡 Fluxo de trabalho dos analistas

### 6. "Minha fila" com contadores no navegador
- **Proposta:** pasta **Filas** no Navegador do Sistema com contadores, como as filas
  do HPSM: "Pendentes (12)", "Em análise (3)", "Concluídas hoje (5)". Cada item abre o
  Histórico Global já filtrado (depende da ideia 5).
- **Onde mexer:** API `GET /api/entries/counts` (um `groupBy` por status);
  `HpsmSidebar.tsx` (folhas com contador, atualização periódica via React Query).
- ✅ **Implementado:** pasta **Filas** (analistas e admins) com **Pendentes**,
  **Em análise** e **Concluídas** — bolinha de status e contador; cada uma abre o
  Histórico Global com `?status=`. Contadores atualizam a cada minuto e após a
  triagem. O destaque do navegador passou a escolher a folha mais específica que
  bate com a URL (a fila, não o Histórico). "Concluídas hoje" virou "Concluídas"
  (não há filtro por data na API ainda); "Atribuídas a mim" depende da ideia 7.

### 7. Atribuição de amostra a um analista
- **Proposta:** campo **Responsável** na triagem e ação "Assumir análise" na toolbar,
  evitando dois analistas na mesma amostra; filtro "Responsável" nas listas; fila
  "Atribuídas a mim" (ideia 6).
- **Onde mexer:** `Entry.assigneeId` no `schema.prisma` + migração; `PatchSchema` em
  `routes/entries.ts`; `EntryDetailPage.tsx`; `EntriesTable.tsx` (coluna).
- ✅ **Implementado:** `Entry.assigneeId` (migração
  `20261022000000_assignee_and_entry_events`); `PATCH /api/entries/:id` aceita
  `assigneeId` (só analistas atribuem, e só a analistas/admins ativos);
  `GET /api/analysts`; filtro `assignee=me|none` e ordenação pela coluna Responsável.
  Na amostra: botão **Assumir análise** na toolbar, campo **Responsável** na triagem e
  "Responsável" no resumo. Listas com coluna e filtro "Responsável"; fila
  **Atribuídas a mim (N)** no navegador (abertas, sem as concluídas).

### 8. Aba "Histórico" (auditoria) na amostra
- **Proposta:** aba **Histórico** com a linha do tempo da amostra: envio, mudanças de
  status/veredito (de → para), relatórios publicados, abertura/descarte de sandbox —
  quem e quando. Equivale à aba "Atividades" do HPSM.
- **Onde mexer:** modelo `EntryEvent` + migração; gravação nos pontos de mudança em
  `routes/entries.ts`, `routes/reports.ts` e `routes/sandbox.ts`;
  `GET /api/entries/:id/events`; nova aba em `EntryDetailPage.tsx` usando a grade.
- ✅ **Implementado:** modelo `EntryEvent` (helper `lib/events.ts`) gravado no envio,
  em mudanças de status/veredito/responsável, em relatórios (rascunho/publicado — a
  publicação também registra as mudanças de status e veredito), e na abertura,
  descarte, expiração e **falha de provisionamento** do sandbox (expiração e falha com
  autor "Sistema"; a falha guarda a mensagem de erro — migração
  `20261023000000_sandbox_failed_event`). A migração cria o
  evento "Amostra enviada" para as amostras já existentes. Aba **Histórico** na
  amostra (Data · Usuário · Evento), visível para todos.

### 9. Anterior / Próximo na ficha da amostra
- **Proposta:** botões ◀ ▶ na toolbar da amostra para percorrer os resultados da
  lista de onde ela foi aberta, sem voltar à lista.
- **Onde mexer:** `EntriesTable.tsx` guarda os ids da página atual (ex.:
  `sessionStorage` ou contexto do workspace) ao abrir uma linha;
  `EntryDetailPage.tsx` lê e mostra os botões (desabilitados nas pontas).
- ✅ **Implementado:** `components/entryNav.ts` guarda a sequência da página ao abrir
  uma linha; a toolbar da amostra mostra **◀ Anterior / Próxima ▶** (desabilitados
  nas pontas) e "Registro N de M". O registro troca **na mesma aba de documento**
  (se o destino já tinha aba, a de origem fecha) e mantém a aba interna (`?tab=`).
  Limite: a sequência é a página atual da lista (não passa para a próxima página).

---

## 🟡 Envio de amostras

### 10. Detecção de duplicata pelo SHA-256
- **Proposta:** ao escolher o arquivo, calcular o SHA-256 no navegador
  (`crypto.subtle.digest`) e consultar a API; se já existir, avisar na barra de
  mensagens "Esta amostra já foi enviada" com link para o registro e o veredito.
  O envio continua permitido (contexto novo pode ser útil).
- **Onde mexer:** `SubmitPage.tsx`; API com busca **exata** por hash (hoje `q`
  procura `contains`), ex. `GET /api/entries?sha256=`.
- **Cuidados:** arquivos grandes — calcular sob demanda e mostrar `HpsmLoading`.
- ✅ **Implementado:** filtro exato `sha256` em `GET /api/entries`; em Enviar Amostra
  o hash aparece no formulário e, se já existir, um aviso com link e veredito. Sem
  `crypto.subtle` (HTTP sem TLS fora do localhost) a checagem é pulada.

### 11. Arrastar e soltar o arquivo
- **Proposta:** área de soltar na seção "Dados do arquivo" mostrando nome, tamanho e
  (com a ideia 10) o hash antes do envio.
- **Onde mexer:** `SubmitPage.tsx` (`FileUploaderDropContainer` do Carbon ou área
  própria com o skin HPSM).
- ✅ **Implementado:** componente próprio `components/HpsmFileDrop.tsx` no lugar do
  `FileUploader` do Carbon: área "Arraste o arquivo aqui ou [Selecionar arquivo]"
  (destaque ao arrastar por cima) e, depois, a linha com nome, tamanho e "Remover".
  O hash e o aviso de duplicata (ideia 10) aparecem logo abaixo.

---

## ⚪ Acabamento

### 12. Botões de copiar
- **Proposta:** ícone de copiar ao lado de SHA-256, URL e IOCs, com "Copiado." na
  barra de mensagens.
- **Onde mexer:** prop `copyable` em `HpsmReadonly` (`components/HpsmForm.tsx`) usando
  `navigator.clipboard`; usos em `EntryDetailPage.tsx` e `EntryReportsTab.tsx`.
- ✅ **Implementado:** componente `components/CopyButton.tsx` (ícone 16px; confirma
  "Copiado" no próprio botão, sem poluir a barra de mensagens; sem Clipboard API cai
  no `execCommand('copy')`) e prop `copyable` no `HpsmReadonly`. Usado em SHA-256 e
  URL da amostra, IOCs dos relatórios, SHA-256 calculado em Enviar Amostra e, no
  Admin, nos códigos das chaves, na chave criada e na senha temporária.

### 13. Avisos ao entrar
- **Proposta:** na Página Inicial, mensagem "2 amostras suas foram concluídas desde a
  sua última visita" com link para Meus Uploads.
- **Onde mexer:** `User.lastSeenAt` (ou data da sessão anterior) + endpoint de
  novidades; `WelcomePage.tsx`.
- ✅ **Implementado:** `User.lastSeenAt`/`previousSeenAt` (migração
  `20261024000000_user_visits`), atualizados em `GET /api/auth/me`: abrir o app depois
  de mais de 30 min parado conta como nova visita. `GET /api/me/updates` usa o
  histórico (ideia 8) — amostras do usuário concluídas por outra pessoa depois da
  visita anterior. A Página Inicial mostra o aviso na barra de mensagens e a seção
  "Novidades desde a sua última visita" (amostra, veredito, data).

### 14. Prazo do sandbox à vista
- **Proposta:** tempo restante no título da aba de documento da amostra
  ("instalador.exe · 12min") e aviso na barra de mensagens 5 minutos antes de a VM
  expirar, com atalho para "Estender prazo".
- **Onde mexer:** `useSandboxCountdown` (`components/sandboxStatus.ts`) +
  `useWorkspaceTitle` em `EntryDetailPage.tsx`; aviso em `SandboxPanel.tsx`.
- ✅ **Implementado:** `useMinutesLeft` (atualiza a cada 15s). Com o ambiente em
  execução a aba de documento mostra **"12min · nome"** (prazo antes do nome, para não
  sumir no corte) e volta ao nome simples ao sair da tela (`useWorkspaceTitle` ganhou
  `titleOnLeave`). Nos últimos 5 min a barra de mensagens avisa "expira em N min" com
  o link **Estender prazo** — visível em qualquer aba da amostra.

### 15. Atalhos de teclado
- **Proposta:** `/` foca a busca da lista, `Alt+N` abre Enviar Amostra, `Ctrl+S`
  salva o formulário aberto (toolbar), `Alt+W` fecha a aba de documento. Lista na
  Página Inicial (seção Dicas).
- **Onde mexer:** um *handler* global em `AppShell.tsx`; registro do "salvar" atual
  via contexto pelas páginas com formulário.
- ✅ **Implementado:** `components/shortcuts.tsx` (`ShortcutsProvider` na casca +
  `useSaveShortcut`). `/` foca a busca, `Alt+N` abre Enviar Amostra, `Alt+W` fecha a
  aba de documento (respeitando o aviso de alterações não salvas) e `Ctrl+S` salva
  Enviar Amostra, Novo relatório, Alterar senha e Preferências — os botões mostram o
  atalho na dica. Lista dos atalhos na Página Inicial (Dicas).

### 16. Linhas da grade navegáveis pelo teclado
- **Proposta:** linhas focáveis, setas ↑↓ movem o foco, Enter abre a amostra; linha
  com foco destacada como a seleção do HPSM. Hoje só abre com o mouse.
- **Onde mexer:** `EntriesTable.tsx` (`tabIndex`, `onKeyDown`, *roving tabindex*).
- ✅ **Implementado:** só uma linha entra no Tab; ↑ ↓ Home End movem o foco; Enter ou
  Espaço abrem a amostra; a linha com foco usa o destaque de seleção
  (`.hpsm-grid-row`).

### 17. Exportar CSV da lista filtrada
- **Proposta:** ação **Exportar CSV** na linha de filtros (ou menu "Mais ▾"),
  respeitando filtros e ordenação.
- **Onde mexer:** API `GET /api/entries/export.csv` com os mesmos parâmetros de
  `ListQuery` (sem o limite de 100); botão em `HpsmFilterBar`.
- ✅ **Implementado:** `GET /api/entries/export.csv` reaproveita os filtros da lista
  (`listWhere`) e a ordenação, sem paginação (até 10 mil linhas). CSV para o Excel
  em português (`;` e BOM UTF-8), rótulos em português e proteção contra injeção de
  fórmula (`lib/csv.ts`). Botão **Exportar CSV** na barra de filtros do Histórico
  Global e de Meus Uploads.

---

## Segunda leva — ideias 19 a 30

Novas ideias depois da primeira leva, todas baseadas em padrões que existem no próprio
HP Service Manager 9 (indicados em cada item).

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 19 | Lista com painel de detalhe | lista e registro na mesma tela | 🟡 | M | ✅ |
| 20 | Atualização em massa | Mass Update | 🟡 | M | ✅ |
| 21 | Visões salvas e Favoritos | Favoritos e Painéis | 🟡 | M–G | ✅ |
| 22 | Registros relacionados | aba Related Records | 🟡 | M | ✅ |
| 23 | Atualizações / comentários na amostra | Activities → Update | 🟡 | M | ✅ |
| 24 | Idade na fila e alerta de prazo | relógios de SLA | ⚪ | P–M | ✅ |
| 25 | Aviso de sessão expirando | aviso de timeout | ⚪ | P | ✅ |
| 26 | Validação de campos no estilo HPSM | campos obrigatórios destacados | 🟡 | P | ✅ |
| 27 | Busca rápida no masthead | busca/ir para registro | ⚪ | P | ✅ |
| 28 | Menu "Mais ▾" na toolbar | More Actions | ⚪ | P | ✅ |
| 29 | Ficha para impressão | impressão do registro | ⚪ | P | ✅ |
| 30 | Ajuda de atalhos (`?` / F1) | Ajuda | ⚪ | P | ✅ |

**Ordem sugerida:** 19 → 20 (maior ganho para quem faz triagem todos os dias), depois
os pequenos 27, 26, 25 e 30. As ideias 21 e 23 envolvem banco; 22 depende de índices.

### 19. Lista com painel de detalhe
- **Problema:** para triar várias amostras o analista abre uma por uma; cada abertura
  troca de tela (e cria/reaproveita uma aba de documento).
- **Proposta:** como no HPSM, **clique simples seleciona** a linha e mostra um painel
  abaixo da grade com o resumo da amostra (tipo, status, veredito, responsável,
  SHA-256/URL, último relatório publicado); **duplo clique ou Enter abre** o registro.
  Uma preferência liga/desliga o painel.
- **Onde mexer:** `EntriesTable.tsx` (estado de seleção; hoje o clique abre), novo
  `EntryPreviewPane.tsx` usando `GET /api/entries/:id` (o cache do React Query é o
  mesmo da ficha); preferência em `lib/preferences.ts` / `UserPage.tsx`.
- **Cuidados:** muda o comportamento do clique — manter Enter abrindo; a navegação por
  setas (ideia 16) passa a atualizar o painel; `aria-selected` na linha.
- ✅ **Implementado (decisão: opcional):** preferência **Painel de detalhe** em Minha
  Conta, **desligada por padrão** — desligada, o clique continua abrindo a amostra.
  Ligada, o clique (e as setas) selecionam a linha e mostram `EntryPreviewPane` abaixo
  da grade (tipo, envio, status, veredito, responsável, tags, SHA-256/URL copiável e
  último relatório publicado); duplo clique, Enter ou "Abrir amostra" abrem a ficha.
  O painel usa o mesmo cache da ficha (`['entry', id]`).

### 20. Atualização em massa
- **Problema:** mudar status, veredito ou responsável de muitas amostras exige abrir
  cada uma.
- **Proposta:** coluna de seleção (caixa) na grade para analistas e uma barra
  "N selecionadas: [Status ▾] [Veredito ▾] [Responsável ▾] [Aplicar]", com
  confirmação ("Atualizar 12 amostras?") e o resultado na barra de mensagens
  ("12 atualizadas").
- **Onde mexer:** API `POST /api/entries/bulk` `{ ids, patch }` com as mesmas regras do
  `PATCH` (em transação, gravando os eventos de cada amostra com `recordTriageChanges`);
  `EntriesTable.tsx` (seleção por página); `HpsmConfirm`.
- **Cuidados:** limite de ids por chamada (ex.: 100); a seleção é limpa ao trocar filtro
  ou página; usuários comuns não veem a coluna.
- ✅ **Implementado:** `POST /api/entries/bulk { ids (1–100), patch }` só para analistas,
  com os helpers `resolveAssignee`/`applyTriage` compartilhados com o `PATCH` (mesmas
  regras e eventos de histórico por amostra, numa transação; ids inexistentes voltam
  em `notFound`). Na grade: coluna de seleção (cabeçalho marca a página, com estado
  indeterminado), **Espaço** marca a linha, e a barra **`EntriesBulkBar`** com Status /
  Veredito / Responsável "(manter)", confirmação listando as mudanças e o resultado
  na barra de mensagens. Trocar filtro ou página limpa a seleção.

### 21. Visões salvas e Favoritos
- **Problema:** combinações de filtro usadas todo dia (ex.: "phishing pendentes") são
  remontadas à mão; amostras acompanhadas não têm atalho.
- **Proposta:** botão **Salvar visão** na barra de filtros (pede um nome) cria um nó na
  pasta **Favoritos** do navegador, que abre a URL salva; **Fixar** na toolbar da
  amostra adiciona a amostra à mesma pasta. Renomear e remover pelo clique direito ou
  por um "×" no nó.
- **Onde mexer:** modelo `Favorite { userId, kind: VIEW | ENTRY, label, url | entryId,
  position }` + migração; rotas `GET/POST/PATCH/DELETE /api/me/favorites`;
  `HpsmSidebar.tsx` (pasta dinâmica); `HpsmFilterBar.tsx` e `EntryDetailPage.tsx`.
- **Cuidados:** aceitar só URLs relativas do próprio app; limite de favoritos por
  usuário (ex.: 30).
- ✅ **Implementado:** modelo `Favorite` (migração `20261025000000_favorites`) e rotas
  em `routes/favorites.ts`: `GET/POST /api/me/favorites`, `PATCH`/`DELETE
  /api/me/favorites/:id` e `PUT /api/me/favorites/order`. A API aceita só caminhos do
  próprio app (`/…`, sem host, `//` ou `\`), até 30 favoritos, e recusa visão ou
  amostra repetida (409, citando o nome já salvo). Amostra apagada some dos favoritos
  (cascade).
  - **Salvar visão** na barra de filtros (Histórico Global e Meus Uploads) pede o nome
    numa caixa HPSM (`usePrompt`), já sugerido pelos filtros ("Pendente · Suspeito"),
    e guarda busca, filtros e ordenação, sem a página.
  - **Fixar / Desafixar** na toolbar da ficha (ícone de estrela; fica "afundado"
    quando fixada).
  - Pasta **Favoritos** no navegador, logo abaixo da Página Inicial: visão salva com
    ícone de funil, amostra com ícone de página; o favorito da tela atual fica
    destacado. Clique direito ou Shift+F10 abrem o menu de contexto (Abrir,
    Renomear, Mover para cima/baixo, Remover); F2 renomeia, Delete remove (com
    confirmação) e o "×" aparece ao passar o mouse.

### 22. Registros relacionados
- **Problema:** campanhas reaparecem com amostras parecidas, e hoje não há como ver a
  ligação entre elas.
- **Proposta:** aba **Relacionadas** na amostra com outras amostras do mesmo domínio
  (`urlDomain`), do mesmo SHA-256 (reenvios), com tags em comum e, numa segunda fase,
  com IOCs coincidentes nos relatórios; coluna **Motivo** explica a ligação.
- **Onde mexer:** `GET /api/entries/:id/related`; componente com a grade de sempre;
  índice em `Entry.urlDomain` (migração).
- **Cuidados:** limitar o resultado (ex.: 50) e ordenar por relevância; IOCs exigem
  extrair e normalizar tokens dos relatórios (fase 2).
- ✅ **Fase 1 implementada:** `GET /api/entries/:id/related` (`routes/related.ts`) junta
  amostras com o **mesmo SHA-256**, o **mesmo host**, o **mesmo domínio-base**
  (`lib/domains.ts`: `login.banco.com.br` ↔ `www.banco.com.br`, entendendo `com.br`,
  `co.uk`...) e **tags em comum**. Pesos: SHA-256 100, host 60, domínio-base 40, 15 por
  tag; empate → mais recente. Devolve as 50 mais relevantes, com `total`. Índice em
  `Entry.urlDomain` (migração `20261026000000_entry_url_domain_index`).
  - Aba **Relacionadas (n)** na ficha (`components/EntryRelatedTab.tsx`), com a coluna
    **Motivo** (vários motivos na mesma linha) e rodapé "Exibindo as 50 mais
    relevantes de N".
  - Clique ou Enter abrem a amostra, e Anterior/Próxima passam a percorrer as
    relacionadas.
- ✅ **Fase 2 implementada (IOCs em comum):** tabela `ReportIoc` (migração
  `20261029000000_report_iocs`) com os indicadores do campo **IOCs** dos relatórios
  **publicados**.
  - **Indexação:** `lib/iocs.ts` refaz o índice a cada criação, edição, publicação ou
    despublicação. Apagar o relatório limpa os IOCs (cascade). Na subida, a API indexa
    os relatórios publicados que ainda não têm IOCs (bases antigas).
  - **Extração:**
    - desarma `hxxp`, `[.]`, `(.)`, `[dot]`, `[:]` e `[@]`;
    - reconhece domínios (inclusive o host de URLs), IPv4 públicos (privados, loopback
      e multicast ficam de fora), e-mails e hashes MD5/SHA-1/SHA-256;
    - grava tudo em minúsculas;
    - ignora "domínios" que são nomes de arquivo (`updater.exe`, `kernel32.dll`) e
      alguns domínios onipresentes (google.com, microsoft.com...);
    - guarda no máximo 200 por relatório.
  - **Motivo `SHARED_IOCS`** na aba Relacionadas, em três casos:
    - outro relatório publicado cita o mesmo indicador;
    - outro relatório cita o arquivo ou o domínio desta amostra;
    - um IOC dos relatórios desta é o arquivo ou o domínio de outra amostra.

    Pesa 50 por indicador, até 3. Na grade aparece "IOCs em comum: a, b, c (+N)",
    com hashes encurtados e a lista completa na dica.
  - **Fora do escopo:** o campo Achados não é lido. A extração usa só o campo IOCs,
    para evitar falsos positivos.

### 23. Atualizações / comentários na amostra
- **Problema:** notas do analista ("pedi mais informações ao remetente") não têm lugar;
  relatórios são formais demais para isso. Comentários estão no Roadmap do README.
- **Proposta:** campo **Nova atualização** na aba Histórico (salvar com Ctrl+S); as
  atualizações entram na linha do tempo com autor e data, visíveis para todos.
- **Onde mexer:** novo tipo de evento `COMMENT` (migração do enum) com o texto no
  `detail`, ou modelo próprio se precisar de edição; `POST /api/entries/:id/comments`;
  `EntryHistoryTab.tsx`.
- **Cuidados:** texto puro (sem HTML), até 4000 caracteres; limite de tentativas como
  nas outras rotas de escrita.
- ✅ **Implementado:** evento `COMMENT` (migração `20261027000000_comment_event`), com o
  texto no `detail`, e `POST /api/entries/:id/comments { text }`.
  - **Na API:**
    - qualquer usuário logado registra, e todos veem;
    - o texto é normalizado: quebras de linha unificadas, sem caracteres de controle,
      espaços aparados, de 1 a 4000 caracteres;
    - limite de 10 envios por minuto por sessão (`attemptLimit(sessionKey('comment'),
      { max, windowMs })`; o limite da troca de senha passou a usar o mesmo
      `sessionKey`);
    - as atualizações não são editáveis: ficam como registro de auditoria.
  - **Na aba Histórico:**
    - seção **Nova atualização** com contador `n/4000`, validação HPSM, Ctrl+S e aviso
      de alterações não salvas;
    - na linha do tempo, "Atualização:" + texto, com quebras de linha preservadas e
      fundo de nota (`--dl-note-bg`);
    - caixa **Somente atualizações (n)**.
  - **Correção junto:** o formulário de Novo relatório agora limpa o destaque de
    validação depois de salvar (`reportCheck.reset()`).

### 24. Idade na fila e alerta de prazo
- **Problema:** nada indica há quanto tempo uma amostra espera triagem.
- **Proposta:** coluna **Idade** na grade (tempo desde o envio ou desde que entrou no
  status atual), com bolinha laranja depois de X horas e vermelha depois de Y para as
  não concluídas; fila **Atrasadas (N)** no navegador.
- **Onde mexer:** a API devolve `statusChangedAt` (do último `STATUS_CHANGED` do
  histórico); limites em variáveis de ambiente (`SLA_WARN_HOURS`, `SLA_LATE_HOURS`) ou
  numa tela de configurações do Admin; `EntriesTable.tsx` e `HpsmSidebar.tsx`.
- **Cuidados:** decidir se a idade conta desde o envio ou desde o status atual.
- ✅ **Implementado (idade desde a entrada no status atual; alerta 24 h, atraso 72 h):**
  - **Banco:** coluna `Entry.statusChangedAt` (migração
    `20261028000000_entry_status_changed_at`). As amostras existentes recebem a data da
    última mudança de status do histórico, ou o envio se não houver. Um **trigger no
    Postgres** atualiza a data a cada mudança de status, por qualquer caminho
    (triagem, ação em massa, publicação de relatório), sempre em UTC.
  - **Configuração:** limites em `SLA_WARN_HOURS` e `SLA_LATE_HOURS` (`lib/sla.ts`).
  - **API:**
    - `GET /api/entries` aceita `age=warn|late` (não concluídas acima do limite) e
      `sort=age`, e devolve `sla` (os limites);
    - `GET /api/entries/:id` também devolve `sla`;
    - `GET /api/entries/counts` traz `late`;
    - o CSV ganhou a coluna "No status desde".
  - **Telas:**
    - coluna **Idade** ("1 d 6 h") na grade, ordenável, com bolinha laranja em alerta
      e vermelha quando atrasada; concluídas mostram "—"; a dica mostra a situação e
      os limites;
    - filtro **Prazo** no Histórico Global;
    - fila **Atrasadas (N)** no navegador;
    - **No status há** no resumo da ficha (`components/sla.tsx`: `AgeText`,
      `slaLevel`, `formatAge`).

### 25. Aviso de sessão expirando
- **Problema:** a sessão expira num horário fixo (`SESSION_TTL_HOURS`, padrão 168h, sem
  renovação); quem está escrevendo um relatório na hora pode perder o texto.
- **Proposta:** dois minutos antes, caixa "Sua sessão expira em 2 min — [Continuar
  conectado] [Sair]"; continuar renova a sessão.
- **Onde mexer:** `GET /api/auth/me` devolve `sessionExpiresAt`; nova rota
  `POST /api/auth/refresh` (estende `expiresAt` e o cookie); aviso agendado no
  `AuthContext` usando o diálogo do `HpsmConfirm`.
- **Cuidados:** com 7 dias de validade o aviso é raro; o ganho é maior se o projeto
  adotar expiração por inatividade (ex.: 30 min) — decidir a política antes.
- ✅ **Implementado (política: inatividade de 30 min):** a sessão vale
  `SESSION_IDLE_MINUTES` (padrão 30) desde a última atividade, nunca além do teto
  `SESSION_TTL_HOURS` contado da criação. Só o login e `POST /api/auth/touch` renovam;
  `GET /api/auth/session` consulta a validade sem renovar (polling não conta como
  atividade). No front, `components/SessionWatcher.tsx` (dentro do `AuthProvider`):
  teclado, mouse, rolagem e toque — inclusive no console do sandbox — renovam no
  máximo 1x/min; 2 min antes do fim confere no servidor (outra janela pode ter
  renovado), renova se houve atividade recente ou mostra a caixa "Sessão expirando"
  com contagem regressiva **[Continuar conectado] [Sair]** (com ela aberta, só o
  botão renova). Ao expirar, fecha as abas e volta ao login com "Sua sessão expirou
  por inatividade. Entre novamente." — sem a pergunta de alterações não salvas.

### 26. Validação de campos no estilo HPSM
- **Problema:** hoje um campo obrigatório vazio gera só uma mensagem genérica na barra.
- **Proposta:** ao salvar, os campos obrigatórios vazios ou inválidos ficam com **borda
  vermelha**, a barra lista os campos ("Preencha: Resumo, Arquivo") e o foco vai para o
  primeiro; erros de validação da API (`details` do zod) são ligados aos campos.
- **Onde mexer:** `HpsmField` ganha `invalid`/`error` (`components/HpsmForm.tsx`);
  `SubmitPage.tsx`, `EntryReportsTab.tsx`, `UserPage.tsx`, formulário de chave do
  `AdminPage.tsx`.
- ✅ **Implementado:** hook `useRequiredFields([{ id, label, ok }])` e prop `invalid` no
  `HpsmField` (`components/HpsmForm.tsx`). No salvar: rótulo e borda vermelhos (também
  com foco), mensagem "Preencha ou corrija os campos destacados: …" e foco no primeiro;
  o destaque some quando o campo é corrigido. Aplicado em Enviar Amostra (arquivo e
  URL, que agora exige `http(s)://`), Novo relatório (Resumo) e Alterar senha (atual,
  nova ≥ 8 e confirmação igual).
- ✅ **Sobras implementadas:**
  - **Formulário de chave do Admin:**
    - Máximo de usos aceita um inteiro de 1 a 1000;
    - Validade aceita um inteiro de 1 a 3650 dias, ou em branco para sem prazo;
    - destaque, mensagem e foco quando algo está errado;
    - Ctrl+S gera a chave;
    - a API agora exige inteiros (`.int()`).
  - **Erros da API por campo:**
    - `lib/validation.ts` (`sendValidationError`) responde 400 com `error` e
      `details: { campo: [mensagem] }`, com as mensagens do zod em português
      ("obrigatório", "mínimo de 3 caracteres", "URL inválida", "e-mail inválido",
      "use um número inteiro"...);
    - rotas que usam: chave, cadastro, envio de URL, edição da amostra, relatório
      (criar/editar), troca de senha, atualização e favoritos.
  - **No front:** `useRequiredFields` ganhou `fromApi(err)`.
    - Destaca os campos citados (pelo `api` ou `id` do campo), com a mensagem
      "Corrija os campos destacados: Título (mínimo de 2 caracteres)." e foco no
      primeiro.
    - O destaque some quando o valor (`value`) muda.
    - Erros sem campo continuam na barra como antes.
    - Ligado em chave, envio de URL (título, descrição, tags), relatório (resumo,
      achados, IOCs), troca de senha, atualização e **cadastro**. No cadastro, o
      `AuthField` ganhou `invalid`, e a confirmação de senha diferente virou destaque
      no lugar do texto solto.

### 27. Busca rápida no masthead
- **Proposta:** campo **Ir para…** no masthead (ou atalho `Ctrl+K`): um SHA-256
  completo abre a amostra (filtro exato `sha256` que já existe); um id abre
  `/entries/:id`; qualquer outro texto abre o Histórico Global com `?q=`.
- **Onde mexer:** `HpsmTopBar.tsx` + componente do campo; a API já suporta tudo.
- **Cuidados:** no celular, só o ícone (o campo abre por cima).
- ✅ **Implementado:** `components/HpsmQuickSearch.tsx` — **"Ir para:"** no masthead
  (`Ctrl+K` foca). SHA-256 de uma amostra única abre a ficha; um ID (cuid) abre a
  amostra; o resto (inclusive hash desconhecido ou repetido) abre o Histórico Global com
  `?q=`. Abaixo de `52rem` o campo sai do masthead (a busca da lista continua).

### 28. Menu "Mais ▾" na toolbar
- **Proposta:** botão **Mais ▾** na toolbar da amostra agrupando ações menos usadas:
  copiar link do registro, imprimir ficha (ideia 29), exportar relatório
  (Markdown/PDF, do Roadmap), abrir em nova janela.
- **Onde mexer:** `HpsmToolbarMenu` em `components/HpsmToolbar.tsx`, reaproveitando o
  comportamento de teclado do `HpsmUserMenu.tsx`; `EntryDetailPage.tsx`.
- ✅ **Implementado:** `HpsmToolbarMenu` (`components/HpsmToolbar.tsx`) abre o
  `HpsmContextMenu` logo abaixo do botão **Mais ▾**. Clique, Enter, Espaço ou ↓ abrem;
  Esc fecha e devolve o foco; clicar de novo fecha. Na ficha da amostra:
  - **Copiar link do registro**;
  - **Abrir em nova janela**;
  - **Imprimir ficha…** (ideia 29);
  - **Exportar relatórios (Markdown)**: gerado no navegador (`components/entryExport.ts`)
    com os dados da amostra e só os relatórios publicados; desabilitado quando não há
    nenhum. O PDF sai pela ficha impressa ("Salvar como PDF").

### 29. Ficha para impressão
- **Proposta:** versão **Imprimir** da amostra com detalhes, relatórios publicados e
  histórico de uma vez (não só a aba ativa), com cabeçalho "impresso por / em".
- **Onde mexer:** rota dedicada `/entries/:id/imprimir` fora da casca (como a janela do
  console), com CSS `@media print`; chamada pelo menu "Mais ▾" (ideia 28).
- **Cuidados:** não incluir dados sensíveis do sandbox (credenciais de console).
- ✅ **Implementado:** `pages/EntryPrintPage.tsx` em `/entries/:id/imprimir`, fora da
  casca (como a janela do console).
  - **Conteúdo:** cabeçalho "DeepLook — Ficha da amostra" com **Impresso por / em**;
    Dados da amostra, Descrição, Relatórios publicados (rascunhos ficam de fora) e o
    Histórico completo, com as atualizações.
  - **Sandbox:** nenhuma informação do ambiente isolado entra na ficha.
  - **Impressão:** `?auto=1` (usado pelo menu) abre a caixa de impressão assim que
    carrega; a toolbar [Imprimir] [Fechar] some no papel; CSS `@media print` em A4,
    com cabeçalho da grade repetido e relatórios sem quebra no meio.
  - **Título da janela:** "Ficha — <amostra>", que também vira o nome sugerido do PDF.

### 30. Ajuda de atalhos (`?` / F1)
- **Proposta:** `?` (fora de campos de texto) ou F1 abre a caixa **Atalhos de
  teclado**, com a tabela de teclas.
- **Onde mexer:** `components/shortcuts.tsx` (já centraliza as teclas) + um diálogo
  genérico derivado do `HpsmConfirm`; uma única lista de atalhos compartilhada com as
  Dicas da Página Inicial, para não divergir.
- **Cuidados:** F1 abre a ajuda do navegador — usar `preventDefault`.
- ✅ **Implementado:** `?` (fora de campos de texto) ou F1 (em qualquer lugar) abrem a
  caixa **Atalhos de teclado** (`components/HpsmShortcutsHelp.tsx`), com a tabela
  agrupada em Geral, Listas e Formulários e caixas; Esc ou [Fechar] fecham e o foco
  volta para onde estava. Também no menu do usuário ("Atalhos de teclado", com ícone
  de ajuda). A lista única `SHORTCUT_GROUPS` (`components/shortcutList.tsx`) alimenta a
  caixa e as Dicas da Página Inicial (itens `tip`), que agora terminam com "Pressione
  ? / F1 para ver todos os atalhos.".

## Terceira leva — ideias 31 a 45

Funcionalidades que aproveitam o que o DeepLook já tem (índice de IOCs, histórico,
prazo, sandbox), mantendo o visual do HP Service Manager 9.

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 31 | Busca por IOC e ficha do indicador | registro de Configuration Item | 🔴 | P–M | ✅ |
| 32 | Exportação de IOCs (CSV / STIX / MISP) | Export | 🔴 | P–M | ✅ |
| 33 | Análise estática no envio | campos calculados do registro | 🟡 | M–G | ✅ |
| 34 | Marcar como duplicata | registro pai/filho | 🟡 | P–M | ✅ |
| 35 | Reputação externa (opcional) | integrações | ⚪ | M | ✅ |
| 36 | Caixa de entrada / notificações | To Do / Inbox | 🔴 | M | ✅ |
| 37 | Menções nas atualizações | notificação por atividade | 🟡 | P | ✅ |
| 38 | Modelos de relatório | Templates | 🟡 | P | ✅ |
| 39 | Revisão de relatório (quatro olhos) | aprovação | ⚪ | M | ✅ |
| 40 | Painel do analista | Dashboards | 🟡 | M | ✅ |
| 41 | Auditoria administrativa | log de auditoria | 🟡 | P–M | ✅ |
| 42 | Status do sistema | System Status | ⚪ | P | ✅ |
| 43 | Tokens de API pessoais | Web Services | ⚪ | M | ✅ |
| 44 | Envio em lote | anexos múltiplos | 🟡 | M | ✅ |
| 45 | Retenção de amostras | arquivamento/expurgo | ⚪ | M | ✅ |

**Ordem sugerida:**
1. 31 + 32 (o índice de IOCs já existe).
2. 36 + 37 (fecham o ciclo de atribuição e atualizações).
3. As pequenas: 38, 34 e 42.
4. 40 e 33.

**Antes de qualquer código:** 35 (falar com serviços externos) e 43 (acesso por token)
precisam de uma decisão de segurança.

### 31. Busca por IOC e ficha do indicador
- **Problema:** "onde mais esse IP apareceu?" exige abrir amostra por amostra.
- **Proposta:**
  - O "Ir para:" do masthead reconhece IP, domínio, e-mail ou hash (inclusive
    desarmados: `hxxp`, `[.]`) e abre a **ficha do indicador** em `/iocs/:tipo/:valor`.
  - A ficha mostra o tipo e o valor, a primeira e a última aparição, e a grade de
    amostras ligadas, com o motivo de cada uma: citado num relatório, é o arquivo
    (SHA-256) ou é o domínio da amostra.
  - Os indicadores na aba Relacionadas e nos relatórios viram links para a ficha.
- **Onde mexer:**
  - API: `GET /api/iocs/lookup?q=` (normaliza com a mesma extração de `lib/iocs.ts`) e
    `GET /api/iocs/:kind/:value`.
  - Front: `pages/IocPage.tsx`, `HpsmQuickSearch.tsx`.
- **Cuidados:** a ficha só lista relatórios publicados; um hash que é o SHA-256 de uma
  amostra aparece mesmo sem relatório.
- ✅ **Implementado:**
  - **API** (`routes/iocs.ts`):
    - `GET /api/iocs/lookup?q=` reconhece o indicador com a mesma extração do índice
      (`hxxp`, `[.]`, URL inteira → domínio; IP privado não conta);
    - `GET /api/iocs/:tipo/:valor` devolve as amostras com o motivo de cada uma
      (relatório publicado, com analista e data; o arquivo; o domínio da URL), a
      primeira e a última aparição, até 200 amostras;
    - `GET /api/entries/:id/iocs` lista os indicadores da amostra.
  - **Ficha** (`pages/IocPage.tsx`, rota `/iocs/:tipo/:valor`): título "IPv4:
    185.0.2.10", resumo (tipo, valor com botão de copiar, primeira e última aparição,
    total), grade navegável pelo teclado (Anterior/Próxima percorrem as amostras da
    ficha) e aba de documento "IOC · valor".
  - **"Ir para:":** um indicador abre a ficha. Um SHA-256 sem amostra também abre a
    ficha (antes caía na busca por texto). Texto comum e IP privado continuam indo
    para a lista.
  - **Links para a ficha:** seção **Indicadores reconhecidos** na aba Relatórios
    (tipo, valor e origem) e os IOCs em comum da aba Relacionadas.
  - **Correção junto:** o título definido por uma tela logo no primeiro render se
    perdia, porque a aba ainda não existia. O `WorkspaceProvider` agora guarda o
    título e o aplica ao criar a aba.

### 32. Exportação de IOCs (CSV / STIX / MISP)
- **Problema:** levar os indicadores para firewall, SIEM ou MISP é copiar e colar.
- **Proposta:**
  - Item "Exportar IOCs ▸ CSV / STIX 2.1 / MISP" no menu "Mais ▾" da amostra (IOCs
    dos relatórios publicados + o próprio arquivo ou domínio).
  - O mesmo para o resultado da ficha do indicador.
- **Onde mexer:** `GET /api/entries/:id/iocs.(csv|stix|misp)`, gerado na API;
  `lib/ioc-export.ts`.
- **Cuidados:**
  - STIX 2.1: um `indicator` por IOC, com `pattern` no formato STIX, mais um `bundle`
    com ids `indicator--<uuid v5>` estáveis.
  - MISP: evento JSON com `Attribute` (`ip-dst`, `domain`, `email-src`, `md5`, `sha1`,
    `sha256`).
  - Só indicadores de relatórios publicados.
- ✅ **Implementado:** `GET /api/entries/:id/iocs/export?format=csv|stix|misp`
  (`lib/ioc-export.ts`), no menu **Mais ▾ > Exportar IOCs (CSV / STIX 2.1 / MISP)**.
  - **O que entra:** os IOCs dos relatórios publicados, o SHA-256 do arquivo, a URL e
    o domínio da amostra.
  - **CSV:** `;` com BOM, como o export da lista.
  - **STIX 2.1:** `bundle` com a identidade "DeepLook" e um `indicator` por IOC, com
    `pattern` STIX escapado e `indicator_types` pelo veredito. Os ids são UUID v5, os
    mesmos a cada exportação.
  - **MISP:** evento com `threat_level_id` e `analysis` pelo veredito e pelo status;
    e-mails com `to_ids: false`.
  - **Mudança no plano:** a ficha do indicador não ganhou exportação própria. A
    exportação é por amostra, e a ficha leva às amostras.

### 33. Análise estática no envio
- **Problema:** informações básicas do arquivo (tipo real, se é executável, entropia)
  dependem de abrir o sandbox.
- **Proposta:** ao receber o arquivo, a API calcula:
  - o tipo real pelos *magic bytes*, com aviso quando a extensão engana
    (`fatura.pdf` que é PE);
  - a entropia (indício de empacotamento);
  - as strings legíveis mais relevantes (URLs, IPs, caminhos);
  - para PE: arquitetura, data de compilação, seções e DLLs importadas.
  
  Tudo aparece na seção "Análise estática" da ficha.
- **Onde mexer:** `lib/static-analysis.ts` (leitura do objeto no MinIO em stream, com
  limite de tamanho), coluna `Entry.staticInfo Json`, seção na aba Detalhes.
- **Cuidados:** nunca executar o arquivo; ler com limite de bytes e tempo; strings que
  parecem IOC podem sugerir (não gravar) IOCs no relatório.
- ✅ **Implementado:** `lib/static-analysis.ts`, só leitura de bytes (sem executar nem
  descompactar), gravada em `Entry.staticInfo` (JSONB, migração
  `20261102000000_entry_static_info`) no upload. Uma falha na análise não impede o
  envio.
  - **Tipo real** por assinatura: PE, ELF, Mach-O, PDF, ZIP (com DOCX/XLSX/PPTX, JAR e
    APK pelos nomes internos), OLE, 7z, RAR, GZIP, CAB, CHM, LNK, ISO, imagens, RTF,
    script e HTML. Extensão divergente gera alerta; executável com nome de outro tipo
    é marcado como **disfarçado** e mostra um aviso no topo da ficha.
  - **Entropia** (0 a 8) dos primeiros 16 MB, com nível baixo, normal ou alto (≥ 7,2:
    provável compactação ou criptografia).
  - **Strings** ASCII e UTF-16LE (nos dois alinhamentos), categorizadas em palavras
    suspeitas, URLs, IPs públicos, e-mails, caminhos e chaves de registro; até 20 de
    cada.
  - **PE:** arquitetura, EXE/DLL, subsistema, data de compilação, seções com entropia,
    empacotador pelo nome das seções (UPX, ASPack, Themida, VMProtect...), DLLs
    importadas e funções da lista de atenção (`VirtualAllocEx`,
    `WriteProcessMemory`...). Toda leitura do cabeçalho checa os limites do buffer:
    300 arquivos MZ aleatórios no teste, nenhum erro.
  - **IOCs sugeridos** das strings: links para a ficha do indicador e o botão
    **Inserir IOCs sugeridos** no Novo relatório. Não entram no índice até constarem
    de um relatório publicado.
  - **Amostras antigas:** `POST /api/entries/:id/static-analysis` (analistas) relê o
    arquivo do MinIO; na ficha, "Analisar agora".
  - **Listas e exportação** não carregam o JSON (`omit`). A ficha impressa ganhou
    "Tipo real" e "Entropia".

### 34. Marcar como duplicata
- **Problema:** reenvios do mesmo golpe ocupam as filas e recebem triagem repetida.
- **Proposta:**
  - Ação "Marcar como duplicata de…" (analistas): escolhe a amostra principal, que pode
    ser sugerida pelas Relacionadas.
  - A duplicata herda o veredito, vai para Concluída e mostra "Duplicata de #X" no
    resumo; a principal lista as suas duplicatas.
  - Desfazer volta ao estado anterior.
- **Onde mexer:** `Entry.duplicateOfId` + evento `MARKED_DUPLICATE` no histórico; filas
  e contadores ignoram duplicatas.
- **Cuidados:** impedir ciclos (A → B → A) e encadeamentos (duplicata de duplicata
  aponta para a principal).
- ✅ **Implementado:** `Entry.duplicateOfId` e os eventos `MARKED_DUPLICATE` e
  `UNMARKED_DUPLICATE` (migração `20261101000000_entry_duplicates`), em
  `routes/duplicates.ts`.
  - **API:**
    - `POST /api/entries/:id/duplicate { of }` (analistas) conclui a amostra com o
      veredito da principal e guarda a situação anterior no evento;
    - `DELETE /api/entries/:id/duplicate` restaura essa situação.
  - **Regras:**
    - a cadeia é sempre achatada: duplicata de duplicata aponta para a principal, e as
      duplicatas de uma amostra que vira duplicata passam a apontar para a nova
      principal;
    - ciclo → 400;
    - quando o veredito da principal muda (triagem, massa ou relatório), as duplicatas
      acompanham, com evento "acompanhando a amostra principal" (`recordTriageChanges`);
    - principal apagada solta as duplicatas.
  - **Telas:**
    - menu **Mais ▾ > Marcar como duplicata…** abre a caixa com as amostras
      relacionadas sugeridas (motivo e veredito) ou "Outra amostra (ID ou link)", com
      o erro na própria caixa;
    - **Desfazer duplicata**, com confirmação;
    - no resumo, "Duplicata de: <link>" e, na principal, "Duplicatas: N", com a seção
      **Duplicatas** na aba Detalhes;
    - marca "duplicata" ao lado do título nas listas e linha na ficha impressa.
  - **Filas:** a duplicata fica Concluída, então sai de Pendentes, Em análise,
    Atribuídas e Atrasadas.

### 35. Reputação externa (opcional)
- **Proposta:** consulta VirusTotal, URLhaus ou AbuseIPDB por hash, domínio ou IP (nunca
  o arquivo), com cache de 24 h; o resultado aparece numa seção "Reputação" da ficha.
- **Onde mexer:** `lib/reputation/*`, chaves em variáveis de ambiente
  (`VT_API_KEY`...), desligado por padrão.
- **Decisão pendente:** o projeto pode enviar indicadores a terceiros? Mesmo só o hash
  revela que a amostra está sendo analisada.
- **Decisão:** todos os serviços citados (VirusTotal, MalwareBazaar, URLhaus, ThreatFox e
  AbuseIPDB), cada um ligado pela própria chave no `.env`. Consulta automática no envio,
  independente de analistas. Do link, só o domínio.
- ✅ **Implementado:** migração `20261107000000_reputation` (modelo `ReputationResult`, um
  por amostra e serviço). Código em `lib/reputation.ts`.
  - **Indicador:** SHA-256 do arquivo; domínio do link, ou IP quando o host é um IP. A URL
    completa e o arquivo nunca saem (o teste confere com servidores falsos).
  - **Serviços por indicador:**
    - **hash:** VirusTotal, MalwareBazaar e ThreatFox;
    - **domínio:** VirusTotal, URLhaus e ThreatFox;
    - **IP:** os três de domínio mais o AbuseIPDB.
  - **Quando:** no envio de arquivo, `.zip` e link, em segundo plano, sem atrasar a
    resposta. Também vale para envios por token.
  - **Fila por serviço** com intervalo mínimo (VirusTotal: 15 s, por causa do limite de 4
    por minuto). Tempo-limite de 15 s por chamada.
  - **Cache de 24 h** por serviço e indicador: outra amostra com o mesmo hash ou domínio
    copia o resultado sem consultar de novo.
  - **Resultados:** Malicioso, Suspeito, Limpo, Não encontrado ou Falha (chave recusada,
    limite atingido, sem resposta), com resumo e link para a página do serviço.
    - **VirusTotal:** malicioso a partir de 5 motores.
    - **AbuseIPDB:** pela confiança de abuso (75% malicioso, 25% suspeito).
  - **API:**
    - `GET /api/entries/:id/reputation`, que traz `pending` enquanto a consulta roda e
      também aceita token;
    - `POST` "Consultar de novo", só analistas, ignora o cache.
  - **Ficha:**
    - **Topo:** "Reputação: malicioso em 2 de 3 serviços", "sem alertas (… · 1 com
      falha)" ou "consultando...".
    - **Seção Reputação externa** na aba Detalhes: indicador consultado e o aviso do que
      não sai; uma linha por serviço com resultado, resumo, data e "Abrir no …"
      (`noopener`).
    - Atualiza sozinha enquanto consulta. Sem serviço ligado, nada aparece.
  - **Status do sistema:** linha "Reputação externa" com os serviços ligados ou sem chave,
    consultas em 24 h e falhas (alerta).

### 36. Caixa de entrada / notificações
- **Problema:** atribuições e conclusões só são vistas quando a pessoa abre a lista.
- **Proposta:**
  - Sininho no masthead com contador e lista: "X atribuiu a amostra Y a você", "sua
    amostra Y foi concluída", "Z mencionou você".
  - Marcar como lida (uma ou todas); clicar abre o registro.
  - Página "Caixa de entrada" com histórico.
- **Onde mexer:** modelo `Notification { userId, type, entryId, actorId, readAt }`
  criado junto com os eventos do histórico; `GET/PATCH /api/me/notifications`; polling
  leve (60 s, como as filas).
- **Cuidados:** não notificar a própria ação; e-mail fica para depois (opcional, SMTP).
- ✅ **Implementado:** modelo `Notification` (migração `20261030000000_notifications`) e
  `lib/notifications.ts` (`notify`), chamado nos pontos únicos da API:
  - `applyTriage` → **ASSIGNED** para o novo responsável (inclusive na atualização em
    massa);
  - `recordTriageChanges` → **COMPLETED** para o dono, com o veredito (triagem, massa e
    publicação de relatório);
  - atualização → **MENTION** para os mencionados e **COMMENT** para dono e
    responsável. Quem já recebeu a menção não recebe o COMMENT repetido.

  Ninguém é notificado da própria ação, e amostra apagada leva as notificações junto.
  - **API:**
    - `GET /api/me/notifications?limit=&unread=1`;
    - `GET /api/me/notifications/count`;
    - `POST /api/me/notifications/read { ids? }` (sem `ids`, marca todas).
  - **Sininho** no masthead (`HpsmInboxMenu`):
    - contador vermelho e rótulo acessível ("Caixa de entrada: 2 não lidas");
    - painel com as 8 mais recentes: não lidas em negrito com ponto azul, trecho da
      atualização, "Marcar todas como lidas" e "Ver todas";
    - teclado igual ao menu do usuário;
    - abrir uma notificação marca como lida e leva à amostra (atualizações abrem a aba
      Histórico).
  - **Caixa de entrada** (`/inbox`, também na raiz do navegador com o contador): as
    últimas 100, com o filtro "Somente não lidas" e teclado.
  - **Contador:** consultado a cada minuto e ao voltar para a janela.

### 37. Menções nas atualizações
- **Proposta:** `@` no campo de atualização sugere usuários ativos; a menção vira link
  e gera notificação (36) para a pessoa mencionada.
- **Onde mexer:** autocompletar em `EntryHistoryTab.tsx`; menções gravadas como
  `@[Nome](id)` no texto e exibidas como nome; a API valida os ids.
- **Cuidados:** só usuários ativos; a menção não dá acesso a nada além do que a pessoa
  já tem.
- ✅ **Implementado (com ajuste):** o texto guarda só "@Nome", mais legível no histórico,
  na ficha impressa e no CSV. Os ids vão à parte (`mentions` no POST).
  - **API:** valida os ids (usuários ativos cujo "@Nome" ainda está no texto) e grava
    `[{ id, name }]` no `toValue` do evento.
  - **Campo de atualização** (`components/MentionTextArea.tsx`, combobox acessível):
    - "@" lista as pessoas ativas (`GET /api/users/mentionable?q=`: só nome, sem
      e-mail, até 8);
    - ↑/↓ escolhem, Enter ou Tab inserem "@Nome ", Esc fecha só a lista;
    - sem a lista aberta, o Enter continua quebrando linha.
  - **No histórico:** o "@Nome" mencionado aparece em negrito (`renderMentions`).

### 38. Modelos de relatório
- **Problema:** relatórios de casos comuns (phishing de credenciais, dropper, doc com
  macro) são escritos do zero.
- **Proposta:**
  - Campo "Modelo" no Novo relatório preenche Resumo, Achados, IOCs e veredito sugerido;
    pergunta antes de sobrescrever um texto já digitado.
  - O admin mantém a lista numa aba "Modelos" da Administração.
- **Onde mexer:** modelo `ReportTemplate`, rotas `/api/report-templates` (leitura para
  analistas, escrita para admin).
- ✅ **Implementado:** modelo `ReportTemplate` com nome único (migração
  `20261031000000_report_templates`) e `routes/templates.ts`.
  - **API:** `GET` para analistas e admin; `POST`, `PATCH` e `DELETE` só para o admin,
    com erros por campo e nome repetido → 409 apontando o campo Nome.
  - **Administração:** aba **Modelos de relatório** (também no navegador, em
    Administração), em `components/AdminTemplatesTab.tsx`:
    - formulário Novo/Editar (nome, veredito sugerido, resumo, achados, IOCs) com
      validação HPSM, Ctrl+S e aviso de alterações não salvas;
    - grade com Editar e Excluir (com confirmação).
  - **Novo relatório:** campo **Modelo**, que só aparece quando há modelos. Preenche
    Resumo, Achados, IOCs e o veredito; com texto já digitado, pergunta antes
    ("Substituir" ou "Manter o texto").

### 39. Revisão de relatório (quatro olhos)
- **Proposta:**
  - Opção (por configuração) para o relatório passar por **Em revisão** antes de
    publicar: outro analista aprova ou devolve com comentário.
  - Aprovar publica e conclui a amostra, como hoje.
- **Onde mexer:** `Report.status` (DRAFT, IN_REVIEW, PUBLISHED) no lugar do booleano,
  com migração; eventos no histórico; fila "Relatórios para revisar".
- **Cuidados:** o autor não revisa o próprio relatório.
- ✅ **Implementado:** `Report.status` (DRAFT, IN_REVIEW, PUBLISHED) no lugar do booleano
  `published`, com `submittedAt`, `reviewedBy`, `reviewedAt` e `reviewNote` (migração
  `20261103000000_report_review`, que converte os publicados existentes).
  - **Configuração:** `REPORT_REVIEW_REQUIRED` (padrão `false`). Com `true`, ninguém
    publica direto: só a aprovação de outro analista publica, e relatório publicado não
    é editado.
  - **API:**
    - `POST /api/entries/:id/reports` aceita `status`;
    - `POST /api/reports/:id/submit`;
    - `POST /api/reports/:id/approve` (publica e conclui a amostra);
    - `POST /api/reports/:id/return { note }` (volta a rascunho com o comentário);
    - `GET /api/reports/review-queue`;
    - `reviews` em `/api/entries/counts`.
  - **Regras:**
    - o autor não aprova nem devolve o próprio relatório (403);
    - em revisão o relatório fica travado para edição (409);
    - a publicação, direta ou por aprovação, passa por uma única função (conclui a
      amostra, registra no histórico e indexa os IOCs).
  - **Visibilidade:** usuários comuns veem só relatórios publicados, na ficha e na API.
    Antes os rascunhos apareciam para todos.
  - **Histórico:** eventos `REPORT_SUBMITTED`, `REPORT_APPROVED` e `REPORT_RETURNED`.
  - **Notificações** `REPORT_APPROVED` e `REPORT_RETURNED` ao autor, com o comentário,
    abrindo a aba Relatórios.
  - **Telas:**
    - fila **Relatórios para revisar (N)** no navegador, em Filas
      (`pages/ReviewQueuePage.tsx`);
    - em cada relatório: situação (Rascunho, Em revisão, Publicado · revisado por…),
      ações (Enviar para revisão, Publicar, Aprovar e publicar, Devolver… com
      comentário) e o aviso "Devolvido por…" para o autor;
    - no Novo relatório, o campo **Ao salvar** (Publicar, Enviar para revisão, Salvar
      como rascunho) substitui a caixa "Publicar".

### 40. Painel do analista
- **Proposta:** página "Painel" no navegador com indicadores no estilo HPSM:
  - amostras por status;
  - atrasadas e em alerta;
  - concluídas na semana;
  - distribuição de vereditos;
  - carga por analista.
  
  Cada número é um link para a lista já filtrada.
- **Onde mexer:** `GET /api/dashboard` (agregações), `pages/DashboardPage.tsx`; gráficos
  simples em SVG, sem biblioteca pesada.
- **Cuidados:** usuários comuns veem só os próprios números.
- ✅ **Implementado:** `GET /api/dashboard?days=7|30|90&tz=` (`routes/dashboard.ts`) e
  `pages/DashboardPage.tsx` em `/painel`, na raiz do navegador. Também pode ser
  escolhido como página inicial nas preferências.
  - **Indicadores:** pendentes, em análise, em alerta ou atrasadas, atrasadas, enviadas
    e concluídas no período (sem duplicatas). Cada um é um link para a lista filtrada.
  - **Gráfico** (`components/DailyChart.tsx`, SVG próprio): colunas por dia de enviadas
    × concluídas, com os dias no **fuso do navegador** (agrupados no Postgres).
    - Um eixo só e grade discreta.
    - Dica ao passar o mouse, ao lado do dia (nunca por cima das colunas).
    - Legenda com totais e "Ver em tabela".
    - Par de cores `--dl-series-1/2` validado com o script do skill de visualização
      (daltonismo e visão normal). O verde-água fica abaixo de 3:1 de contraste, por
      isso a legenda e a tabela são obrigatórias.
  - **Vereditos:** barras horizontais de uma cor (magnitude), com o estado no rótulo.
  - **Carga por analista:** pendentes, em análise, atrasadas e concluídas no período,
    com "Sem responsável" por último; cada número é um link.
  - **Escopo:** usuários comuns veem só as próprias amostras, com links para Meus
    Uploads e sem a carga por analista.
  - **Lista:**
    - novos filtros `assignee=<id do analista>`, `submittedFrom` e `completedFrom`;
    - o select "Responsável" lista os analistas;
    - os filtros de período (e o de prazo em Meus Uploads) aparecem como etiquetas
      removíveis na barra de filtros (`chips` do `HpsmFilterBar`).

### 41. Auditoria administrativa
- **Proposta:** aba "Auditoria" na Administração, com quem fez o quê e quando:
  - suspender ou reativar usuário, mudar papel;
  - gerar ou revogar chave, redefinir senha;
  - logins com falha repetida.
  
  Com filtros e exportação CSV.
- **Onde mexer:** modelo `AdminEvent`, gravado nas rotas de `admin.ts` e `auth.ts`.
- **Cuidados:** nunca gravar senhas, nem as temporárias.
- ✅ **Implementado:** modelo `AuditEvent` (migração `20261104000000_audit_events`) com
  quem fez, ação, usuário-alvo, rótulo do alvo no momento (e-mail, código da chave, nome
  do modelo), detalhe e IP. Gravado por `lib/audit.ts`, na mesma transação da ação.
  - **Ações registradas:**
    - papel alterado ("USER → ANALYST"), conta suspensa e reativada;
    - senha redefinida pelo admin e senha trocada pelo próprio usuário;
    - chave gerada (papel, usos, validade) e revogada;
    - modelo de relatório criado, alterado e excluído;
    - cadastro com chave (código e papel);
    - login recusado, com o motivo: e-mail não cadastrado, senha incorreta ou conta
      suspensa;
    - login bloqueado por excesso de tentativas, uma vez por janela de 5 min (opção
      `onExceeded` em `attemptLimit`).
  - **Nunca grava senhas**, nem a temporária nem a tentada (o teste confere).
  - **Usuário apagado:** os registros ficam (`SetNull`), com o rótulo do alvo.
  - **API** (só admin):
    - `GET /api/admin/audit?action=&days=&q=&limit=&offset=`;
    - `GET /api/admin/audit/export.csv` com os mesmos filtros (até 10 000 linhas, proteção
      contra fórmula no Excel).
  - **Tela:** aba **Auditoria** na Administração (`?tab=audit`) e folha no navegador
    (`components/AdminAuditTab.tsx`).
    - Filtros: Buscar (quem, alvo, detalhe, IP), Ação e Período (padrão 30 dias).
    - Colunas: Data, Quem (ou "(anônimo)"), Ação com cor, Alvo, Detalhe e IP.
    - 50 por página, e Exportar CSV.

### 42. Status do sistema
- **Proposta:** página do admin com verde, laranja ou vermelho para:
  - banco;
  - MinIO (alcançável, espaço);
  - Proxmox (alcançável, VMs do DeepLook em execução);
  - versão e tempo no ar da API.
- **Onde mexer:** `GET /api/admin/status` com tempo limite por verificação.
- ✅ **Implementado:** `lib/status.ts` e `GET /api/admin/status` (só o admin). As
  verificações rodam em paralelo, com 3 s de limite cada e "lento" acima de 1 s.
  - **O que entra:**
    - **API:** versão, tempo no ar, Node.js e ambiente;
    - **Banco:** `SELECT 1`, usuários ativos, amostras e sessões abertas;
    - **MinIO:** bucket acessível; mostra o bucket e o host, nunca as credenciais;
    - **Proxmox:** versão, template e VMs ativas contra `SANDBOX_MAX_ACTIVE` (laranja
      no limite); "Desligado" com `SANDBOX_ENABLED=false` e o modo simulado indicado;
    - **Filas:** pendentes, em análise e atrasadas (laranja se houver atrasada).
  - **Situação geral:** a pior entre as verificações; "Desligado" não conta como
    problema. Os motivos de falha saem legíveis ("conexão recusada", "acesso negado
    (confira as credenciais)"...) em vez de "AggregateError".
  - **Tela:** aba **Status do sistema** na Administração (também no navegador), com
    situação colorida, resumo, tempo, detalhes, aviso geral de falha ou alerta, linha
    com falha destacada, Atualizar e atualização automática a cada 30 s.
  - **Fora:** espaço em disco do MinIO, que exige a API administrativa do MinIO.

### 43. Tokens de API pessoais
- **Proposta:** na Minha Conta, gerar token com nome e validade para enviar e consultar
  amostras por script.
- **Escopo:** só envio e leitura; o token aparece uma única vez e é revogável.
- **Onde mexer:** modelo `ApiToken` (hash do token), autenticação por
  `Authorization: Bearer`.
- **Decisão pendente:** abrir acesso fora do navegador.
- **Decisão:** a API só é liberada manualmente por um administrador, usuário a usuário.
- ✅ **Implementado:** migração `20261106000000_api_tokens` (`User.apiAccess`, modelo
  `ApiToken`; auditoria `API_ACCESS_GRANTED`, `API_ACCESS_REVOKED`, `API_TOKEN_CREATED` e
  `API_TOKEN_REVOKED`).
  - **Liberação:** botões Liberar API / Retirar API na aba Usuários, com confirmação, e a
    coluna "Acesso por API" (liberado e quantos tokens ativos). Retirar revoga na hora
    todos os tokens ativos da pessoa.
  - **Minha Conta > Tokens de API:** a aba só aparece com o acesso liberado.
    - Gera token com nome e validade (7, 30, 60 ou 90 dias), no máximo 10 ativos.
    - O token (`dlk_` + 32 bytes aleatórios) aparece uma única vez, com Copiar; o banco
      guarda só o SHA-256.
    - A lista mostra o início do token, a validade, o último uso com IP e a situação
      (Ativo, Vencido, Revogado), com Revogar…
    - A aba traz exemplos de `curl` com o endereço do servidor.
  - **Autenticação** (`lib/api-tokens.ts`): `Authorization: Bearer <token>` em
    `requireUser`.
    - Só vale em uma lista fechada de rotas: enviar arquivo, `.zip` e link; listar e
      consultar amostras, relatórios, histórico e IOCs. O resto responde 403, inclusive
      download do arquivo, triagem, conta e administração.
    - Recusa token vencido, revogado ou desconhecido e conta suspensa (401), e usuário sem
      a liberação (403).
    - Limite de 120 requisições por minuto por token (429).
    - `/api/auth/me` continua só com o cookie. Outros esquemas de `Authorization` (ex.:
      Basic) seguem para o cookie.
  - **Administração > Tokens de API** (`?tab=tokens`, também no navegador): tokens de
    todos os usuários, ativos ou todos, com último uso e IP, e Revogar….

### 44. Envio em lote
- **Proposta:** vários arquivos de uma vez no Enviar Amostra (uma amostra por arquivo,
  com as mesmas tags), ou um `.zip` com senha `infected` desmembrado em amostras.
- **Cuidados:** limite de arquivos e tamanho total; o zip é aberto só para listar e
  extrair, nunca executar.
- ✅ **Implementado:**
  - **Vários arquivos** no Enviar Amostra (até 20):
    - o seletor soma escolhas sem repetir o mesmo arquivo (nome e tamanho), mostra o
      total e tem Remover por arquivo;
    - o campo Título some (cada amostra leva o nome do arquivo); descrição e tags valem
      para todas;
    - um envio por arquivo pela rota de sempre, então o limite de tamanho vale para
      cada um.
  - **`.zip` desmembrado:** com um único `.zip`, a caixa "Desmembrar" mostra o campo
    Senha (padrão `infected`) e envia para `POST /api/entries/zip`.
    - **Leitor próprio** (`lib/zip.ts`, sem dependência nova): stored e deflate,
      ZipCrypto (inclusive com descritor de dados) e AES do WinZip/7-Zip (AE-1/AE-2, com
      HMAC). ZIP64 e a criptografia forte da PKWARE são recusados com mensagem clara.
    - **Segurança:** tudo na memória, nada vai para o disco nem é executado; CRC e
      tamanho conferidos; zip bomb barrado pelo tamanho declarado e na descompressão
      (`maxOutputLength`).
    - **Limites:** 20 arquivos por pacote; cada arquivo até `MAX_UPLOAD_MB`; total
      extraído até 2× esse valor.
    - **Arquivos ignorados:** pastas, `__MACOSX/` e `.DS_Store`. Vazios e acima do
      limite aparecem como "Ignorado" com o motivo.
    - **Senha:** arquivos com outra senha são pulados. Se nada abrir pela senha, o
      campo Senha fica destacado.
    - **Cada amostra** recebe a análise estática e o evento CREATED, com a descrição
      "Extraído de pacote.zip (caminho/interno)".
  - **Resultado do envio:** tabela com uma linha por arquivo (Aguardando, Enviando...,
    Enviada, Ignorado, Falha com o motivo), link para cada amostra e um resumo.
  - **"Já enviada antes":** `POST /api/entries/file` e o `.zip` devolvem `previous`, a
    primeira amostra com o mesmo SHA-256. O resultado mostra o link.

### 45. Retenção de amostras
- **Proposta:** expurgo automático do **arquivo** após N dias (`RETENTION_DAYS`),
  mantendo ficha, relatórios, IOCs e hash; "lixeira" no admin para excluir ou
  restaurar amostras inteiras.
- **Cuidados:** aviso na ficha ("arquivo expurgado em…"); nunca expurgar amostra com
  sandbox ativo.
- ✅ **Implementado:** migração `20261105000000_entry_retention_trash` (`Entry.filePurgedAt`,
  `deletedAt`, `deletedById`; eventos `FILE_PURGED`, `TRASHED` e `RESTORED`; auditoria
  `ENTRY_TRASHED`, `ENTRY_RESTORED` e `ENTRY_DELETED`).
  - **Retenção** (`lib/retention.ts`): `RETENTION_DAYS` (padrão `0`, desligada).
    - **O que expurga:** só o arquivo das amostras **concluídas** há mais de N dias
      (`statusChangedAt`), para não apagar o que ainda está em análise.
    - **O que não toca:** amostras com sandbox ativo e as que estão na lixeira.
    - **Quando roda:** ao subir a API e depois a cada hora, até 100 por rodada.
    - **Ordem:** apaga o objeto no MinIO antes de marcar a ficha; se algo falhar no
      meio, a próxima rodada termina.
    - **Ficha:**
      - "Arquivo: expurgado em…" no resumo e o campo Armazenamento com a política;
      - Baixar amostra desabilitado;
      - sandbox e "Analisar agora" indisponíveis;
      - evento no histórico.
    - **API:** download, reanálise e sandbox respondem 410.
    - **Status do sistema:** o armazenamento mostra a política, quantos arquivos foram
      expurgados e quantas amostras estão na lixeira.
  - **Lixeira** (só admin):
    - **Mover:** "Mover para a lixeira…" no fim do menu Mais da ficha, com confirmação
      (recusado com sandbox ativo). A aba da ficha vira a Lixeira, com o aviso.
    - **Filtro central:** consultas de `Entry` ignoram a lixeira por padrão, via extensão
      do Prisma em `lib/prisma.ts`. Assim a amostra some de listas, filas, contadores,
      CSV, painel, busca e IOCs, e a ficha responde 404. Triagem e atualização em massa
      também não a alcançam.
    - **Filtros explícitos** nas relações: favoritos, notificações, fila de revisão,
      atualizações do usuário, IOCs, relacionadas, duplicatas da ficha e o SQL do
      painel. Ao restaurar, tudo volta.
    - **Aba Lixeira** na Administração (`?tab=trash`) e no navegador, com busca. Cada
      linha mostra quem enviou, quem moveu, desde quando, o tamanho, se o arquivo já foi
      expurgado e quantos relatórios tem.
    - **Restaurar.**
    - **Excluir definitivamente…:** confirmação; apaga o arquivo no MinIO primeiro (se
      falhar, a amostra fica na lixeira) e depois a ficha com relatórios, histórico e
      atualizações.
    - **Auditoria:** mover, restaurar e excluir.
  - **Tipos:** `Tx` e `Db` saem de `lib/prisma.ts`, porque o cliente estendido não é
    compatível com `Prisma.TransactionClient`.

## Quarta leva — ideias 46 a 50

Segurança da conta e verificação das amostras: sobras das levas anteriores (troca
obrigatória de senha e "Sair" sem aviso), antivírus em contêiner próprio e 2FA opcional.

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 46 | Botão "Salvar" na alteração de senha | botões do formulário | ⚪ | P | ✅ |
| 47 | "Sair" com alterações não salvas | aviso de alterações pendentes | 🟡 | P | ✅ |
| 48 | Troca obrigatória de senha após redefinição | expiração de senha | 🔴 | P–M | ✅ |
| 49 | Antivírus ClamAV em contêiner próprio | integrações + System Status | 🟡 | M | ✅ |
| 50 | Autenticação em dois fatores (2FA) opcional | login com segundo fator | 🔴 | M–G | ✅ |

**Ordem (uma etapa por item, cada uma com testes, documentação e commit próprio):**
46 → 47 → 48 → 49 → 50. As duas primeiras são pequenas e só de interface; a 48 mexe
no login e prepara o terreno para a 50.

### 46. Botão "Salvar" na alteração de senha
- **Problema:** em Minha Conta > Senha, o único jeito de salvar é "Salvar senha" na
  barra cinza da seção (ou Ctrl+S). Fica fácil de não perceber.
- **Proposta:** botão **Salvar** no rodapé do formulário, logo abaixo de "Confirmar
  senha", alinhado aos campos. Faz o mesmo que a barra e o Ctrl+S: valida, mostra
  "Salvando..." e fica desabilitado enquanto salva.
- **Cuidados:** a barra continua (padrão das outras telas); os dois botões e o atalho
  chamam a mesma função.
- ✅ **Implementado:** componente `HpsmFormActions` (`components/HpsmForm.tsx`), um rodapé
  de formulário com os botões começando na coluna dos controles. Na aba Senha ele traz
  **Salvar**, que vira "Salvando..." e fica desabilitado enquanto salva, igual à barra e
  ao Ctrl+S. Teste em `account.mjs`: posição abaixo da confirmação, alinhamento com os
  campos, validação e troca de senha pelo botão.

### 47. "Sair" com alterações não salvas
- **Problema:** trocar de tela com um formulário alterado pergunta "Alterações não
  salvas", mas o **Sair** do menu do usuário encerra a sessão direto e perde o que foi
  digitado (limite conhecido do item 4).
- **Proposta:** com alguma alteração pendente (Enviar Amostra, Novo relatório, Alterar
  senha, Preferências, Tokens de API...), o Sair pergunta antes: "Há alterações não
  salvas. Sair mesmo assim? [Sair] [Continuar editando]". Sem alterações, sai direto como
  hoje.
- **Onde mexer:** `useUnsavedChanges` registra os formulários sujos num ponto central;
  o `handleLogout` da barra superior consulta esse registro antes de chamar a API.
- **Cuidados:** o mesmo vale para o encerramento por inatividade? Não: a sessão expirada
  já expirou; o aviso de inatividade (item 24) continua como está.
- ✅ **Implementado:**
  - **Registro central:** `useUnsavedChanges` anota cada formulário com alteração
    pendente (`hasUnsavedChanges()`). Sai do registro quando a alteração é desfeita ou
    quando `allowNavigation()` é chamado depois de salvar.
  - **Sair** (`HpsmTopBar`): com algo pendente, pergunta "Há alterações não salvas
    nesta tela. Deseja sair mesmo assim e descartá-las?" [Sair] [Continuar editando].
    Continuar mantém a tela e o texto; Sair encerra a sessão.
  - **Sem aviso duplo:** a navegação para o login acontece dentro de
    `discardUnsavedChanges()`, que libera o bloqueio de troca de tela.
  - Sem alteração, ou com a alteração desfeita, o Sair sai direto como antes.
  - Teste em `logout-unsaved.mjs`.

### 48. Troca obrigatória de senha após redefinição
- **Problema:** quando o admin redefine a senha (item 2), a pessoa recebe uma senha
  temporária, que o admin viu, e pode continuar usando-a para sempre.
- **Proposta:**
  - A redefinição pelo admin marca a conta com **troca obrigatória**.
  - No login com a senha temporária, a pessoa vai direto para uma tela **Definir nova
    senha** (senha atual já preenchida pelo login, nova e confirmação). Enquanto não
    trocar, a API recusa tudo o que não for essa troca, sair e os dados da sessão (403
    com código próprio), e o front não deixa navegar para outras telas.
  - Ao trocar, a marca some, as outras sessões são encerradas e a pessoa entra
    normalmente.
  - A nova senha não pode ser igual à temporária.
- **Onde mexer:** `User.mustChangePassword`; `POST /api/admin/users/:id/reset-password`
  liga; `POST /api/me/password` desliga; checagem central em `requireUser`; tokens de API
  da pessoa também ficam bloqueados até a troca.
- **Admin:** coluna/indicador "troca de senha pendente" na aba Usuários; auditoria da
  troca já existe (`USER_PASSWORD_CHANGED`).
- ✅ **Implementado:** migração `20261108000000_must_change_password`
  (`User.mustChangePassword`).
  - **Redefinição pelo admin:** liga a marca. A confirmação e o aviso da senha
    temporária explicam a troca, e a auditoria registra "troca obrigatória no próximo
    login".
  - **API:** com a marca ligada, `requireUser` responde 403
    `{ code: 'PASSWORD_CHANGE_REQUIRED' }` em tudo, menos `POST /api/me/password`.
    `/api/auth/me`, sessão e Sair continuam. Tokens de API da pessoa também recebem 403.
  - **Troca obrigatória:**
    - desliga a marca e encerra todas as sessões;
    - abre uma sessão nova (`signedIn: true`), então a pessoa entra direto;
    - na auditoria aparece como "troca obrigatória após redefinição";
    - a nova senha precisa ser diferente da temporária.
  - **Tela "Definir nova senha"** (`pages/ForcePasswordPage.tsx`), no layout do login,
    sem o shell: é a única rota enquanto a marca estiver ligada.
    - A senha temporária digitada no login fica só em memória e é usada uma vez; depois
      de recarregar, a tela pede a temporária.
    - Botões "Salvar e entrar" e "Sair".
  - **Usuários (Administração):** "· troca de senha pendente" ao lado do status.
  - **Testes:** 21 de integração (Postgres) e `force-password.mjs`.

### 49. Antivírus ClamAV em contêiner próprio
- **Proposta:**
  - Novo serviço `clamav` no `docker-compose.yml` (imagem oficial `clamav/clamav`, com
    `freshclam` atualizando as assinaturas sozinho e volume para a base).
  - A API conversa com o `clamd` pela rede interna (TCP 3310, protocolo `INSTREAM`), sem
    gravar o arquivo em disco e sem expor a porta para fora.
  - **Varredura automática** de cada arquivo enviado (inclusive os extraídos de um
    `.zip`), em segundo plano, sem atrasar o envio.
  - **Resultado na ficha:** seção "Antivírus (ClamAV)" com Limpo / Infectado (nome da
    assinatura) / Falha, versão do motor e data da base; "Infectado" também no resumo do
    topo. Analistas têm "Escanear de novo".
  - **Status do sistema:** linha "Antivírus (ClamAV)" com a situação do `clamd` (responde
    ao PING), versão, data da base de assinaturas (alerta se tiver mais de 2 dias) e
    varreduras/infectados nas últimas 24 h.
- **Configuração:** `CLAMAV_HOST` (vazio = desligado) e `CLAMAV_PORT` (3310).
- **Cuidados:** o ClamAV usa bastante memória (cerca de 1,5 a 3 GB por causa da base);
  arquivos acima do limite do `clamd` (`StreamMaxLength`) viram "Falha: arquivo grande
  demais" em vez de travar; o resultado não muda o veredito, que continua com o analista.
- ✅ **Implementado:** migração `20261109000000_antivirus` (modelo `AntivirusScan`, a
  varredura mais recente de cada amostra).
  - **Contêiner:** serviço `clamav` no compose (`clamav/clamav:stable`, base em
    `./data/clamav`, sem porta publicada). A API usa `CLAMAV_HOST=clamav`; vazio desliga.
  - **Cliente** (`lib/clamav.ts`): TCP com `PING`, `VERSION` (motor, número e data da
    base) e `INSTREAM` em blocos de 64 KB. Respostas:
    - `stream: OK` vira Limpo;
    - `… FOUND` vira Infectado com a assinatura;
    - limite de tamanho, fora do ar e tempo esgotado viram Falha com o motivo.
  - **Varredura:** no envio, em segundo plano, com o conteúdo já em memória; vale também
    para os arquivos extraídos de um `.zip` e para envios por token.
  - **API:**
    - `GET /api/entries/:id/antivirus` → `{ enabled, pending, scan }`, também por token;
    - `POST` "Escanear de novo", só analistas, lê do MinIO; responde 410 se o arquivo foi
      expurgado.
  - **Ficha:**
    - **Seção "Antivírus (ClamAV)":** situação com cor, motor, base, data e o botão.
    - **Topo:** "Antivírus: infectado (assinatura)".
    - Atualiza sozinha só enquanto `pending`. Arquivos anteriores ao antivírus mostram
      "Não escaneado" e "Escanear agora".
  - **Status do sistema:** linha "Antivírus (ClamAV)". Erro quando o `clamd` não
    responde; alerta quando a base tem mais de 2 dias.
  - **Testes:**
    - 23 testes de integração contra o **ClamAV real** em contêiner, com o arquivo de
      teste EICAR montado em memória: limpo, infectado, `.zip`, nova varredura, expurgo e
      status;
    - casos de falha com um `clamd` falso: limite, fora do ar e base velha;
    - `antivirus.mjs`.
  - **Achado no teste:** na primeira subida, o `clamd` pode carregar a base antiga
    enquanto o `freshclam` ainda baixa a nova. O Status do sistema mostrou o alerta
    corretamente, e um `RELOAD` resolve; o README explica.

### 50. Autenticação em dois fatores (2FA) opcional
- **Proposta:**
  - **Opcional, por usuário**, configurado em Minha Conta numa aba própria **2FA**.
  - **TOTP** (códigos de 6 dígitos a cada 30 s), compatível com Google Authenticator,
    Microsoft Authenticator, Aegis, 1Password etc.
  - **Ativar:** a aba mostra o QR code e a chave para digitar à mão; a pessoa confirma
    com um código do aplicativo e recebe **10 códigos de recuperação** (uso único,
    mostrados uma vez, com Copiar e Baixar).
  - **Login:** depois da senha certa, quem tem 2FA vê a etapa "Código de verificação"
    (aceita também um código de recuperação). Sem o código, nenhuma sessão é criada.
  - **Desativar** ou **gerar novos códigos de recuperação**: pede a senha e um código.
  - **Admin:** "Desativar 2FA" na aba Usuários para quem perdeu o celular (com
    confirmação), e coluna mostrando quem tem 2FA ativo.
- **Segurança:**
  - Segredo TOTP guardado criptografado (AES-GCM com chave derivada do
    `SESSION_SECRET`); códigos de recuperação só como hash.
  - Janela de ±1 passo (30 s) para relógio adiantado/atrasado; um código já usado não
    vale de novo.
  - Limite de tentativas na etapa do código, como no login; tentativas erradas entram
    na auditoria.
  - Auditoria: 2FA ativado, desativado (pela pessoa ou pelo admin), códigos de
    recuperação gerados e login com código de recuperação.
- **Junto com o item 48:** quem precisa trocar a senha e tem 2FA passa primeiro pelo
  código e depois pela troca.
- **Tokens de API** continuam valendo sem 2FA (são para scripts); o 2FA protege o login
  pelo navegador.
- ✅ **Implementado:** migração `20261110000000_two_factor`.
  - **Banco:**
    - campos `twoFactorSecret`, `twoFactorPendingSecret`, `twoFactorEnabledAt` e
      `twoFactorLastStep` em `User`;
    - modelo `TwoFactorRecoveryCode`;
    - auditoria `TWO_FACTOR_ENABLED`, `TWO_FACTOR_DISABLED`,
      `TWO_FACTOR_RECOVERY_CODES` e `TWO_FACTOR_RECOVERY_USED`.
  - **`lib/two-factor.ts`** (sem dependência para o TOTP; `qrcode` só para o QR em SVG):
    - Base32, HOTP/TOTP conferidos com os vetores do RFC 6238;
    - janela de ±1 passo, sem repetir o mesmo passo;
    - segredo cifrado com AES-256-GCM;
    - códigos de recuperação "xxxx-xxxx" (sem 0/1/o/l) guardados como SHA-256;
    - desafio do login assinado com HMAC, válido por 5 minutos.
  - **Login:** a senha certa devolve `{ twoFactorRequired, challenge }`, sem sessão.
    `POST /api/auth/login/2fa { challenge, code }` cria a sessão.
    - Aceita o código do aplicativo ou um de recuperação.
    - Código errado responde 401 e registra "código 2FA incorreto" na auditoria.
    - 5 tentativas a cada 5 minutos por usuário; o bloqueio é auditado.
  - **Minha Conta > 2FA** (`components/TwoFactorTab.tsx`):
    - **Situação e recuperação:** situação e quantos códigos restam (laranja com 3 ou
      menos).
    - **Ativar:** QR, chave em grupos de 4 com Copiar e o campo do código. A ativação
      mostra os códigos uma vez, com Copiar, Baixar (.txt) e "Guardei os códigos".
    - **Gerar novos códigos / Desativar 2FA…:** pedem senha e código, e desativar pede
      confirmação.
  - **Tela de login:** a etapa "Verificação em duas etapas" tem o campo Código, Voltar
    e a dica do código de recuperação.
    - **Destino com código de recuperação:** o contexto de autenticação guarda o destino
      pós-login e a rota "/" o respeita. Sem isso, a troca das rotas de visitante pelas
      de usuário logado atropelava o `navigate`.
  - **Administração > Usuários:** coluna 2FA e **Desativar 2FA** (confirmação, auditoria
    "pelo admin").
  - **Com o item 48:** a senha temporária digitada na primeira etapa segue para a troca
    obrigatória depois do código.
  - **`SESSION_SECRET` trocado:** o segredo não decifra mais. O login responde "O 2FA
    desta conta precisa ser reconfigurado…" em vez de erro 500, e os códigos de
    recuperação continuam entrando.
  - **Testes:**
    - 34 de integração (Postgres), com os códigos calculados como o aplicativo faria;
    - `two-factor.mjs`.

## Item avulso — 51

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 51 | Política de senha | política de senha / expiração | 🔴 | M | ✅ |

### 51. Política de senha
- **Decisão:** mínimo de 8 caracteres, com ao menos um número e um caractere especial;
  validade de 90 dias, exceto para admins. Sem e-mail por enquanto.
- **Proposta:**
  - **Regra de formato** em todo lugar onde alguém escolhe uma senha: cadastro com
    chave, Alterar senha (Minha Conta) e a tela "Definir nova senha". A API recusa com
    erro no campo ("inclua ao menos um número" / "…um caractere especial"); as telas
    mostram a regra e destacam o campo.
  - **Validade de 90 dias** (`PASSWORD_MAX_AGE_DAYS`, `0` desliga), contada da última
    troca (`User.passwordChangedAt`). Admins não expiram.
  - **Senha vencida:** no login, a pessoa cai na mesma tela "Definir nova senha" do item
    48, com o texto "Sua senha expirou (90 dias)…". Até trocar, a API recusa o resto,
    inclusive os tokens de API da pessoa.
  - **Aviso antes de vencer:** nos últimos 7 dias, faixa no topo do app "Sua senha
    expira em N dias. [Alterar senha]" e a data de validade na aba Senha (é o aviso
    enquanto não há e-mail).
  - **Admin:** "· senha expirada" ao lado do status na aba Usuários.
- **Cuidados:**
  - Senhas atuais fora da regra continuam valendo; a regra vale na próxima troca.
  - Na migração, o prazo começa a contar da data da migração para todas as contas.
  - A senha temporária da redefinição pelo admin já obriga a troca (item 48), então não
    precisa seguir a regra.
  - A nova senha continua tendo de ser diferente da atual.
- ✅ **Implementado:** migração `20261111000000_password_policy`
  (`User.passwordChangedAt`).
  - **Regra** (`lib/password-policy.ts`, espelhada em `web/src/auth/passwordPolicy.ts`):
    - zod com mensagens próprias ("mínimo de 8 caracteres", "inclua ao menos um
      número", "inclua ao menos um caractere especial");
    - `issueMessage` passa a repassar a mensagem de regex personalizada;
    - caractere especial = não é letra (inclusive acentuada), número nem espaço.
  - **Onde vale:** cadastro, `POST /api/me/password` e a tela "Definir nova senha". O
    front barra antes de enviar, com a regra no campo e o destaque.
  - **Validade** (`PASSWORD_MAX_AGE_DAYS=90`):
    - `passwordState()` calcula se a senha precisa ser trocada e por quê
      (`reset` | `expired`), e a data de validade;
    - admins não expiram;
    - a sessão, o login e os tokens usam esse cálculo. Com a senha vencida, vale o mesmo
      bloqueio do item 48: 403 `PASSWORD_CHANGE_REQUIRED` e tokens recusados, com
      mensagem própria;
    - a troca obrigatória abre sessão nova e renova a validade; a auditoria registra
      "troca obrigatória (senha expirada)".
  - **Avisos** (`components/PasswordExpiryNotice.tsx`):
    - **topo do app, nos últimos 7 dias:** "Sua senha expira em N dias. Alterar senha",
      ou "Sua senha expira hoje.";
    - **aba Senha:** "Sua senha vale até … (N dias). Ao trocar, ganha mais 90 dias.", ou
      "Sem validade" para admin.
  - **Tela "Definir nova senha":** o texto muda quando a senha venceu ("sua senha
    expirou (validade de 90 dias)").
  - **Usuários (Administração):** "· senha expirada" (calculado na API, sem expor a data
    da troca).
  - **Testes:**
    - 22 de integração (Postgres): regra, letras acentuadas e espaço, vencida, token,
      admin, validade desligada, senha antiga fora da regra e prioridade do "reset";
    - `password-policy.mjs`;
    - `force-password.mjs` ajustado à regra.

## Quinta leva — ideias 52 a 65

Mais valor na triagem do dia a dia, análise mais funda e alguns ajustes de conta e
equipe, sempre no padrão visual do HP Service Manager 9.

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 52 | "Pegar a próxima" | Next in queue | 🔴 | P | ✅ |
| 53 | Prioridade P1–P4 com prazo próprio | Priority / SLA por prioridade | 🔴 | M | ✅ |
| 54 | E-mail suspeito (.eml) | anexos do registro | 🔴 | M–G | ✅ |
| 55 | Casos (agrupar amostras) | Incident ligado a Interactions | 🔴 | G | ✅ |
| 56 | Regras YARA | regras de negócio | 🟡 | M | ✅ |
| 57 | Visualizador hexadecimal | anexo visualizado no registro | 🟡 | P | ✅ |
| 58 | Comparar duas amostras | comparação de registros | 🟡 | M | ✅ |
| 59 | MITRE ATT&CK nos relatórios | categorização | 🟡 | M | ✅ |
| 60 | Alertas de IOC (watchlist) | Alerts | 🟡 | P–M | ✅ |
| 61 | Sessões ativas | segurança da conta | ⚪ | P | ✅ |
| 62 | Visões compartilhadas | filas da equipe | ⚪ | P–M | ✅ |
| 63 | Base de conhecimento | Knowledge Management | 🔴 | M–G | ✅ |
| 64 | Cota de envio | limites | ⚪ | P | ✅ |
| 65 | Webhooks de saída | integrações | ⚪ | M | ❌ (fora, por enquanto) |

**Ordem (uma etapa por item, com testes, documentação e commit próprio):**
52 → 57 → 53 → 61 → 60 → 56 → 59 → 58 → 62. Depois, 54, 55 e 65 conforme as decisões;
63 e 64 se ainda fizerem sentido.

**Decisões (23/10/2026) e segunda etapa da leva:** 64 → 63 → 54 → 55.
- **54:** remetente, destinatários e corpo do e-mail aparecem para todos.
- **55:** casos só para analistas e admins; uma amostra pode estar em vários casos; o
  caso não tem relatório próprio e sempre tem ao menos uma amostra.
- **63:** prioridade alta.
- **64:** 20 envios por dia para usuários comuns; analistas e admins sem limite.
- **65:** sem webhooks por enquanto.

**Antes de qualquer código:**
- **54:** os e-mails trazem dados pessoais das vítimas; quem vê os cabeçalhos completos?
- **55:** é a maior da leva (listas, Painel, relatórios); confirmar que cabe no fluxo.
- **65:** manda dados para fora; quais destinos e o que pode sair?

### 52. "Pegar a próxima"
- **Problema:** com várias amostras pendentes, cada analista escolhe na mão e às vezes
  dois pegam a mesma.
- **Proposta:** botão **Pegar a próxima** na barra das filas (Pendentes, Atribuídas a
  mim, Atrasadas) e na Página Inicial dos analistas. Atribui ao analista a amostra
  **pendente sem responsável mais antiga** (as atrasadas primeiro), muda para Em
  análise e abre a ficha.
- **Cuidados:** dois cliques ao mesmo tempo não podem pegar a mesma amostra (atribuição
  atômica no banco); sem nada na fila, avisa "Nenhuma amostra pendente sem responsável";
  duplicatas e amostras na lixeira ficam de fora; entra no histórico como atribuição.
- ✅ **Implementado:** `POST /api/entries/next` (só analistas).
  - **Ordem:** a pendente sem responsável mais antiga no status (`statusChangedAt`), então
    as atrasadas vêm primeiro. Duplicatas e amostras na lixeira ficam de fora.
  - **Sem disputa:** a atribuição só vale se a amostra ainda estiver pendente e sem dono
    (`updateMany` com essas condições). Quem perder a corrida tenta a seguinte, até 5
    vezes; o teste com 4 analistas ao mesmo tempo confere que cada amostra fica com um
    dono só.
  - **Efeito:** a amostra fica atribuída a quem pegou e Em análise, com os dois eventos
    no histórico.
  - **Fila vazia:** 404 "Nenhuma amostra pendente sem responsável."
  - **Front** (`components/useTakeNext.ts`): botão **Pegar a próxima** na barra do
    Histórico Global (todas as filas) e link na Página Inicial dos analistas. Abre a
    ficha; com a fila vazia, o aviso aparece na barra e a tela não muda.
  - **Testes:** 8 de integração (Postgres), inclusive a corrida, e `take-next.mjs`.

### 53. Prioridade P1–P4 com prazo próprio
- **Proposta:** campo **Prioridade** (P1 Crítica, P2 Alta, P3 Média — padrão, P4 Baixa)
  na triagem, na atualização em massa e na coluna/filtro das listas; o prazo de alerta e
  atraso (item 24) passa a depender da prioridade (padrão sugerido: P1 2 h/4 h, P2 8 h/24 h,
  P3 24 h/72 h, P4 72 h/120 h, configurável). As filas ordenam por prioridade e idade.
- **Cuidados:** amostras antigas ficam P3 (o comportamento de hoje); mudança de
  prioridade entra no histórico.
- ✅ **Implementado:** migração `20261112000000_priority` (enum `Priority`,
  `Entry.priority` com padrão P3, índice com status e idade, evento
  `PRIORITY_CHANGED`).
  - **Prazos** (`lib/sla.ts`):
    - P1 2 h / 4 h, P2 8 h / 24 h, P3 24 h / 72 h e P4 72 h / 120 h;
    - o P3 continua em `SLA_WARN_HOURS` / `SLA_LATE_HOURS`, e os outros vêm de
      `SLA_P1_HOURS`, `SLA_P2_HOURS` e `SLA_P4_HOURS` ("alerta/atraso");
    - `slaWhere()` monta o filtro "passou do prazo da própria prioridade" e substitui o
      corte único em todos os lugares: filtro Prazo, contador de Atrasadas, Painel e
      Status do sistema.
  - **API:**
    - filtro `priority` e ordenação `sort=priority` (mais urgente primeiro, empate pela
      idade);
    - campo na triagem (`PATCH`) e na atualização em massa, só para analistas;
    - coluna Prioridade no CSV;
    - `sla.byPriority` nas respostas;
    - "Pegar a próxima" (52) agora escolhe por prioridade e depois pela idade.
  - **Front:**
    - **Listas:** coluna Prioridade (P1 vermelho, P2 laranja, P3 azul, P4 cinza); o
      primeiro clique na coluna mostra o mais urgente primeiro.
    - **Filtro e prazo:** filtro Prioridade no Histórico Global; a Idade usa o prazo da
      prioridade da amostra, e a dica mostra os limites dela.
    - **Ficha:** prioridade no resumo, e na triagem o campo mostra o prazo da prioridade
      escolhida.
    - **Massa e histórico:** campo na atualização em massa; "Prioridade: P3 Média → P2
      Alta" no histórico.
  - **Testes:** 15 de integração (Postgres) e `priority.mjs`.

### 54. E-mail suspeito (.eml) — decisão pendente
- **Proposta:** enviar o `.eml` de um phishing: a ficha mostra remetente, destinatários,
  assunto, data, autenticação (SPF/DKIM/DMARC do cabeçalho), caminho dos servidores e os
  links; cada anexo vira uma amostra "filha" ligada ao e-mail (e passa pelo antivírus e
  pela reputação).
- **Decisão:** dados pessoais das vítimas (destinatários, corpo).
- **Decidido:** remetente, destinatários e corpo aparecem para todos que veem a amostra.
- **Como vai ser:**
  - `.eml` (ou `message/rfc822`) enviado como arquivo é lido na API com a `mailparser`
    (MIT); nada é executado e o HTML nunca é renderizado (vira texto);
  - a ficha ganha a seção **E-mail**: remetente, Reply-To, destinatários (Para/Cc), assunto,
    data, Message-ID, resultado de SPF/DKIM/DMARC (do `Authentication-Results`), o
    caminho dos servidores (`Received`, do mais antigo ao mais novo), os links do corpo e o
    corpo em texto;
  - cada anexo vira uma amostra **filha** ("Anexo de: …"), com antivírus, reputação,
    YARA e análise estática como qualquer envio; a ficha do e-mail lista os anexos;
  - os links e o domínio do remetente entram como IOCs sugeridos do relatório;
  - a cota de envio (64) conta o e-mail e cada anexo.
- ✅ **Implementado:** migração `20261119000000_email_samples` (`Entry.emailInfo`,
  `Entry.parentEntryId`).
  - **Biblioteca:** trocamos a `mailparser` pela **`postal-mime` 2.7.6** (MIT-0, mesmo
    autor, sem dependências), fixada numa versão de agosto/2026.
    - Por que a troca: a `mailparser` até a 3.9.10 traz dependências com alertas
      (`linkify-it` com DoS quadrático, `nodemailer` antigo), e um e-mail de phishing é
      conteúdo de atacante. As versões corrigidas saíram nesta semana.
  - **Leitura** (`lib/eml.ts`):
    - um arquivo `.eml` ou `message/rfc822` só é tratado como e-mail se tiver ao menos
      um cabeçalho típico (From, To, Subject, Date, Received ou Message-ID);
    - o que é lido: assunto, remetente, Reply-To, Para/Cc (até 50), data, Message-ID,
      SPF/DKIM/DMARC do primeiro `Authentication-Results` e o caminho dos `Received`,
      do primeiro servidor ao último;
    - links http(s) do texto e dos `href` (até 100);
    - corpo em **texto**, até 20 mil caracteres. O HTML vira texto: script, style e
      tags saem, e as entidades viram letras, inclusive as acentuadas.
  - **Envio** (`createFileEntry`):
    - cada anexo vira uma amostra filha (`parentEntryId`), com antivírus, reputação,
      YARA e análise estática;
    - o e-mail encaminhado como anexo também é lido, até 3 níveis;
    - limites: 20 anexos por e-mail, `MAX_UPLOAD_MB` por anexo; o que fica de fora
      aparece com o motivo;
    - cada anexo gasta uma vaga da cota (64): os que passam do limite ficam "não
      enviados: cota de envio atingida";
    - sem título próprio, a amostra recebe "E-mail: <assunto>";
    - a lista não carrega o `emailInfo`.
  - **Ficha:**
    - seção **E-mail**: assunto, De, Responder para (com aviso quando o domínio é
      diferente do remetente), Para/Cc, data, Message-ID, SPF/DKIM/DMARC com cores, o
      caminho numerado, os links só como texto (com Copiar) e o corpo em texto;
    - seção **Anexos**, com link para cada amostra filha ou o motivo de não ter sido
      enviada;
    - a filha mostra "Anexo de: …" no topo;
    - "Inserir IOCs sugeridos" no relatório inclui os links e os domínios do remetente
      e do Reply-To.
  - **Testes:** 15 de integração (Postgres e MinIO, com `.eml` de verdade) e
    `email.mjs`.

### 55. Casos — decisão pendente
- **Proposta:** agrupar amostras da mesma campanha num **Caso** com título, status,
  responsável, linha do tempo e relatório próprio; a ficha mostra o caso; lista de casos
  no navegador.
- **Decidido:** só analistas e admins veem e mexem; uma amostra pode estar em vários
  casos; **sem relatório próprio** (o caso mostra os relatórios das amostras); todo caso
  tem ao menos uma amostra.
- **Como vai ser:**
  - caso com título, descrição, status (Aberto → Em andamento → Encerrado) e responsável;
  - criar a partir da ficha ("Mais ▾ > Adicionar a caso…", novo ou existente) ou das
    amostras marcadas na lista ("Criar caso com as N"); não existe caso vazio: tirar a
    última amostra é recusado (encerre o caso);
  - tela do caso: dados editáveis, amostras (com veredito e status), relatórios
    publicados das amostras, linha do tempo (criado, amostra incluída/retirada, status,
    responsável, comentários) e comentários;
  - a ficha da amostra mostra os casos dela; pasta **Casos** no navegador (abertos,
    meus, todos) com contador; histórico da amostra registra a inclusão/retirada.
- ✅ **Implementado:** migração `20261120000000_cases`:
  - `Case`: número sequencial exibido como `CASO-0001`, título, descrição, status,
    responsável, autor e `closedAt`;
  - `CaseEntry` (amostra ↔ caso, com quem incluiu e quando) e `CaseEvent` (linha do
    tempo);
  - eventos `CASE_ADDED`/`CASE_REMOVED` no histórico da amostra.
  - **API** (`routes/cases.ts`, só analistas e admins; usuário comum recebe 403):
    - `GET /api/cases?status=&assignee=&q=` (`active` = não encerrados; a busca aceita
      o código, ex.: `caso-0002`) e `GET /api/cases/counts` (`{ active, mine }`);
    - `POST /api/cases { title, description?, entryIds[] }` exige ao menos uma amostra
      e cria o caso com quem criou como responsável;
    - `GET /api/cases/:id` traz as amostras (veredito, status, prioridade, quem
      incluiu) com os relatórios **publicados** de cada uma, e a linha do tempo;
    - `PATCH` muda título, descrição, status (encerrar grava a data; reabrir a limpa)
      e responsável (só analista ativo). Cada mudança vira evento;
    - `POST /:id/entries` inclui só as amostras novas; `DELETE /:id/entries/:entryId`
      recusa retirar a última (409: "encerre o caso");
    - `POST /:id/comments`; `GET /api/entries/:id/cases` traz os casos da amostra.
  - **Front:**
    - pasta **Casos** no navegador (só analistas): "Casos ativos (n)", "Meus casos
      (n)" e "Todos os casos";
    - lista `/casos` com busca, status e responsável, todos na URL;
    - tela `/casos/:id`, com o código na aba do workspace:
      - dados editáveis (Ctrl+S, confirmação ao sair sem salvar);
      - amostras com "Retirar…" (com confirmação, desabilitado na última) e "Incluir
        amostra" por ID ou link;
      - relatórios publicados das amostras (veredito, analista, ATT&CK, resumo);
      - linha do tempo e comentários;
    - caixa **Adicionar a caso…** (caso ativo ou novo, com busca), no menu Mais da ficha
      e na barra das amostras marcadas;
    - a ficha mostra "Casos: CASO-0001" no topo;
    - usuário comum não vê a pasta, o menu nem a tela.
  - **Testes:** 28 de integração (Postgres) e `cases.mjs`.

### 56. Regras YARA
- **Proposta:** aba **Regras YARA** (analistas e admin): criar, editar, ativar/desativar
  regras com validação de sintaxe; o ClamAV que já roda carrega as regras (arquivos `.yar`
  na base dele) e cada acerto aparece na seção Antivírus da ficha ("YARA: nome_da_regra").
- **Cuidados:** regra com erro de sintaxe nunca chega ao ClamAV (senão ele não recarrega);
  recarregar o ClamAV depois de salvar.
- ✅ **Implementado** (com uma mudança de rota): em vez de gravar `.yar` na base do ClamAV,
  a API compila e aplica as regras com o **YARA-X** (`@virustotal/yara-x`, o motor
  oficial do VirusTotal, em WebAssembly e sem binário nativo).
  - **Por que a mudança:** regra com erro é recusada na hora, com a linha, e nunca chega
    a derrubar o antivírus. Não precisa recarregar o `clamd` nem compartilhar volume.
    O resultado também sai mais rico: regra, conjunto, tags, descrição e ocorrências.
  - **Banco:** migração `20261115000000_yara_rules`:
    - `YaraRule`: nome único, descrição, fonte, ativa, autor e último editor;
    - `YaraScan`: a última varredura por amostra, com os acertos em JSON;
    - auditoria `YARA_RULE_CREATED`/`UPDATED`/`DELETED`.
  - **Motor** (`lib/yara.ts`):
    - as regras ativas são compiladas juntas, cada conjunto no próprio namespace (dois
      conjuntos podem repetir o identificador);
    - a compilação fica em cache e só refaz quando alguma regra muda;
    - a varredura tem tempo-limite de 10 s e no máximo 100 ocorrências por string;
    - um conjunto que deixe de compilar não derruba os outros.
  - **Quando varre:** cada arquivo enviado (inclusive os de um `.zip` e os envios por
    token), em segundo plano e só se houver regra ativa. Analistas têm "Escanear de novo"
    na ficha. Regra nova vale para os próximos envios; não há varredura retroativa.
  - **API** (`routes/yara.ts`, analistas e admins):
    - `GET`/`POST /api/yara/rules`, `PATCH`/`DELETE /api/yara/rules/:id`;
    - o `PATCH` só com `{ enabled }` ativa ou desativa;
    - `POST /api/yara/validate` valida sem salvar;
    - erro de compilação volta como 400 em `details.source`;
    - `GET`/`POST /api/entries/:id/yara` traz o resultado e escaneia de novo.
  - **Front:**
    - tela **Regras YARA** (`/yara`), na pasta **Detecção** do navegador, só para
      analistas e admins (usuário comum volta ao início);
    - editor monoespaçado com **Validar**, **Salvar regra** (Ctrl+S) e o quadro
      "Compilador" com a saída do YARA-X;
    - a lista tem situação, editor e data, com Editar / Ativar / Desativar / Excluir;
    - na ficha, a seção **Regras YARA** traz a situação, os conjuntos aplicados e a
      tabela de acertos (regra, conjunto, tags, descrição, ocorrências);
    - o topo da ficha mostra "YARA: regra, regra (+N)";
    - a seção fica escondida enquanto não houver regra ativa nem varredura.
  - **Testes:** 28 de integração (Postgres e MinIO, com o YARA-X de verdade) e `yara.mjs`.

### 57. Visualizador hexadecimal
- **Proposta:** seção **Conteúdo (hex)** na aba Análise: os primeiros 4 KB do arquivo em
  hexadecimal + texto, com "Mostrar mais" de 4 em 4 KB (até 64 KB) e destaque do cabeçalho
  conhecido (MZ, PK, %PDF...). Só analistas; nada é baixado nem executado.
- **Cuidados:** lido do MinIO por faixa (sem trazer o arquivo inteiro); arquivo expurgado
  mostra o aviso da retenção.
- ✅ **Implementado:** `GET /api/entries/:id/hex?offset=&length=` (só analistas).
  - Lê do MinIO só a faixa pedida (`Range`), em blocos de até 4 KB, até 64 KB do começo
    do arquivo. Devolve `{ offset, size, limit, data }`, com `data` em base64.
  - Recusa link (400), arquivo expurgado (410) e quem não é analista (403).
  - **Seção "Conteúdo (hex)"** na aba Análise (`components/HexViewer.tsx`):
    - só carrega com **Mostrar conteúdo**;
    - linhas com offset, 16 bytes (separados em 8 + 8) e texto, e **Mostrar mais 4 KB**;
    - **cabeçalho conhecido** destacado e nomeado: MZ, ELF, PK, %PDF, OLE, RAR, 7z,
      PNG, JPEG, GIF e GZIP.
  - **Testes:** 10 de integração (MinIO real, conferindo os bytes de cada faixa) e
    `hex-viewer.mjs`.

### 58. Comparar duas amostras
- **Proposta:** "Comparar com…" no menu Mais da ficha (ou duas marcadas na lista): lado a
  lado tipo real, tamanho, entropia, SHA-256, strings e IOCs, com o que é comum e o que é
  só de cada uma.
- ✅ **Implementado** (sem migração; só analistas e admins):
  - **API** `GET /api/entries/compare?a=&b=` (`routes/compare.ts`):
    - os campos de cada lado: tipo, tipo real, arquivo, tamanho, SHA-256, entropia,
      total de strings, resumo do PE, URL, veredito, status, prioridade, quem enviou e
      quando;
    - `sameContent` quando o SHA-256 é igual;
    - para cada lista, `{ common, onlyA, onlyB }` (até 200 itens). As listas são os IOCs
      (relatórios publicados + o próprio hash/domínio), as URLs, IPs, e-mails, caminhos,
      chaves de registro e strings suspeitas da análise estática, as DLLs e funções
      importadas suspeitas, as seções do PE, as regras YARA (56) e as técnicas ATT&CK
      (59, só de relatórios publicados);
    - mesma amostra dá 400; inexistente, 404; usuário comum, 403.
    - Nada é executado nem lido do MinIO: usa a análise guardada no envio.
  - **Front:**
    - "Comparar as 2" na barra de seleção da lista, só com exatamente duas marcadas;
    - "Comparar com…" no menu Mais da ficha, com a mesma caixa da duplicata:
      relacionadas sugeridas ou ID/link. A caixa virou `EntryPickDialog`, que as duas
      usam;
    - tela **Comparar amostras** (`/comparar?a=&b=`, aba própria no workspace):
      - tabela "Lado a lado" com as linhas que diferem destacadas e marcadas
        "(difere)"; linhas vazias dos dois lados não aparecem;
      - uma seção por lista com três colunas: "Só em A", "Em comum" e "Só em B";
      - "Trocar os lados" e aviso de mesmo conteúdo;
    - usuário comum volta ao início.
  - **Testes:** 17 de integração (Postgres) e `compare.mjs`.

### 59. MITRE ATT&CK nos relatórios
- **Proposta:** campo de técnicas ATT&CK no relatório (busca por código ou nome, ex.:
  T1566 Phishing); as técnicas aparecem na ficha, viram filtro nas listas e um quadro "mais
  vistas" no Painel. Lista de técnicas embutida (sem buscar fora).
- ✅ **Implementado:** migração `20261116000000_attack_techniques`
  (`Report.attackTechniques`, `text[]` com índice GIN).
  - **Lista embutida:** `lib/attack-enterprise.json` traz o ATT&CK Enterprise v20.0:
    706 técnicas e subtécnicas (sem as revogadas ou obsoletas) e 15 táticas. Foi extraído
    do repositório oficial `mitre-attack/attack-stix-data`, com código, nome e táticas.
    Nada é buscado fora em tempo de execução. Para atualizar, troque o arquivo.
  - **API:**
    - `GET /api/attack` devolve a lista, com cache de um dia no navegador;
    - `attackTechniques` no `POST /api/entries/:id/reports` e no `PATCH /api/reports/:id`:
      no máximo 30, normalizadas (maiúsculas, sem repetir, na ordem do ATT&CK);
    - código desconhecido volta como 400 em `details.attackTechniques`;
    - filtro `attack=T1566` em `GET /api/entries` e no CSV: amostras com relatório
      **publicado** com a técnica. O código da técnica-mãe acha também as subtécnicas;
    - `techniques` no `GET /api/dashboard`: as 10 mais vistas em relatórios publicados
      ou editados no período, contando cada amostra uma vez e sem a lixeira. Usuário
      comum vê só as próprias amostras.
  - **Front:**
    - campo **Técnicas ATT&CK** no novo relatório, um combobox: busca por código ou por
      nome (sem acento e sem caixa), setas + Enter ou clique para escolher, etiquetas com
      ×, e Backspace no campo vazio remove a última;
    - no relatório, as técnicas aparecem como links ("T1566.001 Spearphishing
      Attachment", com as táticas no title) para o Histórico Global filtrado;
    - o topo da ficha mostra "ATT&CK: …" com as técnicas dos relatórios publicados;
    - filtro **ATT&CK** no Histórico Global, com sugestões do navegador; só aplica um
      código que existe;
    - em Meus Uploads, o filtro aparece como etiqueta removível;
    - no Painel, o quadro **Técnicas ATT&CK mais vistas no período**: barras, e o
      número leva à lista filtrada.
  - **Também:** mensagens de `refine`/`superRefine` passam a chegar ao campo (antes
    viravam "valor inválido").
  - **Testes:** 24 de integração (Postgres) e `attack.mjs`.

### 60. Alertas de IOC (watchlist)
- **Proposta:** "Seguir" na ficha do indicador (IP, domínio, e-mail, hash): quando o
  indicador aparecer numa amostra nova (hash/domínio no envio) ou num relatório publicado,
  quem segue recebe uma notificação na Caixa de entrada. Lista "Indicadores que sigo" na
  Minha Conta.
- ✅ **Implementado:** migração `20261114000000_ioc_watch` (modelo `IocWatch`, um por
  pessoa e indicador; notificação `IOC_SEEN`).
  - **Quando avisa** (`lib/ioc-watch.ts`):
    - **amostra nova:** o SHA-256 do arquivo, ou o domínio/IP do link (inclusive os
      arquivos de um `.zip` e os envios por token);
    - **relatório publicado:** `syncReportIocs` compara os indicadores de antes e de
      depois e só avisa pelos novos; editar o relatório sem indicador novo não repete.
  - **Como avisa:** uma notificação por pessoa e por evento, com o primeiro indicador e
    "(+N)". Quem fez a ação não é avisado, e a indexação inicial da subida não avisa
    ninguém.
  - **API:**
    - `POST`/`DELETE /api/iocs/:kind/:value/watch`, com a mesma validação da ficha e no
      máximo 200 por pessoa;
    - `watching` em `GET /api/iocs/:kind/:value`;
    - `GET /api/me/watches`.
  - **Front:**
    - **Seguir / Deixar de seguir** (com o sininho) na barra da ficha do indicador;
    - aba **Indicadores** na Minha Conta, com tipo, link para a ficha, desde quando e
      "Deixar de seguir";
    - notificação "Indicador que você segue: Domínio x (+1) num relatório publicado",
      que abre a aba Relatórios quando veio de um relatório.
  - **Testes:** 16 de integração (Postgres e MinIO) e `ioc-watch.mjs`.

### 61. Sessões ativas
- **Proposta:** aba **Sessões** na Minha Conta: cada sessão com navegador/sistema, IP,
  início e último acesso, a atual marcada; "Encerrar" uma e "Encerrar as outras".
  Auditoria do encerramento.
- ✅ **Implementado:** migração `20261113000000_session_details` (`Session.userAgent`,
  `ip`, `lastSeenAt`; auditoria `SESSION_REVOKED`).
  - **Gravação:** `createSession` grava o User-Agent e o IP (login, 2FA e troca
    obrigatória). `loadUser` atualiza o último acesso no máximo a cada 5 minutos, ou na
    hora se o IP mudar.
  - **API** (`routes/sessions.ts`):
    - `GET /api/me/sessions` com navegador e sistema (`lib/user-agent.ts`: Chrome,
      Edge, Firefox, Safari, Opera; Windows, macOS, Linux, Android, iOS), IP, entrada,
      último acesso e qual é a atual;
    - `DELETE /api/me/sessions/:handle`; a atual sai pelo Sair;
    - `POST /api/me/sessions/revoke-others`;
    - auditoria com o dispositivo e o IP.
  - **Segurança:** o id da sessão é o próprio segredo do cookie, então a lista usa só um
    hash curto dele (`handle`). O teste confere que o id não aparece.
  - **Minha Conta > Sessões** (`components/SessionsTab.tsx`):
    - tabela com a atual marcada e o User-Agent completo na dica;
    - **Encerrar…** com confirmação;
    - **Encerrar as outras sessões**, desabilitado quando só há a atual.
  - **Testes:** 18 de integração (Postgres), inclusive sessões de outra pessoa
    intactas, e `sessions.mjs`.

### 62. Visões compartilhadas
- **Proposta:** ao salvar uma visão (filtros), analistas escolhem "compartilhar com a
  equipe": ela aparece numa pasta **Visões da equipe** no navegador de todos os analistas,
  com contador. Só quem criou (ou admin) edita/remove.
- ✅ **Implementado:** migração `20261117000000_team_views` (`TeamView`: nome, endereço
  único, quem compartilhou).
  - **API** (`routes/team-views.ts`, só analistas e admins):
    - `GET /api/team-views` traz as visões em ordem alfabética, com `count` e `canEdit`;
    - o `count` é calculado com o mesmo filtro da lista (`ListQuery`/`listWhere`) para
      quem está vendo, então "Atribuídas a mim" conta as de cada um. A lixeira não
      entra, e um endereço que não vale mais vira `null`;
    - `POST` aceita só visões do Histórico Global (`/history?…`). Endereço repetido
      dá 409 com o nome já usado; o limite é de 30;
    - `PATCH` (renomear) e `DELETE` só para quem compartilhou ou um admin (403 para os
      outros). Se o autor for apagado, a visão fica e só o admin a altera.
  - **Front:**
    - botão **Compartilhar visão** na barra de filtros do Histórico Global, só para
      analistas, com o nome sugerido como no "Salvar visão";
    - pasta **Visões da equipe** no navegador de todos os analistas, com o contador
      (atualiza a cada minuto) e "compartilhada por …" no title;
    - quem pode alterar tem menu de contexto (Abrir, Renomear, Remover da equipe) e
      as teclas Shift+F10, F2 e Delete. Remover pede confirmação, avisando que some
      para todos;
    - usuário comum não vê a pasta nem o botão e não consulta a API.
  - **Testes:** 20 de integração (Postgres) e `team-views.mjs`.

### 63. Base de conhecimento (opcional)
- **Proposta:** artigos (Markdown) sobre famílias de malware e golpes, com busca, ligados
  aos relatórios que os citam.
- **Decidido:** importante (sobe para prioridade alta).
- **Como vai ser:**
  - artigo com título, resumo, categoria (Família de malware, Golpe, Técnica, Procedimento),
    tags e corpo em Markdown; analistas e admins escrevem, todos leem;
  - Markdown desenhado por um renderizador próprio e seguro (títulos, parágrafos,
    listas, negrito/itálico, código, citações, links http/https e para o próprio app);
    nenhum HTML do texto é aceito;
  - tela **Base de conhecimento** (`/kb`) com busca (título, resumo, tags e corpo) e
    filtro por categoria; artigo com "Editar" (pré-visualização ao lado) e histórico de
    quem alterou;
  - relatórios citam artigos (campo "Artigos da base" com busca); o relatório mostra os
    links e o artigo lista as amostras/relatórios publicados que o citam;
  - "Ir para:" acha artigos pelo título.
- ✅ **Implementado:** migração `20261118000000_knowledge_base`:
  - `KbArticle`: título único, resumo, categoria, tags, corpo, autor e último editor;
  - `KbArticleRevision`: a versão anterior, guardada a cada edição;
  - ligação muitos-para-muitos `Report.kbArticles`.
  - **API** (`routes/kb.ts`):
    - `GET /api/kb?q=&category=` (todos): busca sem caixa em título, resumo, texto e
      tags; os títulos que batem vêm primeiro; traz `citations` (relatórios publicados);
    - `GET /api/kb/:id`: corpo, autor, as últimas 20 edições (quem e quando) e os
      relatórios **publicados** que citam o artigo, sem as amostras da lixeira;
    - `POST`/`PATCH` só para analistas e admins. Título repetido dá 409, e as tags vão
      em minúsculas, sem repetir (até 10). Cada `PATCH` guarda a versão anterior;
    - `DELETE`: quem criou ou um admin. Os relatórios perdem só o link;
    - relatórios: `kbArticleIds` no `POST`/`PATCH` (até 10; artigo inexistente dá 400
      no campo), e `kbArticles` (id e título) no relatório e na ficha.
  - **Front:**
    - **Base de conhecimento** no topo do navegador, para todos;
    - lista `/kb` com busca e categoria (ficam na URL) e cartões com categoria, tags,
      atualização e "Citado em N relatórios";
    - artigo `/kb/:id`, com o título na aba do workspace, Editar, Excluir (para quem
      pode), "Citado em" e "Alterações";
    - editor `/kb/novo` e `/kb/:id/editar`: obrigatórios destacados, Ctrl+S,
      confirmação ao sair sem salvar e **pré-visualização ao lado**;
    - **Markdown** (`components/Markdown.tsx`): renderizador próprio, sem HTML e sem
      dependência nova. Desenha títulos, listas, citações, código, negrito/itálico e
      links. Só viram link endereços http/https (em nova aba, sem opener) e caminhos do
      app; uma URL solta fica como texto, para ninguém clicar num domínio malicioso por
      engano, e `<script>` aparece como texto;
    - relatório: campo **Artigos da base** (busca, setas + Enter, etiquetas) e links na
      leitura;
    - "Ir para:" com o título exato abre o artigo, e `kb: termo` busca na base.
  - **Testes:** 24 de integração (Postgres) e `kb.mjs`.

### 64. Cota de envio (opcional)
- **Proposta:** limite de envios por usuário comum por dia (`UPLOAD_DAILY_LIMIT`), com
  mensagem clara ao atingir; analistas e admin sem limite.
- **Decidido:** 20 por dia para usuários comuns; analistas e admins sem limite.
- **Como vai ser:** `UPLOAD_DAILY_LIMIT=20` (0 desliga), contado nas últimas 24 horas
  (arquivo, link, cada arquivo de um `.zip` e envios por token); acima do limite, 429
  com "você já enviou 20 amostras nas últimas 24 horas; a próxima libera às HH:MM";
  "Enviar Amostra" mostra quantos envios restam.
- ✅ **Implementado** (sem migração):
  - **Regra** (`lib/quota.ts`): `UPLOAD_DAILY_LIMIT` (padrão 20; 0 desliga) envios por
    usuário comum nas **últimas 24 horas**; analistas e admins não têm limite. Conta
    arquivo, link, cada arquivo extraído de um `.zip` e os envios por token, que passam
    pelas mesmas rotas;
  - **Acima do limite:** `POST /api/entries/file`, `/url` e `/zip` devolvem 429 com
    `resetAt` e a mensagem "Você já enviou 20 amostras nas últimas 24 horas (limite
    para usuários comuns). A próxima libera em 2 h 5 min.". O `.zip` cria só os
    arquivos que cabem; os outros aparecem como ignorados com o motivo ("cota de 20
    envios em 24 horas atingida");
  - **`GET /api/me/upload-quota`** devolve `{ limit, used, remaining, resetAt }`;
  - **Enviar Amostra:** "Restam N envios de 20 nas próximas 24 horas" na barra. Com a
    cota esgotada, aparece o aviso com o horário local da próxima vaga e o botão Enviar
    fica desabilitado;
  - **Testes:** 13 de integração (Postgres e MinIO) e `quota.mjs`.

### 65. Webhooks de saída — decisão pendente
- **Proposta:** avisar Slack/Teams/SIEM (POST JSON) quando uma amostra é concluída como
  maliciosa ou suspeita.
- **Decisão:** destinos permitidos e o que pode sair (só o hash? título? relatório?).
- **Decidido (23/10/2026):** sem webhooks por enquanto.

## Item técnico — 66. Migração para o Prisma 7

- **Por quê:** o `npm audit` da API aponta o `deepmerge-ts` < 8 (alerta alto), que vem
  fixado dentro do Prisma 6.19.3. A correção só existe no Prisma 7.10.1, que usa o
  `deepmerge-ts` 8.0.2.
- **O que muda no Prisma 7** (guia oficial de atualização):
  - o gerador `prisma-client-js` dá lugar ao `prisma-client`, com `output` obrigatório
    (o cliente sai do `node_modules` e passa a ser gerado no projeto);
  - todo banco precisa de um **driver adapter** (PostgreSQL: `@prisma/adapter-pg`, com o
    `pg`);
  - a URL do banco, as migrações e o seed saem do `schema.prisma` e do `package.json` e
    vão para o `prisma.config.ts`;
  - o `.env` não é mais carregado sozinho, e o `migrate diff` troca
    `--shadow-database-url` pela configuração;
  - Node ≥ 20.19 / 22.12 e TypeScript ≥ 5.4 (já atendemos: Node 22 no Docker,
    TypeScript 5.6).
- **Plano (por etapas, sem mudar o comportamento):**
  1. **Pacotes:** `prisma` e `@prisma/client` 7.10.1 e `@prisma/adapter-pg` 7.10.1,
     com versões fixas.
  2. **Schema e configuração:**
     - gerador `prisma-client` com `output = "../src/generated/prisma"` e
       `moduleFormat = "cjs"`. A API continua em CommonJS, sem converter tudo para ESM;
     - `prisma.config.ts` com o schema, as migrações, o seed e `DATABASE_URL` (e
       `SHADOW_DATABASE_URL` para quem gera migrações);
     - sem `url` no `datasource` do schema; o bloco `prisma.seed` sai do `package.json`.
  3. **Cliente:** `lib/prisma.ts` cria o `PrismaClient` com o `PrismaPg`, preservando o
     filtro da lixeira (`$extends`). O pool fica próximo do Prisma 6: tempo-limite de
     conexão de 5 s, porque o `pg` não tem limite por padrão.
  4. **Imports:** os 29 arquivos que importam de `@prisma/client` passam a importar do
     cliente gerado (`src/generated/prisma/client`), incluindo o `prisma/seed.ts`.
  5. **Build e Docker:**
     - o código gerado fica fora do git, do lint e do prettier;
     - o Dockerfile copia o `prisma.config.ts` antes do `prisma generate`;
     - o entrypoint continua com `migrate deploy` e `db seed`.
  6. **Verificação:**
     - typecheck, lint e build;
     - migrações do zero num banco novo e `migrate diff` sem diferenças entre o schema e
       as migrações;
     - os testes de integração (Postgres e MinIO) das áreas mais sensíveis: transações,
       SQL cru do Painel, JSON, arrays, enums, filtro da lixeira;
     - o "Status do sistema" com o banco fora do ar (mensagem de erro do adapter);
     - a suíte completa de Playwright e o `npm audit` sem o `deepmerge-ts`.
  7. **Documentação:** README (como gerar o cliente e as migrações) e este item com o
     Implementado.
- ✅ **Implementado** (sem migração de banco):
  - **Pacotes:**
    - `prisma` e `@prisma/client` 7.10.1 e `@prisma/adapter-pg` 7.10.1, fixos;
    - o `npm audit` da API ficou com **0 vulnerabilidades** (`deepmerge-ts` 8.0.2).
  - **Schema e configuração:**
    - gerador `prisma-client` com saída em `src/generated/prisma`, CommonJS;
    - `prisma.config.ts` com o schema, as migrações, o seed (`tsx prisma/seed.ts`),
      `DATABASE_URL` e `SHADOW_DATABASE_URL`;
    - sem `url` no schema; o `prisma.seed` saiu do `package.json`. Sem
      `DATABASE_URL`, o `prisma generate` continua funcionando (build da imagem).
  - **Cliente** (`lib/prisma.ts`):
    - `createPrismaClient()` usa o `PrismaPg` com tempo-limite de conexão de 5 s, como
      no Prisma 6;
    - o filtro da lixeira continua igual, e o seed usa a mesma função.
  - **Imports:** 29 arquivos passaram de `@prisma/client` para o cliente gerado. A API
    exporta os mesmos nomes (enums, `Prisma`, tipos dos modelos), sem outra mudança de
    código.
  - **Status do sistema:** com o adapter, falhas do banco chegam como "Raw query
    failed… Code: …". O `describeError` traduz os códigos comuns do Postgres:
    - senha recusada;
    - banco inexistente;
    - banco em manutenção;
    - limite de conexões;
    - servidor inalcançável.
  - **Build e Docker:**
    - o Dockerfile copia o `prisma.config.ts` e gera o cliente depois de copiar o
      código;
    - `src/generated` fica fora do git, do lint, do prettier e do contexto do Docker.
  - **Ajuste à parte:** erro de lint antigo no `lib/eml.ts` (espaço não separável
    literal virou `\u00a0`).
  - **Verificação:**
    - typecheck, lint e build;
    - as 33 migrações aplicadas do zero, e `migrate diff` vazio entre schema,
      migrações e banco;
    - seed idempotente;
    - 9 testes de integração (183 checagens: Painel com SQL cru, JSON, arrays,
      transações, filtro da lixeira, P2002/P2025, e-mail, YARA, cota, casos, base de
      conhecimento);
    - a API de verdade subindo, com login, Status do sistema e Painel;
    - a **imagem Docker** aplicando as migrações, o seed e subindo contra um banco vazio;
    - as falhas do banco traduzidas;
    - a suíte completa de Playwright.

## Sexta leva — ideias 67 a 80

Aprofundar a análise (documentos, similaridade, YARA retroativo), achar as coisas mais
rápido (busca avançada), dividir o trabalho da equipe sozinho (atribuição e
escalonamento) e fechar as pontas dos casos e relatórios, sempre no padrão visual do HP
Service Manager 9.

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 67 | YARA retroativo (regra nova nas amostras antigas) | regras de negócio | 🔴 | M | ✅ |
| 68 | Busca avançada (amostras, relatórios, comentários, base, casos) | Advanced Search | 🔴 | M | ✅ |
| 69 | Lista de permissões de indicadores (falsos positivos) | listas de exceção | 🟡 | P–M | ✅ |
| 70 | Análise de documentos (PDF e Office) | campos calculados do registro | 🔴 | M–G | ✅ |
| 71 | Similaridade por hash difuso (TLSH) | registros relacionados | 🟡 | M | ✅ |
| 72 | Regras de atribuição automática | Assignment Groups | 🟡 | M | ✅ |
| 73 | Escalonamento por prazo | SLA escalation | 🟡 | P–M | ✅ |
| 74 | Exportar o caso (Markdown e impressão) | impressão do registro | 🟡 | P–M | ✅ |
| 75 | Versões do relatório (histórico e diferenças) | histórico de alterações | 🟡 | P–M | ✅ |
| 76 | Evidências no relatório (imagens) | anexos do registro | 🟡 | M | ✅ |
| 77 | Relatório gerencial | Reports | ⚪ | M | ✅ |
| 78 | Importar indicadores (CSV e STIX) | importação de dados | ⚪ | M | ✅ |
| 79 | Notificações por e-mail (SMTP) | notificações | ⚪ | M | ⏸ (sem SMTP) |
| 80 | Captura da página de um link (navegador isolado) | integrações | ⚪ | G | ✅ |

**Ordem sugerida (uma etapa por item, com testes, documentação e commit próprio):**
67 → 69 → 68 → 70 → 71 → 73 → 74 → 75 → 76 → 77 → 78. Depois, 72, 79 e 80 conforme as
decisões.

### 67. YARA retroativo
- **Problema:** uma regra YARA nova só vale para os próximos envios; para saber se ela
  pega amostras antigas, é preciso "Escanear de novo" uma por uma.
- **Proposta:** na tela Regras YARA, **Aplicar às amostras existentes** (por regra):
  varre em segundo plano os arquivos ainda guardados, com progresso ("1.240 de 3.000"),
  e lista as amostras que casaram, com link. O resultado fica na seção YARA da ficha.
- **Cuidados:** uma varredura retroativa por vez; arquivos expurgados ficam de fora;
  cancelar a qualquer momento; limite de tamanho por arquivo; não trava a API.
- ✅ **Implementado:** migração `20261121000000_yara_retroscan`:
  - `YaraRetroscan`: regra, nome da regra no início, situação, total, varridas,
    casaram, ilegíveis, acima do limite, quem iniciou, início e fim;
  - `YaraRetroscanHit`: as amostras que casaram, com os identificadores.
  - **Execução** (`lib/yara-retro.ts`):
    - em segundo plano, **uma por vez** (a segunda dá 409);
    - entram os arquivos ainda guardados, fora da lixeira e até 100 MB. Os expurgados
      ficam de fora, e os maiores são contados como "acima de 100 MB";
    - lê do MinIO em páginas de 100 e grava o progresso a cada 10 amostras;
    - arquivo que não pode ser lido conta como "ilegível" e não interrompe a
      varredura;
    - o cancelamento é checado a cada amostra; se a API reiniciar no meio, a
      varredura fica "Falhou: interrompida (API reiniciada)".
  - **Ficha:** os acertos entram na seção Regras YARA, mesclados com os das outras
    regras. Acertos antigos da mesma regra que não casam mais saem.
  - **Reaproveitamento:** a compilação e a varredura do `lib/yara.ts` viraram
    `compileRuleSets` e `scanBuffer`, usados pelo envio e pela varredura retroativa.
  - **API** (analistas):
    - `POST /api/yara/rules/:id/retroscan` (202);
    - `GET /api/yara/retroscans`, as últimas 10;
    - `GET /api/yara/retroscans/:id`, com até 500 acertos;
    - `POST /api/yara/retroscans/:id/cancel`;
    - se a regra for excluída, o histórico fica com o nome.
  - **Front:**
    - "Aplicar às existentes…" em cada regra, com confirmação; fica desabilitado
      enquanto outra varredura roda;
    - seção **Varreduras retroativas**: situação, barra de progresso ("1.240 de 3.000
      (41%)"), ilegíveis e acima do limite, quantas casaram e quem iniciou. Atualiza a
      cada 2 s enquanto roda;
    - "Ver acertos" mostra as amostras (link, veredito, status, identificadores), e
      há "Cancelar".
  - **Testes:** 15 de integração (Postgres e MinIO) e `yara-retro.mjs`.

### 68. Busca avançada
- **Problema:** a busca da lista só olha título, hash, URL e nome do arquivo; o que está
  nos relatórios, comentários, base de conhecimento e casos não aparece.
- **Proposta:** tela **Busca** com um campo só e resultados agrupados por tipo: amostras,
  relatórios (resumo, achados, IOCs), comentários, artigos e casos, cada um com o trecho
  que casou destacado. Filtros por tipo e período; o "Ir para:" leva a ela quando o
  texto não é ID, hash nem indicador.
- **Cuidados:** busca textual do Postgres (dicionário português, com índice),
  respeitando o que cada pessoa pode ver (usuário comum não vê casos nem rascunhos).
- ✅ **Implementado:** migração `20261123000000_search_unaccent`, que só habilita a
  extensão `unaccent` do Postgres.
  - **Busca** (`routes/search.ts`, `GET /api/search?q=&type=&days=`):
    - busca textual do Postgres com o dicionário português, sem diferenciar acentos:
      "cobranca codigo" acha "cobrança … código", e a forma digitada aparece
      destacada;
    - sintaxe de buscador: aspas para frase exata e `-` para excluir uma palavra;
    - grupos:
      - amostras: título, descrição, arquivo e URL;
      - relatórios: resumo, achados e IOCs;
      - comentários;
      - base de conhecimento: título, resumo, texto e tags;
      - casos: título e descrição;
    - cada resultado vem com o trecho encontrado, marcado com `⟦ ⟧`. O front destaca
      sem HTML; um `<script>` no texto aparece como texto;
    - ordem por relevância; 10 por grupo em "Tudo" e 50 num grupo só; filtro de
      período;
    - amostras na lixeira ficam de fora; o usuário comum vê só relatórios publicados
      e não vê casos.
  - **Sem índice por enquanto:** um índice sobre expressão ficaria fora do schema do
    Prisma, e cada nova migração tentaria apagá-lo. Com o volume atual a busca direta
    basta; se crescer, criar uma coluna `tsvector` com índice GIN.
  - **Front:**
    - tela **Busca** (`/busca`, no topo do navegador) com Buscar, Em (Tudo ou um
      grupo) e Período, todos na URL;
    - grupos com contagem, links (o relatório abre na aba Relatórios, o comentário no
      Histórico) e "Ver todos os N em …";
    - o **"Ir para:"** com texto que não é ID, hash nem indicador abre a Busca (antes
      ia para o Histórico Global filtrado).
  - **Testes:** 16 de integração (Postgres) e `search.mjs`. O `quick-search.mjs` e o
    `iocs.mjs` foram ajustados ao novo destino do "Ir para:".

### 69. Lista de permissões de indicadores
- **Problema:** domínios e IPs legítimos (microsoft.com, google.com, o próprio domínio da
  empresa) aparecem nos IOCs sugeridos, nas Relacionadas e nos alertas, gerando ruído.
- **Proposta:** aba **Indicadores permitidos** (analistas): domínio (com subdomínios),
  IP/faixa ou hash, com motivo. Indicadores permitidos somem das sugestões, não ligam
  amostras nas Relacionadas, não disparam alertas de IOC e aparecem marcados na ficha do
  indicador.
- **Cuidados:** nunca escondem o que foi digitado no relatório; auditoria de quem
  incluiu; lista inicial vazia (sem "lista mágica").
- ✅ **Implementado:** migração `20261122000000_allowlist`:
  - `AllowedIndicator`: tipo, valor normalizado, motivo e autor; um por tipo e valor;
  - auditoria `ALLOWLIST_ADDED`/`ALLOWLIST_REMOVED`.
  - **Regras** (`lib/allowlist.ts`):
    - domínio vale para os subdomínios;
    - IPv4 aceita um IP ou uma faixa CIDR, guardada pelo endereço de rede
      (`10.1.2.3/8` vira `10.0.0.0/8`);
    - hashes e e-mails são exatos; um e-mail também é coberto pelo domínio dele, e uma
      URL pelo host;
    - a lista fica em cache por 30 s e é descartada a cada alteração.
  - **Onde vale:**
    - não liga amostras nas **Relacionadas**, nem pelo domínio (inclusive o
      domínio-base) nem por IOC em comum;
    - não dispara **alertas de IOC**;
    - a **ficha do indicador** mostra "Indicador permitido (coberto por …): motivo",
      para todos;
    - some dos **IOCs sugeridos** do relatório, com a contagem dos ocultos;
    - o que o analista escreve no relatório não muda.
  - **Detalhe:** a lista fixa de domínios onipresentes do extrator (google.com,
    microsoft.com…) continua; a lista de permissões é a parte da equipe.
  - **API** (analistas):
    - `GET`/`POST /api/allowlist` e `DELETE /api/allowlist/:id`. Valor inválido dá
      400 no campo, com dica para faixa; repetido dá 409;
    - `POST /api/allowlist/filter { values }` diz quais sugestões estão cobertas;
    - `allowed` em `GET /api/iocs/:kind/:value`.
  - **Front:**
    - tela **Indicadores permitidos** (`/permitidos`, pasta Detecção, só analistas),
      com tipo (a dica muda com ele), indicador e motivo; incluir com Ctrl+S; o tipo
      fica para o próximo;
    - tabela com autor e "Remover" (com confirmação).
  - **Testes:** 21 de integração (Postgres) e `allowlist.mjs`.

### 70. Análise de documentos (PDF e Office)
- **Problema:** phishing chega muito como PDF e Office; hoje só vemos tipo, entropia e
  strings.
- **Proposta:** na análise estática, para **PDF**: JavaScript, ações automáticas
  (OpenAction/AA), arquivos embutidos, formulários e links; para **Office** (OOXML e o
  formato antigo OLE): presença de **macros VBA** (nomes dos módulos e trechos
  suspeitos: AutoOpen, Shell, CreateObject, URLDownloadToFile), objetos OLE embutidos e
  links externos (template remoto). Seção "Documento" na ficha, com alertas.
- **Cuidados:** só leitura de bytes, com limites (zip-bomb, recursão); nada é executado;
  falha na análise não impede o envio.
- ✅ **Implementado** (sem migração: o resultado vai em `staticInfo.document`):
  - **Análise** (`lib/doc-analysis.ts`), sem dependência nova. Só lê bytes, com
    limites; falha vira "sem dados", nunca exceção:
    - **PDF:** JavaScript, OpenAction/AA, Launch, arquivos embutidos, AcroForm/XFA,
      criptografia, páginas e links (`/URI`). Decodifica nomes ofuscados
      (`/J#61vaScript`) e abre os streams FlateDecode, até 8 MB por stream e 32 MB no
      total, onde o conteúdo malicioso costuma ficar escondido;
    - **Office moderno (OOXML):**
      - macros (`vbaProject.bin`);
      - links externos e **template remoto** (`attachedTemplate`) das `.rels`;
      - objetos embutidos (`/embeddings/`) e campos DDE;
    - **Office antigo (OLE):** leitor próprio do formato OLE/CFB (setores, FAT,
      mini stream, árvore de diretórios) e da compressão do VBA (**MS-OVBA**, validada
      com o vetor da especificação). Os **módulos de macro** saem com o código-fonte
      (até 20 KB por módulo e 100 KB no total), as rotinas que rodam ao abrir
      (AutoOpen, Document_Open, Workbook_Open…) e as chamadas suspeitas (Shell,
      CreateObject, URLDownloadToFile, PowerShell, Environ, Chr…);
    - **RTF:** objetos OLE embutidos (`\objupdate` = atualização automática), DDE e
      HYPERLINK.
  - **Risco:** alto quando há algo que roda sozinho ou baixa conteúdo; médio para
    objetos embutidos, XFA e macros sem nada suspeito; baixo no resto.
  - **IOCs:** os links do documento entram nos IOCs sugeridos.
  - **Ficha:**
    - aviso no topo quando o risco é alto ("documento com conteúdo ativo…");
    - seção **Documento** com risco, alertas coloridos, links (só como texto, com
      Copiar) e objetos embutidos;
    - **Macros VBA**, com linhas, "roda ao abrir", chamadas suspeitas e **Ver código**
      (o texto do código aparece cru: um `<script>` aparece como texto);
    - amostras enviadas antes ganham a análise com "Analisar agora" / reanálise.
  - **Testes:**
    - 20 checagens com arquivos montados no próprio teste: PDF com JavaScript
      ofuscado e link num stream comprimido, `.doc` OLE com projeto VBA, `.docm` com
      `vbaProject.bin`, template remoto e DDE, `.docx` limpo, RTF e corrompidos;
    - `document.mjs`.

### 71. Similaridade por hash difuso (TLSH)
- **Problema:** variantes de um mesmo malware têm SHA-256 diferente e não aparecem como
  relacionadas.
- **Proposta:** calcular o **TLSH** de cada arquivo no envio e mostrar na aba
  Relacionadas as amostras parecidas ("94% parecida"), com limiar ajustável.
- **Cuidados:** cálculo em JavaScript puro ou WASM (sem binário nativo); comparação
  eficiente (pré-filtro por tamanho e tipo); amostras antigas calculadas em segundo plano.
- ✅ **Implementado** (migração `20261124000000_entry_tlsh`: coluna `Entry.tlsh`):
  - **Hash** (`lib/tlsh.ts`): implementação própria em TypeScript com arrays tipados,
    sem dependência nova. Gera o mesmo digest da referência (conferido com o tlsh-js em
    62 arquivos e com o vetor do README); 16 MB em ~0,3 s.
    - Arquivo com menos de 512 bytes, sem variedade ou acima de 32 MB fica com `''`
      ("não calculável"); `null` = ainda não calculado.
    - Distância TLSH (0 = iguais) vira **similaridade** = 100 − distância (mínimo 0).
  - **Envio:** o TLSH é calculado junto com o SHA-256.
  - **Amostras antigas** (`lib/tlsh-backfill.ts`): calculadas em segundo plano depois
    de a API subir, um arquivo por vez, lendo do MinIO. Expurgada ou ilegível fica `''`
    para não repetir.
  - **Relacionadas:**
    - novo motivo `SIMILAR` ("Arquivo parecido (TLSH): 85%"), com peso 0,9 × a %;
    - `?similarity=` de 50 a 99 (padrão 70, ou seja, distância até 30);
    - compara com os 20 mil hashes mais recentes. A distância é uma conta de 35 bytes,
      então o pré-filtro por tamanho e tipo não foi necessário;
    - a cópia idêntica continua só como "Mesmo arquivo (SHA-256)".
  - **Tela:**
    - aba Relacionadas com o filtro **Arquivos parecidos a partir de** (50–90%, Limpar
      volta a 70%); a lista vazia mantém o filtro para baixar o limiar;
    - ficha com o **TLSH** ("T1…", com Copiar) na seção Arquivo, ou "Não calculável" /
      "Calculando…".
  - **Testes:**
    - 10 checagens no Postgres/MinIO: cálculo no envio, arquivo pequeno, variante
      parecida (90%), aleatório fora, cópia idêntica sem `SIMILAR`, limiar mais alto,
      cálculo das antigas, expurgada/ilegível e não repetir;
    - `similar.mjs`.

### 72. Regras de atribuição automática
- **Proposta:** regras "quando chegar amostra com tipo/tag/prioridade X, atribuir ao
  analista Y" ou **rodízio** entre analistas de um grupo, pulando quem está ausente.
- **Decisão (24/10/2026):** **grupos + regras**, que **analistas e admins** configuram.
  - Grupos de analistas (ex.: Phishing, Malware), cada um com os seus membros.
  - Regras em ordem: "amostra do tipo / com a tag / da prioridade X → grupo". A primeira
    que casar vale; sem regra, a amostra fica sem responsável (como hoje).
  - Dentro do grupo, **rodízio** entre os membros, pulando quem está **ausente** (marcado
    na Minha Conta ou por um admin) e quem está inativo.
  - Tudo no histórico da amostra, com autor "Sistema" e a regra aplicada; o responsável
    recebe o aviso de atribuição como hoje.
- ✅ **Implementado** (migração `20261129000000_auto_assignment`: `AssignmentGroup`,
  `AssignmentGroupMember`, `AssignmentRule` e `User.away`):
  - **Rodízio** (`lib/auto-assign.ts`), chamado ao criar qualquer amostra (arquivo,
    link, anexo de e-mail, conteúdo de ZIP):
    - vale a primeira regra **ligada** que casar: tipo, tag e prioridade, com campo vazio
      valendo qualquer valor;
    - dentro do grupo, recebe o membro ativo, analista ou admin, **não ausente**, que
      recebeu há mais tempo (quem nunca recebeu vem primeiro);
    - uma trava por grupo no Postgres impede que envios simultâneos caiam na mesma
      pessoa;
    - nunca troca um responsável já definido. Sem regra ou sem ninguém disponível, a
      amostra fica sem responsável. Uma falha na atribuição não impede o envio;
    - no histórico: "Responsável: — → Ana (automática: grupo Phishing (tipo link, tag
      phishing))", autor Sistema, e o aviso "O sistema atribuiu a amostra a você".
  - **API** (`routes/assignment.ts`, analistas e admins):
    - `GET /api/assignment` traz grupos com membros e disponibilidade, regras com a
      descrição e os analistas;
    - grupos: criar, renomear, definir membros (só analistas e admins ativos; quem
      fica mantém a vez) e excluir, o que leva as regras do grupo;
    - regras: criar no fim, ligar/desligar, subir/descer e excluir;
    - `PUT /api/assignment/away/:userId`: a pessoa marca a si mesma, um admin marca
      qualquer analista. O `auth/me` traz `away`.
  - **Tela** `/atribuicao` (pasta Gestão):
    - **Regras** em ordem, com Subir/Descer, Ligar/Desligar e Excluir; a regra
      desligada aparece apagada; incluir por grupo, tipo, tag e prioridade;
    - **Grupos**, com os membros (ausentes e inativos marcados) e quantas regras;
      Membros…, Renomear… e Excluir (avisa das regras);
    - **Disponibilidade**: caixa "Ausente" por analista (o admin marca qualquer um).
  - **Testes:**
    - 28 checagens no Postgres: sem regra, permissões, nome repetido, membros válidos,
      ordem, rodízio entre três, histórico e aviso, ausente/inativo pulados, ninguém
      disponível, ordem e regra desligada, não troca responsável, envios simultâneos
      sem repetir, leitura e exclusão do grupo;
    - `assignment.mjs`.

### 73. Escalonamento por prazo
- **Problema:** amostra atrasada só aparece na fila "Atrasadas"; ninguém é avisado.
- **Proposta:** ao entrar em alerta, avisar o responsável na Caixa de entrada; ao
  atrasar, avisar também os admins e, se ligado, subir a prioridade um nível. Tudo no
  histórico da amostra.
- **Cuidados:** um aviso por mudança de estado (sem repetir a cada minuto); sem
  responsável, avisa os analistas.
- ✅ **Implementado** (migração `20261125000000_sla_escalation`):
  - **Rodada** (`lib/sla-escalation.ts`): ao subir e a cada 5 minutos, usando os
    prazos de cada prioridade (`lib/sla.ts`). O atraso é tratado antes: quem pulou
    direto para atrasada recebe só o aviso de atraso.
  - **Um aviso por nível e por status:** `Entry.slaStage` (alerta/atraso) guarda até
    onde já avisou. O mesmo trigger que mantém `statusChangedAt` zera o campo quando o
    status muda; outras mudanças não zeram. A marcação só vale se a amostra não mudou
    no meio, então duas rodadas ao mesmo tempo avisam uma vez só.
  - **Quem recebe** (notificações `SLA_WARN` / `SLA_LATE` na Caixa de entrada,
    "Prazo em alerta: mais de 24 h no mesmo status" / "Amostra atrasada: …"):
    - **alerta:** o responsável; sem responsável, os analistas ativos;
    - **atraso:** o responsável (ou os analistas) e os admins ativos.
  - **Prioridade:** com `SLA_ESCALATE_PRIORITY=true` (padrão `false`), ao atrasar a
    prioridade sobe um nível (P4 → P3 → P2 → P1), com o evento "Prioridade: P3 Média →
    P2 Alta (escalonamento por atraso)". O prazo mais curto da nova prioridade não gera
    novo aviso.
  - **Histórico:** "Prazo em alerta: mais de 24 h no status atual (P3 Média)" /
    "Atrasada: …", com autor **Sistema**.
  - **Sem enxurrada:** prazo cruzado há mais de 24 h (primeira subida com a fila cheia,
    API parada por dias) só é marcado, sem aviso, sem evento e sem subir a prioridade.
  - **Testes:**
    - 25 checagens no Postgres: quem recebe, inativos e concluídas fora, lixeira, não
      repetir, atraso direto, prioridade (e P1), antigas só marcadas, trigger zerando
      ao mudar de status, rodadas simultâneas;
    - `sla-escalation.mjs`.

### 74. Exportar o caso
- **Proposta:** no caso, **Exportar (Markdown)** e **Imprimir**: dados, amostras com
  hash e veredito, relatórios publicados, IOCs de todas as amostras (sem repetir),
  técnicas ATT&CK e linha do tempo; IOCs do caso também em CSV/STIX.
- **Cuidados:** mesmo visual da ficha para impressão.
- ✅ **Implementado** (sem migração):
  - **IOCs do caso** (`entriesIocs` em `routes/iocs.ts`): os dos relatórios publicados e
    os das próprias amostras (SHA-256, URL, domínio), sem repetir, cada um com as
    amostras onde aparece. "Relatório publicado" vence "própria amostra"; rascunhos e
    amostras na lixeira ficam de fora.
    - `GET /api/cases/:id/iocs`.
    - `GET /api/cases/:id/iocs/export?format=csv|stix|misp` (`lib/ioc-export.ts`):
      - **CSV:** coluna com as amostras;
      - **STIX 2.1:** mesmos ids de indicador da exportação da amostra, tipo pelo pior
        veredito entre as amostras, mais um `grouping` com o caso;
      - **MISP:** ameaça pelo pior veredito e análise pelo status do caso.
  - **Tela do caso:**
    - nova seção **Indicadores das amostras (N)**, com link para a ficha do indicador
      (a URL fica só como texto) e para as amostras;
    - **Imprimir** e o menu **Exportar**: "Caso completo (Markdown)" e "IOCs do caso"
      em CSV, STIX 2.1 e MISP (desligados sem indicadores).
  - **Markdown** (`components/caseExport.ts`): dados, amostras com hash/URL, status,
    prioridade e veredito, relatórios publicados (resumo, achados, IOCs, ATT&CK),
    indicadores, técnicas ATT&CK com o nome e as amostras, e linha do tempo com os
    comentários.
  - **Impressão** (`/casos/:id/imprimir`, `pages/CasePrintPage.tsx`): as mesmas
    seções, no visual da ficha impressa (fora da casca, `?auto=1`, "Impresso por /
    em", aviso no rodapé).
  - O detalhe do caso passou a trazer o SHA-256/URL das amostras e os achados/IOCs dos
    relatórios.
  - **Testes:**
    - 17 checagens no Postgres: detalhe, IOCs sem repetir (ordem, origem, duas
      amostras), rascunho e lixeira de fora, CSV, STIX (grouping, pior veredito, mesmo
      id da amostra), MISP (ameaça, análise), permissões e erros;
    - `case-export.mjs`.

### 75. Versões do relatório
- **Problema:** relatório publicado pode ser editado (sem revisão obrigatória) e não fica
  registro do que mudou.
- **Proposta:** cada edição guarda a versão anterior; o relatório mostra "Versões (3)" e
  a diferença entre duas versões (linhas adicionadas e removidas), com quem e quando.
- ✅ **Implementado** (migração `20261126000000_report_revisions`):
  - **API:**
    - `ReportRevision`: cada `PATCH /api/reports/:id` que muda o conteúdo (resumo,
      achados, IOCs, veredito ou técnicas ATT&CK) guarda a versão anterior, com a
      situação de então (rascunho/publicado). Mudar só a situação (Publicar) ou mandar
      o mesmo conteúdo não gera versão. Os artigos da base citados não têm versão.
    - `GET /api/reports/:id/versions` (só analistas, porque versões antigas podem ter
      texto de rascunho) devolve da 1ª à atual, com autor e data: a 1ª é do autor na
      criação, as seguintes de quem editou, quando editou.
    - A lista de relatórios traz `_count.revisions`.
  - **Editar na tela:** a aba Relatórios não tinha edição (só a API editava). Agora o
    autor ou um admin tem **Editar**: resumo, achados, IOCs, ATT&CK, artigos e
    veredito, com Ctrl+S, Cancelar e aviso de alteração não salva. Também serve para
    ajustar um relatório devolvido. Fica fora em revisão e, com revisão obrigatória,
    no publicado (a API já recusava).
  - **Versões (N):** escolhe duas versões ("Versão 2 (atual) — Bruno Lima, data ·
    publicado") e mostra:
    - a diferença linha a linha de Resumo, Achados e IOCs (`components/textDiff.ts`,
      maior subsequência comum), com contagem +/−, linhas verdes e vermelhas
      riscadas, e texto para leitor de tela;
    - o veredito "Desconhecido → Suspeito" e as técnicas ATT&CK adicionadas e removidas;
    - "mesmo conteúdo" quando não há diferença.
  - **Correção junto (commit `fix:` antes deste):** com o zod 4, o PATCH do relatório
    voltava o veredito a "Desconhecido" e despublicava quando o campo não vinha
    (`.partial()` mantém os `.default()`). O botão "Publicar" também gravava
    "Desconhecido" na amostra.
  - **Testes:**
    - 19 checagens no Postgres: versão guardada com o conteúdo e a situação antigos,
      autores e datas, sem versão para conteúdo igual ou só a situação, admin edita,
      campo vazio, rascunho, permissões, em revisão, revisão obrigatória e contador;
    - 9 checagens da correção do PATCH;
    - `report-versions.mjs`.

### 76. Evidências no relatório
- **Proposta:** anexar **imagens** ao relatório (prints da página falsa, da VM do
  sandbox, do e-mail), guardadas no MinIO, com miniaturas e visualização ampliada; entram
  na ficha para impressão e na exportação do caso.
- **Cuidados:** só imagens (PNG, JPEG, WebP), tamanho máximo, metadados EXIF removidos,
  verificação do tipo real (não confiar na extensão).
- ✅ **Implementado** (migração `20261127000000_report_evidence`):
  - **Imagem** (`lib/evidence-image.ts`, sem dependência nova): só lê e recorta bytes,
    sem decodificar nada.
    - **Tipo real** pela assinatura: PNG, JPEG ou WebP. SVG, GIF, executável com
      extensão de imagem, arquivo truncado ou malformado são recusados.
    - **Metadados removidos:**
      - PNG: `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`;
      - JPEG: APP1 (EXIF/XMP), APP3–APP13 (IPTC), APP15 e comentários. Ficam JFIF,
        o perfil de cor ICC e o Adobe;
      - WebP: `EXIF` e `XMP `, com os bits apagados no VP8X;
      - em todos, os bytes depois do fim da imagem (dado escondido).
    - Dimensões lidas do cabeçalho; lado acima de 12.000 px é recusado.
    - **Conferido no Chromium:** imagens reais com EXIF/GPS, XMP, IPTC e lixo no fim
      decodificam iguais (mesmos pixels) antes e depois da limpeza.
  - **API** (`routes/evidence.ts`):
    - `POST /api/reports/:id/evidence` (multipart com `file` e `caption`): até 10 MB
      por imagem e 20 por relatório. Grava em `evidence/<relatório>/<uuid>.<ext>` no
      bucket de amostras e responde com quantos metadados saíram;
    - `PATCH /api/evidence/:id` muda a legenda (até 300 caracteres);
    - `DELETE /api/evidence/:id` apaga a imagem no MinIO antes da linha;
    - `GET /api/evidence/:id` serve a imagem com `nosniff`, `Content-Security-Policy:
      sandbox` e `inline`. Usuário comum só vê as de relatório publicado; amostra na
      lixeira não mostra.
    - Quem altera é quem edita o relatório (autor ou admin): fora de revisão e, com
      revisão obrigatória, não no publicado.
    - O relatório (lista, caso) traz as evidências em ordem. Excluir a amostra de vez
      na lixeira também apaga as imagens.
  - **Tela:**
    - campo **Evidências (N)** no relatório, com miniaturas (a imagem inteira cabe no
      quadro) e legenda (sem legenda, "Evidência N");
    - **visualização ampliada** com legenda, dimensões, tamanho, quem enviou e quando;
      setas e botões trocam de imagem, Esc fecha e o foco volta à miniatura, e há
      "Abrir em nova aba";
    - para quem edita: legenda opcional e **Adicionar imagens…** (várias de uma vez,
      com o motivo de cada recusa), "Legenda…" e "Excluir" com confirmação.
  - **Impressão e exportação:**
    - a ficha impressa e a impressão do caso mostram as imagens, duas por linha, sem
      quebrar entre páginas;
    - o Markdown do caso lista as evidências pela legenda (as imagens ficam no
      DeepLook).
  - **Miniaturas:** são a própria imagem reduzida no navegador. Gerar miniatura no
    servidor exigiria decodificar a imagem (biblioteca nativa); fica para depois se o
    tamanho pesar.
  - **Testes:**
    - 28 checagens no Postgres/MinIO: tipo real com nome trocado, metadados fora,
      cabeçalhos, PNG/WebP, recusas (SVG, executável, 10 MB, legenda), permissões,
      legenda, publicado/usuário comum, revisão obrigatória, em revisão, limite de 20,
      excluir no MinIO, caso e lixeira;
    - 28 checagens da limpeza com imagens reais;
    - `evidence.mjs`; `case-export.mjs` com evidência.

### 77. Relatório gerencial
- **Proposta:** tela **Relatórios** (admin e analistas) com o resumo de um período:
  amostras recebidas e concluídas, tempo médio até concluir (por prioridade), vereditos,
  técnicas mais vistas, casos abertos e encerrados e carga por analista; exportar em CSV
  e imprimir.
- ✅ **Implementado** (sem migração):
  - **API** (`routes/management.ts`): `GET /api/management?from=&to=&tz=` (analistas e
    admins). As datas são dias inteiros no fuso do navegador (inválido cai em UTC), até
    366 dias. Traz:
    - recebidas (arquivos e links) e concluídas no período: as que chegaram a Concluído,
      sem duplicatas, que não tiveram análise;
    - **tempo até concluir** (do envio à conclusão): média e mediana, no total e por
      prioridade;
    - vereditos das concluídas e técnicas ATT&CK dos relatórios publicados escritos no
      período;
    - casos abertos, encerrados e em aberto hoje;
    - **carga por analista:** concluídas como responsável e tempo médio, relatórios
      publicados e revisões feitas. Os ativos aparecem sempre; os inativos, só com
      atividade.
    - `&format=csv`: CSV do Excel com uma linha por indicador (seção, item, quantidade,
      tempos, relatórios, revisões).
  - **Tela** `/gerencial` (pasta **Gestão** no navegador):
    - atalhos de período (7, 30 e 90 dias, mês atual, mês anterior, ano atual) e datas
      De/Até, que ficam na URL; padrão: últimos 30 dias;
    - indicadores, tabela por prioridade (acima de 48 h mostra em dias), barras de
      vereditos e técnicas e a tabela por analista;
    - **Exportar CSV** e **Imprimir** (`/gerencial/imprimir`, no visual da ficha
      impressa, com a explicação das contas no rodapé).
  - **Testes:**
    - 23 checagens no Postgres: contagens com duplicata, lixeira e outro mês de fora,
      média e mediana por prioridade, total, técnicas, casos, carga (inativo, admin
      zerado, ordem), limite do dia no fuso de São Paulo, fuso inválido, CSV e
      validações;
    - `management.mjs`.

### 78. Importar indicadores
- **Proposta:** importar uma lista de indicadores (CSV ou pacote STIX 2.1) para **seguir**
  (alertas de IOC) ou para a **lista de permissões**, com pré-visualização do que foi
  reconhecido antes de confirmar.
- **Cuidados:** limite de linhas; indicadores inválidos listados à parte; nada é buscado
  na internet.
- ✅ **Implementado** (migração `20261128000000_audit_allowlist_import`: ação de auditoria
  `ALLOWLIST_IMPORTED`):
  - **Leitura** (`lib/ioc-import.ts`, só texto, nada é buscado na internet):
    - **CSV/lista:** um indicador por linha, com ou sem coluna de tipo ("ip;1.2.3.4",
      "domain,x.test"). Separador `;`, `,` ou tab; cabeçalho e BOM do Excel aceitos;
      hxxp e [.] desfeitos; uma URL vira o host;
    - **STIX 2.1:** `indicator` com pattern (`ipv4-addr`, `domain-name`, `email-addr`,
      `url` e hashes de `file`, com OR/AND) e os observáveis soltos (`ipv4-addr`,
      `domain-name`, `email-addr`, `url`, `file`). Pattern sem indicador suportado ou de
      outra linguagem vai para os inválidos;
    - limites: 5000 linhas ou objetos e 2 MB; repetidos contam uma vez.
    - **Validação por destino:** seguir só aceita o que pode aparecer nos relatórios (sem
      faixa CIDR e sem IP privado); a lista de permissões aceita faixas.
  - **API** (`routes/ioc-import.ts`):
    - `POST /api/iocs/import/preview { target, text }` → reconhecidos com a situação
      ("novo", "já seguido/permitido", "já coberto" por domínio ou faixa, "sem vaga"
      acima do limite de 200 seguidos), inválidos com o motivo, repetidos e vagas;
    - `POST /api/iocs/import { target, items, reason? }` revalida tudo no servidor e
      grava só os novos. Seguir é por usuário (qualquer um); permitidos são só para
      analistas, com motivo obrigatório e uma linha na auditoria com a quantidade.
  - **Tela:** diálogo **Importar indicadores**, aberto pela Minha Conta > Indicadores
    ("importe uma lista") e pelo botão **Importar…** dos Indicadores permitidos:
    - colar ou **Escolher arquivo…** (.csv, .txt, .json);
    - **Pré-visualizar**: resumo, tabela dos reconhecidos (os que não entram ficam
      apagados) e "Não importados" com o motivo;
    - motivo (permitidos) e **Importar N**. Esc fecha.
  - **Testes:**
    - 24 checagens no Postgres: CSV (tipo na coluna, URL, faixa, IP privado, texto,
      repetido), situação, revalidação, limite de 200, permitidos (já, coberto, faixa,
      motivo, autor, auditoria, lista recarregada), STIX e erros;
    - `ioc-import.mjs`.

### 79. Notificações por e-mail — adiado
- **Proposta:** enviar por e-mail (SMTP) o que hoje vai só para a Caixa de entrada
  (menções, atribuições, relatório devolvido, alerta de IOC), com opção por pessoa;
  também "Esqueci a senha" por e-mail.
- **Decisão (24/10/2026):** **adiado** — não há servidor SMTP por enquanto. Os avisos
  continuam só na Caixa de entrada; a senha continua sendo redefinida pelo admin.

### 80. Captura da página de um link
- **Proposta:** para amostras do tipo link, abrir a página num **navegador isolado**
  (contêiner próprio, sem acesso à rede interna) e guardar captura de tela, HTML,
  redirecionamentos e certificado, como evidência e para o analista não precisar abrir o
  link.
- **Decisão (24/10/2026):** o servidor pode acessar os links; captura **sob demanda**
  ("Capturar página" na ficha do link), num navegador isolado em contêiner próprio, sem
  acesso à rede interna (só internet), com tempo e tamanho limitados.
- ✅ **Implementado** (migração `20261130000000_page_capture`: `PageCapture` e o evento
  `PAGE_CAPTURED`):
  - **Serviço `capture`** (`apps/capture`): Chromium da imagem do Playwright 1.49.0 com um
    servidor HTTP mínimo (`POST /capture` com token, `GET /health`).
    - **Proxy de saída** (`src/proxy.mjs`): todo o tráfego do navegador passa por ele, que
      resolve o nome uma vez e recusa endereços privados, loopback, link-local,
      CGNAT, reservados e de metadados de nuvem (169.254.169.254), inclusive IPv6 e
      IPv4 mapeado. A conexão vai para o IP conferido, sem nova resolução de DNS
      (sem DNS rebinding); o que foi recusado volta na resposta.
    - **Navegador:** WebRTC/QUIC e prefetch de DNS desligados, só `http(s)` (file:, ftp:…
      recusados), sem downloads e sem service workers; contexto novo a cada captura;
      certificado inválido aceito e registrado.
    - **Limites:** 20 s para abrir, print de 1280 px de largura e até 6.000 px de altura,
      HTML de até 2 MB, uma captura por vez; erros do Chromium traduzidos ("a página
      não respondeu em 20 s", "domínio não encontrado").
    - **docker-compose:** contêiner só na rede `capture` (sem banco, MinIO ou ClamAV),
      `no-new-privileges`, usuário sem privilégios, `shm_size` 512 MB e 1 GB de
      memória.
  - **API** (`lib/page-capture.ts`, `routes/captures.ts`):
    - `POST /api/entries/:id/capture` (analistas, só links, uma em andamento por
      amostra) roda em segundo plano;
    - print e HTML vão para o MinIO (`captures/<amostra>/<id>.png | .html.txt`);
      redirecionamentos, certificado e bloqueados ficam no banco; o histórico registra
      "Página capturada";
    - `GET /api/entries/:id/captures` (todos que veem a amostra);
    - `GET /api/captures/:id/screenshot` serve com `nosniff` e CSP `sandbox`;
      `GET /api/captures/:id/html` **só como anexo de texto**;
    - capturas em andamento quando a API reinicia viram falha; serviço fora do ar ou
      token errado viram falha com o motivo; excluir de vez na lixeira apaga os
      arquivos;
    - `CAPTURE_URL`/`CAPTURE_TOKEN` (vazio = desligada); o **Status do sistema** ganhou
      a linha "Captura de página".
  - **Tela** (ficha do link, aba Detalhes): **Capturar página** / "Capturar de novo",
    com acompanhamento enquanto roda. Mostra:
    - o print (clique abre inteiro);
    - título, **endereço final como texto** (com Copiar, nunca link) e resposta HTTP;
    - a cadeia de redirecionamentos e o certificado (emissor, validade, "vencido");
    - o que foi bloqueado, **Baixar HTML (texto)** e as capturas anteriores.
  - **Testes:**
    - 21 checagens ponta a ponta com o serviço real em contêiner e um site de teste:
      redirecionamentos 302→301→200, título, print PNG, HTML como anexo, IP interno,
      169.254.169.254 e loopback bloqueados, alvo interno recusado, HTML cortado em
      2 MB, arquivo sem página, token errado, serviço fora do ar, desligada,
      reinício;
    - `capture.mjs`.

---

## Sétima leva — ideias 81 a 94

Analisar o que hoje passa batido (ZIP com senha, scripts, atalhos e imagens de disco),
automatizar a triagem (tags e prioridade por regra), falar com quem enviou (resolução e
avisos gerais), proteger a operação (backup, login pelo AD) e enxergar as campanhas
(mapa de relações, domínios parecidos com os da empresa), sempre no padrão visual do HP
Service Manager 9.

| # | Ideia | Padrão do HPSM 9 | Prioridade | Esforço | Status |
|---|---|---|---|---|---|
| 81 | Backup em ZIP para baixar | administração do sistema | 🔴 | M | ⬜ |
| 82 | ZIP com senha ("infected") | campos calculados do registro | 🔴 | M | ↩ já existe (item 44) |
| 83 | Análise de scripts (PowerShell, JS, VBS, BAT, HTA) | campos calculados do registro | 🔴 | M | ✅ |
| 84 | Atalhos (.lnk) e imagens de disco (.iso, .img, .vhd) | campos calculados do registro | 🟡 | M | ✅ |
| 85 | Decodificador (Base64, hex, XOR, PowerShell, gzip) | ferramentas do registro | 🟡 | P–M | ✅ |
| 86 | Tags e prioridade automáticas por regra | regras de negócio | 🟡 | M | ✅ |
| 87 | Resolução para quem enviou | Solution / Resolution | 🟡 | P–M | ⬜ |
| 88 | Mensagens do sistema (aviso geral) | Broadcast messages | 🟡 | P | ⬜ |
| 89 | Menções e avisos nos casos | Activities / Notifications | 🟡 | P | ⬜ |
| 91 | Mapa de relações (amostras, indicadores, casos) | registros relacionados | ⚪ | M–G | ⬜ |
| 92 | Domínios parecidos com os da empresa | listas de vigilância | ⚪ | M | ⬜ |
| 93 | Documentação da API (OpenAPI) | Web Services | ⚪ | M | ⬜ |
| 94 | Login pelo AD/LDAP (opcional) | autenticação externa | ⚪ | M–G | ⬜ |

**Ordem (uma etapa por item, com testes, documentação e commit próprio):**
83 → 85 → 84 → 86 → 87 → 88 → 89 → 91 → 92 → 93 → 81 → 94 (o 82 já existia).

**Decisões (29/10/2026):** 81 vira um ZIP gerado na tela e baixado; 90 (expediente e
feriados no prazo) saiu do projeto; 94 só com AD/LDAP e opcional.

### 82. ZIP com senha ("infected")
- **Problema:** amostras de malware circulam em ZIP com senha (quase sempre `infected`).
  Hoje o ZIP com senha entra como um arquivo só, sem os arquivos de dentro.
- **Proposta:** campo **Senha do ZIP** no envio, já preenchido com `infected`. O ZIP é
  aberto com a senha (ZipCrypto e AES) e cada arquivo vira uma amostra filha, como no
  ZIP comum. Errou a senha: aviso claro e o ZIP fica como amostra única.
- **Cuidados:** os mesmos limites do ZIP comum (zip-bomb, quantidade, tamanho); a senha
  não é guardada; nada é executado.
- ↩ **Já existe:** o envio em lote do [item 44](#44-envio-em-lote) já desmembra um `.zip`
  com senha (padrão `infected`, ZipCrypto e AES) em amostras. Nada a fazer.

### 83. Análise de scripts (PowerShell, JS, VBS, BAT, HTA)
- **Problema:** scripts maliciosos chegam ofuscados (`-EncodedCommand`, `FromBase64String`,
  `eval`, concatenações) e o analista desofusca à mão.
- **Proposta:** na análise estática, reconhecer scripts e mostrar a seção **Script**:
  - comandos e funções suspeitas (`IEX`, `DownloadString`, `Invoke-WebRequest`,
    `WScript.Shell`, `eval`, `ActiveXObject`, `certutil`, `bitsadmin`);
  - **camadas decodificadas**: `-EncodedCommand` (UTF-16LE), Base64 e gzip/deflate em
    PowerShell, `String.fromCharCode` e `unescape` em JS;
  - URLs e domínios achados nas camadas, nos IOCs sugeridos.
- **Cuidados:** só leitura e decodificação; nada é executado; limite de camadas e de
  tamanho; texto mostrado sempre como texto.
- ✅ **Implementado** (sem migração: o resultado vai em `staticInfo.script`):
  - **Análise** (`lib/script-analysis.ts`, sem dependência nova):
    - **Linguagem** pela extensão (`.ps1`, `.js`/`.jse`/`.wsf`, `.vbs`/`.vbe`,
      `.bat`/`.cmd`, `.hta`) ou, sem ela, pelo conteúdo (`@echo off`,
      `<hta:application`, `CreateObject`, `$var =`). Aceita UTF-8 e UTF-16 com BOM;
      binário e texto comum ficam de fora.
    - **Achados** (27 regras), cada um com o porquê e o tipo:
      - baixar: DownloadString, Invoke-WebRequest, Net.WebClient, BITS,
        certutil, XMLHTTP, ADODB.Stream;
      - executar: IEX, Start-Process, WScript.Shell, .Run, eval, ActiveX,
        CreateObject, mshta/rundll32/regsvr32/wmic;
      - evasão: janela oculta, ExecutionPolicy Bypass, exclusão no Defender, desvio
        do AMSI, apagar cópias de sombra, `attrib +h`;
      - persistência: Run, tarefa agendada;
      - ofuscação: -EncodedCommand, FromBase64String, fromCharCode, unescape/atob,
        Chr() em série.
    - **Camadas decodificadas**, em cadeia, até 5 níveis e 12 camadas: `-EncodedCommand`
      (UTF-16LE), `FromBase64String` (com GZip/Deflate/zlib), `atob`,
      `String.fromCharCode`, `unescape`/`decodeURIComponent`, `Chr() & Chr()` e blocos
      Base64 longos. Repetidas são reconhecidas pelo hash do texto inteiro.
    - URLs do arquivo e das camadas entram nos IOCs sugeridos. Arquivo do Script
      Encoder (`#@~^`) é marcado, mas não decodificado.
    - **Risco:** alto quando baixa e executa, tenta evasão, ou quando uma camada
      escondida baixa ou executa; médio com só uma dessas coisas ou só ofuscação;
      baixo no resto.
  - **Ficha:**
    - aviso no topo com risco alto ("script … com comportamento malicioso (…). Não
      execute fora do ambiente isolado");
    - seção **Script** com linguagem, risco, linhas, achados (o porquê e onde: no
      arquivo ou na camada N), URLs só como texto (com Copiar) e as camadas com
      método, origem e tamanho. **Ver texto** mostra o texto puro: HTML dentro do
      script não vira HTML.
  - **Testes:**
    - 25 checagens com scripts montados no teste: BAT com `-enc`, PowerShell com
      Base64 + GZip em duas camadas, JScript, VBScript sem extensão, HTA com
      `eval(atob)`, UTF-16 com BOM, benigno, texto comum, binário, Script Encoder,
      limite de profundidade e o envio pela API gravando a análise;
    - `script.mjs`.

### 84. Atalhos (.lnk) e imagens de disco (.iso, .img, .vhd)
- **Problema:** atalhos `.lnk` e imagens `.iso`/`.img` são vetores comuns (burlam o Mark
  of the Web) e hoje aparecem só como "binário".
- **Proposta:**
  - **LNK:** destino, argumentos (com o comando escondido), diretório de trabalho, ícone,
    máquina e MAC de origem, datas;
  - **ISO/IMG (ISO 9660 e UDF) e VHD:** lista de arquivos com tamanho e, opcionalmente,
    "Extrair como amostras filhas" (como o ZIP).
- **Cuidados:** leitura direta dos bytes, com limites; arquivos ocultos marcados.
- ✅ **Implementado** (migração `20261201000000_files_extracted`: evento `FILES_EXTRACTED`):
  - **Atalho** (`lib/lnk-analysis.ts`, formato MS-SHLLINK):
    - destino (pelo LinkInfo ou pela lista de itens do Shell, com o nome longo da
      extensão BEEF0004), argumentos, diretório, descrição, ícone e como a janela abre;
    - variável de ambiente do destino, máquina NetBIOS e MAC de origem (TrackerDataBlock)
      e as datas;
    - **alertas:** interpretador ou binário do sistema (PowerShell, cmd, mshta,
      rundll32…), argumentos longos ou escondidos atrás de espaços, URL nos argumentos,
      janela minimizada, ícone de outro tipo de arquivo. A URL dos argumentos entra nos
      IOCs sugeridos.
  - **Imagem de disco** (`lib/disk-image.ts`):
    - **ISO 9660** com os nomes longos do **Joliet** (cobre `.iso` e `.img`, que costuma
      ser ISO renomeada);
    - **FAT12/16/32**, com nomes longos (VFAT), pastas e atributo oculto, numa imagem
      crua ou num **VHD fixo** com MBR;
    - VHDX, VHD dinâmico, NTFS e UDF puro são reconhecidos e marcados como "não listado";
    - até 500 arquivos (cortes indicados), 16 níveis de pasta;
    - alertas para executáveis ou scripts dentro da imagem, ocultos e ".lnk visível com
      arquivos ocultos".
  - **Extrair como amostras** (`POST /api/entries/:id/extract-image`, analistas):
    - até 50 arquivos por vez; cada um vira uma amostra **filha** do mesmo dono, com as
      tags da imagem e analisada como um envio (antivírus, YARA, análise estática);
    - uma vez por imagem (409 na segunda); arquivo expurgado = 410; o histórico
      registra quantos saíram;
    - `GET /api/entries/:id/children` lista as filhas (também as de e-mail).
  - **Ficha:**
    - aviso no topo para atalho perigoso;
    - seção **Atalho do Windows (.lnk)** (argumentos só como texto, Copiar do comando
      completo);
    - seção **Imagem de disco** com formato, rótulo, alertas e a tabela de arquivos
      (ocultos marcados; depois de extrair, cada linha leva à amostra com status e
      veredito);
    - a filha mostra **"Extraído de:"** (e continua "Anexo de:" quando o pai é um
      e-mail).
  - **Testes:**
    - 32 checagens com arquivos gerados por ferramentas reais (`xorriso`, `mkfs.fat`,
      `mtools`, `sfdisk`, `pylnk3`): ISO com Joliet e acentos, FAT16 com nome longo,
      pasta e oculto, FAT32, VHD fixo com MBR, VHDX, LNK com destino, argumentos,
      janela e alertas, arquivos truncados, análise estática, envio, extração (dono,
      tags, título com o caminho), filhas, 409, histórico, não imagem, expurgado;
    - `disk.mjs`.

### 85. Decodificador (Base64, hex, XOR, PowerShell, gzip)
- **Problema:** para decodificar um trecho, o analista copia para outra ferramenta fora
  do DeepLook.
- **Proposta:** ferramenta **Decodificar** (menu Mais e Ctrl+Shift+D): cola o texto e
  encadeia passos (Base64, hex, URL, PowerShell `-EncodedCommand`, XOR com chave,
  gzip/deflate, ROT13), com o resultado em texto e em hex. "Decodificar" também aparece
  na seleção de strings da análise estática.
- **Cuidados:** tudo no navegador; resultado nunca vira HTML nem link; tamanho limitado.
- ✅ **Implementado** (só no front, sem API nova):
  - **Passos** (`components/decoder.ts`), sobre bytes e encadeados em qualquer ordem:
    - Base64 (inclusive URL-safe e sem `=`), hex (com espaços, `0x`, `\x`), URL
      (`%xx` e `%uXXXX`), PowerShell `-EncodedCommand` (Base64 + UTF-16LE), UTF-16LE;
    - XOR com chave em texto ou bytes (`0x20` ou `0x41 0x42`), descompactar
      (gzip, zlib ou deflate, pelo `DecompressionStream` do navegador), ROT13,
      inverter e códigos de caractere (`72,101,…` ou `0x48`).
    - Passo que falha fica marcado em vermelho, com o motivo ("não é hex",
      "Base64 com tamanho inválido"), e os seguintes esperam. Entrada de até 1 MB.
    - **Sugestão** do próximo passo pelo jeito do resultado: Base64, hex, `%xx`,
      números, UTF-16 (zeros alternados) ou gzip (`1f 8b`).
  - **Caixa Decodificar** (`components/DecoderDialog.tsx`):
    - texto, lista de passos (trocar, tirar, XOR com a chave) e "+ Incluir passo…";
    - resultado em **Texto** ou **Hex** (deslocamento, bytes e caracteres; os
      primeiros 4 KB), contagem de bytes e **Copiar** (leva o resultado inteiro,
      mesmo quando a tela corta em 200 mil caracteres);
    - o resultado é sempre texto: HTML ou script dentro dele não vira página.
  - **Onde abre:**
    - **Ctrl+Shift+D** em qualquer tela, já com o texto selecionado (ex.: um trecho
      das strings);
    - **Mais ▾ > Decodificar texto…** na ficha (analistas);
    - **Decodificar…** em cada camada da seção Script (item 83).
    - Esc fecha e o foco volta para onde estava. O atalho entrou na lista (`?`/F1) e
      nas Dicas.
  - **Testes:** `decoder.mjs`; `more-print.mjs` com o item novo do menu.

### 86. Tags e prioridade automáticas por regra
- **Problema:** a triagem repete as mesmas marcações ("macro → tag macro, P2").
- **Proposta:** regras "quando a análise achar X, aplicar Y":
  - condições: tipo real, YARA que casou, detecção do antivírus, domínio ou TLD do link,
    remetente do e-mail, documento com macro, extensão disfarçada;
  - ações: incluir tags e definir prioridade. Roda depois das análises, antes da
    atribuição automática (item 72), que já usa tag e prioridade;
  - tudo no histórico ("tag macro pela regra Documento com macro").
- **Cuidados:** nunca tira tag nem baixa prioridade definida por pessoa; mantida por
  analistas, como as regras de atribuição.
- ✅ **Implementado** (migração `20261202000000_triage_rules`: `TriageRule` e o evento
  `TRIAGE_RULE`):
  - **Regras** (`lib/triage-rules.ts`), com nome, condição, valor, tags e prioridade.
    Valem **todas** as regras ligadas que casarem (não só a primeira). Condições:
    - tipo real (`pe`, `ole`, `pdf`…);
    - regra YARA que casou (nome ou qualquer) e antivírus que detectou (assinatura ou
      qualquer);
    - domínio do link (igual, subdomínio ou `.top`) e remetente do e-mail (endereço ou
      domínio);
    - documento com macro, executável disfarçado, script ou documento com risco alto,
      atalho suspeito.
  - **Ações:** incluir tags (normalizadas, sem repetir) e **subir** a prioridade. Nunca
    tira tag nem rebaixa: P1 continua P1.
  - **Quando roda:**
    - na chegada, logo depois das análises e **antes da atribuição automática**
      (item 72), que já enxerga as tags e a prioridade novas;
    - de novo quando o **YARA** casa ou o **antivírus** detecta, porque essas
      varreduras terminam em segundo plano.
    - Aplicar de novo não repete nada.
  - **Histórico:** "Regra de triagem "Documento com macro": tags macro; prioridade P2"
    e "Prioridade: P3 Média → P2 Alta (regra de triagem)", com autor Sistema.
  - **API** (`routes/triage-rules.ts`, analistas): listar (com a descrição da
    condição), criar (valor obrigatório para tipo real, domínio e remetente; ao menos
    uma tag ou a prioridade), ligar/desligar e excluir (as tags já aplicadas ficam).
  - **Tela** `/regras-triagem` (pasta Detecção): lista com condição, tags, prioridade e
    situação (desligada apagada). A nova regra só mostra o campo Valor quando a
    condição pede, com a dica do formato.
  - **Testes:**
    - 20 checagens no Postgres: validações, chegada com tags e prioridade, atribuição
      automática pela tag da regra, histórico, não repetir, cada condição, regra
      desligada, nunca rebaixar, YARA real no fim da varredura, antivírus, exclusão;
    - `triage-rules.mjs`.

### 87. Resolução para quem enviou
- **Problema:** quem enviou vê o veredito, mas não sabe o que fazer ("posso abrir?",
  "já cliquei, e agora?").
- **Proposta:** campo **Resolução para o solicitante** na conclusão, com modelos ("É
  golpe: não clique, apague o e-mail", "Seguro: pode abrir", "Clicou? Troque a senha e
  avise o suporte"). Aparece em destaque na ficha, em Meus Uploads e no aviso de
  conclusão.
- **Cuidados:** texto curto e sem detalhes técnicos; o relatório completo continua só
  para os analistas.
- ✅ **Implementado** (migração `20261204000000_entry_resolution`: `Entry.resolution`, o
  evento `RESOLUTION_SET` e a notificação `RESOLUTION`):
  - **Campo** "Resolução para quem enviou" na aba Análise, abaixo da triagem (analistas):
    - até 500 caracteres, com contador;
    - modelos que se **somam** ao texto ("É golpe…", "Clicou no link…", "Abriu o
      anexo…", "Ainda suspeito…", "Seguro: pode abrir.", "Legítimo, mas desnecessário…");
    - grava no botão "Salvar resolução" e avisa a alteração não salva; vazio remove.
  - **Onde aparece**, sempre como texto puro:
    - destaque "O que fazer" no topo da ficha, para todos, na cor do veredito;
    - abaixo do título em Meus Uploads;
    - no aviso de concluída (caixa de entrada e sininho), com a resolução atual.
  - **Avisos:** escrever ou trocar numa amostra **já concluída** avisa quem enviou
    ("escreveu o que fazer com a sua amostra"). Em aberto não avisa, porque o aviso
    de concluída já leva a resolução.
  - **Duplicatas:** herdam a resolução da principal (e quem as enviou é avisado). Ao
    marcar como duplicata, a amostra recebe a da principal; se a principal não tem,
    fica com a sua.
  - **Histórico:** "Resolução para quem enviou: "…"", "… removida" e "(da principal)".
  - **Testes:**
    - 20 checagens no Postgres: permissão, limite, aparar, aviso de concluída com a
      resolução, duplicatas, repetir sem efeito, alterar numa concluída, ficha e Meus
      Uploads, em aberto sem aviso, remover, marcar como duplicata;
    - `resolution.mjs`.

### 88. Mensagens do sistema (aviso geral)
- **Proposta:** analistas publicam um aviso para todos ("Campanha de phishing do 'boleto
  vencido' em andamento"), com nível (informação, alerta), validade e, opcionalmente,
  ligado a um caso. Aparece numa faixa no topo e na Página Inicial até vencer ou a pessoa
  dispensar.
- **Cuidados:** no máximo três avisos ativos; texto puro.
- ✅ **Implementado** (migração `20261203000000_broadcasts`: `Broadcast` e
  `BroadcastDismissal`):
  - **Faixa** no topo da área de trabalho, em todas as telas (inclusive a Página
    Inicial), para todos os perfis:
    - alertas primeiro, em laranja; informação em azul;
    - texto puro, o caso ligado como link ("(CASO-0001)"), quem publicou e até quando;
    - "×" dispensa **só para a pessoa**; atualiza a cada 2 minutos e ao voltar à janela.
  - **Gestão** `/avisos` (pasta Gestão, analistas):
    - publicar com texto (5 a 300 caracteres), nível, validade (4 horas a 30 dias) e
      caso opcional;
    - com 3 avisos ativos o formulário avisa o limite em vez de aparecer;
    - lista dos últimos 30 dias com nível, autor, validade e quantas pessoas dispensaram;
    - "Encerrar" (com confirmação) antecipa a validade para agora: sai da faixa de
      todos e fica na lista, apagado.
  - **API** (`routes/broadcasts.ts`): ativos não dispensados para todos; dispensar;
    lista, publicar (409 com 3 ativos, 400 se o caso não existe) e encerrar para
    analistas.
  - **Testes:**
    - 19 checagens no Postgres: permissões, validações, caso, ordem, dispensa por
      pessoa, limite de 3, encerrar, lista com dispensas, vencido some sozinho;
    - `broadcasts.mjs`.

### 89. Menções e avisos nos casos
- **Proposta:** "@" nos comentários do caso, como nas atualizações da amostra; o
  responsável do caso é avisado quando alguém comenta, inclui ou retira amostras; os
  avisos abrem o caso.
- **Cuidados:** não avisa a própria pessoa; reaproveita a Caixa de entrada.
- ✅ **Implementado** (migração `20261205000000_case_notifications`: a notificação passa a
  ser de uma amostra **ou** de um caso, com restrição no banco, e ganha 5 tipos):
  - **Menções:** "@" no comentário do caso, com o mesmo autocompletar das
    atualizações, mas **só com analistas** (quem pode abrir o caso):
    - vão só os ids de quem continua com "@Nome" no texto;
    - a menção fica destacada na linha do tempo.
  - **Avisos** ao responsável do caso:
    - comentário (com o trecho);
    - amostras incluídas ("incluiu 2 amostra(s) no seu caso") e retirada (com o título);
    - e, além da proposta, o caso atribuído a ele.
  - **Regras:** o mencionado recebe "mencionou você"; o responsável mencionado recebe
    só a menção. Nunca avisa quem fez a ação, e incluir de novo o que já estava não
    avisa.
  - **Caixa de entrada e sininho:** a coluna vira "Amostra ou caso" ("CASO-0001 ·
    título"), e os avisos de caso abrem o caso. A lixeira de amostras continua
    escondendo só os avisos delas.
  - **Testes:**
    - 23 checagens no Postgres: comentário, próprio responsável, menções (só analistas,
      só quem está no texto, responsável recebe só a menção), incluir/retirar,
      atribuição, sem responsável, lidas, avisos de amostra iguais, lixeira, restrição
      do banco, autocompletar;
    - `case-notifications.mjs`.

### 91. Mapa de relações (amostras, indicadores, casos)
- **Problema:** as ligações de uma campanha ficam espalhadas entre Relacionadas,
  indicadores e casos.
- **Proposta:** aba **Mapa** na ficha da amostra e no caso: desenho com a amostra no
  centro, os indicadores, as amostras ligadas (mesmo arquivo, parecido, IOC em comum) e
  os casos, com cor pelo veredito. Clicar abre a ficha; "Expandir" busca o próximo nível.
- **Cuidados:** limite de nós (com "+N"); funciona pelo teclado (lista equivalente ao
  lado); respeita a lista de permissões.
- ✅ **Implementado** (sem migração):
  - **API** (`routes/graph.ts`): nós de amostra, indicador e caso, mais as ligações com
    rótulo. A busca da aba Relacionadas virou `findRelated` (`routes/related.ts`) e é
    a mesma nas duas.
    - **Amostra:** indicadores dos relatórios publicados; amostras com o mesmo arquivo,
      parecidas, do mesmo domínio ou com indicador em comum (essa ligação passa pelo
      indicador quando ele está no mapa); tag sozinha não entra.
    - **Casos:** só para analistas; o usuário comum vê o mapa sem eles.
    - **Caso:** as amostras dele e os indicadores, primeiro os que ligam mais de uma.
    - Indicadores da lista de permissões ficam fora; amostras na lixeira também.
    - **Limites:** amostra 12/12/8 e caso 20/15; o que sobra vem em `hidden` e aparece
      como "+N".
  - **Desenho** em SVG próprio, sem biblioteca nova:
    - aba **Mapa** na ficha (todos) e seção "Mapa de relações" no caso;
    - amostras em círculo na cor do veredito, indicadores em losango, casos em
      retângulo; rótulo das ligações ("mesmo arquivo", "parecido 82%");
    - legenda com "Não mostrados: +N";
    - clicar abre a ficha, o caso ou o indicador.
  - **Lista equivalente ao lado** (teclado e leitores de tela): por grupo, com links, o
    motivo da ligação e o **Expandir**. Ele traz as ligações daquela amostra para o
    mesmo desenho sem mexer no que já estava e mostra o "+N" dela.
  - **Testes:**
    - 19 checagens no Postgres (centro, indicadores, permitidos fora, mesmo arquivo,
      ligação pelo indicador, tag sozinha fora, casos só para analistas, limite com
      "+N", mapa do caso com o compartilhado primeiro, 403/404, lixeira);
    - 9 de regressão da aba Relacionadas;
    - `relation-map.mjs`.

### 92. Domínios parecidos com os da empresa
- **Problema:** golpes usam domínios parecidos com os da empresa
  (`empresa-seguranca.com`, `ernpresa.com`).
- **Proposta:** o admin cadastra os domínios da empresa. O DeepLook gera as variações
  comuns (letra trocada, faltando ou repetida, homoglifos, outro TLD, hífen, palavras como
  "login" e "seguranca") e:
  - marca links, remetentes e IOCs que casarem ("parecido com empresa.com.br");
  - mostra a lista de variações já vistas, com as amostras.
- **Cuidados:** nada é consultado na internet; os próprios domínios da empresa entram na
  lista de permissões.
- ✅ **Implementado** (migração `20261206000000_company_domains`: `CompanyDomain` e
  `LookalikeHit`):
  - **Detecção** (`lib/lookalike.ts`). Em vez de **gerar** a lista de variações (milhares,
    com os homoglifos), cada domínio visto é **comparado** com os da empresa pelas
    mesmas regras:
    - outro TLD (`empresa.com`);
    - letras parecidas: `rn`/`m`, `vv`/`w`, `0`/`o`, `1`/`l`, acentos e cirílico/grego,
      também em IDN `xn--`;
    - erro de digitação: letra trocada, faltando, repetida, a mais, invertida ou hífen a
      mais;
    - nome com palavra a mais (`empresa-seguranca`, `loginempresa`);
    - nome no subdomínio (`empresa.com.br.verifica.top`).
    - O próprio domínio e os subdomínios dele não contam. Nada é consultado na internet.
  - **Onde procura:** o link enviado, os remetentes (From, Sender, Reply-To,
    Return-Path) e os links do e-mail, os indicadores sugeridos e os dos relatórios
    publicados.
  - **Quando:** na chegada da amostra, na reanálise, ao publicar ou mudar um relatório e,
    ao mudar a lista, em todas as amostras (em segundo plano, em lotes).
  - **Ficha:** aviso no topo "Domínio parecido com o da empresa — provável golpe", com o
    domínio, o motivo e onde apareceu, para todos os perfis.
  - **Tela** `/dominios-empresa` (pasta Detecção):
    - o admin inclui (aceita URL e `www.`, no máximo 20) e exclui;
    - o domínio entra na lista de permissões (item 69) e, ao excluir, sai só o item que
      o cadastro pôs;
    - analistas veem as **variações vistas**, uma linha por domínio, com o motivo, onde
      apareceu e as amostras (5 com o veredito e "+N").
  - **Testes:**
    - 35 checagens no Postgres: cada regra, o próprio domínio, nomes curtos, cadastro,
      lista de permissões, revarredura, cada origem, ficha, relatório publicado e
      despublicado, variações vistas, permissões, exclusão;
    - `lookalike.mjs`.

### 93. Documentação da API (OpenAPI)
- **Problema:** os tokens de API existem, mas quem integra precisa adivinhar as rotas.
- **Proposta:** especificação OpenAPI 3 gerada das validações das rotas, servida em
  `/api/openapi.json`, e a página **Documentação da API** (Minha Conta > Tokens de API),
  com exemplos em curl para enviar amostra, consultar o resultado e baixar os IOCs.
- **Cuidados:** só as rotas que aceitam token; sem "experimentar" que chame a API real a
  partir da página.
- ✅ **Implementado** (sem migração e sem dependência nova):
  - **Especificação** OpenAPI 3.1 (`lib/openapi.ts`, `GET /api/openapi.json`, com sessão
    ou token):
    - parâmetros e corpos gerados dos schemas zod das próprias rotas (`z.toJSONSchema`
      do zod 4): filtros da lista, link e formato da exportação;
    - upload multipart, respostas, erros e o esquema bearer descritos à mão.
    - Só as rotas que aceitam token (agora exportadas em `ALLOWED_ROUTES`); o teste
      falha se as duas listas divergirem.
  - **Página** Documentação da API (`/user/api`, link em Minha Conta > Tokens de API):
    - passo a passo;
    - exemplos em curl com o endereço do DeepLook e Copiar: enviar arquivo, enviar link,
      consultar o resultado, baixar os IOCs;
    - as rotas lidas da especificação, com método, caminho, campos (caminho, query,
      JSON, formulário; tipo, valores, padrão, obrigatório) e respostas;
    - "Baixar a especificação". Nada na página chama a API pela pessoa.
  - README com o link.
  - **Testes:**
    - 12 checagens: acesso (sem login 401, token, sessão), rotas iguais a
      `ALLOWED_ROUTES`, schemas vindos do zod, multipart, `$ref` resolvidos, parâmetros
      de caminho declarados;
    - `api-docs.mjs`.

### 81. Backup em ZIP para baixar
- **Problema:** banco e MinIO ficam em volumes locais; não há rotina de backup nem teste
  de restauração.
- **Decisão (29/10/2026):** **gerar um ZIP e disponibilizá-lo para download**.
- **Proposta:** na Administração, aba **Backup** (só admin):
  - **Gerar backup** monta, em segundo plano, um ZIP com o dump do banco (`pg_dump`,
    formato custom) e os arquivos guardados no MinIO (evidências, capturas e,
    opcionalmente, os arquivos das amostras), mais um manifesto com versão, data,
    contagens e SHA-256 de cada parte;
  - acompanha o progresso e mostra **Baixar** quando fica pronto; os últimos backups
    ficam listados (os antigos expiram) e tudo vai para a auditoria;
  - README com o passo a passo de restauração (`pg_restore` e cópia para o bucket).
- **Cuidados:** um backup por vez; o ZIP fica no MinIO, baixa só com admin logado e
  expira; com os arquivos das amostras, o ZIP tem malware: aviso claro, e o manifesto
  diz o que entrou.
- ✅ **Implementado** (migração `20261207000000_backups`: `Backup` e as ações de auditoria
  `BACKUP_CREATED`/`BACKUP_DOWNLOADED`/`BACKUP_DELETED`):
  - **Geração** (`lib/backup.ts`), em segundo plano e um por vez (409):
    - `pg_dump --format=custom` num arquivo temporário;
    - os objetos do bucket com o mesmo caminho, sem `backups/` e, sem a opção, sem
      `samples/`;
    - `LEIA-ME-RESTAURACAO.txt` e `manifest.json`: versão, data, quem gerou, se tem
      malware, contagens e o SHA-256 de cada arquivo;
    - o ZIP vai para `backups/<id>.zip` no bucket, enviado em partes.
    - Etapa e progresso ficam na linha; uma falha vira "Falhou" com o motivo (ex.:
      saída do pg_dump).
  - **ZIP** (`lib/zip-writer.ts`), gravador próprio sem dependência nova:
    - sem compressão (o dump já vem comprimido);
    - CRC-32 calculado enquanto os dados passam;
    - ZIP64 quando passa de 4 GB;
    - recusa nome repetido, `../` e tamanho diferente do esperado.
    - Conferido com `unzip -t`, o `zipfile` do Python e o 7-Zip, inclusive em ZIP64
      forçado.
  - **Validade:** `BACKUP_RETENTION_DAYS` (padrão 7). De hora em hora e ao listar, os
    vencidos saem do bucket e ficam como "Vencido". Na subida da API, o que estava em
    andamento vira "Falhou (a API reiniciou)".
  - **API** (`routes/backups.ts`, admin com sessão; token não serve): listar, gerar,
    baixar (com nome de arquivo e auditado) e excluir.
  - **Tela:** aba **Backup** da Administração (e folha no navegador):
    - opção "Incluir os arquivos das amostras", com confirmação "malware real";
    - barra de progresso com a etapa, atualizada a cada 2 s;
    - lista com situação, conteúdo, tamanho, validade, Baixar e Excluir.
  - **Imagem da API:** `postgresql-client-16` do repositório oficial do PostgreSQL
    (PGDG). O Debian traz um pg_dump mais velho, que não exporta o Postgres 16;
    `BACKUP_PG_DUMP` troca o comando.
  - README com "Backup e restauração", e `.env.example`/compose com as variáveis.
  - **Testes:**
    - 22 checagens com Postgres e MinIO reais: permissões, um por vez, manifesto, ZIP
      conferido pelo Python (SHA-256 de cada parte), sem amostras e sem backups,
      **restauração de verdade** com `pg_restore` num banco novo (contagens batem),
      com amostras (malware), falha do pg_dump com o motivo, vencido (sai do bucket,
      não baixa), excluir, auditoria, interrompido na subida;
    - `backup.mjs`.

### 94. Login pelo AD/LDAP (opcional)
- **Decisão (29/10/2026):** por enquanto só **AD/LDAP**, **não obrigatório**. Sem AD
  configurado, tudo continua como hoje (chave de ativação e cadastro normal); com AD
  configurado, a chave e o cadastro normal também continuam valendo.
- **Proposta:**
  - variáveis `LDAP_URL`, `LDAP_BIND_DN`/`LDAP_BIND_PASSWORD`, base e filtro de busca;
  - no login, quem não tem conta local entra com o usuário/senha do AD: a conta é criada
    no primeiro acesso (nome e e-mail do AD), com o papel pelos grupos
    (`LDAP_ANALYST_GROUP`, `LDAP_ADMIN_GROUP`; sem grupo, usuário comum);
  - contas do AD não têm senha local (troca de senha e política ficam no AD), mas o 2FA
    do DeepLook continua valendo;
  - o Status do sistema ganha a linha "AD/LDAP".
- **Cuidados:** LDAPS/StartTLS com verificação de certificado; sem enumerar usuários
  ("usuário ou senha inválidos" igual para tudo); limite de tentativas igual ao login;
  conta suspensa no DeepLook não entra mesmo com a senha certa no AD.
- ✅ **Implementado** (migração `20261208000000_ldap_accounts`: `User.authSource`
  LOCAL/LDAP e `ldapDn`; dependência nova `ldapts` 9.2.0, versão exata):
  - **Configuração** (`lib/ldap.ts`): `LDAP_URL`, `LDAP_STARTTLS`, `LDAP_TLS_CA`, conta de
    serviço, base, filtro (`{login}`; padrão do AD com sAMAccountName, userPrincipalName
    ou mail), atributos de nome e e-mail, e grupos de analistas e admins (por
    `memberOf`).
  - **Só com TLS:** `ldaps://` ou StartTLS, com o certificado verificado contra a CA
    informada; `ldap://` sem StartTLS é recusado (e o Status mostra o erro).
  - **Login:** conta local entra como sempre. Sem conta local (ou com conta do AD):
    - bind da conta de serviço e busca com o valor escapado (RFC 4515);
    - exatamente uma conta encontrada, depois bind com a senha da pessoa (senha vazia
      nunca: seria bind anônimo).
    - No primeiro acesso a conta é criada (nome, e-mail, papel pelos grupos; auditado).
      Nos seguintes, nome, e-mail e papel são atualizados, e a mudança de papel é
      auditada.
    - O 2FA do DeepLook vale igual.
  - **Cuidados:**
    - toda falha responde "Credenciais inválidas", com o motivo real só na Auditoria;
    - o limite de tentativas é o mesmo do login;
    - conta suspensa não entra, mesmo com a senha certa (com a errada, 401 como
      qualquer outra);
    - e-mail do AD que já é de uma conta local: o AD não assume a conta.
  - **Contas do AD:** sem senha local (o hash é aleatório e nunca confere), sem validade
    nem troca obrigatória. Trocar a senha (Minha Conta) e "Redefinir senha" (admin)
    respondem 409.
  - **Tela:**
    - com o AD ligado, o login pede "E-mail ou usuário da rede" (campo texto), com uma
      explicação (`GET /api/auth/options`);
    - a aba Senha da conta do AD explica que a senha é a da rede;
    - a lista de usuários marca "AD" e desliga "Redefinir senha".
  - **Status do sistema:** linha "AD/LDAP" (conexão e TLS, base, grupos, contas do AD).
  - README, `.env.example` e compose com as variáveis.
  - **Testes:**
    - 34 checagens com um **OpenLDAP real** (LDAPS e StartTLS com CA própria):
      - sem AD nada muda;
      - primeiro acesso, por usuário e por e-mail, papéis pelos grupos;
      - mesma resposta para senha errada e usuário inexistente, injeção no filtro,
        conta sem e-mail (motivo só na auditoria);
      - conta local não assumida, suspensa, 2FA, troca e redefinição recusadas;
      - papel atualizado ao sair do grupo;
      - sem TLS recusado, CA errada recusada, Status;
      - senha vazia e limite de tentativas;
    - `ldap-login.mjs`.

## Oitava leva — itens 95 a 124

Resultado da varredura do projeto em 31/10/2026. Salvo indicação, cada problema foi
confirmado na leitura do código; o item 101 também foi reproduzido em teste. Ordem combinada:
95 a 99 primeiro; o resto será ordenado depois. Decisões de 122 e 123 tomadas em 31/10/2026.

### Maior risco

### 95. Imagens instaladas pelo lockfile
- **Problema:** os Dockerfiles da API e do web copiam só o `package.json`; com os `^`,
  produção pode rodar versões diferentes das testadas.
- **Proposta:** `COPY package*.json` e `npm ci`, que falha se o lockfile divergir.
- ✅ **Implementado:** API e web com `package-lock.json` e `npm ci`. Testado: as duas imagens
  reais compilam com as versões do lockfile (no web, build e `nginx -t`), e um `package.json` divergente faz o `npm ci` falhar.

### 96. Chromium atualizado na captura
- **Problema:** a captura abre páginas hostis com o Playwright 1.49.0 (novembro de 2024) e
  não tem lockfile.
- **Proposta:** Playwright recente (versão exata, com pelo menos duas semanas) na captura e
  nos testes, lockfile próprio e `npm ci`; teste real da captura com a imagem nova.
- ✅ **Implementado:** Playwright 1.64.1 (publicado em 14/10/2026) na captura e nos testes, com
  lockfile próprio e `npm ci`. Testado com a imagem real: abre a página, com print e
  redirecionamentos, e recusa rede interna e metadados. O `run.ps1` agora roda todos os
  cenários e lista os que falharam (`run-all.sh`); dois cenários passaram a esperar o diálogo,
  porque o `click` novo não espera a navegação.

### 97. Segredos padrão recusados
- **Problema:** a pilha sobe com `SESSION_SECRET`, `CAPTURE_TOKEN` e senhas padrão, e o admin
  `admin12345` não precisa trocar a senha.
- **Proposta:** a API não sobe com `SESSION_SECRET` ou `CAPTURE_TOKEN` conhecidos (mensagem
  clara; `ALLOW_INSECURE_DEFAULTS=true` para demonstração); o Status do sistema avisa das
  senhas padrão do banco e do MinIO; o admin criado pelo seed, ou que ainda use a senha
  padrão, troca a senha no primeiro acesso.
- **Cuidados:** instalações com segredo padrão precisam ajustar o `.env` antes de atualizar.
- ✅ **Implementado:**
  - em produção a API não sobe com `SESSION_SECRET` ou `CAPTURE_TOKEN` (com a captura ligada)
    conhecidos e explica o que fazer; `ALLOW_INSECURE_DEFAULTS=true` libera para demonstração;
  - linha "Configuração" no Status do sistema: senhas padrão do banco e do MinIO;
  - admin novo troca a senha no primeiro acesso, e o existente que ainda use a senha padrão
    também, a cada subida; tela de troca com texto neutro;
  - scripts de smoke com `SMOKE_ADMIN_PASSWORD`; README e `.env.example`.

### 98. API sem root e sem dependências de desenvolvimento
- **Problema:** o container que analisa malware roda como root e leva as dependências de
  desenvolvimento.
- **Proposta:** usuário sem privilégios, imagem final só com o necessário para migrar, criar
  o admin e rodar; `no-new-privileges` e `cap_drop: ALL` no compose.
- ✅ **Implementado:** imagem em estágios, a final com `npm ci --omit=dev` e `USER node`, e o
  código pertence ao root (somente leitura para o processo). O seed foi para `src/seed.ts` e é
  compilado; o CLI do `prisma` virou dependência de produção, para migrar na subida; compose com
  `cap_drop: ALL` e `no-new-privileges`. Testado com a imagem real sem capacidades: migrações,
  admin, envio de amostra (YARA nativo) e backup com `pg_dump`.

### 99. Testes de integração no repositório
- **Problema:** os testes contra Postgres, MinIO e LDAP reais ficam numa pasta temporária (um
  já se perdeu), e não há comando para rodá-los.
- **Proposta:** `apps/api/tests/` e `npm run test:integration`, que sobe o que precisa em
  docker. CI fica para quando o repositório tiver `remote`.
- ✅ **Implementado:** `apps/api/tests/`, com 14 arquivos (290 checagens) e o
  `npm run test:integration`, que sobe Postgres, MinIO e OpenLDAP, gera certificados e imagens de
  disco, e usa um banco novo por arquivo; `npm run test:images` testa as imagens reais (22
  checagens). Lint e tipos cobrem os testes. **CI não foi criada:** o repositório não tem `remote`,
  e não daria para ver o workflow rodar.
- **Limite:** os testes de integração de antes do item 81 se perderam; só os das telas continuam
  cobrindo esses itens.

### Bugs

### 100. Aviso geral vaza o título do caso
Usuário comum recebe o título do caso ligado ao aviso, e o link leva a uma tela sem acesso.
Sem caso para quem não é analista.
✅ **Implementado:** usuário comum recebe o aviso sem o caso.

### 101. Domínio parecido: falso positivo com subdomínio cadastrado
Com `portal.empresa.com.br` cadastrado, `mail.empresa.com.br` e `empresa.com.br` viram
"provável golpe". Mesmo domínio-base não é parecido.
✅ **Implementado:** mesmo domínio-base nunca é "parecido".

### 102. Rascunho da resolução passa para outra amostra
Ao usar Próxima e Descartar, o texto continua se as duas amostras têm a mesma resolução, e
salvar grava na amostra errada. O formulário recomeça a cada amostra.
✅ **Implementado:** o formulário recomeça a cada amostra. O bug só ocorria ao voltar para uma amostra já visitada (vem do cache, sem a tela de "carregando"), e foi assim que o cenário o reproduziu.

### 103. Desmarcar duplicata mantém a resolução herdada
A resolução da principal fica em destaque e a original se perdeu. Guardar e devolver a
anterior, como já acontece com status e veredito.
✅ **Implementado:** marcar guarda a resolução anterior; desmarcar a devolve. Herança e devolução aparecem no histórico.

### 104. Progresso do backup sem tratamento de erro
`void setStep` pode derrubar a API numa falha de banco e sobrescrever a linha já pronta.
✅ **Implementado:** gravar o progresso nunca derruba a API nem o backup, e o envio espera cada gravação, para não sobrescrever a linha pronta.

### 105. Restauração sem citar o `SESSION_SECRET`
Com outro segredo, os 2FA param de funcionar. Incluir no LEIA-ME e no README.
✅ **Implementado:** LEIA-ME do ZIP e README citam o `SESSION_SECRET`.

### 106. Backup restaurado sem as amostras
O download dá erro em vez de "arquivo indisponível", e o LEIA-ME não avisa.
✅ **Implementado:** arquivo fora do bucket responde 404 "O arquivo desta amostra não está no armazenamento" (no download e em qualquer outra rota), não vai para a auditoria, e o LEIA-ME avisa.

### 107. Papel de conta do AD editável na tela
O próximo login desfaz a mudança sem aviso. Desligar o seletor e recusar na API.
✅ **Implementado:** seletor desligado na tela; a API responde 409.

### 108. Acessos que sobrevivem à perda de confiança
Token de API sobrevive à troca ou redefinição de senha; token e sessão sobrevivem à saída da
pessoa do AD. Revogar nas trocas de senha e definir a regra para contas do AD.
✅ **Implementado:** troca voluntária e redefinição pelo admin revogam os tokens (a troca por senha vencida não, para não quebrar scripts a cada ciclo). Regra do AD (`lib/ldap-sweep.ts`): de hora em hora, conta removida ou desativada é suspensa, com sessões e tokens revogados e auditoria; AD fora do ar não muda nada, e se a maioria parecer sumida ninguém é suspenso.

### 109. Revarredura de domínios interrompida
Duas varreduras simultâneas colidem (`createMany` sem `skipDuplicates`) e a segunda para.
✅ **Implementado:** `skipDuplicates` nas gravações; testado com três varreduras simultâneas.

### 110. Erro 500 no login do AD
E-mail novo que já existe ou dois primeiros acessos simultâneos.
✅ **Implementado:** primeiros acessos simultâneos usam a mesma conta; e-mail novo que já é de outra conta mantém o atual.

### 111. Corrida entre conferir e gravar
Chave de ativação além do limite, mais de 3 avisos ativos, dois backups ao mesmo tempo.
✅ **Implementado:** chave de ativação com contagem condicional na transação; avisos e backups com trava na transação. Contra o código antigo, a chave de um uso criava 5 contas e 4 pedidos geravam 4 backups. Cadastros simultâneos com o mesmo e-mail respondem 409 em vez de 500.

### Segurança

### 112. IP forjável
`trustProxy: true` com o `X-Forwarded-For` acrescentado pelo nginx deixa o cliente forjar o
IP da auditoria e das sessões. Confiar só no proxy conhecido.
✅ **Implementado:** o nginx substitui o `X-Forwarded-For` e só aceita o `CF-Connecting-IP` de conexão em rede privada (o `cloudflared` local); a API só confia em proxy de rede privada. Testado no nginx real: valor forjado descartado, Tunnel respeitado, e sem proxy vale a conexão.

### 113. Login: bloqueio de terceiros e enumeração
Limite só por e-mail permite bloquear a conta de outra pessoa e testar uma senha em muitas
contas; "Conta suspensa" aparece sem conferir a senha; e-mail inexistente responde mais rápido.
- **Decisão (31/10/2026):** em teste não há proxy; em produção o acesso passa sempre pelo
  Cloudflare Tunnel, então vale o `CF-Connecting-IP` vindo do `cloudflared`.
✅ **Implementado:** limite por e-mail + IP, para ninguém bloquear a conta alheia de outro IP; mais 30 falhas por IP e 20 por e-mail em 5 minutos; "Conta suspensa" só com a senha certa; e-mail inexistente também paga o bcrypt; cadastro com limite de 10 tentativas por IP.

### 114. Auditoria incompleta
Domínios da empresa (alteram a lista de permissões), regras de triagem, atribuição automática
e avisos gerais.
✅ **Implementado:** domínios da empresa, regras de triagem, atribuição automática (grupos, regras, ordem e ausência) e avisos gerais, com seis ações novas e filtro na tela.

### 115. Cabeçalhos e cookie
Sem CSP e HSTS no nginx; `COOKIE_SECURE` vem `false`.
✅ **Implementado:** CSP e HSTS no nginx; a CSP de produção vale nos cenários de tela (violação falha o cenário); o Status do sistema avisa enquanto `COOKIE_SECURE` estiver desligado, sem mudar o padrão, porque em teste o acesso é por HTTP.

### 116. Backup sem cifra e sem conferir o disco
O ZIP tem hashes de senha e segredos de 2FA, fica no bucket de origem, e a geração não confere
o espaço em disco. Avaliar senha/cifra e aviso de espaço.
- **Decisão (31/10/2026):** senha informada ao gerar o ZIP, com opção de exportar sem senha.
✅ **Implementado:** senha obrigatória ao gerar, de 12 caracteres ou mais, ou a opção explícita de exportar sem ela, com confirmação. AES-256 no padrão WinZip AE-2, conferido no 7-Zip. A senha só fica na memória durante a geração: não vai ao banco, à auditoria nem à resposta. **Limites:** os nomes dos arquivos dentro do ZIP não são cifrados, e o padrão usa PBKDF2 com 1000 iterações, daí o mínimo de 12 caracteres. Disco: o backup falha logo, com o motivo, se não couber. O ZIP continua no bucket de origem até vencer.

### Operação e acabamento

### 117. Upload em memória
Cada envio vai inteiro para a memória (até 200 MB), a API não tem `mem_limit`, e o nginx aceita
1 GB.
✅ **Implementado:** orçamento de memória para os envios simultâneos (`MAX_UPLOAD_MEMORY_MB`, padrão 600): acima dele, 503 "tente de novo em instantes". Arquivo acima do limite é recusado pelo `Content-Length`, antes de ser lido. `mem_limit` no container da API (`API_MEM_LIMIT`, padrão 4g). **Diferente do proposto:** gravar em disco não ajudaria, porque a análise, o ZIP, o `.eml`, o antivírus e o YARA leem o arquivo inteiro em memória. **Limite:** o antivírus e o YARA, em segundo plano, seguram o arquivo depois da resposta, fora do orçamento; quem cobre esse caso é o `mem_limit`.

### 118. Limpeza e índices
Sessões vencidas nunca são apagadas; `Notification` sem índice em `entryId` e `caseId`.
✅ **Implementado:** limpeza de hora em hora das sessões vencidas; índices em `entryId` e `caseId` nas notificações.

### 119. Containers
Sem desligamento controlado (SIGTERM) nem healthcheck da API; `minio:latest` e `clamav:stable`
sem versão fixa.
✅ **Implementado:** desligamento controlado em SIGTERM/SIGINT, com teto de 15 s; healthcheck da API, e o web espera ela ficar saudável; ClamAV em `1.5`. O padrão `quay.io/minio/minio:latest` não resolve mais (401), então o padrão passou a ser o digest de `elestio/minio`, de 15/10/2025.

### 120. Mensagens sem acento
Cerca de 60 mensagens da API, como "Credenciais invalidas" e "Dados invalidos".
✅ **Implementado:** mensagens da API para o usuário com acento. Logs e o texto da ISO do sandbox continuam sem acento.

### 121. Domínios parecidos: ruído com nomes curtos
`empresarial.com` parece com `empresa.com.br`. Limite maior ou lista de palavras típicas de
golpe.
✅ **Implementado:** "palavra a mais" só conta com palavra típica de golpe (login, seguranca, suporte, conta...). **Efeito:** `empresa-qualquercoisa.com` deixa de ser marcado.

### Decisões tomadas

### 122. Quem baixa amostras
Hoje qualquer usuário comum baixa a amostra de qualquer pessoa, sem auditoria.
- **Decisão (31/10/2026):** só quem enviou e os analistas baixam, sempre com auditoria.
- ✅ **Implementado** (migração `20261209000000_entry_downloaded_audit`): o download responde 403
  a quem não enviou nem é analista, antes de revelar qualquer estado do arquivo, e cada download
  concluído vai para a Auditoria ("Amostra baixada", com quem baixou, a amostra, o dono e o
  SHA-256). "Baixar amostra" só aparece para quem pode. Token de API continua sem baixar.

### 123. E-mail de quem enviou
A lista global e o CSV mostram esse e-mail a todos os usuários.
- **Decisão (31/10/2026):** usuários comuns veem só o nome; analistas e administradores veem o
  e-mail.
- ✅ **Implementado:** `ownerForViewer` (`lib/auth.ts`) tira o e-mail na lista, na ficha, na ficha do
  indicador e nas Relacionadas; a própria pessoa continua vendo o seu. O CSV já exportava só o
  nome. A ficha e a impressão mostram só o nome quando não há e-mail.
- **Testes dos dois itens:** `tests/integration/sample-access.test.ts` (30 checagens) e
  `sample-access.mjs`.

### Sugestões

### 124. Ideias de produto
Resolução na atualização em massa e no CSV; condição "domínio parecido" nas regras de triagem;
grupos aninhados do AD; teste rápido contra a API real, para complementar o mock.

**Decisões:**
- **a. Teste rápido (`npm run test:smoke`):** navegador real, com as imagens reais do web e da
  API, mais Postgres e MinIO, numa rede própria. Faz o caminho principal (primeiro acesso, envio,
  triagem, usuário comum) e abre as telas; qualquer erro 4xx/5xx inesperado da API, erro no console
  ou violação da CSP reprova. Não entra na suíte de telas, porque precisa compilar as imagens.
- **b. Resolução em massa e no CSV:** campo na barra de atualização em massa, com os modelos como
  sugestão. Vazio mantém; remover continua sendo na ficha, porque apagar de muitas de uma vez por
  engano é pior do que o trabalho de remover uma a uma. Mesmas regras da ficha: histórico, herança
  das duplicatas e aviso a quem enviou. Coluna "Resolução" no CSV para todos, porque a ficha já a
  mostra a todos.
- **c. Condição "domínio parecido":** valor opcional com o domínio da empresa (vazio = qualquer).
  Vale na chegada, como as outras. Mudar a lista de domínios da empresa ou publicar relatório não
  reaplica regras nas amostras antigas: refaz os achados, mas não mexe em tags e prioridade.
- **d. Grupos aninhados do AD:** `LDAP_NESTED_GROUPS`, desligado por padrão, porque ligar pode dar
  papel a mais gente. Sobe pelo `memberOf` dos grupos, que funciona no AD e no OpenLDAP do teste.
  Até 200 grupos por login. Grupo que o servidor recusa ou não acha é ignorado; queda do AD no meio
  falha o login, em vez de rebaixar o papel sem motivo.

✅ **124a implementado:** `npm run test:smoke`, com as imagens reais do web e da API. **Achou um bug na primeira rodada:** o usuário comum abria `/revisoes` pela URL e levava 403 da API. A rota agora o manda para o início, como as outras telas de analista. **Fora do teste:** antivírus, captura, sandbox e AD ficam desligados.

✅ **124b implementado:** campo "Resolução" na barra de atualização em massa, com os modelos como sugestão, e coluna no CSV. **Cuidado achado no teste:** com a principal e a duplicata marcadas juntas, a duplicata registrava dois eventos e avisava duas vezes; agora é um só, relendo a resolução dentro da transação.

✅ **124c implementado:** condição "Parecido com domínio da empresa", com valor opcional. Olha os mesmos domínios da varredura: link, remetente, links do e-mail e indicadores. Vale na chegada e quando o YARA ou o antivírus terminam.

✅ **124d implementado:** `LDAP_NESTED_GROUPS=true` sobe pelo `memberOf` dos grupos, sem repetir grupo, então ciclos terminam. Testado no OpenLDAP real; **não testado num AD de verdade**. **Limites:** o grupo primário ("Domain Users") não aparece no `memberOf`, e grupo de outro domínio é ignorado. O teste do AD também parou de oscilar: o OpenLDAP gerava parâmetros DH ao subir, às vezes por mais de um minuto, e agora usa um arquivo pronto.

## Nona leva — itens 125 a 140

Vieram da validação de usabilidade de 31/10/2026, em 35 telas de admin e 9 de usuário comum, em
quatro larguras, com a API simulada e o `axe-core`. Primeiro entram os itens 125 a 133; os demais
ficam registrados.

### Alta prioridade

### 125. Nome longo quebra a lista
Com 200 caracteres sem espaço, a tabela chega a 2200 px e Status, Veredito e Data somem da tela.
**Decisão:** no máximo duas linhas e 28rem na coluna, com o nome inteiro no `title` e na ficha.
✅ **Implementado:** nas tabelas de amostras, no máximo duas linhas e 28rem, com o nome inteiro no `title`. As colunas seguintes continuam à vista.

### 126. Nome longo quebra a ficha
O título sai da tela e a página rola 485 px de lado. **Decisão:** quebrar o título em várias linhas.
✅ **Implementado:** o título e os campos da ficha quebram em qualquer ponto; nada sai da tela.

### 127. Celular: a página rola de lado
Em 390 px, a ficha rola 14 px para o usuário comum e 73 px para o analista; Histórico Global e
Administração rolam cerca de 350 px. **Decisão:** a faixa de abas rola sozinha e mantém a ativa à vista.
✅ **Implementado:** as abas das páginas rolam na própria faixa e mantêm a ativa à vista, sem mexer na rolagem da página. **Causa do Histórico Global:** textos só para leitor de tela escapavam do recorte da tabela.

### Média prioridade

### 128. Queda de rede no envio
A pessoa lê "Failed to fetch". **Decisão:** mensagem em português, em todas as chamadas à API.
✅ **Implementado:** mensagem em português em todas as chamadas à API. O arquivo escolhido continua na tela para tentar de novo.

### 129. Limite de tamanho não aparece
A tela diz "conforme configurado no servidor". **Decisão:** mostrar o limite real e recusar o arquivo
maior antes de enviar; a API continua conferindo.
✅ **Implementado:** a ajuda mostra o limite real (`maxUploadMb` em `/api/me/upload-quota`) e o arquivo maior é recusado antes de enviar, com o nome no aviso. Um lote com arquivo grande demais não é enviado até ele sair. A API continua conferindo.

### 130. Envio sem progresso
Arquivo grande fica só em "Enviando...". **Decisão:** percentual durante o envio e "analisando" depois.
✅ **Implementado:** percentual durante o envio e "analisando" depois, em arquivo único, lote e `.zip`. O teste rápido comprova o caminho do arquivo único contra a API real, com o envio limitado a 2 MB/s. **Limite:** não há botão para cancelar o envio.

### 131. Título da aba do navegador
É sempre "DeepLook". **Decisão:** nome da tela ou da amostra + "DeepLook".
✅ **Implementado:** nome da tela ou da amostra + "DeepLook"; só "DeepLook" fora da sessão.

### 132. Sem "pular para o conteúdo"
Mais de 70 Tabs não chegaram à primeira linha da lista. **Decisão:** link no primeiro Tab, que leva
ao conteúdo da tela.
✅ **Implementado:** é o primeiro Tab e leva ao conteúdo. No Histórico Global, a primeira linha agora fica a 25 Tabs, contra mais de 70; o que resta são filtros e cabeçalhos de ordenação.

### 133. Menu no celular
O Esc não fecha, o botão não informa se está aberto e os links do menu fechado recebem foco.
✅ **Implementado:** o botão informa o estado, o foco entra no menu ao abrir, o Esc fecha e devolve o foco, e os links do menu fechado não recebem mais foco.

### Baixa prioridade

### 134. Contraste
Textos de ajuda em 3,94:1 (mínimo 4,5:1) e links no meio do texto com 1,78:1 (mínimo 3:1).
✅ **Implementado:** textos de ajuda em `#666666` e links sublinhados no meio do texto e nas mensagens. O `axe-core` não acha mais violação de contraste nas 43 telas auditadas, com os dados da API simulada.

### 135. Enter no envio de link
Não envia; só o botão e o Ctrl+S funcionam.
✅ **Implementado:** Enter em campo de uma linha envia e passa pela mesma validação; na descrição, continua quebrando linha.

### 136. Lista vazia
"Meus Uploads" sem nenhum envio dá a mesma mensagem de um filtro sem resultado, sem atalho para
enviar, e ainda mostra a caixa "selecionar todas".
✅ **Implementado:** mensagem própria quando nada foi enviado, com atalho para "Enviar Amostra"; "Nenhuma amostra encontrada" fica para filtro sem resultado; sem linhas, sem "selecionar todas".

### Sugestões

### 137. Ficha para quem não é técnico
O usuário comum vê primeiro SHA-256, TLSH e tipo MIME. Ideia: situação em linguagem simples no topo.
**Decisão:** aviso só para o usuário comum, sem resolução escrita, e a seção "Arquivo" começa
recolhida; ele pode abrir. Analistas não mudam.
✅ **Implementado:** aviso "Situação" por status e veredito, com a promessa de aviso só para quem enviou; "Arquivo" começa recolhida para o usuário comum.

### 138. Painel e Página Inicial do usuário comum
Tirar "Técnicas ATT&CK", "72 h no status" e a lista de atalhos; acrescentar "cliquei ou abri, e agora?".
**Decisão:** só para o usuário comum; o painel dele fica sem prazos e sem ATT&CK.
✅ **Implementado:** painel sem prazos e sem ATT&CK; Página Inicial com "Cliquei ou abri, e agora?" e sem a lista de atalhos, que continuam funcionando.

### 139. Palavra "comunidade"
Aparece em três telas. Rever se o DeepLook for para empresas.
**Decisão:** trocar por "equipe" ou tirar, onde a frase continuar fazendo sentido.
✅ **Implementado:** trocada por "equipe" ou retirada nas três telas e na página pública.

### Decisão tomada

### 140. Histórico Global aberto a todos — adiado
O usuário comum continua vendo e exportando as amostras de todos, porque o DeepLook ainda não será
implantado em empresas. **Depois:** opção na Administração que restringe cada usuário ao que ele
mesmo enviou.
**Decisões:**
- **Padrão desligado:** nada muda até um admin ligar, em Administração > Configurações, com auditoria.
- **Só o usuário comum:** analistas e admins continuam vendo tudo.
- **Vale na API, não só na tela:** amostra de outra pessoa responde 404, sem revelar que existe, em
  toda rota `/api/entries/:id...`, inclusive as futuras, e também por token de API. Listas, CSV,
  contadores, busca, ficha de indicador, relacionadas, mapa, avisos, favoritos, citações da base de
  conhecimento, evidências e o aviso "já enviada" ficam só com as dele.
- **O que continua igual:** a base de conhecimento. O aviso de indicador seguido continua sendo
  gerado, mas só aparece para o usuário comum se a amostra for dele.
- **O Histórico Global** sai do menu dele, e o endereço leva a Meus Uploads.

### Pedido do usuário

### 141. Menu lateral lembra o que ficou recolhido
As pastas do Navegador voltavam todas abertas a cada sessão. **Decisão:** guardar nas preferências
do usuário, no servidor: vale para as próximas sessões e em outro computador. "Restaurar padrões" e
"Salvar" das Preferências não mexem nisso.

✅ **Implementado:** as pastas recolhidas ficam em `closedFolders` nas preferências, gravadas 400 ms depois do último clique. Valem para as próximas sessões e em outro computador. **Se a gravação falhar,** a pasta segue recolhida na sessão, sem aviso de erro, e a mudança não vale para a próxima.
