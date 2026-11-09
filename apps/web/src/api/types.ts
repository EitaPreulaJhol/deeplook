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

/** GET /api/entries/:id/unpack (item 7.8). */
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
    entries: { product: number; build: number; count: number }[];
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
  language: 'powershell' | 'javascript' | 'vbscript' | 'batch' | 'hta';
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
  document?: DocumentInfo | null;
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
  | 'ENTRY_TRASHED'
  | 'ENTRY_RESTORED'
  | 'ENTRY_DELETED'
  | 'ENTRY_DOWNLOADED'
  | 'ENTRY_INTEGRITY_FAILED'
  | 'ENTRY_INTEGRITY_RESTORED'
  | 'YARA_RULE_CREATED'
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
  | 'BROADCAST_ENDED';

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
    | 'YARA_PACK_UPDATE';
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
  | { kind: 'SAME_RICH'; detail: string };

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
