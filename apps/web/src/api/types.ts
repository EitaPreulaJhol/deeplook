export type Role = 'USER' | 'ANALYST' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type EntryType = 'FILE' | 'URL';
export type EntryStatus = 'PENDING' | 'IN_REVIEW' | 'COMPLETED';
export type Verdict = 'UNKNOWN' | 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
/** Prioridade (item 53): P1 Critica, P2 Alta, P3 Media (padrao), P4 Baixa. */
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  /** Acesso por API liberado por um admin (tokens pessoais). */
  apiAccess?: boolean;
  /** Conta do AD/LDAP (item 94): sem senha local; na lista do admin, `authSource`. */
  ldap?: boolean;
  authSource?: 'LOCAL' | 'LDAP';
  /** Precisa definir uma senha nova antes de entrar (redefinida pelo admin ou vencida). */
  mustChangePassword?: boolean;
  /** Por que precisa trocar: redefinida pelo admin ou vencida (politica de senha). */
  passwordChangeReason?: 'reset' | 'expired' | null;
  /** Validade da senha da sessao atual (null para admins ou sem validade). */
  passwordExpiresAt?: string | null;
  /** Senha vencida pela politica (lista da Administracao). */
  passwordExpired?: boolean;
  /** 2FA ativo (sessao atual). */
  twoFactorEnabled?: boolean;
  /** Ausente: fora do rodizio da atribuicao automatica (item 72). */
  away?: boolean;
  /** 2FA ativo desde (lista da Administracao). */
  twoFactorEnabledAt?: string | null;
  _count?: { entries: number; apiTokens?: number };
}

/** Ultima varredura do ClamAV (GET /api/entries/:id/antivirus). */
export interface AntivirusScan {
  status: 'PENDING' | 'CLEAN' | 'INFECTED' | 'ERROR';
  signature: string | null;
  error: string | null;
  engine: string | null;
  dbVersion: number | null;
  dbDate: string | null;
  scannedAt: string;
}

export interface AntivirusInfo {
  /** ClamAV configurado (CLAMAV_HOST); falso = secao escondida. */
  enabled: boolean;
  /** Varredura em andamento (a ficha atualiza sozinha). */
  pending: boolean;
  scan: AntivirusScan | null;
}

/** Regra do capa que casou (item 7.2): o que uma ou mais funcoes fazem. */
export interface CapaRule {
  name: string;
  /** Ex.: host-interaction/process/inject. */
  namespace: string;
  attack: string[];
  /** Malware Behavior Catalog: "OBJETIVO::Comportamento::Metodo [ID]". */
  mbc: string[];
  matches: number;
  /** Enderecos das funcoes (ate 20). */
  addresses: string[];
}

export interface FlossString {
  string: string;
  /** Funcao que monta ou decifra a string. */
  function: string | null;
}

export type CapaStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

/** GET /api/entries/:id/capa (item 7.2). */
export interface CapaInfo {
  /** Servico capa configurado (CAPA_URL). */
  enabled: boolean;
  /** Executavel do Windows ou do Linux dentro do teto. */
  eligible: boolean;
  maxMb: number;
  analysis: {
    status: CapaStatus;
    capa: {
      format?: string | null;
      arch?: string | null;
      os?: string | null;
      functions?: number | null;
      libraryFunctions?: number | null;
      rules: CapaRule[];
      truncated: boolean;
      /** So as regras do nivel do arquivo: a analise de funcoes nao terminou (capaError). */
      fileOnly?: boolean;
    } | null;
    floss: {
      stack: FlossString[];
      tight: FlossString[];
      decoded: FlossString[];
      truncated: boolean;
    } | null;
    attack: string[];
    iocCandidates: { kind: IocKind; value: string }[] | null;
    capaError: string | null;
    flossError: string | null;
    error: string | null;
    versions: { capa: string | null; floss: string | null; rules: string | null } | null;
    ms: number | null;
    attempts: number;
    nextAttemptAt: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    /** Na fila: quantas estao na frente. */
    ahead: number | null;
  } | null;
}

/** Funcao com pseudo-C na analise do Ghidra (item 7.3). */
export interface GhidraFunction {
  name: string;
  entry: string;
  isEntryPoint: boolean;
  /** APIs sensiveis que a funcao chama. */
  sensitive: string[];
  callers: string[];
  c?: string;
  truncated?: boolean;
  error?: string | null;
}

/** Por que uma funcao do pseudo-C completo ficou sem codigo: o prazo ou o teto do servico. */
export type GhidraSkipped = 'deadline' | 'cap';

/** Linha de GET /api/entries/:id/ghidra/functions (plans/ghidra-pseudo-c). */
export interface GhidraFunctionRow {
  entry: string;
  name: string;
  size: number;
  complexity: number;
  isEntryPoint: boolean;
  library: boolean;
  sensitive: string[];
  hasCode: boolean;
  truncated: boolean;
  skipped: GhidraSkipped | null;
  error: string | null;
}

export interface GhidraFunctionPage {
  /** Funcoes do programa (a lista pode ter menos: teto de 20 000). */
  total: number | null;
  listed: number;
  deadlineHit: boolean;
  capHit: boolean;
  /** Quantas passam no filtro. */
  matching: number;
  page: number;
  pageSize: number;
  functions: GhidraFunctionRow[];
}

/** Chamador ou chamada; sem nome quando ficou fora da lista. */
export interface GhidraFunctionLink {
  entry: string;
  name: string | null;
}

/** GET /api/entries/:id/ghidra/functions/:entry. */
export interface GhidraFunctionDetail {
  entry: string;
  name: string;
  size: number;
  complexity: number;
  isEntryPoint: boolean;
  library: boolean;
  sensitive: string[];
  apis: string[];
  callers: GhidraFunctionLink[];
  callerCount: number;
  callees: GhidraFunctionLink[];
  calleeCount: number;
  c: string | null;
  truncated: boolean;
  skipped: GhidraSkipped | null;
  error: string | null;
}

/** Linha com o texto procurado: o trecho e as ocorrencias nele ([inicio, fim) em UTF-16). */
export interface GhidraSearchLine {
  line: number;
  text: string;
  marks: [number, number][];
}

export interface GhidraSearchHit {
  entry: string;
  name: string;
  library: boolean;
  /** Linhas com o texto na funcao (as devolvidas vao ate 10). */
  lineCount: number;
  lines: GhidraSearchLine[];
}

/** GET /api/entries/:id/ghidra/search (plans/ghidra-pseudo-c, fase 5). */
export interface GhidraSearchResult {
  q: string;
  caseSensitive: boolean;
  hideLibrary: boolean;
  ms: number;
  scanned: number;
  matchedFunctions: number;
  matchedLines: number;
  /** Mais funcoes com o texto do que as devolvidas (ate 200). */
  truncated: boolean;
  /** O tempo da busca acabou antes do fim. */
  partial: boolean;
  results: GhidraSearchHit[];
}

/** GET /api/entries/:id/ghidra (item 7.3). */
export interface GhidraInfo {
  enabled: boolean;
  /** Executavel do Windows ou do Linux (a secao aparece). */
  applicable: boolean;
  /** Da para pedir agora (nao e .NET, cabe no teto, arquivo presente). */
  eligible: boolean;
  reason: string | null;
  maxMb: number;
  canDownload: boolean;
  analysis: {
    status: CapaStatus;
    summary: {
      /** Analise mais leve: sem os analisadores listados, pelo tamanho do binario. */
      light?: { reason: 'size'; analyzers: string[] };
      format: string | null;
      language: string | null;
      compiler: string | null;
      imageBase: string | null;
      entryPoint: string | null;
      functions: number;
      thunks: number;
      sensitiveFunctions: number;
      largest: {
        name: string;
        entry: string;
        size: number;
        complexity: number;
        calls: number;
        callers: number;
        apis: string[];
      }[];
      decompiled: GhidraFunction[];
    } | null;
    hasProject: boolean;
    gzfSize: number | null;
    gzfError: string | null;
    /** Pseudo-C de todas as funcoes (plans/ghidra-pseudo-c): a janela abre por ele. */
    hasPseudo: boolean;
    pseudoFunctions: number;
    pseudoTotal: number | null;
    pseudoDeadlineHit: boolean;
    pseudoCapHit: boolean;
    pseudoError: string | null;
    error: string | null;
    version: string | null;
    ms: number | null;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    requestedBy: { id: string; displayName: string } | null;
    ahead: number | null;
  } | null;
}

/** O que o Detect It Easy reconheceu (item 7.9). */
export interface DieDetection {
  filetype: string;
  /** compiler, linker, packer, protector, installer, library, sign tool... */
  type: string;
  name: string;
  version: string;
  info: string;
  /** Texto completo, ex.: "Packer: UPX(4.24)[NRV, brute]". */
  string: string;
}

/** GET /api/entries/:id/unpack (itens 7.8 e 7.9). */
export interface UnpackInfo {
  enabled: boolean;
  /** Executavel do Windows ou do Linux (a secao aparece). */
  applicable: boolean;
  maxMb: number;
  job: {
    status: CapaStatus;
    unpacker: string | null;
    label: string | null;
    note: string | null;
    /** Cada arquivo extraido: a amostra filha criada ou por que ficou de fora. */
    files: { name: string; size: number; entryId?: string; skipped?: string }[] | null;
    detections: DieDetection[] | null;
    dieVersion: string | null;
    dieError: string | null;
    error: string | null;
    ms: number | null;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  children: { id: string; title: string; verdict: Verdict }[];
}

/** Regra YARA (item 56): conjunto de regras escrito pelos analistas. */
export interface YaraRule {
  id: string;
  name: string;
  description: string | null;
  source: string;
  enabled: boolean;
  /** Pacote de origem; null = regra da equipe. */
  pack: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
}

/** Pacote de regras de uma fonte confiavel (GET /api/yara/packs). */
export interface YaraPack {
  id: string;
  name: string;
  author: string;
  license: string;
  url: string;
  description: string;
  commit: string;
  commitDate: string;
  enabled: boolean;
  installed: boolean;
  fileCount: number;
  excludedCount: number;
  rulesTotal: number;
  rulesActive: number;
}

/** Acerto de uma regra YARA numa amostra. */
export interface YaraHit {
  /** Nome do conjunto (YaraRule.name). */
  rule: string;
  /** Identificador da regra dentro do conjunto. */
  identifier: string;
  tags: string[];
  description: string | null;
  /** Quantas ocorrencias das strings casaram. */
  matches: number;
  /** Autor da regra; varreduras antigas nao trazem. */
  author?: string | null;
  /** Pacote de origem; null ou ausente = regra da equipe. */
  pack?: string | null;
}

export interface YaraScan {
  status: 'PENDING' | 'CLEAN' | 'MATCHED' | 'ERROR';
  matches: YaraHit[];
  rulesCount: number;
  error: string | null;
  scannedAt: string;
}

export interface YaraInfo {
  /** Conjuntos ativos agora (0 = secao escondida se nunca varreu). */
  activeRules: number;
  pending: boolean;
  scan: YaraScan | null;
}

/** Resultado de um servico de reputacao externa (GET /api/entries/:id/reputation). */
export interface ReputationResult {
  service: string;
  name: string;
  kind: 'HASH' | 'DOMAIN' | 'IP';
  indicator: string;
  status: 'PENDING' | 'FOUND' | 'NOT_FOUND' | 'ERROR';
  verdict: Verdict;
  summary: string;
  link: string | null;
  checkedAt: string;
}

export interface ReputationInfo {
  /** Servicos ligados (com chave no .env); vazio = secao escondida. */
  services: { id: string; name: string }[];
  indicator: { kind: 'HASH' | 'DOMAIN' | 'IP'; value: string } | null;
  /** Consulta do envio ainda em andamento. */
  pending: boolean;
  results: ReputationResult[];
}

/** Token de API pessoal (GET /api/me/api-tokens); o segredo so vem na criacao. */
/** O que o token alcanca (item 3.2): amostras (envio e consulta) ou so a leitura do status. */
export type ApiTokenScope = 'SAMPLES' | 'STATUS' | 'FEED';

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: ApiTokenScope;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
}

/** Tela aberta apos o login e na raiz "/". */
export type StartPage = 'welcome' | 'dashboard' | 'history' | 'mine';

/** Preferencias de uso (GET /api/auth/me, PATCH /api/me/preferences). */
export interface Preferences {
  startPage: StartPage;
  pageSize: 25 | 50 | 100;
  restoreTabs: boolean;
  /** Painel de detalhe abaixo das listas. */
  detailPane: boolean;
  /** Idioma da interface (revisao de novembro, 2.5). */
  language: 'pt-BR' | 'en';
  /** Pastas recolhidas no Navegador. */
  closedFolders: string[];
  /** Avisos silenciados na Caixa de entrada (item 164). */
  mutedNotifications: NotificationType[];
}

/** Usuario da sessao atual: inclui as preferencias. */
export interface CurrentUser extends User {
  preferences: Preferences;
}

/** Remetente/destinatario de um e-mail. */
export interface EmailParty {
  name: string | null;
  address: string | null;
}

/** E-mail suspeito lido no envio (Entry.emailInfo, item 54). */
export interface EmailInfo {
  version: 1;
  subject: string | null;
  from: EmailParty | null;
  sender: EmailParty | null;
  replyTo: EmailParty[];
  to: EmailParty[];
  cc: EmailParty[];
  date: string | null;
  messageId: string | null;
  returnPath: string | null;
  auth: { spf: string | null; dkim: string | null; dmarc: string | null };
  received: { from: string | null; by: string | null; date: string | null }[];
  links: string[];
  body: string;
  bodyTruncated: boolean;
  attachments: {
    filename: string;
    mimeType: string;
    size: number;
    entryId?: string;
    skipped?: string;
  }[];
}

/** Certificado da assinatura Authenticode (item 7.1). */
export interface CertSummary {
  subject: string;
  issuer: string;
  serial: string;
  validFrom: string;
  validTo: string;
  sha1: string;
  sha256: string;
}

/** Alerta da analise do PE (item 7.1). */
export interface PeAlert {
  level: 'high' | 'medium' | 'info';
  text: string;
}

/**
 * Executavel do Windows. Os campos do item 7.1 sao opcionais: amostras analisadas antes nao os
 * tem (ate a reanalise em segundo plano chegar a elas).
 */
export interface PeInfo {
  machine: string;
  is64: boolean;
  isDll: boolean;
  subsystem: string;
  compiledAt: string | null;
  sections: {
    name: string;
    virtualSize: number;
    rawSize: number;
    entropy: number;
    /** R, W e X. */
    flags?: string;
  }[];
  imports: { dll: string; functions: number; names?: string[] }[];
  suspiciousImports: string[];
  packer: string | null;
  imphash?: string | null;
  rich?: {
    hash: string;
    checksumValid: boolean;
    entries: {
      product: number;
      build: number;
      count: number;
      /** Ferramenta ([C], [C++], [LNK]...) e versao do Visual Studio (analises novas). */
      tool?: string | null;
      version?: string | null;
    }[];
    linker?: string | null;
  } | null;
  exports?: {
    dll: string | null;
    total: number;
    symbols: { ordinal: number; name: string | null; forwarder: string | null }[];
    truncated: boolean;
  } | null;
  entryPoint?: { rva: number; section: string | null } | null;
  tlsCallbacks?: number;
  overlay?: { offset: number; size: number; entropy: number; type: string | null } | null;
  checksum?: { declared: number; computed: number | null };
  resources?: {
    type: string;
    name: string;
    lang: number;
    size: number;
    entropy: number;
    content: string | null;
  }[];
  resourcesTruncated?: boolean;
  version?: Record<string, string> | null;
  manifest?: { executionLevel: string | null; uiAccess: boolean } | null;
  /** Diretorio de debug (plans/analise-estatica-ampliada, item 1). */
  debug?: {
    pdbPath: string | null;
    pdbFormat: 'RSDS' | 'NB10' | null;
    pdbGuid: string | null;
    pdbAge: number | null;
    pdbId: string | null;
    types: string[];
    repro: boolean;
    timestamp: number | null;
    user: string | null;
    project: string | null;
    debugBuild: boolean;
  } | null;
  /** Hashes de pivo (item 2): authentihash, exphash e o dHash do icone principal. */
  authentihash?: string;
  exphash?: string | null;
  icon?: { hash: string; width: number; height: number } | null;
  /** TimeDateStamp de cada lugar que o grava (segundos). */
  timestamps?: {
    header: number | null;
    debug: number | null;
    exports: number | null;
    resources: number | null;
  };
  signature?: {
    digestAlgorithm: string | null;
    digestMatches: boolean | null;
    signatureValid: boolean;
    programName: string | null;
    programUrl: string | null;
    signer: CertSummary | null;
    chain: CertSummary[];
    selfSigned: boolean;
    timestamp: string | null;
    nested: number;
    error?: string;
  } | null;
  dotnet?: {
    runtime: string | null;
    flags: string[];
    assembly: { name: string; version: string } | null;
    module: string | null;
    assemblyRefs: string[];
    pinvoke: { dll: string; name: string }[];
    suspicious: string[];
    obfuscator: string | null;
    types: number;
    methods: number;
    /** Recursos embutidos no assembly (item 30); ausente nas analises antigas. */
    resources?: {
      name: string;
      size: number;
      entropy: number;
      content: string | null;
      public: boolean;
    }[];
  } | null;
  alerts?: PeAlert[];
}

/** Analise estatica do arquivo enviado (Entry.staticInfo). */
/** Atalho do Windows (.lnk) (item 84). */
export interface LnkInfo {
  target: string | null;
  arguments: string | null;
  workingDir: string | null;
  relativePath: string | null;
  description: string | null;
  iconLocation: string | null;
  window: 'normal' | 'maximized' | 'minimized';
  envTarget: string | null;
  machine: string | null;
  mac: string | null;
  created: string | null;
  modified: string | null;
  accessed: string | null;
  targetSize: number | null;
  alerts: string[];
}

/** Imagem de disco (item 84): ISO 9660, FAT ou VHD (FAT). */
export interface DiskImageInfo {
  format: 'iso9660' | 'fat' | 'vhd-fat' | 'unsupported';
  note: string | null;
  label: string | null;
  files: { path: string; size: number; hidden: boolean }[];
  truncated: boolean;
  alerts: string[];
}

/** Script (item 83): PowerShell, JS, VBS, BAT e HTA. */
export interface ScriptInfo {
  language:
    'powershell' | 'javascript' | 'vbscript' | 'batch' | 'hta' | 'autoit' | 'shell' | 'python';
  lines: number;
  risk: 'high' | 'medium' | 'low';
  findings: {
    name: string;
    why: string;
    kind: 'download' | 'execute' | 'evasion' | 'persistence' | 'obfuscation' | 'other';
    /** 0 = o arquivo; N = a camada N. */
    layer: number;
  }[];
  layers: { method: string; from: number; text: string; truncated: boolean }[];
  urls: string[];
  /** Codificado com o Script Encoder (#@~^): nao decodificado. */
  encoded: boolean;
}

/** Analise de documento (item 70): PDF, Office e RTF. */
/** OneNote, HTML smuggling e MSI (plans/caca-e-formatos, item 4). */
export interface DeliveryInfo {
  format: 'onenote' | 'html' | 'msi' | 'pdf';
  risk: 'high' | 'medium' | 'low';
  alerts: { level: 'high' | 'medium' | 'info'; text: string }[];
  files: {
    name: string;
    size: number;
    sha256: string;
    type: string | null;
    source: string;
    entryId?: string;
    skipped?: string;
  }[];
  onenote?: { objects: number; images: number };
  html?: { smuggling: string[]; base64: number; dataUris: number; byteArrays: number };
  msi?: {
    product: {
      name: string | null;
      manufacturer: string | null;
      version: string | null;
      code: string | null;
    };
    customActions: {
      action: string;
      type: number;
      kind: string;
      source: string | null;
      target: string | null;
      flags: string[];
    }[];
    binary: string[];
    files: string[];
    filesTotal: number;
    tables: string[];
  };
}

export interface DocumentInfo {
  format: 'pdf' | 'ooxml' | 'ole' | 'rtf';
  risk: 'high' | 'medium' | 'low';
  alerts: { level: 'high' | 'medium' | 'info'; text: string }[];
  pdf?: {
    pages: number | null;
    javascript: boolean;
    openAction: boolean;
    additionalActions: boolean;
    launch: boolean;
    embeddedFiles: number;
    forms: boolean;
    xfa: boolean;
    encrypted: boolean;
  };
  office?: {
    macros: boolean;
    modules: {
      name: string;
      lines: number;
      autoExec: string[];
      suspicious: string[];
      code: string;
      truncated: boolean;
    }[];
    externalLinks: string[];
    remoteTemplate: string | null;
    embedded: string[];
    dde: boolean;
  };
  links: string[];
}

export interface StaticInfo {
  version: 1;
  analyzedAt: string;
  size: number;
  bytesAnalyzed: number;
  detectedType: { id: string; label: string; extensions: string[]; executable: boolean } | null;
  extensionMismatch: { declared: string; expected: string[]; dangerous: boolean } | null;
  entropy: number;
  entropyLevel: 'low' | 'normal' | 'high';
  strings: {
    total: number;
    urls: string[];
    ips: string[];
    emails: string[];
    paths: string[];
    registry: string[];
    suspicious: string[];
  };
  pe: PeInfo | null;
  /** PDF, Office e RTF (item 70). */
  /** Executavel Linux (item 168). */
  elf?: ElfInfo | null;
  /** Executavel macOS (macho-analysis.ts). */
  macho?: MachoInfo | null;
  /** Abuso conhecido: LOLDrivers, LOLRMM e binarios do sistema (item 4). */
  lol?: {
    driver: {
      id: string;
      category: 'malicious' | 'vulnerable';
      name: string;
      cves: string[];
      usecase: string;
      by: 'sha256' | 'authentihash';
    } | null;
    rmm: { name: string; by: 'product' | 'filename' | 'signer' | 'domain'; evidence: string }[];
    lolbins: {
      name: string;
      platform: 'windows' | 'linux';
      uses: string[];
      evidence: string;
      url: string;
    }[];
    alerts: PeAlert[];
  } | null;
  /** Constantes de criptografia, chaves RSA e alfabetos Base64 proprios (item 7). */
  crypto?: {
    constants: { algorithm: string; what: string; offset: number }[];
    alphabets: { alphabet: string; offset: number; decoded: { source: string; text: string }[] }[];
    alerts: PeAlert[];
  } | null;
  document?: DocumentInfo | null;
  delivery?: DeliveryInfo | null;
  script?: ScriptInfo | null;
  lnk?: LnkInfo | null;
  diskImage?: DiskImageInfo | null;
  iocCandidates: { kind: IocKind; value: string }[];
}

/** GET /api/dashboard (Painel). */
export interface DashboardData {
  scope: 'all' | 'mine';
  days: number;
  tz: string;
  /** Inicio do periodo (meia-noite do 1o dia no fuso do navegador). */
  since: string;
  sla: SlaConfig;
  byStatus: Record<EntryStatus, number>;
  byVerdict: Record<Verdict, number>;
  open: { warn: number; late: number };
  period: { submitted: number; completed: number };
  daily: { day: string; submitted: number; completed: number }[];
  workload: {
    id: string | null;
    name: string;
    pending: number;
    inReview: number;
    late: number;
    completed: number;
  }[];
  /** Tecnicas ATT&CK mais vistas nos relatorios publicados do periodo. */
  techniques?: (AttackTechnique & { count: number })[];
}

/** Situacao de um componente: verde, laranja, vermelho ou desligado. */
export type StatusLevel = 'ok' | 'warn' | 'error' | 'off';

/** GET /api/admin/status */
export interface SystemStatus {
  checkedAt: string;
  overall: StatusLevel;
  checks: {
    id: string;
    name: string;
    level: StatusLevel;
    summary: string;
    latencyMs?: number;
    details: { label: string; value: string }[];
  }[];
}

export type AuditAction =
  | 'SETTING_CHANGED'
  | 'YARA_PACK_UPDATED'
  | 'USER_REGISTERED'
  | 'USER_ROLE_CHANGED'
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'USER_LDAP_RELINKED'
  | 'USER_PASSWORD_RESET'
  | 'USER_PASSWORD_CHANGED'
  | 'KEY_CREATED'
  | 'KEY_REVOKED'
  | 'TEMPLATE_CREATED'
  | 'TEMPLATE_UPDATED'
  | 'TEMPLATE_DELETED'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'API_ACCESS_GRANTED'
  | 'API_ACCESS_REVOKED'
  | 'API_TOKEN_CREATED'
  | 'API_TOKEN_REVOKED'
  | 'SESSION_REVOKED'
  | 'TWO_FACTOR_ENABLED'
  | 'TWO_FACTOR_DISABLED'
  | 'TWO_FACTOR_RECOVERY_CODES'
  | 'TWO_FACTOR_RECOVERY_USED'
  | 'PASSKEY_ADDED'
  | 'PASSKEY_REMOVED'
  | 'ENTRY_TRASHED'
  | 'ENTRY_RESTORED'
  | 'ENTRY_DELETED'
  | 'ENTRY_DOWNLOADED'
  | 'SANDBOX_PCAP_DOWNLOADED'
  | 'SANDBOX_MEMDUMP_DOWNLOADED'
  | 'REPORT_AI_DRAFT'
  | 'ENTRY_INTEGRITY_FAILED'
  | 'ENTRY_INTEGRITY_RESTORED'
  | 'YARA_RULE_CREATED'
  | 'SIGMA_RULE_CREATED'
  | 'SIGMA_RULE_UPDATED'
  | 'SIGMA_RULE_DELETED'
  | 'YARA_RULE_UPDATED'
  | 'YARA_RULE_DELETED'
  | 'ALLOWLIST_ADDED'
  | 'ALLOWLIST_REMOVED'
  | 'ALLOWLIST_IMPORTED'
  | 'BACKUP_CREATED'
  | 'BACKUP_DOWNLOADED'
  | 'BACKUP_DELETED'
  | 'COMPANY_DOMAIN_ADDED'
  | 'COMPANY_DOMAIN_REMOVED'
  | 'TRIAGE_RULE_CHANGED'
  | 'ASSIGNMENT_CHANGED'
  | 'BROADCAST_PUBLISHED'
  | 'BROADCAST_ENDED'
  | 'SANDBOX_STOPPED'
  | 'WORKER_PAUSED'
  | 'WORKER_RESUMED'
  | 'JOB_CANCELLED'
  | 'JOB_RETRIED';

/** Registro de auditoria (GET /api/admin/audit). */
export interface AuditEvent {
  id: string;
  action: AuditAction;
  actor: { id: string; displayName: string; email: string } | null;
  targetUser: { id: string; displayName: string; email: string } | null;
  targetLabel: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

/** Artefatos do sandbox (GET /api/sandbox/:id/artifacts; revisao 3.7). */
/** GET /api/sandbox/:id/sigma (plans/novas-analises, item 1). */
export interface SandboxSigmaHit {
  ruleId: string;
  title: string;
  level: 'critical' | 'high' | 'medium' | 'low' | 'informational' | string;
  techniques: string[];
  image: string | null;
  pid: number | null;
  sample: boolean;
  eventId: number;
  event: Record<string, string | null>;
  count: number;
  firstAt: string;
  lastAt: string;
  description: string | null;
  author: string | null;
  falsepositives: string[];
  references: string[];
  url: string | null;
  /** Regra da equipe (plans/caca-e-formatos, item 1): o id no banco, para o editor. */
  teamRuleId: string | null;
}

/** Resumo do que o compilador entendeu de uma regra Sigma. */
export interface SigmaRuleSummary {
  ruleId: string;
  title: string;
  level: string;
  eventIds: number[];
  techniques: string[];
}

/** Regra Sigma da equipe (plans/caca-e-formatos, item 1). */
export interface TeamSigmaRule {
  id: string;
  ruleId: string;
  name: string;
  source: string;
  enabled: boolean;
  evaluatedAt: string | null;
  evaluating: boolean;
  firedRuns: number;
  rule: SigmaRuleSummary | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; displayName: string } | null;
  updatedBy: { id: string; displayName: string } | null;
}

/** Regra vendorizada no catalogo (SigmaHQ). */
export interface CatalogSigmaRule extends SigmaRuleSummary {
  path: string;
  description: string | null;
  /** Colecao da SigmaHQ: core (principal), emerging (ameacas emergentes) ou hunting (caca). */
  collection: string | null;
  enabled: boolean;
  firedRuns: number;
  url: string | null;
  evaluating: boolean;
}

export interface SigmaTestResult {
  rule: SigmaRuleSummary;
  matched: number;
  scanned: number;
  truncated: boolean;
  events: {
    time: string;
    eventId: number;
    image: string | null;
    pid: number | null;
    sample: boolean;
    event: Record<string, string | null>;
  }[];
}

/** Busca nos eventos do sandbox (plans/caca-e-formatos, item 2). */
export interface HuntEvent {
  time: string;
  eventId: number;
  image: string | null;
  pid: number | null;
  sample: boolean;
  summary: string | null;
  data: Record<string, string | null>;
}
export interface HuntRunsPage {
  runs: {
    sessionId: string;
    entryId: string;
    entryTitle: string;
    startedAt: string;
    matched: number;
    first: HuntEvent[];
  }[];
  total: number | null;
  nextOffset: number | null;
  capped: boolean;
}
export interface HuntEventsPage {
  total: number;
  page: number;
  pageSize: number;
  events: HuntEvent[];
}

export interface SandboxSigma {
  rules: {
    name: string | null;
    release: string | null;
    license: string | null;
    url: string | null;
    team?: number;
    count: number;
  };
  sample: { name: string; found: boolean };
  pending: number;
  hits: SandboxSigmaHit[];
}

export interface SandboxArtifacts {
  status: SandboxStatus;
  note: string | null;
  intervalS: number;
  screenshots: { id: string; createdAt: string }[];
  processes: {
    at: string;
    firstAt: string;
    lists: number;
    current: SandboxProcess[];
    appeared: SandboxProcess[];
  } | null;
  /** O que o Sysmon do template registrou (plano pos-revisao, 5.3); null antes da 1a leitura. */
  sysmon: SandboxSysmon | null;
  /** Captura de rede pelo MikroTik ligada (plano pos-revisao, 5.4). */
  captureEnabled?: boolean;
  network?: SandboxNetwork | null;
}

/** Captura de rede e Suricata de um ambiente (plano pos-revisao, 5.4). */
export interface SandboxNetwork {
  status: 'CAPTURING' | 'STORED' | 'FAILED';
  error: string | null;
  mac: string | null;
  packets: number | null;
  bytes: number | null;
  truncated: boolean;
  startedAt: string;
  stoppedAt: string | null;
  pcap: boolean;
  ids: {
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
    error: string | null;
    ms: number | null;
    finishedAt: string | null;
    result: SuricataResult | null;
  } | null;
}

export interface SuricataResult {
  alertsTotal: number;
  version: string | null;
  rules: { count: number; updatedAt: string | null } | null;
  alerts: {
    sid: number;
    signature: string;
    category?: string | null;
    severity?: number | null;
    proto?: string | null;
    src?: string | null;
    dst?: string | null;
    count: number;
  }[];
  dns: { name: string; type?: string | null; answers: string[]; count: number }[];
  http: {
    host?: string | null;
    method?: string | null;
    url?: string | null;
    status?: number | null;
    dst?: string | null;
    count: number;
  }[];
  tls: { sni?: string | null; issuer?: string | null; dst?: string | null; count: number }[];
}

export interface SysmonProcess {
  time: string;
  pid: number | null;
  ppid: number | null;
  image: string;
  cmd: string | null;
  parentImage: string | null;
  user: string | null;
  hashes: string | null;
}

export type SandboxSysmon =
  | {
      at: string;
      available: true;
      events: number;
      truncated: boolean;
      processes: SysmonProcess[];
      network: {
        time: string;
        image: string;
        protocol: string | null;
        dstIp: string | null;
        dstPort: number | null;
        dstHost: string | null;
      }[];
      files: { time: string; image: string; path: string }[];
      registry: {
        time: string;
        image: string;
        action: string | null;
        key: string;
        details: string | null;
      }[];
      dns: { time: string; image: string; query: string; results: string | null }[];
    }
  | { at: string; available: false; reason: string };

export interface SandboxProcess {
  pid: number;
  ppid: number | null;
  name: string;
  cmd: string | null;
}

/** Analise do oletools (GET /api/entries/:id/office; item 7.14). */
/** Servicos novos (plans/novas-analises): GET /api/entries/:id/analyses/:kind. */
export type ServiceKindId = 'emulation' | 'android' | 'config' | 'dotnet' | 'jar';

export interface EmulationResult {
  kind: 'pe' | 'shellcode';
  arch?: string | null;
  filetype?: string | null;
  runtimeS?: number;
  apiTotal: number;
  apis: {
    name: string;
    count: number;
    order: number;
    args: (string | null)[];
    ret?: string | null;
  }[];
  entryPoints: {
    type?: string | null;
    start?: string | null;
    apis: number;
    error?: string | null;
  }[];
  files: { event?: string | null; path: string }[];
  registry: { event?: string | null; path: string; value?: string | null }[];
  network: {
    dns: { query: string; response?: string | null }[];
    traffic: {
      server?: string | null;
      port?: number | null;
      proto?: string | null;
      method?: string | null;
      url?: string | null;
    }[];
  };
  processes: {
    event?: string | null;
    pid?: number | null;
    path?: string | null;
    cmdline?: string | null;
    protect?: string | null;
    size?: number | null;
  }[];
  dropped: { path: string; size?: number | null; sha256?: string | null }[];
  dynamicCode: number;
  strings: (string | null)[];
  errors: {
    entry?: string | null;
    type?: string | null;
    api?: string | null;
    pc?: string | null;
    instr?: string | null;
  }[];
}

export interface AndroidResult {
  package?: string | null;
  appName?: string | null;
  versionName?: string | null;
  versionCode?: string | null;
  minSdk?: string | null;
  targetSdk?: string | null;
  mainActivity?: string | null;
  permissions: { name: string; short: string; dangerous: boolean }[];
  components: { activities: number; services: number; receivers: number; providers: number };
  exported: {
    kind: string;
    name?: string | null;
    permission?: string | null;
    actions: (string | null)[];
  }[];
  certificates: {
    subject?: string | null;
    issuer?: string | null;
    serial?: string | null;
    sha256: string;
    notBefore?: string | null;
    notAfter?: string | null;
    selfSigned: boolean;
    debug: boolean;
  }[];
  signed: { v1: boolean; v2: boolean; v3: boolean };
  apis: string[];
  urls: (string | null)[];
  ips: string[];
  domains: string[];
  dexFiles: string[];
  nativeLibs: (string | null)[];
  hiddenPayloads: (string | null)[];
  fileCount: number;
  dexErrors: (string | null)[];
}

/** Descompilacao de .NET (plans/caca-e-formatos, item 3). */
export interface DotnetResult {
  module: { name: string | null; framework: string | null; outputType: string | null };
  types: { path: string; size: number; lines: number }[];
  findings: {
    rule: string;
    level: 'high' | 'medium';
    why: string;
    path: string;
    line: number;
    text: string;
  }[];
  obfuscators: string[];
  resources: {
    name: string;
    size: number;
    sha256: string;
    kind: string | null;
    entropy: number;
    entryId?: string;
  }[];
  urls: string[];
  truncated: boolean;
  sourceKey: string | null;
}

/** Descompilacao de Java (JAR e .class, CFR). */
export interface JarResult {
  module: {
    name: string | null;
    mainClass: string | null;
    agentClass: string | null;
    javaVersion: string | null;
    createdBy: string | null;
    classes: number;
  };
  types: { path: string; size: number; lines: number }[];
  findings: {
    rule: string;
    level: 'high' | 'medium';
    why: string;
    path: string;
    line: number;
    text: string;
  }[];
  obfuscators: string[];
  resources: {
    name: string;
    size: number;
    sha256: string;
    kind: string | null;
    entropy: number;
    entryId?: string;
  }[];
  urls: string[];
  failed: number;
  truncated: boolean;
  sourceKey: string | null;
}

export interface ConfigResult {
  parsers?: number;
  matches: { rule: string | null; family: string | null }[];
  configs: { family: string; config: unknown }[];
  errors: { family: string; error: string | null }[];
}

export interface ServiceAnalysisInfo<R> {
  enabled: boolean;
  auto: boolean;
  manual: boolean;
  maxMb: number;
  analysis: {
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
    options: Record<string, string> | null;
    result: R | null;
    alerts: { level: 'high' | 'medium' | 'info'; text: string }[] | null;
    iocs: string[];
    error: string | null;
    version: string | null;
    ms: number | null;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
}

export interface OfficeInfo {
  enabled: boolean;
  eligible: boolean;
  maxMb: number;
  analysis: {
    status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
    result: {
      vba?: {
        macros: boolean;
        xlm: boolean;
        stomping: boolean;
        modules: { name: string | null; lines: number; code: string; truncated: boolean }[];
        keywords: { type: string | null; keyword: string | null; description: string | null }[];
        xlmLines: string[];
        mraptor: {
          suspicious: boolean;
          autoexec: boolean;
          write: boolean;
          execute: boolean;
          flags: string | null;
        } | null;
        error: string | null;
      };
      dde?: { links: string[]; error: string | null };
      rtf?: {
        objects: {
          ole: boolean;
          package: boolean;
          className: string | null;
          filename: string | null;
          size: number;
        }[];
        error: string | null;
      } | null;
    } | null;
    alerts: { level: 'high' | 'medium' | 'info'; text: string }[] | null;
    error: string | null;
    version: string | null;
    ms: number | null;
    attempts: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
}

/** Pontuacao de risco explicavel (GET /api/entries/:id/risk, so analistas). */
export interface RiskInfo {
  risk: {
    score: number;
    level: 'high' | 'medium' | 'low';
    suggestedVerdict: 'MALICIOUS' | 'SUSPICIOUS' | null;
    reasons: { source: string; text: string; weight: number }[];
    pending: string[];
  };
  thresholds: { malicious: number; suspicious: number };
}

/** Cadeia da auditoria conferida agora (GET /api/admin/audit/verify). */
export interface AuditChainState {
  ok: boolean;
  events: number;
  unchained: number;
  head: { seq: number; hash: string } | null;
  problem: { seq: number | null; reason: string } | null;
  checkedAt: string;
}

/** Modelo de relatorio (GET /api/report-templates). */
export interface ReportTemplate {
  id: string;
  name: string;
  summary: string;
  findings: string | null;
  iocs: string | null;
  verdict: Verdict;
  updatedAt: string;
}

/** Executavel Linux (StaticInfo.elf, item 168). */
export interface ElfInfo {
  class: 32 | 64;
  endian: 'little' | 'big';
  machine: string;
  type: string;
  entry: string;
  interpreter: string | null;
  stripped: boolean;
  static: boolean;
  sections: { name: string; type: string; size: number; entropy: number }[];
  needed: string[];
  importedSymbols: number;
  suspiciousSymbols: string[];
  rwxSegments: number;
  packer: string | null;
  alerts: string[];
  /** telfhash da Trend Micro (item 2); null sem tabela de simbolos. */
  telfhash?: string | null;
}

/** Executavel macOS, comum ou universal (StaticInfo.macho). */
export interface MachoInfo {
  fat: boolean;
  architectures: string[];
  architecture: string;
  class: 32 | 64;
  endian: 'little' | 'big';
  type: string;
  platform: string | null;
  uuid: string | null;
  entry: string | null;
  sections: { segment: string; name: string; size: number; entropy: number }[];
  libraries: string[];
  rpaths: string[];
  importedSymbols: number;
  suspiciousSymbols: string[];
  signature: {
    present: boolean;
    adhoc: boolean;
    runtime: boolean;
    identifier: string | null;
    entitlements: string[];
  };
  rwxSegments: number;
  encrypted: boolean;
  packer: string | null;
  alerts: string[];
  risk: 'high' | 'medium' | 'low';
  /** symhash (item 2): o da arquitetura descrita e um por arquitetura. */
  symhash?: string | null;
  symhashes?: { architecture: string; symhash: string }[];
}

/** Tipos de aviso da caixa de entrada. */
export type NotificationType = AppNotification['type'];

/** Notificacao da caixa de entrada (GET /api/me/notifications). */
export interface AppNotification {
  id: string;
  type:
    | 'ASSIGNED'
    | 'COMPLETED'
    | 'MENTION'
    | 'COMMENT'
    | 'REPORT_APPROVED'
    | 'REPORT_RETURNED'
    | 'IOC_SEEN'
    | 'SLA_WARN'
    | 'SLA_LATE'
    | 'RESOLUTION'
    | 'CASE_MENTION'
    | 'CASE_COMMENT'
    | 'CASE_ENTRY_ADDED'
    | 'CASE_ENTRY_REMOVED'
    | 'CASE_ASSIGNED'
    | 'YARA_PACK_UPDATE'
    | 'SANDBOX_STOPPED_BY_ADMIN';
  /**
   * Veredito (COMPLETED), trecho da atualizacao (MENTION/COMMENT), horas do
   * prazo (SLA_WARN/SLA_LATE, enviadas pelo sistema: `actor` null), a
   * resolucao escrita (RESOLUTION) ou, nos casos, o trecho do comentario e as
   * amostras incluidas/retiradas.
   */
  detail: string | null;
  readAt: string | null;
  createdAt: string;
  /**
   * Amostra ou caso (item 89; sempre um dos dois). `resolution`: a resolucao
   * atual (aparece no aviso de concluida).
   */
  entry: { id: string; title: string; resolution?: string | null } | null;
  case?: { id: string; number: number; title: string; code: string } | null;
  actor: { id: string; displayName: string } | null;
}

/** Tipos de indicador do indice de IOCs (relatorios publicados). */
export type IocKind = 'IPV4' | 'IPV6' | 'DOMAIN' | 'EMAIL' | 'MD5' | 'SHA1' | 'SHA256' | 'URL';

/** Onde um indicador aparece numa amostra (ficha do indicador). */
export type IocSighting =
  | { kind: 'REPORT'; reportId: string; analyst: string; createdAt: string }
  | { kind: 'FILE' }
  | { kind: 'URL_HOST' }
  /** O proprio link da amostra (ficha de URL, item 166). */
  | { kind: 'URL_SAMPLE' };

/** GET /api/iocs/:kind/:value */
export interface IocDetail {
  /** A pessoa segue este indicador (alertas de IOC). */
  watching?: boolean;
  /** Coberto pela lista de permissoes (item 69): item que cobre e o motivo. */
  allowed?: { by: string; reason: string } | null;
  ioc: { kind: IocKind; value: string };
  items: { entry: Entry; sightings: IocSighting[] }[];
  total: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

/** GET /api/entries/:id/iocs: indicadores da amostra (relatorios + a propria). */
export interface EntryIoc {
  kind: IocKind;
  value: string;
  source: 'REPORT' | 'SAMPLE';
  reportIds: string[];
}

/** Por que uma amostra aparece na aba "Relacionadas". */
export type RelatedReason =
  | { kind: 'SAME_SHA256' }
  | { kind: 'SAME_HOST'; detail: string }
  | { kind: 'SAME_BASE_DOMAIN'; detail: string }
  | { kind: 'SHARED_TAGS'; detail: string[] }
  | { kind: 'SHARED_IOCS'; detail: string[] }
  /** Arquivo parecido pelo TLSH: similaridade em % (100 - distancia). */
  | { kind: 'SIMILAR'; detail: number }
  /** Mesma tabela de importacoes (imphash, item 7.1). */
  | { kind: 'SAME_IMPHASH'; detail: string }
  /** Mesmo Rich header (item 7.1). */
  | { kind: 'SAME_RICH'; detail: string }
  | { kind: 'SIMILAR_PAGE'; detail: number }
  /** Mesmo pivo: PDB, authentihash... (plans/analise-estatica-ampliada). */
  | { kind: 'SAME_PIVOT'; detail: { pivot: PivotKind; value: string; distance?: number } };

/** Pivos que ligam amostras (EntryPivot na API). */
export type PivotKind =
  'PDB_PATH' | 'PDB_ID' | 'AUTHENTIHASH' | 'EXPHASH' | 'ICON_DHASH' | 'TELFHASH' | 'SYMHASH';

/** Linha de GET /api/entries/:id/related (da mais relevante para a menos). */
export interface RelatedEntry {
  entry: Entry;
  reasons: RelatedReason[];
  score: number;
}

/** Item da pasta "Favoritos" do navegador (GET /api/me/favorites). */
export interface Favorite {
  id: string;
  /** VIEW: visao de lista salva (`url`); ENTRY: amostra fixada (`entryId`). */
  kind: 'VIEW' | 'ENTRY';
  label: string;
  url: string | null;
  entryId: string | null;
  position: number;
  createdAt: string;
  entry: { id: string; title: string; status: EntryStatus; verdict: Verdict } | null;
}

export interface TagValue {
  id: string;
  name: string;
}

export interface EntryOwner {
  id: string;
  displayName: string;
  /** So para analistas, administradores e a propria pessoa (item 123). */
  email?: string;
}

/** Rascunho -> (Em revisao ->) Publicado. */
export type ReportStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED';

export interface Report {
  id: string;
  entryId: string;
  analystId: string;
  analyst: { id: string; displayName: string; role: Role };
  summary: string;
  findings?: string | null;
  iocs?: string | null;
  verdict: Verdict;
  status: ReportStatus;
  /** Revisao (quatro olhos). */
  submittedAt?: string | null;
  reviewedBy?: { id: string; displayName: string } | null;
  reviewedAt?: string | null;
  /** Comentario de quem devolveu o relatorio. */
  reviewNote?: string | null;
  /** Tecnicas MITRE ATT&CK (ex.: T1566.001). */
  attackTechniques?: string[];
  /** Artigos da base de conhecimento citados (item 63). */
  kbArticles?: { id: string; title: string }[];
  /** Versoes anteriores guardadas (item 75). */
  _count?: { revisions: number };
  /** Imagens de evidencia (item 76), na ordem em que entraram. */
  evidence?: ReportEvidence[];
  createdAt: string;
  updatedAt: string;
}

/** Imagem de evidencia do relatorio (item 76); a imagem fica em GET /api/evidence/:id. */
export interface ReportEvidence {
  id: string;
  caption: string | null;
  mimeType: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
  uploadedBy: { id: string; displayName: string } | null;
}

/** Lista embutida do MITRE ATT&CK (GET /api/attack). */
export interface AttackTechnique {
  id: string;
  name: string;
  tactics: string[];
}

export interface AttackData {
  version: string;
  tactics: { id: string; name: string }[];
  techniques: AttackTechnique[];
}

/** Dominio parecido com um da empresa achado na amostra (item 92). */
export interface LookalikeHit {
  domain: string;
  companyDomain: string;
  reason: 'TLD' | 'HOMOGLYPH' | 'TYPO' | 'KEYWORD' | 'SUBDOMAIN';
  detail: string | null;
  /** URL, SENDER, LINK, IOC, REPORT. */
  sources: string[];
}

export interface Entry {
  /** Prioridade (padrao P3). */
  priority?: Priority;
  /** Resolucao para quem enviou (item 87): o que fazer, em texto curto. */
  resolution?: string | null;
  /** Dominios parecidos com os da empresa (item 92; so na ficha). */
  lookalikeHits?: LookalikeHit[];
  id: string;
  ownerId: string;
  owner: EntryOwner;
  type: EntryType;
  title: string;
  description?: string | null;
  status: EntryStatus;
  verdict: Verdict;
  originalFilename?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  sha256?: string | null;
  /** Hash parecido (TLSH, sem o "T1"): '' = nao calculavel; null = ainda nao calculado. */
  tlsh?: string | null;
  storageKey?: string | null;
  /** Arquivo apagado pela retencao (RETENTION_DAYS); ficha e hash continuam. */
  filePurgedAt?: string | null;
  /** Ultima conferencia do SHA-256 do arquivo guardado (item 4.2); null = nunca conferido. */
  integrityCheckedAt?: string | null;
  /** Quando se detectou que o arquivo nao confere com o SHA-256 da ficha (ou sumiu). */
  integrityFailedAt?: string | null;
  bucket?: string | null;
  url?: string | null;
  urlDomain?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Analista responsavel (atribuicao); null = sem responsavel. */
  assignee?: { id: string; displayName: string } | null;
  tags: TagValue[];
  reports?: Report[];
  _count?: { reports: number; duplicates?: number };
  /** Analise estatica do arquivo (so na ficha; as listas nao trazem). */
  staticInfo?: StaticInfo | null;
  /** E-mail (.eml) lido no envio (item 54). */
  emailInfo?: EmailInfo | null;
  /** E-mail de onde veio este anexo (item 54). */
  parentEntry?: { id: string; title: string; originalFilename?: string | null } | null;
  /** Duplicata de outra amostra (a principal). */
  duplicateOfId?: string | null;
  /** Duplicata de amostra de outra pessoa, com a restricao ligada (sem o id). */
  isDuplicate?: boolean;
  duplicateOf?: { id: string; title: string } | null;
  /** Duplicatas desta amostra (GET /api/entries/:id, ate 50). */
  duplicates?: { id: string; title: string; createdAt: string }[];
  /** Quando entrou no status atual (idade na fila / prazo). */
  statusChangedAt?: string;
}

/** Limites do prazo (horas no status atual), vindos da API. */
export interface SlaConfig {
  warnHours: number;
  lateHours: number;
  /** Prazos de cada prioridade (o par acima e o do P3). */
  byPriority?: Record<Priority, { warnHours: number; lateHours: number }>;
}

export interface ActivationKey {
  id: string;
  code: string;
  role: Role;
  maxUses: number;
  usesUsed: number;
  expiresAt?: string | null;
  revoked: boolean;
  createdAt: string;
  createdBy?: { id: string; displayName: string };
  usedBy?: { id: string; displayName: string; email: string }[];
}

export type SandboxStatus =
  'REQUESTED' | 'PROVISIONING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'EXPIRED' | 'FAILED';

export interface SandboxEntryRef {
  id: string;
  title: string;
  sha256?: string | null;
  originalFilename?: string | null;
  fileSize?: number | null;
  owner?: { id: string; displayName: string };
}

export interface SandboxSession {
  id: string;
  entryId: string;
  analystId: string;
  node: string;
  vmid?: number | null;
  name: string;
  status: SandboxStatus;
  phase?: string | null;
  isoVolume?: string | null;
  upid?: string | null;
  ip?: string | null;
  lastError?: string | null;
  expiresAt: string;
  startedAt?: string | null;
  stoppedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  analyst?: { id: string; displayName: string };
  entry?: SandboxEntryRef;
  /** Execucao automatica da amostra (pedida ao abrir); null = nao pedida. */
  autoRun?: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | null;
  autoRunAt?: string | null;
  /** Em que conta rodou (DOMINIO\usuario, ou SYSTEM sem usuario logado). */
  autoRunUser?: string | null;
  autoRunSysmon?: boolean | null;
  autoRunError?: string | null;
}

/** Tipos de evento da linha do tempo de uma execucao (plans/sandbox-execucoes, fase 3). */
export type TimelineKind = 'process' | 'network' | 'dns' | 'file' | 'registry';

export interface SandboxTimelineEvent {
  /** Hora no relogio da API (ISO). */
  time: string;
  kind: TimelineKind;
  image: string | null;
  pid: number | null;
  /** O processo e da amostra (ou descende dela). */
  sample: boolean;
  detail: Record<string, string | number | null>;
}

export interface SandboxTimelineMarker {
  kind: 'started' | 'autorun' | 'sample' | 'screenshot' | 'stopped';
  time: string;
  /** Print da tela: o artefato. */
  id?: string;
}

/** GET /api/sandbox/:id/timeline. */
export interface SandboxTimeline {
  sample: { name: string; found: boolean; processes: number };
  scope: 'sample' | 'all';
  kinds: TimelineKind[];
  page: number;
  pageSize: number;
  total: number;
  events: SandboxTimelineEvent[];
  /** Horario do primeiro evento da proxima pagina (null na ultima). */
  next: string | null;
  markers: SandboxTimelineMarker[];
}

/** GET /api/sandbox/:id/summary: o que a amostra fez numa execucao (ficha impressa, Markdown). */
export interface SandboxRunSummary {
  session: {
    id: string;
    status: SandboxStatus;
    createdAt: string;
    startedAt: string | null;
    stoppedAt: string | null;
    analyst: string | null;
    autoRun: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | null;
    autoRunAt: string | null;
    autoRunUser: string | null;
    autoRunSysmon: boolean | null;
  };
  sample: { name: string; found: boolean; processes: number };
  sysmon: { available: boolean; reason: string | null; events: number | null } | null;
  processes: {
    time: string;
    image: string | null;
    pid: number | null;
    ppid: number | null;
    cmd: string | null;
  }[];
  dns: { query: string; results: string | null }[];
  network: { destination: string; protocol: string | null }[];
  files: string[];
  registry: { key: string; action: string | null; details: string | null }[];
  appeared: { pid: number; ppid: number | null; name: string; cmd: string | null }[];
  screenshots: number;
}

/** Uma execucao (sessao) da amostra no historico: GET /api/entries/:id/sandbox/sessions. */
/** GET /api/sandbox/:id/memory (plans/novas-analises, item 3). */
export interface SandboxMemoryDump {
  id: string;
  pid: number;
  image: string | null;
  status: 'CAPTURING' | 'STORED' | 'ANALYZING' | 'DONE' | 'FAILED';
  size: number | null;
  storedSize: number | null;
  sha256: string | null;
  error: string | null;
  result: {
    arch?: string | null;
    modules: number;
    regionsTotal: number;
    privateScanned: number;
    privateExecutable: number;
    regions: {
      base: string;
      size: number;
      protect: string;
      kind: 'pe' | 'code';
      entropy: number;
      head: string;
      sha256: string;
      carved?: string;
      matches?: { rule: string | null; family: string | null }[];
      configs?: { family: string; config: unknown }[];
    }[];
    urls: string[];
  } | null;
  children: { entryId: string; sha256: string; base: string }[] | null;
  createdAt: string;
  storedAt: string | null;
  finishedAt: string | null;
}

export interface SandboxMemory {
  enabled: boolean;
  analysis: boolean;
  running: boolean;
  scheduledAt: string | null;
  requested: boolean;
  dumps: SandboxMemoryDump[];
}

/** GET /api/sandbox/:a/compare/:b (plans/novas-analises, item 8). */
export type SandboxCompareCategory =
  'process' | 'dns' | 'network' | 'file' | 'registry' | 'sigma' | 'ids';

export interface SandboxCompare {
  a: { id: string; startedAt: string; stoppedAt: string | null };
  b: { id: string; startedAt: string; stoppedAt: string | null };
  scope: 'sample' | 'all';
  sample: { name: string; foundA: boolean; foundB: boolean };
  categories: Record<
    SandboxCompareCategory,
    {
      onlyA: { key: string; example: string; count: number }[];
      onlyB: { key: string; example: string; count: number }[];
      both: { key: string; exampleA: string; exampleB: string }[];
      counts: { onlyA: number; onlyB: number; both: number };
    }
  >;
}

export interface SandboxRun {
  id: string;
  status: SandboxStatus;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  autoRun: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | null;
  autoRunAt: string | null;
  autoRunUser: string | null;
  autoRunSysmon: boolean | null;
  autoRunError: string | null;
  analyst: { id: string; displayName: string };
}

export interface SandboxHealth {
  enabled: boolean;
  mock: boolean;
  node: string;
  templateVmid: number;
  isoStorage: string;
  ttlMinutes: number;
  maxActive: number;
  maxPerUser: number;
  consoleEnabled: boolean;
  activeSessions: number;
  checks: { name: string; ok: boolean; detail: string }[];
}

export type EntryEventType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'VERDICT_CHANGED'
  | 'ASSIGNED'
  | 'REPORT_CREATED'
  | 'REPORT_PUBLISHED'
  | 'SANDBOX_OPENED'
  | 'SANDBOX_CLOSED'
  | 'SANDBOX_FAILED'
  | 'SANDBOX_AUTORUN'
  | 'COMMENT'
  | 'MARKED_DUPLICATE'
  | 'UNMARKED_DUPLICATE'
  | 'PRIORITY_CHANGED'
  | 'REPORT_SUBMITTED'
  | 'REPORT_APPROVED'
  | 'REPORT_RETURNED'
  | 'FILE_PURGED'
  | 'TRASHED'
  | 'RESTORED'
  | 'CASE_ADDED'
  | 'CASE_REMOVED'
  | 'SLA_WARN'
  | 'SLA_LATE'
  | 'PAGE_CAPTURED'
  | 'TRIAGE_RULE'
  | 'RESOLUTION_SET';

/** Evento do historico da amostra (GET /api/entries/:id/events). */
export interface EntryEvent {
  id: string;
  entryId: string;
  type: EntryEventType;
  fromValue?: string | null;
  toValue?: string | null;
  detail?: string | null;
  createdAt: string;
  /** null = acao do sistema (ex.: expiracao do sandbox). */
  actor: { id: string; displayName: string } | null;
}

// ---- Monitoramento (plans/monitoramento) ----

export type MonitorQueueId =
  | 'capa'
  | 'ghidra'
  | 'unpack'
  | 'oletools'
  | 'qr'
  | 'emulation'
  | 'android'
  | 'config'
  | 'dotnet'
  | 'jar'
  | 'suricata'
  | 'memdump';

export interface MonitorQueue {
  id: MonitorQueueId;
  paused: boolean;
  ready: number;
  scheduled: number;
  running: number;
  oldestRunningAt: string | null;
  oldestPendingAt: string | null;
  done24h: number;
  failed24h: number;
  avgMs: number | null;
  p95Ms: number | null;
  /** O servico da fila no Status do sistema (de pe, desligado...). */
  service: { level: StatusLevel; summary: string } | null;
}

export interface MonitorSession {
  id: string;
  status: SandboxStatus;
  phase: string | null;
  vmid: number | null;
  createdAt: string;
  startedAt: string | null;
  expiresAt: string;
  entry: { id: string; title: string };
  analyst: { id: string; displayName: string };
  analystAtLimit: boolean;
  vm: {
    status: string | null;
    cpu: number | null;
    cpus: number | null;
    mem: number | null;
    maxmem: number | null;
    netin: number | null;
    netout: number | null;
  } | null;
}

/** GET /api/admin/monitor. */
export interface MonitorSnapshot {
  checkedAt: string;
  sandbox:
    | { enabled: false }
    | {
        enabled: true;
        limit: number;
        perUserLimit: number;
        sessions: MonitorSession[];
        node: {
          available: boolean;
          reason: 'permission' | 'error' | null;
          cpu: number | null;
          memUsed: number | null;
          memTotal: number | null;
          diskUsed: number | null;
          diskTotal: number | null;
        };
        orphans: { vms: number; isos: number } | null;
      };
  queues: MonitorQueue[];
  platform: {
    uptimeS: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    loop: { p50: number; p99: number };
    workerRestarts: number;
    sigmaRetro: { current: string | null; queued: number };
    yaraRetroscans: number;
    dbBytes: number;
    storage: { bytes?: number; objects?: number; partial?: boolean; at: string } | null;
  };
}

/** GET /api/admin/monitor/history. */
export interface MonitorHistory {
  range: '24h' | '7d';
  since: string;
  bucketMs: number;
  series: Record<string, [number, number][]>;
  durations: Partial<
    Record<MonitorQueueId, { day: string; n: number; avgMs: number; p95Ms: number }[]>
  >;
}

/** GET /api/admin/monitor/queues/:queue/jobs. */
export interface MonitorJobs {
  queue: MonitorQueueId;
  state: 'pending' | 'running' | 'failed';
  page: number;
  total: number;
  jobs: {
    id: string;
    state: string;
    attempts: number;
    createdAt: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    entryId: string;
    entryTitle: string;
  }[];
}
