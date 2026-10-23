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
[51. Política de senha](#51-política-de-senha). A
[Quinta leva — ideias 52 a 65](#quinta-leva--ideias-52-a-65) está em andamento.

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
| 53 | Prioridade P1–P4 com prazo próprio | Priority / SLA por prioridade | 🔴 | M | ⬜ |
| 54 | E-mail suspeito (.eml) | anexos do registro | 🔴 | M–G | ⬜ (decisão) |
| 55 | Casos (agrupar amostras) | Incident ligado a Interactions | 🔴 | G | ⬜ (decisão) |
| 56 | Regras YARA | regras de negócio | 🟡 | M | ⬜ |
| 57 | Visualizador hexadecimal | anexo visualizado no registro | 🟡 | P | ⬜ |
| 58 | Comparar duas amostras | comparação de registros | 🟡 | M | ⬜ |
| 59 | MITRE ATT&CK nos relatórios | categorização | 🟡 | M | ⬜ |
| 60 | Alertas de IOC (watchlist) | Alerts | 🟡 | P–M | ⬜ |
| 61 | Sessões ativas | segurança da conta | ⚪ | P | ⬜ |
| 62 | Visões compartilhadas | filas da equipe | ⚪ | P–M | ⬜ |
| 63 | Base de conhecimento | Knowledge Management | ⚪ | M–G | ⬜ (opcional) |
| 64 | Cota de envio | limites | ⚪ | P | ⬜ (opcional) |
| 65 | Webhooks de saída | integrações | ⚪ | M | ⬜ (decisão) |

**Ordem (uma etapa por item, com testes, documentação e commit próprio):**
52 → 57 → 53 → 61 → 60 → 56 → 59 → 58 → 62. Depois, 54, 55 e 65 conforme as decisões;
63 e 64 se ainda fizerem sentido.

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

### 54. E-mail suspeito (.eml) — decisão pendente
- **Proposta:** enviar o `.eml` de um phishing: a ficha mostra remetente, destinatários,
  assunto, data, autenticação (SPF/DKIM/DMARC do cabeçalho), caminho dos servidores e os
  links; cada anexo vira uma amostra "filha" ligada ao e-mail (e passa pelo antivírus e
  pela reputação).
- **Decisão:** dados pessoais das vítimas (destinatários, corpo).

### 55. Casos — decisão pendente
- **Proposta:** agrupar amostras da mesma campanha num **Caso** com título, status,
  responsável, linha do tempo e relatório próprio; a ficha mostra o caso; lista de casos
  no navegador.

### 56. Regras YARA
- **Proposta:** aba **Regras YARA** (analistas e admin): criar, editar, ativar/desativar
  regras com validação de sintaxe; o ClamAV que já roda carrega as regras (arquivos `.yar`
  na base dele) e cada acerto aparece na seção Antivírus da ficha ("YARA: nome_da_regra").
- **Cuidados:** regra com erro de sintaxe nunca chega ao ClamAV (senão ele não recarrega);
  recarregar o ClamAV depois de salvar.

### 57. Visualizador hexadecimal
- **Proposta:** seção **Conteúdo (hex)** na aba Análise: os primeiros 4 KB do arquivo em
  hexadecimal + texto, com "Mostrar mais" de 4 em 4 KB (até 64 KB) e destaque do cabeçalho
  conhecido (MZ, PK, %PDF...). Só analistas; nada é baixado nem executado.
- **Cuidados:** lido do MinIO por faixa (sem trazer o arquivo inteiro); arquivo expurgado
  mostra o aviso da retenção.

### 58. Comparar duas amostras
- **Proposta:** "Comparar com…" no menu Mais da ficha (ou duas marcadas na lista): lado a
  lado tipo real, tamanho, entropia, SHA-256, strings e IOCs, com o que é comum e o que é
  só de cada uma.

### 59. MITRE ATT&CK nos relatórios
- **Proposta:** campo de técnicas ATT&CK no relatório (busca por código ou nome, ex.:
  T1566 Phishing); as técnicas aparecem na ficha, viram filtro nas listas e um quadro "mais
  vistas" no Painel. Lista de técnicas embutida (sem buscar fora).

### 60. Alertas de IOC (watchlist)
- **Proposta:** "Seguir" na ficha do indicador (IP, domínio, e-mail, hash): quando o
  indicador aparecer numa amostra nova (hash/domínio no envio) ou num relatório publicado,
  quem segue recebe uma notificação na Caixa de entrada. Lista "Indicadores que sigo" na
  Minha Conta.

### 61. Sessões ativas
- **Proposta:** aba **Sessões** na Minha Conta: cada sessão com navegador/sistema, IP,
  início e último acesso, a atual marcada; "Encerrar" uma e "Encerrar as outras".
  Auditoria do encerramento.

### 62. Visões compartilhadas
- **Proposta:** ao salvar uma visão (filtros), analistas escolhem "compartilhar com a
  equipe": ela aparece numa pasta **Visões da equipe** no navegador de todos os analistas,
  com contador. Só quem criou (ou admin) edita/remove.

### 63. Base de conhecimento (opcional)
- **Proposta:** artigos (Markdown) sobre famílias de malware e golpes, com busca, ligados
  aos relatórios que os citam.

### 64. Cota de envio (opcional)
- **Proposta:** limite de envios por usuário comum por dia (`UPLOAD_DAILY_LIMIT`), com
  mensagem clara ao atingir; analistas e admin sem limite.

### 65. Webhooks de saída — decisão pendente
- **Proposta:** avisar Slack/Teams/SIEM (POST JSON) quando uma amostra é concluída como
  maliciosa ou suspeita.
- **Decisão:** destinos permitidos e o que pode sair (só o hash? título? relatório?).
