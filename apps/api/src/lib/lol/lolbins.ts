/**
 * Binarios do proprio sistema usados para baixar, executar ou esconder carga (plans/analise-estatica-
 * ampliada, item 4). A ideia e a dos projetos LOLBAS (Windows) e GTFOBins (Linux), mas a lista e
 * escrita aqui (os dois sao GPL-3.0): so o nome, o uso e o padrao de linha de comando abusivo, com o
 * link para a pagina do projeto. O padrao exige o argumento que denuncia o abuso; o binario sozinho
 * nao conta (certutil e regsvr32 aparecem em qualquer instalador).
 */

export type LolUse =
  | 'download'
  | 'execute'
  | 'decode'
  | 'awl-bypass'
  | 'persistence'
  | 'reverse-shell'
  | 'copy'
  | 'privilege';

export interface LolBin {
  name: string;
  platform: 'windows' | 'linux';
  uses: LolUse[];
  re: RegExp;
  /** Pagina do LOLBAS ou do GTFOBins. */
  url: string;
}

// Entre o binario e o argumento: ate 200 caracteres da mesma linha (sem quebra), sem retrocesso
// quadratico (classe simples com teto).
const GAP = '[^\\r\\n]{0,200}?';
const exe = (name: string) => `\\b${name}(?:\\.exe)?\\b`;
const rx = (source: string) => new RegExp(source, 'i');
const lolbas = (name: string, kind = 'Binaries') =>
  `https://lolbas-project.github.io/lolbas/${kind}/${name}/`;
const gtfo = (name: string) => `https://gtfobins.github.io/gtfobins/${name}/`;

export const LOLBINS: LolBin[] = [
  {
    name: 'certutil',
    platform: 'windows',
    uses: ['download', 'decode'],
    re: rx(`${exe('certutil')}${GAP}[-/](?:urlcache|decodehex|decode|encode|verifyctl)\\b`),
    url: lolbas('Certutil'),
  },
  {
    name: 'mshta',
    platform: 'windows',
    uses: ['execute', 'download'],
    re: rx(`${exe('mshta')}\\s+["']?(?:https?:|javascript:|vbscript:|\\\\\\\\)`),
    url: lolbas('Mshta'),
  },
  {
    name: 'regsvr32',
    platform: 'windows',
    uses: ['execute', 'awl-bypass', 'download'],
    re: rx(`${exe('regsvr32')}${GAP}(?:/i:\\s*["']?https?:|scrobj\\.dll)`),
    url: lolbas('Regsvr32'),
  },
  {
    name: 'rundll32',
    platform: 'windows',
    uses: ['execute'],
    re: rx(
      `${exe('rundll32')}${GAP}(?:javascript:|url\\.dll,|shell32\\.dll,\\s*ShellExec_RunDLL|advpack\\.dll,|zipfldr\\.dll,|pcwutl\\.dll,|ieadvpack\\.dll,|\\\\\\\\[^\\s,]+,)`,
    ),
    url: lolbas('Rundll32'),
  },
  {
    name: 'bitsadmin',
    platform: 'windows',
    uses: ['download', 'persistence'],
    re: rx(`${exe('bitsadmin')}${GAP}/(?:transfer|addfile|SetNotifyCmdLine)\\b`),
    url: lolbas('Bitsadmin'),
  },
  {
    name: 'msiexec',
    platform: 'windows',
    uses: ['execute', 'download'],
    re: rx(`${exe('msiexec')}${GAP}/[iqy]\\S*\\s+["']?(?:https?:|\\\\\\\\)`),
    url: lolbas('Msiexec'),
  },
  {
    name: 'wmic',
    platform: 'windows',
    uses: ['execute'],
    re: rx(
      `${exe('wmic')}${GAP}(?:process\\s+call\\s+create|/format:\\s*["']?(?:https?:|\\\\\\\\))`,
    ),
    url: lolbas('Wmic'),
  },
  {
    name: 'cmstp',
    platform: 'windows',
    uses: ['execute', 'awl-bypass'],
    re: rx(`${exe('cmstp')}${GAP}/(?:s|au|ni)\\b`),
    url: lolbas('Cmstp'),
  },
  {
    name: 'installutil',
    platform: 'windows',
    uses: ['execute', 'awl-bypass'],
    re: rx(`${exe('installutil')}${GAP}/(?:u|logfile=)`),
    url: lolbas('Installutil'),
  },
  {
    name: 'regasm',
    platform: 'windows',
    uses: ['execute', 'awl-bypass'],
    re: rx(`${exe('reg(?:asm|svcs)')}${GAP}(?:/u\\b|\\S+\\.dll)`),
    url: lolbas('Regasm'),
  },
  {
    name: 'msbuild',
    platform: 'windows',
    uses: ['execute', 'awl-bypass'],
    re: rx(`${exe('msbuild')}\\s+["']?[^\\s"']+\\.(?:xml|csproj|proj|targets)\\b`),
    url: lolbas('Msbuild'),
  },
  {
    name: 'odbcconf',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`${exe('odbcconf')}${GAP}(?:regsvr|-f\\s)`),
    url: lolbas('Odbcconf'),
  },
  {
    name: 'forfiles',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`${exe('forfiles')}${GAP}/c\\s`),
    url: lolbas('Forfiles'),
  },
  {
    name: 'pcalua',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`${exe('pcalua')}\\s+-a\\s`),
    url: lolbas('Pcalua'),
  },
  {
    name: 'hh',
    platform: 'windows',
    uses: ['execute', 'download'],
    re: rx(`${exe('hh')}\\s+["']?(?:https?:|mk:@MSITStore)`),
    url: lolbas('Hh'),
  },
  {
    name: 'esentutl',
    platform: 'windows',
    uses: ['copy', 'download'],
    re: rx(`${exe('esentutl')}${GAP}/y\\s`),
    url: lolbas('Esentutl'),
  },
  {
    name: 'expand',
    platform: 'windows',
    uses: ['copy', 'download'],
    re: rx(`${exe('(?:expand|extrac32)')}\\s+(?:/\\w+\\s+)*["']?\\\\\\\\`),
    url: lolbas('Expand'),
  },
  {
    name: 'curl',
    platform: 'windows',
    uses: ['download'],
    re: rx(`\\bcurl\\.exe${GAP}(?:-o\\s|--output\\s|-O\\b)`),
    url: lolbas('Curl'),
  },
  {
    name: 'finger',
    platform: 'windows',
    uses: ['download'],
    re: rx(`${exe('finger')}\\s+[^\\s@]+@[\\w.-]+\\s*\\|`),
    url: lolbas('Finger'),
  },
  {
    name: 'msdt',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`(?:${exe('msdt')}${GAP}IT_BrowseForFile|ms-msdt:)`),
    url: lolbas('Msdt'),
  },
  {
    name: 'conhost',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`${exe('conhost')}\\s+--headless\\b`),
    url: lolbas('Conhost'),
  },
  {
    name: 'schtasks',
    platform: 'windows',
    uses: ['persistence', 'execute'],
    re: rx(`${exe('schtasks')}${GAP}/create\\b${GAP}/tr\\b`),
    url: lolbas('Schtasks'),
  },
  {
    name: 'wscript',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`${exe('[cw]script')}${GAP}//e:`),
    url: lolbas('Wscript'),
  },
  {
    name: 'mavinject',
    platform: 'windows',
    uses: ['execute'],
    re: rx(`${exe('mavinject')}${GAP}/injectrunning\\b`),
    url: lolbas('Mavinject'),
  },
  {
    name: 'bash',
    platform: 'linux',
    uses: ['reverse-shell'],
    re: rx(`\\b(?:ba)?sh\\s+-i\\s*[^\\r\\n]{0,40}/dev/tcp/`),
    url: gtfo('bash'),
  },
  {
    name: 'nc',
    platform: 'linux',
    uses: ['reverse-shell'],
    re: rx(`\\b(?:nc|ncat|netcat)\\s${GAP}-[ce]\\s*/bin/(?:ba)?sh\\b`),
    url: gtfo('nc'),
  },
  {
    name: 'socat',
    platform: 'linux',
    uses: ['reverse-shell'],
    re: rx(`\\bsocat\\s${GAP}exec:`),
    url: gtfo('socat'),
  },
  {
    name: 'python',
    platform: 'linux',
    uses: ['reverse-shell'],
    re: rx(
      `\\bpython[23]?\\s+-c\\s+["'][^"'\\r\\n]{0,200}socket\\.socket${GAP}(?:pty\\.spawn|subprocess|os\\.dup2)`,
    ),
    url: gtfo('python'),
  },
  {
    name: 'perl',
    platform: 'linux',
    uses: ['reverse-shell'],
    re: rx(`\\bperl\\s+-e\\s+["']\\s*use\\s+Socket`),
    url: gtfo('perl'),
  },
  {
    name: 'curl',
    platform: 'linux',
    uses: ['download', 'execute'],
    re: rx(`\\b(?:curl|wget)\\s[^\\r\\n|]{0,200}\\|\\s*(?:sudo\\s+)?(?:ba)?sh\\b`),
    url: gtfo('curl'),
  },
  {
    name: 'base64',
    platform: 'linux',
    uses: ['decode', 'execute'],
    re: rx(`\\bbase64\\s+(?:-d|--decode)\\b[^\\r\\n]{0,80}\\|\\s*(?:ba)?sh\\b`),
    url: gtfo('base64'),
  },
  {
    name: 'chmod',
    platform: 'linux',
    uses: ['privilege'],
    re: rx(`\\bchmod\\s+(?:u\\+s|[0-7]?[4-7][0-7]{3})\\s`),
    url: gtfo('chmod'),
  },
];
