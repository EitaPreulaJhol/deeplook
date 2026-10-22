# 🖥️ Interface no estilo HP Service Manager 9

Este guia descreve como a interface do DeepLook foi construída para se parecer com o
**web client do HP Service Manager 9** e como manter esse visual ao criar ou alterar
telas. A regra geral é **não modernizar**: densidade alta, fonte pequena, cinzas com
gradiente, texto em vez de "pílulas" e uma estrutura de área de trabalho com abas.

> O app usa **React + Vite + @carbon/react**. O Carbon fornece o comportamento dos
> controles (campos, selects, tabelas); a aparência HPSM vem dos tokens `--dl-*` e
> do skin em `apps/web/src/styles/hpsm.scss`, que sobrescreve o que o Carbon desenha.

---

## 1. Estrutura da tela

```
┌───────────────────────────────────────────────────────────────────────────┐
│ DeepLook                                             Ana Souza ▾ (Admin)   │  masthead
├──────────────────────┬────────────────────────────────────────────────────┤
│ Navegador do Sistema │ [Página Inicial ×] [Histórico Global ×] [Amostra ×]│  abas de documento
│  🏠 Página Inicial   ├────────────────────────────────────────────────────┤
│  ⊟ 📁 Amostras       │ ⓘ Mensagens (erros, avisos, confirmações)          │  barra de mensagens
│     Histórico Global │ ┌─ Título da página ───────────────────────────────┐│
│     Meus Uploads     │ │ [Voltar] [Atualizar] | [Baixar amostra]          ││  toolbar do registro
│     Enviar Amostra   │ │ ⊟ Seção  Rótulo: [campo]   Rótulo: [campo]       ││  formulário
│  ⊟ 📁 Administração  │ └──────────────────────────────────────────────────┘│
└──────────────────────┴────────────────────────────────────────────────────┘
```

| Parte | Componente | Arquivo |
|---|---|---|
| Casca (junta tudo) | `AppShell` | `components/AppShell.tsx` |
| Masthead azul | `HpsmTopBar` + `HpsmUserMenu` | `components/HpsmTopBar.tsx`, `components/HpsmUserMenu.tsx` |
| Navegador em árvore | `HpsmSidebar` | `components/HpsmSidebar.tsx` |
| Abas de documento | `WorkspaceProvider` + `WorkspaceTabs` | `components/workspace.tsx` |
| Barra de mensagens | `HpsmMessageBar` + `HpsmMessage` | `components/messages.tsx` |

- **Masthead:** marca à esquerda; à direita, "Nome ▾ (Papel)". O nome do usuário
  abre um submenu (Minha conta, Alterar senha, Preferências, Sair) — é o único lugar
  do "Sair". No celular, o papel "(Admin)" some e o nome continua abrindo o menu.
- **Navegador do Sistema:** sempre visível no desktop (não recolhe). Abaixo de
  `52rem` vira um drawer aberto pelo botão ☰. Itens novos entram em `ROOT_LEAVES`
  (soltos no topo) ou em `TREE` (dentro de uma pasta) em `HpsmSidebar.tsx`; pastas
  podem ser restritas (`access: 'triage' | 'admin'`) e folhas podem ter contador
  (`count`) e bolinha de status (`tone`). A pasta **Filas** (analistas/admins) mostra
  Pendentes / Em análise / Concluídas com contadores (`GET /api/entries/counts`). O
  destaque vai para a folha mais específica que bate com a URL.
- **Abas de documento:** cada tela aberta vira uma aba com **×** (clique do meio
  também fecha). Limite de 10 abas; a mais antiga sai primeiro. Uma navegação com
  `state: { replaceTab: pathnameAtual }` troca o registro **na mesma aba** (usado pelo
  Anterior / Próxima da amostra).
- **Barra de mensagens:** todas as mensagens da página aparecem empilhadas aqui, no
  topo da área de trabalho, como no HPSM.

---

## 2. Tokens e tipografia

Todos os valores visuais estão em `apps/web/src/styles/_tokens.scss` (fonte única).
Não use cores ou medidas soltas nos componentes: crie ou reaproveite um token.

| Grupo | Tokens principais | Valor / uso |
|---|---|---|
| Tipografia | `--dl-font-sans`, `--dl-font-size` | Tahoma/Arial, **12px** no app inteiro |
| Controles | `--dl-control-h` | **24px** de altura para campos, selects e botões |
| Grade (tabelas) | `--dl-grid-head-1/2`, `--dl-grid-head-border`, `--dl-grid-line` | cabeçalho em gradiente cinza, divisórias verticais |
| Seções | `--dl-section-head-1/2`, `--dl-section-title`, `--dl-section-toggle-border` | cabeçalho azul-claro com título `#15428b` e caixinha +/− |
| Campos | `--dl-field-label-w`, `--dl-readonly-bg`, `--dl-readonly-border` | coluna de rótulos (9rem) e campo travado cinza |
| Botões | `--dl-btn-*` | gradiente cinza; hover azul-claro; `--dl-btn-primary-border` para a ação padrão |
| Status | `--dl-status-green/red/orange/blue/gray` | bolinha ao lado do texto de status |
| Navegador | `--dl-sidebar-*`, `--dl-tree-*` | fundo branco, seleção `#dfe8f6`, guia pontilhada |
| Abas de documento | `--dl-doctabs-*`, `--dl-doctab-*` | faixa e abas com gradiente |
| Login | `--dl-auth-width`, `--dl-auth-label-w` | largura da caixa e coluna de rótulos |

Arquivos de estilo:

| Arquivo | Papel |
|---|---|
| `styles/_tokens.scss` | tokens `--dl-*` |
| `styles/hpsm.scss` | skin do app logado: tokens do Carbon → paleta HPSM e todos os componentes `hpsm-*`/`dl-*` |
| `styles/auth.scss` | páginas públicas (home, login, cadastro) e o botão `.dl-btn` sem Carbon |
| `styles/app.scss` | entrada dos estilos e layout da casca |

---

## 3. Componentes

### Toolbar do registro — `components/HpsmToolbar.tsx`

Ações da tela (Voltar, Salvar, Cancelar…) ficam numa toolbar logo abaixo do título,
com botões pequenos de ícone + texto. **Não** use botões grandes no meio do conteúdo.

```tsx
<HpsmToolbar label="Ações da amostra">
  <HpsmToolbarButton label="Voltar" icon={IconArrowLeft} onClick={() => navigate(-1)} />
  <HpsmToolbarButton label="Atualizar" icon={IconRefresh} onClick={reload} />
  <HpsmToolbarDivider />
  <HpsmToolbarButton label="Baixar amostra" icon={IconDownload} href={url} disabled={!url} />
</HpsmToolbar>
```

Dentro de uma `HpsmSection`, a toolbar encosta no topo do corpo da seção.

### Formulários — `components/HpsmForm.tsx`

| Componente | Uso |
|---|---|
| `HpsmSection` | grupo recolhível (+/−) com título |
| `HpsmForm` | grade de campos; `columns={2}` divide em duas colunas a partir de 64rem |
| `HpsmField` | rótulo à esquerda com `:` e controle ao lado; `required` (asterisco), `wide` (linha inteira), `top` (multilinha), `help` (texto abaixo) |
| `HpsmReadonly` | valor travado em caixa cinza; `multiline`, `mono`, `copyable={{ value, label }}` (botão de copiar) |

```tsx
<HpsmSection title="Triagem">
  <HpsmForm columns={2}>
    <HpsmField label="Status" htmlFor="triage-status">
      <Select id="triage-status" labelText="Status" hideLabel ...>...</Select>
    </HpsmField>
    <HpsmField label="Enviado por">
      <HpsmReadonly>{entry.owner.displayName}</HpsmReadonly>
    </HpsmField>
  </HpsmForm>
</HpsmSection>
```

**Validação:** `const check = useRequiredFields([{ id: 'report-summary', label: 'Resumo',
ok: resumo.length >= 3 }])`; no salvar, `if (!check.check()) return;`, mostre
`check.message` com `HpsmMessage` e passe `invalid={check.isInvalid('report-summary')}`
ao `HpsmField` — rótulo/borda vermelhos, mensagem na barra e foco no primeiro inválido.
Se o formulário continua na tela depois de salvar (campos limpos), chame `check.reset()`
para o destaque não voltar sobre os campos vazios.

**Erros de validação da API:** na API, responda com `sendValidationError(reply,
parsed.error)` (`lib/validation.ts`): 400 com `details` por campo, em português. No
front, declare o campo com `api` (nome no `details`, se diferente do `id`) e `value`, e
no `catch` use `if (!check.fromApi(err)) setError(...)`:

```tsx
const check = useRequiredFields([
  { id: 'url-title', label: 'Título', ok: true, api: 'title', value: urlTitle },
]);
```

O campo citado ganha o destaque e a mensagem "Corrija os campos destacados: Título
(mínimo de 2 caracteres)."; o destaque some quando o valor muda. Nos formulários de
login/cadastro, `AuthField` aceita `invalid`.

> **Rótulos e acessibilidade:** o controle do Carbon recebe `labelText` + `hideLabel`
> (o nome acessível continua no controle) e o `HpsmField` recebe o mesmo `htmlFor`.
> O rótulo visível fica com `aria-hidden` para o leitor de tela não ler duas vezes.

### Listas — `components/EntriesTable.tsx` e `components/HpsmFilterBar.tsx`

- Grade compacta (`size="xs"`), cabeçalho ordenável (ordenação **no servidor**,
  parâmetros `sort`/`dir` de `GET /api/entries`) e rodapé
  "Exibindo registros X a Y de N" com « ‹ Anterior · Próxima › ».
- Filtros numa linha fixa acima da lista (`HpsmFilterBar` + `HpsmFilterItem`), com
  botão **Limpar**. A lista se atualiza sozinha (a busca espera 300ms).
- Teclado: só uma linha entra no Tab; ↑ ↓ Home End movem o foco e Enter abre a
  amostra (a linha com foco recebe o destaque de seleção).
- Atualização em massa (analistas): coluna de seleção (Espaço marca a linha) e a barra
  `EntriesBulkBar` ("N selecionadas: Status / Veredito / Responsável [Aplicar]") →
  `POST /api/entries/bulk`, com confirmação.
- Painel de detalhe (preferência `detailPane`, desligada por padrão): clique/setas
  selecionam e mostram o resumo abaixo da grade (`EntryPreviewPane`); duplo clique ou
  Enter abrem a ficha.
- Abrir uma linha guarda a sequência da página (`components/entryNav.ts`); a ficha da
  amostra mostra **◀ Anterior / Próxima ▶** e "Registro N de M" na toolbar.
- Lista vazia: a grade continua visível e o aviso vai para a barra de mensagens
  (`<HpsmMessage kind="info">Nenhuma amostra encontrada.</HpsmMessage>`).

### Status em texto — `components/tags.tsx`

Status, veredito, papel e tipo são **texto**, nunca a `Tag` ("pílula") do Carbon:

```tsx
<StatusText tone="green">Ativo</StatusText>   // bolinha verde + texto
<VerdictTag verdict={entry.verdict} />          // tons já mapeados
<RoleTag role={user.role} />                    // texto puro
```

Tons: `green`, `red`, `orange`, `blue`, `gray` e `none` (sem bolinha).

### Mensagens e carregamento — `components/messages.tsx`

```tsx
{error && <HpsmMessage kind="error">{error}</HpsmMessage>}
{query.isLoading && <HpsmLoading text="Carregando amostras..." />}
```

- `HpsmMessage` (`error`, `warning`, `info`, `success`) é renderizado por portal na
  barra de mensagens da casca. Fora da casca (login, janela do console) aparece no
  próprio lugar. Use o texto direto, sem título "Erro" (o ícone já diz).
- `HpsmLoading` é a caixinha "Carregando…" com o anel de pontos.

### Abas — `components/HpsmTabs.tsx` e `components/workspace.tsx`

- Abas **internas** da página (Detalhes / Análise / Relatórios) usam `HpsmTabs`. A
  aba ativa fica na URL (`?tab=`), para o navegador e o menu poderem apontar direto
  para ela e para a aba de documento reabrir no mesmo ponto.
- Para dar nome à aba de **documento** (ex.: o título da amostra), chame
  `useWorkspaceTitle(titulo)` na página. Se o título tiver informação viva (ex.:
  "12min · nome" do sandbox), passe o nome simples no 2º argumento
  (`titleOnLeave`): ele é aplicado quando a tela é desmontada. Rotas novas precisam de um título padrão em
  `routeTitle()` (`workspace.tsx`), senão não abrem aba.

### Arquivo — `components/HpsmFileDrop.tsx`

`<HpsmFileDrop file={file} onChange={setFile} />` — área "Arraste o arquivo aqui ou
[Selecionar arquivo]" e a linha do arquivo escolhido (nome, tamanho, Remover). Usado
no lugar do `FileUploader` do Carbon. `formatFileSize()` vem do mesmo arquivo.

### Atalhos de teclado — `components/shortcuts.tsx`

| Tecla | Ação |
|---|---|
| `Ctrl+K` | foca o "Ir para:" do masthead (ID, SHA-256 ou texto) |
| `/` | foca a busca da lista (fora de campos de texto) |
| `Alt+N` | abre Enviar Amostra |
| `Alt+W` | fecha a aba de documento atual |
| `Ctrl+S` | salva o formulário aberto |
| `↑ ↓ Home End` + `Enter` | navegam e abrem amostras na grade |
| `?` (fora de campos) / `F1` | abre a caixa **Atalhos de teclado** (também no menu do usuário) |

Para o `Ctrl+S` valer numa tela nova: `useSaveShortcut(salvar, !salvando)` — e ponha
`title="Salvar (Ctrl+S)"` no botão da toolbar.

**Lista única:** todo atalho novo entra em `SHORTCUT_GROUPS`
(`components/shortcutList.tsx`). Dela saem a caixa `HpsmShortcutsHelp` (`?`/F1) e as
Dicas da Página Inicial (itens com `tip: true`); `<ShortcutKeys keys={[['Ctrl', 'K']]} />`
desenha as teclas. Com qualquer `.hpsm-modal` aberto, os atalhos globais ficam
desligados; F1 sempre leva `preventDefault` (não abre a ajuda do navegador).

### Copiar — `components/CopyButton.tsx`

`<CopyButton value={codigo} label="chave" />` — ícone de copiar que confirma "Copiado"
no próprio botão. Em campos travados, prefira `<HpsmReadonly copyable={{ value, label }}>`.

### Confirmação — `components/HpsmConfirm.tsx`

Ações destrutivas pedem confirmação numa caixa no estilo HPSM (foco inicial em
**Não**, Esc cancela):

```tsx
const confirm = useConfirm();
if (await confirm({ title: 'Revogar chave', message: '...', confirmLabel: 'Revogar', danger: true })) {
  await revokeKey(key);
}
```

O `ConfirmProvider` fica em `main.tsx`, então funciona também fora da casca (janela do
console).

Para pedir um texto (nome de visão, renomear), use `usePrompt` do mesmo arquivo: devolve
o texto aparado ou `null` (Cancelar/Esc); o botão de confirmar fica desabilitado com o
campo vazio.

```tsx
const prompt = usePrompt();
const nome = await prompt({ title: 'Salvar visão', label: 'Nome', defaultValue: sugestao });
```

### Menu de contexto — `components/HpsmContextMenu.tsx`

`<HpsmContextMenu x y label items={[{ label, icon?, action, disabled?, separated? }]}
onClose={(restaurarFoco) => ...} />` — menu flutuante no desenho do menu do usuário
(portal no `body`, não sai da janela). Setas pulam itens desabilitados, Esc/Tab fecham
devolvendo o foco a quem abriu, clique fora fecha. Abra pelo `onContextMenu` (posição
do mouse) e por Shift+F10 / tecla Menu (posição do elemento).

### Menu "Mais" da toolbar — `HpsmToolbarMenu` em `components/HpsmToolbar.tsx`

`<HpsmToolbarMenu label="Mais" items={[{ label, icon?, action, disabled?, separated? }]} />`
— botão "Mais ▾" que abre o `HpsmContextMenu` logo abaixo dele (teclado: Enter, Espaço
ou ↓ abrem; Esc fecha e volta ao botão). Use para ações menos frequentes do registro.

### Ficha para impressão — `pages/EntryPrintPage.tsx`

Rota `/entries/:id/imprimir` fora da casca, aberta por "Mais ▾ > Imprimir ficha…" com
`?auto=1`. Estilos em `.dl-print*` (`hpsm.scss`, seção 12i) com `@media print`. Ao
acrescentar dados à ficha, nunca inclua nada do ambiente isolado.

### Notificações — `lib/notifications.ts` (API) e `components/notifications.ts`

Na API, notifique com `notify(tx, [{ userId, type, entryId, actorId, detail }])` dentro
da mesma transação do evento; ele ignora a própria pessoa e destinatários repetidos. No
front, `useNotificationCount()` (contador compartilhado), `useNotifications(limit,
somenteNaoLidas)`, `useMarkRead()`, `notificationText(n)` e `notificationHref(n)`.

### Menções — `components/MentionTextArea.tsx`

`<MentionTextArea id value onChange onMention />` no lugar do `TextArea`: "@" abre a
lista de pessoas e insere "@Nome". Envie os ids das menções que continuam no texto e
use `renderMentions(texto, event.toValue)` para destacar os nomes.

### Indicadores — `components/iocs.ts` e `pages/IocPage.tsx`

`iocHref(kind, valor)` monta o link da ficha; `iocKindOf(valor)` deduz o tipo de um
valor já normalizado; `shortIoc` encurta hashes para a grade; `looksLikeIoc(texto)`
decide se o "Ir para:" consulta `/api/iocs/lookup`. Para baixar algo gerado pela API,
use `downloadUrl(url)` (`components/entryExport.ts`), sem o atributo `download`: o nome
vem do `Content-Disposition`.

### Prazo — `components/sla.tsx`

`<AgeText entry={entry} sla={sla} />` mostra a idade no status atual ("1 d 6 h") com o
marcador do prazo: nada no prazo, laranja acima de `warnHours`, vermelho acima de
`lateHours`, "—" nas concluídas. Os limites vêm da API (`sla` na resposta da lista e da
ficha); passe `sla` ao `EntriesTable` para a coluna Idade ganhar os marcadores.

### Favoritos — `components/favorites.ts`

`useFavorites()` devolve `favorites` e as ações `addView(nome, url)`, `pinEntry(id)`,
`rename`, `remove` e `move(id, -1 | 1)`; os erros da API (limite, repetido) chegam como
exceção para a tela mostrar na barra. `currentViewUrl(pathname, search)` monta a URL
da visão sem a página; `suggestViewName(base, partes)` sugere o nome. Na barra de
filtros, basta passar `viewName` ao `HpsmFilterBar` para aparecer **Salvar visão**.

### Alterações não salvas — `components/useUnsavedChanges.ts`

Formulários com conteúdo digitado avisam antes de perdê-lo (trocar de tela ou de aba
interna, Voltar, fechar a aba de documento, recarregar a janela):

```tsx
const { allowNavigation } = useUnsavedChanges(Boolean(title || description));
// depois de salvar com sucesso e antes de redirecionar:
allowNavigation();
navigate(`/entries/${id}`);
```

Usa o `useBlocker` do React Router, que só funciona com *data router* — por isso o
`main.tsx` usa `createBrowserRouter` com uma rota `*` que renderiza o `App`. Só um
formulário com o hook pode estar montado por vez (limite do `useBlocker`).

### Estado das listas na URL — `components/useEntryListState.ts`

Busca, filtros, ordenação e página das listas ficam na URL
(`?q=&status=&sort=&dir=&offset=`): a aba de documento reabre a lista como estava e a
busca pode ser compartilhada por link. Use o hook em qualquer lista nova de amostras.

### Cabeçalho da página — `components/PageHeader.tsx`

`<PageHeader title="..." subtitle="..." />` — faixa com título e subtítulo.

### Páginas públicas — `components/AuthLayout.tsx` e `components/AuthField.tsx`

Login, cadastro e home usam `PublicMasthead`, a caixa `.dl-box` com cabeçalho e
`PublicLegal`. `AuthLayout` aceita `altLink` (link para a outra tela, abaixo da caixa
à direita). Os botões são `.dl-btn` / `.dl-btn--primary` (sem Carbon).

---

## 4. Convenções e armadilhas do Carbon

**Faça assim**

- Botões do Carbon dentro do app viram automaticamente o botão cinza do HPSM. O
  `kind` muda só detalhes: `primary` = negrito (ação padrão), `ghost` = sem moldura,
  `danger*` = texto vermelho.
- Toda mensagem ao usuário passa por `HpsmMessage`; nada de `InlineNotification`.
- Fonte e alturas vêm dos tokens; controles do Carbon já são ajustados para 12px/24px
  dentro de `.dl-shell` e `.dl-console-window`.

**Evite**

- `Tag` do Carbon para status (use `StatusText`).
- `DataTable` do Carbon para listas cujos dados mudam (filtro, paginação): ele guarda
  as linhas em estado interno e sincroniza **um render depois**, entregando ids que
  não existem mais (`entry` vira `undefined` e a tela fica branca). `EntriesTable`
  renderiza as linhas direto dos dados. As tabelas do Admin ainda usam `DataTable`,
  mas ignoram ids antigos (`if (!u) return null`).
- Popovers e caixas tracejadas de "vazio" — não fazem parte do HPSM.

**Ajustes que o skin faz no Carbon** (se algo "voltar ao Carbon", procure aqui em
`hpsm.scss`):

| Problema do Carbon | Correção |
|---|---|
| `th[aria-sort]` zera o padding, força 48px de altura e tira a borda | regra própria para `th[aria-sort]` |
| ícone do botão com `position: absolute` (fica sobre o texto) | `position: static` e ícone antes do texto |
| `::placeholder` do textarea com 14px fixos | `font-size: inherit` |
| `padding-block` sobrando nos campos de 24px (texto do select sobe) | `padding-block: 0` |
| `Tile` e `p` com fonte própria (14–16px) | fonte do corpo (12px) |

---

## 5. Rotas do front

| Rota | Tela | Observação |
|---|---|---|
| `/home`, `/login`, `/register` | páginas públicas | só sem sessão |
| `/` | — | redireciona para a página inicial das preferências |
| `/inicio` | Página Inicial | boas-vindas; padrão após o login |
| `/history` | Histórico Global | |
| `/me` | Meus Uploads | |
| `/submit` | Enviar Amostra | abas Arquivo / Link |
| `/entries/:id` | Amostra | `?tab=analise`, `?tab=relatorios`, `?tab=relacionadas`, `?tab=historico` |
| `/inbox` | Caixa de entrada (notificações) | também na raiz do navegador, com o contador |
| `/iocs/:tipo/:valor` | Ficha do indicador (ipv4, domain, email, md5, sha1, sha256) | aberta pelo "Ir para:" e pelos links de IOCs |
| `/entries/:id/imprimir` | Ficha para impressão (sem a casca) | `?auto=1` abre a impressão ao carregar |
| `/admin` | Administração | só ADMIN; `?tab=keys` |
| `/user` | Minha Conta | `?tab=senha`, `?tab=preferencias` |
| `/sandbox/entry/:entryId/console` | janela do console | fora da casca |

---

## 6. Minha Conta e preferências

### Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/api/auth/me` | usuário da sessão, incluindo `preferences` (já completadas com os padrões) |
| POST | `/api/auth/touch` | atividade do usuário: renova a sessão por `SESSION_IDLE_MINUTES` e devolve `{ expiresAt }` (401 se já expirou) |
| GET | `/api/auth/session` | `{ expiresAt }` da sessão atual, **sem** renovar |
| PATCH | `/api/me/preferences` | atualização parcial; chaves desconhecidas → 400 |
| POST | `/api/me/password` | `{ currentPassword, newPassword }`: confere a atual, exige 8–200 caracteres e senha diferente, e **encerra todas as sessões** do usuário |
| POST | `/api/admin/users/:id/reset-password` | admin: gera senha temporária (devolvida uma vez) e encerra as sessões do usuário |

| GET | `/api/analysts` | analistas/admins ativos (select de Responsável); só para analistas |
| GET | `/api/entries/counts` | contadores das filas: `{ counts: { PENDING, IN_REVIEW, COMPLETED }, mine }` |
| GET | `/api/entries/:id/events` | histórico da amostra (aba Histórico) |
| POST | `/api/entries/bulk` | atualização em massa `{ ids (1–100), patch: { status?, verdict?, assigneeId? } }` (analistas) |
| GET | `/api/entries/export.csv` | lista filtrada/ordenada em CSV (mesmos parâmetros da lista, sem paginação) |
| GET | `/api/me/updates` | amostras do usuário concluídas desde a visita anterior (Página Inicial) |
| GET | `/api/entries` | aceita também `age=warn\|late` (não concluídas há mais de `SLA_WARN_HOURS`/`SLA_LATE_HOURS` no status) e `sort=age`; devolve `sla: { warnHours, lateHours }` |
| GET | `/api/entries/counts` | inclui `late` (fila Atrasadas) |
| GET | `/api/report-templates` | modelos de relatório (analistas e admin) |
| POST/PATCH/DELETE | `/api/report-templates[/:id]` | admin: `{ name, summary, findings?, iocs?, verdict }`; nome repetido → 409 |
| GET | `/api/me/notifications?limit=&unread=1` | caixa de entrada `{ items, unread }` (ASSIGNED, COMPLETED, MENTION, COMMENT) |
| GET | `/api/me/notifications/count` | `{ unread }` (sininho, a cada minuto) |
| POST | `/api/me/notifications/read` | `{ ids? }` marca como lidas (sem `ids`: todas) |
| GET | `/api/users/mentionable?q=` | pessoas ativas para o "@" (nome, sem e-mail; até 8) |
| GET | `/api/iocs/lookup?q=` | texto → indicador reconhecido `{ ioc: { kind, value } }` ou 404 |
| GET | `/api/iocs/:kind/:value` | ficha: `{ ioc, items: [{ entry, sightings }], total, firstSeen, lastSeen }` |
| GET | `/api/entries/:id/iocs` | indicadores da amostra (relatórios publicados + arquivo/URL/domínio) |
| GET | `/api/entries/:id/iocs/export?format=` | `csv`, `stix` (STIX 2.1) ou `misp` (evento JSON), como anexo |
| POST | `/api/entries/:id/comments` | nova atualização `{ text, mentions? }` (1–4000, texto puro) → evento `COMMENT` no histórico; 10/min por sessão |
| GET | `/api/entries/:id/related` | aba Relacionadas: `{ items: [{ entry, reasons, score }], total, limit: 50 }`; motivos `SAME_SHA256`, `SAME_HOST`, `SAME_BASE_DOMAIN`, `SHARED_TAGS`, `SHARED_IOCS` (IOCs dos relatórios publicados, `lib/iocs.ts`) |
| GET | `/api/me/favorites` | pasta Favoritos do usuário, em ordem (`entry` resumida nas amostras fixadas) |
| POST | `/api/me/favorites` | `{ kind: 'VIEW', label, url }` ou `{ kind: 'ENTRY', entryId, label? }`; até 30; repetido → 409 |
| PATCH | `/api/me/favorites/:id` | `{ label }` (1–60 caracteres) |
| PUT | `/api/me/favorites/order` | `{ ids }`: todos os ids do usuário na nova ordem |
| DELETE | `/api/me/favorites/:id` | remove o favorito |

`GET /api/entries` aceita também `assignee=me|none` e `sort=assignee`;
`PATCH /api/entries/:id` aceita `assigneeId` (id do analista ou `null`).

`POST /api/auth/login` e `POST /api/me/password` aceitam **5 tentativas a cada 5
minutos** (por e-mail e por sessão, respectivamente); depois respondem 429.

Após trocar a senha, o front limpa a sessão e leva ao login com o aviso
"Senha alterada. Entre novamente com a nova senha.".

**Sessão por inatividade:** expira após `SESSION_IDLE_MINUTES` (padrão 30) sem
atividade, com teto absoluto de `SESSION_TTL_HOURS`. O `SessionWatcher` renova com
atividade (no máximo 1x/min), avisa 2 min antes com a caixa "Sessão expirando"
(contagem regressiva, **[Continuar conectado] [Sair]**) e, ao expirar, volta ao login
com "Sua sessão expirou por inatividade. Entre novamente.".

### Preferências

Guardadas na coluna JSON `User.preferences` (migração
`20261021000000_add_user_preferences`).

| Chave | Valores (padrão em negrito) | Onde é aplicada |
|---|---|---|
| `startPage` | **`welcome`** · `history` · `mine` | destino após o login e na raiz `/` |
| `pageSize` | 25 · **50** · 100 | Histórico Global e Meus Uploads |
| `restoreTabs` | **`true`** · `false` | reabre as abas de documento da sessão anterior ao entrar (cópia por usuário no `localStorage`) |
| `detailPane` | `true` · **`false`** | painel de detalhe abaixo das listas (clique seleciona, duplo clique abre) |

### Como adicionar uma preferência

1. **API** — `apps/api/src/lib/preferences.ts`: adicione a chave em
   `PreferencesSchema` e em `DEFAULT_PREFERENCES`. Valores salvos inválidos ou
   ausentes caem no padrão (validação por chave), então não há migração.
2. **Web** — `apps/web/src/api/types.ts` (`Preferences`) e
   `apps/web/src/auth/preferences.ts` (`DEFAULT_PREFERENCES`, com o mesmo valor).
3. **Formulário** — um `HpsmField` novo na aba Preferências de
   `apps/web/src/pages/UserPage.tsx`.
4. **Aplicação** — leia com `const { preferences } = useAuth()`. Para gravar fora da
   página de conta, use `updatePreferences({ chave: valor })` (atualiza na hora e
   desfaz se a API recusar).

---

## 7. Verificação visual (Playwright)

Os roteiros em `scripts/ui-playwright/` sobem o **build** do front num Chromium
(Playwright em Docker) e respondem `/api/*` com dados de exemplo — não precisam de
banco nem da API rodando.

| Roteiro | O que faz |
|---|---|
| `screens.mjs` | screenshot de todas as telas em `out/` e medida do cabeçalho da lista |
| `filters.mjs` | troca filtros, busca e Limpar; confere que os filtros sobrevivem a recarregar a página; falha se a tela ficar branca ou a contagem errar |
| `account.mjs` | login → Página Inicial → menu do usuário → preferências aplicadas → troca de senha (erros e sucesso) → novo login |
| `actions.mjs` | diálogo de confirmação (Esc/Não cancelam), redefinir senha, "Registro atualizado." na triagem e aviso de amostra duplicada |
| `unsaved.mjs` | aviso de alterações não salvas: navegador, fechar aba de documento (cancelar mantém a aba), aba interna do relatório e preferências |
| `copy-keyboard.mjs` | botões de copiar (confere a área de transferência) e grade navegável pelo teclado |
| `queues-nav.mjs` | filas com contadores (e atualização após a triagem) e Anterior / Próxima na mesma aba de documento |
| `assign-history.mjs` | Assumir análise, troca de responsável, fila "Atribuídas a mim", coluna/filtro Responsável e aba Histórico (inclui falha do sandbox) |
| `session-idle.mjs` | sessão por inatividade (relógio falso): renovação 1x/min, aviso aos 28 min com contagem, Continuar/Sair, renovação por outra janela e expiração com volta ao login |
| `more-print.mjs` | menu "Mais ▾" (mouse, teclado, Esc devolve o foco), copiar link, nova janela, exportar Markdown (e desabilitado sem relatório) e a ficha impressa (fora da casca, impressão automática, "Impresso por / em", seções, sem dados do sandbox, toolbar oculta no papel, PDF A4) |
| `sla.mjs` | prazo: coluna Idade (formato, laranja/vermelho, "—", dica, leitor de tela), ordenar por idade, filtro Prazo, fila Atrasadas (N), "No status há" na ficha e idade zerada ao mudar o status |
| `comments.mjs` | atualizações na aba Histórico: validação, Ctrl+S, texto puro com quebras de linha, fundo de nota, "Somente atualizações", erro da API, aviso de não salvo; destaque do relatório limpo após salvar |
| `report-templates.mjs` | modelos: aba pelo navegador, validação, criar (Ctrl+S), editar, nome repetido da API no campo, excluir com confirmação; campo Modelo no Novo relatório (preenche, veredito, pergunta antes de sobrescrever) |
| `notifications.mjs` | caixa de entrada: contador no sininho e no navegador, painel (frases, foco, teclado, abrir marca como lida, marcar todas), página com filtro e teclado; menções (lista, Esc, Enter/Tab, nova linha, ids enviados, destaque no histórico) |
| `iocs.mjs` | indicadores: seção na aba Relatórios, ficha (título, resumo, onde aparece, aba de documento, teclado), ficha vazia/inválida, "Ir para:" com IOC desarmado/IP/IP privado/texto, links nas Relacionadas e exportação CSV/STIX/MISP |
| `related.mjs` | aba Relacionadas: total no rótulo, coluna Motivo (vários motivos, singular/plural, IOCs em comum com hash encurtado, "+N" e lista na dica), rodapé com o limite, setas + Enter, Anterior/Próxima pelas relacionadas, lista vazia |
| `favorites.mjs` | Favoritos: Salvar visão (nome sugerido, sem a página, repetida, limite de 30), Fixar/Desafixar, abrir e destacar pelo navegador, menu de contexto (mover, renomear), Shift+F10, F2, Delete e "×" |
| `shortcuts-help.mjs` | ajuda de atalhos: `?` (texto dentro de campos), F1 (em qualquer lugar, sem a ajuda do navegador), Esc/Fechar, foco devolvido, menu do usuário e Dicas vindas da mesma lista |
| `validation-api.mjs` | formulário de chave do Admin (validação, Ctrl+S, números enviados) e erros por campo da API em chave, envio de URL, relatório, atualização, troca de senha e cadastro (destaque, mensagem, foco, some ao corrigir) |
| `validation.mjs` | validação: destaque vermelho (cor conferida, também com foco), mensagem, foco no 1º inválido e destaque que some ao corrigir |
| `quick-search.mjs` | "Ir para:" do masthead: Ctrl+K, SHA-256 abre a amostra, hash desconhecido e texto abrem a lista filtrada |
| `bulk-update.mjs` | atualização em massa: seleção, barra, confirmação, resultado, limpeza ao filtrar, Espaço/Enter e usuário comum sem a coluna |
| `detail-pane.mjs` | painel de detalhe: desligado o clique abre; ligado, seleção, setas, duplo clique, Enter e "Abrir amostra" |
| `news-shortcuts-export.mjs` | novidades na Página Inicial, atalhos (`/`, Alt+N, Alt+W, Ctrl+S) e download do CSV com os filtros |
| `filedrop-sandbox.mjs` | arrastar e soltar o arquivo (via `DataTransfer`) e prazo do sandbox: aba com "Nmin", aviso nos últimos 5 min e "Estender prazo" |
| `mock-api.mjs` | API simulada e servidor do `dist` usados pelos três |

```powershell
cd apps/web; npm run build; cd ../..
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1
# só alguns roteiros:
powershell -ExecutionPolicy Bypass -File scripts/ui-playwright/run.ps1 -Scripts filters,account
```

Requer o Docker em execução (imagem `mcr.microsoft.com/playwright:v1.49.0-noble`).
O script sai com erro se alguma checagem falhar; screenshots ficam em
`scripts/ui-playwright/out/` (ignorado pelo git).

---

## 8. Próximas melhorias

Ideias de UX/usabilidade priorizadas estão em [`docs/ux-backlog.md`](ux-backlog.md):
a primeira leva (1–18) está implementada; a segunda (19–30, padrões do HPSM 9 como
painel de detalhe, atualização em massa e Favoritos) está pendente.
