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
| 7 | Atribuição de amostra a um analista | 🟡 | G | Amostra / banco | ⬜ |
| 8 | Aba "Histórico" (auditoria) na amostra | 🟡 | G | Amostra / banco | ⬜ |
| 9 | Anterior / Próximo na ficha da amostra | 🟡 | M | Amostra | ✅ |
| 10 | Detecção de duplicata pelo SHA-256 | 🟡 | M | Envio / API | ✅ |
| 11 | Arrastar e soltar o arquivo | ⚪ | P | Envio | ✅ |
| 12 | Botões de copiar (hash, URL, IOCs) | ⚪ | P | Amostra / Relatórios | ✅ |
| 13 | Avisos ao entrar ("suas amostras concluídas") | ⚪ | M | Página Inicial / API | ⬜ |
| 14 | Prazo do sandbox à vista | ⚪ | P–M | Sandbox | ✅ |
| 15 | Atalhos de teclado | ⚪ | P | Global | ⬜ |
| 16 | Linhas da grade navegáveis pelo teclado | ⚪ | P | Listas | ✅ |
| 17 | Exportar CSV da lista filtrada | ⚪ | M | Listas / API | ⬜ |
| 18 | Limite de tentativas no login e na troca de senha | 🔴 | P | Segurança / API | ✅ |

**Feitos:** 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 16 e 18 — cada item abaixo traz um
bloco **Implementado** com o que mudou. **Pendentes:** 7 e 8 (envolvem banco), 13, 15
e 17.

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

### 8. Aba "Histórico" (auditoria) na amostra
- **Proposta:** aba **Histórico** com a linha do tempo da amostra: envio, mudanças de
  status/veredito (de → para), relatórios publicados, abertura/descarte de sandbox —
  quem e quando. Equivale à aba "Atividades" do HPSM.
- **Onde mexer:** modelo `EntryEvent` + migração; gravação nos pontos de mudança em
  `routes/entries.ts`, `routes/reports.ts` e `routes/sandbox.ts`;
  `GET /api/entries/:id/events`; nova aba em `EntryDetailPage.tsx` usando a grade.

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
