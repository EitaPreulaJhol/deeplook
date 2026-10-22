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

A **segunda leva (ideias 19 a 30)**, ainda pendente, está no fim do documento:
[Segunda leva — ideias 19 a 30](#segunda-leva--ideias-19-a-30).

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
  login ficou para depois.

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
  relatório, Alterar senha e Preferências. **Limite conhecido:** "Sair" (logout)
  ainda não pergunta.

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
| 33 | Análise estática no envio | campos calculados do registro | 🟡 | M–G | ⬜ |
| 34 | Marcar como duplicata | registro pai/filho | 🟡 | P–M | ⬜ |
| 35 | Reputação externa (opcional) | integrações | ⚪ | M | ⬜ (decisão) |
| 36 | Caixa de entrada / notificações | To Do / Inbox | 🔴 | M | ✅ |
| 37 | Menções nas atualizações | notificação por atividade | 🟡 | P | ✅ |
| 38 | Modelos de relatório | Templates | 🟡 | P | ✅ |
| 39 | Revisão de relatório (quatro olhos) | aprovação | ⚪ | M | ⬜ |
| 40 | Painel do analista | Dashboards | 🟡 | M | ⬜ |
| 41 | Auditoria administrativa | log de auditoria | 🟡 | P–M | ⬜ |
| 42 | Status do sistema | System Status | ⚪ | P | ⬜ |
| 43 | Tokens de API pessoais | Web Services | ⚪ | M | ⬜ (decisão) |
| 44 | Envio em lote | anexos múltiplos | 🟡 | M | ⬜ |
| 45 | Retenção de amostras | arquivamento/expurgo | ⚪ | M | ⬜ |

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

### 35. Reputação externa (opcional)
- **Proposta:** consulta VirusTotal, URLhaus ou AbuseIPDB por hash, domínio ou IP (nunca
  o arquivo), com cache de 24 h; o resultado aparece numa seção "Reputação" da ficha.
- **Onde mexer:** `lib/reputation/*`, chaves em variáveis de ambiente
  (`VT_API_KEY`...), desligado por padrão.
- **Decisão pendente:** o projeto pode enviar indicadores a terceiros? Mesmo só o hash
  revela que a amostra está sendo analisada.

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

### 41. Auditoria administrativa
- **Proposta:** aba "Auditoria" na Administração, com quem fez o quê e quando:
  - suspender ou reativar usuário, mudar papel;
  - gerar ou revogar chave, redefinir senha;
  - logins com falha repetida.
  
  Com filtros e exportação CSV.
- **Onde mexer:** modelo `AdminEvent`, gravado nas rotas de `admin.ts` e `auth.ts`.
- **Cuidados:** nunca gravar senhas, nem as temporárias.

### 42. Status do sistema
- **Proposta:** página do admin com verde, laranja ou vermelho para:
  - banco;
  - MinIO (alcançável, espaço);
  - Proxmox (alcançável, VMs do DeepLook em execução);
  - versão e tempo no ar da API.
- **Onde mexer:** `GET /api/admin/status` com tempo limite por verificação.

### 43. Tokens de API pessoais
- **Proposta:** na Minha Conta, gerar token com nome e validade para enviar e consultar
  amostras por script.
- **Escopo:** só envio e leitura; o token aparece uma única vez e é revogável.
- **Onde mexer:** modelo `ApiToken` (hash do token), autenticação por
  `Authorization: Bearer`.
- **Decisão pendente:** abrir acesso fora do navegador.

### 44. Envio em lote
- **Proposta:** vários arquivos de uma vez no Enviar Amostra (uma amostra por arquivo,
  com as mesmas tags), ou um `.zip` com senha `infected` desmembrado em amostras.
- **Cuidados:** limite de arquivos e tamanho total; o zip é aberto só para listar e
  extrair, nunca executar.

### 45. Retenção de amostras
- **Proposta:** expurgo automático do **arquivo** após N dias (`RETENTION_DAYS`),
  mantendo ficha, relatórios, IOCs e hash; "lixeira" no admin para excluir ou
  restaurar amostras inteiras.
- **Cuidados:** aviso na ficha ("arquivo expurgado em…"); nunca expurgar amostra com
  sandbox ativo.
