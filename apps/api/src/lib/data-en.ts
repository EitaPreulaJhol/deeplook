/**
 * Textos das analises em ingles (plano pos-revisao, item 1.4, parte 2): alertas da analise
 * estatica (PE, .NET, ELF, atalho, imagem de disco, documento, script), alertas do oletools, tipo do
 * arquivo e os motivos de falha das analises em segundo plano. Ficam gravados em portugues (no
 * `staticInfo` da amostra e nas tabelas das analises) e a API os traduz na saida, para quem pede
 * ingles (lib/data-language.ts). Registros antigos tambem saem traduzidos, desde que a frase nao
 * tenha mudado.
 *
 * O formato e o de messages-en.ts: a chave e o texto exato, `{0}`, `{1}`... nos trechos variaveis,
 * e vale o primeiro padrao que casar. O teste tests/unit/data-language.test.ts le os modulos de
 * analise e reprova texto sem par aqui.
 */
export const DATA_EN: readonly (readonly [pt: string, en: string])[] = [
  // ---- PE (pe-analysis.ts) ----
  [
    'A assinatura não confere com o conteúdo: o arquivo foi alterado depois de assinado.',
    'The signature does not match the content: the file was changed after it was signed.',
  ],
  [
    'A assinatura digital é inválida (não confere com o certificado).',
    'The digital signature is invalid (it does not match the certificate).',
  ],
  ['O ponto de entrada está fora de todas as seções.', 'The entry point is outside every section.'],
  [
    'Não importa nenhuma função: resolve tudo sozinho na execução.',
    'It imports no function: it resolves everything by itself at run time.',
  ],
  [
    'A data de compilação está no futuro: foi forjada.',
    'The compile date is in the future: it was forged.',
  ],
  [
    'O Rich header não confere com o cabeçalho: foi editado ou copiado de outro programa.',
    'The Rich header does not match the header: it was edited or copied from another program.',
  ],
  ['O manifesto pede execução como administrador.', 'The manifest asks to run as administrator.'],
  ['Assinado com certificado autoassinado.', 'Signed with a self-signed certificate.'],
  [
    'O checksum do cabeçalho não confere com o arquivo.',
    'The header checksum does not match the file.',
  ],
  ['Seções graváveis e executáveis', 'Writable and executable sections'],
  ['Seção gravável e executável', 'Writable and executable section'],
  ['(sem nome)', '(no name)'],
  ['sem nome', 'no name'],
  ['Assinatura presente, mas não conferida: {0}', 'Signature present, but not checked: {0}'],
  [
    'O ponto de entrada está na seção {0}, que não é executável.',
    'The entry point is in section {0}, which is not executable.',
  ],
  [
    'O ponto de entrada está na última seção ({0}): comum em código injetado ou empacotado.',
    'The entry point is in the last section ({0}): common in injected or packed code.',
  ],
  [
    'Empacotado com {0}: o código real só aparece ao executar.',
    'Packed with {0}: the real code only shows up when it runs.',
  ],
  [
    '{0}: {1}. O código pode se reescrever na memória.',
    '{0}: {1}. The code can rewrite itself in memory.',
  ],
  [
    'Só {0} funções importadas, com GetProcAddress e LoadLibrary: as demais são resolvidas na execução.',
    'Only {0} imported functions, with GetProcAddress and LoadLibrary: the others are resolved at run time.',
  ],
  ['O recurso {0}/{1} contém outro executável.', 'Resource {0}/{1} contains another executable.'],
  [
    '{0} bytes anexados depois do fim do executável{1}.',
    '{0} bytes appended after the end of the executable{1}.',
  ],
  [
    'Diz ser da {0}, mas não tem assinatura digital.',
    'It claims to be from {0}, but has no digital signature.',
  ],
  [
    'O nome original declarado na versão é {0}.',
    'The original name declared in the version is {0}.',
  ],
  [
    '{0} TLS callback(s): código que roda antes do ponto de entrada (o CRT do MinGW também usa).',
    '{0} TLS callback(s): code that runs before the entry point (the MinGW CRT also uses them).',
  ],

  ['x86 (32 bits)', 'x86 (32-bit)'],
  ['x64 (64 bits)', 'x64 (64-bit)'],
  ['Nativo (driver)', 'Native (driver)'],
  ['Janelas (GUI)', 'Windows (GUI)'],
  ['outro ({0})', 'other ({0})'],

  // ---- .NET (pe-dotnet.ts) ----
  ['32 bits obrigatório', '32-bit required'],
  ['Assembly.Load (carrega código da memória)', 'Assembly.Load (loads code from memory)'],
  ['AppDomain.Load (carrega código da memória)', 'AppDomain.Load (loads code from memory)'],
  ['MethodInfo.Invoke (chamada por reflexão)', 'MethodInfo.Invoke (call through reflection)'],
  ['WebClient (baixa da internet)', 'WebClient (downloads from the internet)'],
  ['HttpClient (baixa da internet)', 'HttpClient (downloads from the internet)'],
  ['Marshal (executa código nativo da memória)', 'Marshal (runs native code from memory)'],
  ['CreateDecryptor (decifra conteúdo)', 'CreateDecryptor (decrypts content)'],
  ['RegistryKey.SetValue (grava no registro)', 'RegistryKey.SetValue (writes to the registry)'],
  [
    'Carrega assembly da memória (Assembly.Load): típico de carregador .NET.',
    'Loads an assembly from memory (Assembly.Load): typical of a .NET loader.',
  ],
  [
    'Nomes de tipos e métodos ilegíveis: provável ofuscação.',
    'Unreadable type and method names: likely obfuscation.',
  ],
  [
    'Chama APIs nativas sensíveis por P/Invoke: {0}.',
    'Calls sensitive native APIs through P/Invoke: {0}.',
  ],
  ['Ofuscado com {0}.', 'Obfuscated with {0}.'],
  ['nome forte', 'strong name'],
  ['entrada nativa', 'native entry point'],
  ['32 bits preferido', '32-bit preferred'],
  ['Process.Start (executa programa)', 'Process.Start (runs a program)'],

  // ---- Assinatura Authenticode (pe-authenticode.ts) ----
  ['Tabela de assinatura grande demais para ler.', 'Signature table too large to read.'],
  [
    'A tabela de assinatura passa do fim do arquivo.',
    'The signature table goes past the end of the file.',
  ],
  [
    'A tabela de assinatura não traz uma assinatura PKCS#7.',
    'The signature table does not hold a PKCS#7 signature.',
  ],
  ['Assinatura em formato desconhecido.', 'Signature in an unknown format.'],
  ['A assinatura não é Authenticode.', 'The signature is not Authenticode.'],
  ['A assinatura não traz o hash do arquivo.', 'The signature does not carry the file hash.'],
  ['Assinatura malformada.', 'Malformed signature.'],
  [
    'O certificado de quem assinou não veio no arquivo.',
    "The signer's certificate is not in the file.",
  ],

  // ---- ELF (elf-analysis.ts) ----
  ['tabela de seções fora do arquivo', 'section table outside the file'],
  [
    'sem tabela de seções (comum em malware e em binário empacotado)',
    'no section table (common in malware and packed binaries)',
  ],
  ['segmento gravável e executável', 'writable and executable segment'],
  ['pilha executável', 'executable stack'],
  ['objeto realocável', 'relocatable object'],
  ['executável', 'executable'],
  ['executável (PIE)', 'executable (PIE)'],
  ['biblioteca compartilhada', 'shared library'],
  ['{0} seções declaradas (lidas {1})', '{0} sections declared ({1} read)'],

  // ---- Atalho (lnk-analysis.ts) ----
  [
    'Abre um interpretador de comandos ou binário do sistema usado em ataques.',
    'Opens a command interpreter or a system binary used in attacks.',
  ],
  [
    'Argumentos começam com muitos espaços (escondem o comando na janela de propriedades).',
    'Arguments start with many spaces (they hide the command in the properties window).',
  ],
  ['Argumentos com endereço da internet.', 'Arguments with an internet address.'],
  [
    'Argumentos longos ({0} caracteres): comando escondido.',
    'Long arguments ({0} characters): hidden command.',
  ],
  [
    'Abre minimizado (a vítima não vê a janela).',
    'Opens minimized (the victim does not see the window).',
  ],
  [
    'Ícone de outro tipo de arquivo (disfarça o atalho como documento).',
    'Icon of another file type (it disguises the shortcut as a document).',
  ],

  // ---- Imagem de disco (disk-image.ts) ----
  ['VHDX: o conteúdo não é listado.', 'VHDX: the content is not listed.'],
  [
    'VHD dinâmico ou diferencial: o conteúdo não é listado.',
    'Dynamic or differencing VHD: the content is not listed.',
  ],
  ['VHD com NTFS: o conteúdo não é listado.', 'VHD with NTFS: the content is not listed.'],
  ['VHD sem partição FAT reconhecida.', 'VHD without a recognized FAT partition.'],
  [
    'UDF sem ISO 9660: o conteúdo não é listado.',
    'UDF without ISO 9660: the content is not listed.',
  ],
  ['{0} deles oculto(s).', '{0} of them hidden.'],
  [
    'Atalho (.lnk) visível com arquivos ocultos: padrão comum de entrega de malware.',
    'Visible shortcut (.lnk) with hidden files: a common malware delivery pattern.',
  ],
  [
    '{0} arquivo(s) executável(is) ou de script dentro da imagem (ex.: {1}).',
    '{0} executable or script file(s) inside the image (e.g. {1}).',
  ],

  // ---- Documento (doc-analysis.ts) ----
  ['Contém JavaScript.', 'Contains JavaScript.'],
  ['Ação "Launch": pode abrir programas.', '"Launch" action: it can open programs.'],
  [
    'Ação automática ao abrir ou interagir (OpenAction/AA).',
    'Automatic action on open or interaction (OpenAction/AA).',
  ],
  ['Formulário XFA (pode conter scripts).', 'XFA form (it can contain scripts).'],
  [
    'Criptografado: parte do conteúdo pode não ter sido lida.',
    'Encrypted: part of the content may not have been read.',
  ],
  ['{0} link(s) no documento.', '{0} link(s) in the document.'],
  ['Contém macros VBA ({0} módulo(s)){1}.', 'Contains VBA macros ({0} module(s)){1}.'],
  ['; executam ao abrir: {0}', '; they run on open: {0}'],
  ['Template remoto (baixado ao abrir): {0}', 'Remote template (downloaded on open): {0}'],
  ['{0} objeto(s) OLE embutido(s){1}.', '{0} embedded OLE object(s){1}.'],
  [' com atualização automática (\\objupdate)', ' with automatic update (\\objupdate)'],
  ['não é OLE', 'not OLE'],
  ['setor fora do arquivo', 'sector outside the file'],
  ['container VBA inválido', 'invalid VBA container'],
  ['{0} arquivo(s) embutido(s).', '{0} embedded file(s).'],
  ['OLE incomum', 'unusual OLE'],
  ['VBA corrompido', 'corrupted VBA'],
  ['VBA grande demais', 'VBA too large'],
  ['Chamadas suspeitas nas macros: {0}.', 'Suspicious calls in the macros: {0}.'],
  ['Campo DDE (pode executar comandos).', 'DDE field (it can run commands).'],
  ['{0} objeto(s) embutido(s).', '{0} embedded object(s).'],
  ['{0} link(s) externo(s).', '{0} external link(s).'],
  ['{0} objeto(s)', '{0} object(s)'],

  // ---- oletools (oletools.ts) ----
  ['executa ao abrir', 'runs on open'],
  [
    'Contém macros XLM 4.0 (Excel 4), muito usadas por malware.',
    'Contains XLM 4.0 macros (Excel 4), widely used by malware.',
  ],
  [
    'VBA stomping: o código-fonte não bate com o compilado (o que roda não é o que se vê).',
    'VBA stomping: the source code does not match the compiled code (what runs is not what you see).',
  ],
  [
    'Documento cifrado: parte da análise pode não ter visto o conteúdo.',
    'Encrypted document: part of the analysis may not have seen the content.',
  ],
  ['Campo DDE (executa comandos sem macro): {0}', 'DDE field (runs commands without a macro): {0}'],
  [
    'Objeto {0} no RTF: o Equation Editor é alvo de exploits conhecidos (CVE-2017-11882).',
    'Object {0} in the RTF: the Equation Editor is a target of known exploits (CVE-2017-11882).',
  ],
  ['{0} objeto(s) embutido(s) no RTF.', '{0} embedded object(s) in the RTF.'],
  ['grava arquivos', 'writes files'],
  ['executa programas', 'runs programs'],
  ['Macro suspeita pelo MacroRaptor: {0}.', 'Macro flagged by MacroRaptor: {0}.'],
  ['Contém macros VBA ({0} módulo(s)).', 'Contains VBA macros ({0} module(s)).'],
  ['{0} indicador(es) nas macros.', '{0} indicator(s) in the macros.'],
  ['{0} texto(s) ofuscado(s) decodificado(s).', '{0} obfuscated text(s) decoded.'],

  // ---- Motivos de falha das analises em segundo plano (capa, Ghidra, oletools, unpack) ----
  ['falha interna na análise', 'internal analysis failure'],
  ['falha interna ao desempacotar', 'internal unpacking failure'],
  ['o arquivo não está mais disponível', 'the file is no longer available'],
  ['não foi possível ler o arquivo no armazenamento', 'could not read the file from storage'],
  ['não foi possível gravar o projeto no armazenamento', 'could not write the project to storage'],
  ['resposta do serviço em formato inesperado', 'service answer in an unexpected format'],
  ['o capa não produziu resultado', 'capa produced no result'],
  ['a análise falhou', 'the analysis failed'],
  ['sem manifest.json', 'no manifest.json'],
  ['faltou na resposta', 'missing from the answer'],
  ['não foi possível ler os bytes', 'could not read the bytes'],
  ['igual à própria amostra', 'same as the sample itself'],
  [
    'só identificado: já há duas gerações desempacotadas acima',
    'only identified: there are already two unpacked generations above',
  ],
  [
    'UPX sem a marca UPX! (disfarçado): o upx não desempacota sem ela',
    'UPX without the UPX! mark (disguised): upx does not unpack without it',
  ],
  [
    'protegido com {0} (Detect It Easy): precisa de um desempacotador que execute a amostra',
    'protected with {0} (Detect It Easy): it needs an unpacker that runs the sample',
  ],
  [
    'empacotado com {0} (Detect It Easy): nenhum desempacotador estático para ele',
    'packed with {0} (Detect It Easy): no static unpacker for it',
  ],
  ['maior que {0} MB', 'larger than {0} MB'],
  [
    'falha ao criar as amostras filhas ({0} de {1} criadas)',
    'failed to create the child samples ({0} of {1} created)',
  ],
  ['o serviço respondeu {0}', 'the service answered {0}'],
  ['interrompida (a API reiniciou)', 'interrupted (the API restarted)'],
  ['interrompido (a API reiniciou)', 'interrupted (the API restarted)'],
  ['nada a desempacotar', 'nothing to unpack'],
  ['manifesto inesperado', 'unexpected manifest'],
  // Historico da amostra (parte 3): o evento de arquivos extraidos.
  ['{0} arquivo(s) pelo desempacotador {1}', '{0} file(s) by the {1} unpacker'],
  // Ghidra: por que a amostra nao pode ser analisada (aparece na ficha).
  ['Só arquivos.', 'Files only.'],
  [
    'Executável .NET: o Ghidra não descompila o código intermediário (IL).',
    '.NET executable: Ghidra does not decompile the intermediate code (IL).',
  ],

  // ---- Tipo do arquivo (file-type.ts) ----
  ['Executável do Windows (PE)', 'Windows executable (PE)'],
  ['Executável Linux (ELF)', 'Linux executable (ELF)'],
  ['Executável macOS (Mach-O)', 'macOS executable (Mach-O)'],
  ['Ajuda compilada (CHM)', 'Compiled help (CHM)'],
  ['Aplicativo Android (APK)', 'Android app (APK)'],
  ['Apresentação PowerPoint (OOXML)', 'PowerPoint presentation (OOXML)'],
  ['Arquivo 7-Zip', '7-Zip archive'],
  ['Arquivo CAB', 'CAB archive'],
  ['Arquivo GZIP', 'GZIP archive'],
  ['Arquivo RAR', 'RAR archive'],
  ['Arquivo ZIP', 'ZIP archive'],
  ['Atalho do Windows (LNK)', 'Windows shortcut (LNK)'],
  ['Documento Office antigo / MSI (OLE)', 'Legacy Office document / MSI (OLE)'],
  ['Documento PDF', 'PDF document'],
  ['Documento RTF', 'RTF document'],
  ['Documento Word (OOXML)', 'Word document (OOXML)'],
  ['Imagem de disco (ISO)', 'Disk image (ISO)'],
  ['Imagem GIF', 'GIF image'],
  ['Imagem JPEG', 'JPEG image'],
  ['Imagem PNG', 'PNG image'],
  ['Pacote Java (JAR)', 'Java package (JAR)'],
  ['Página HTML', 'HTML page'],
  ['Planilha Excel (OOXML)', 'Excel spreadsheet (OOXML)'],
  ['Script com interpretador (#!)', 'Script with an interpreter (#!)'],

  // ---- Script (script-analysis.ts): o motivo de cada achado ----
  ['executa texto como código', 'runs text as code'],
  ['baixa conteúdo da internet', 'downloads content from the internet'],
  ['cliente HTTP usado para baixar', 'HTTP client used to download'],
  ['baixa arquivos em segundo plano', 'downloads files in the background'],
  [
    'baixa ou decodifica arquivo com ferramenta do Windows',
    'downloads or decodes a file with a Windows tool',
  ],
  ['faz requisição HTTP', 'makes an HTTP request'],
  ['grava o que foi baixado em arquivo', 'writes what was downloaded to a file'],
  ['executa comandos do sistema', 'runs system commands'],
  ['cria objeto COM (acesso ao sistema)', 'creates a COM object (system access)'],
  ['executa código por binário confiável do Windows', 'runs code through a trusted Windows binary'],
  ['esconde o comando em Base64', 'hides the command in Base64'],
  ['roda com a janela oculta', 'runs with a hidden window'],
  ['ignora a política de execução', 'ignores the execution policy'],
  ['Exclusão/desligar o Defender', 'Exclusion/turning off Defender'],
  ['tenta escapar do antivírus', 'tries to evade the antivirus'],
  ['Desvio do AMSI', 'AMSI bypass'],
  ['desliga a inspeção de scripts do Windows', "turns off Windows's script inspection"],
  ['Apagar cópias de sombra', 'Deleting shadow copies'],
  ['típico de ransomware', 'typical of ransomware'],
  ['Run/Tarefa agendada/Inicializar', 'Run/Scheduled task/Startup'],
  ['fica ativo depois de reiniciar (persistência)', 'stays active after a restart (persistence)'],
  ['decodifica conteúdo escondido', 'decodes hidden content'],
  ['inicia outro programa', 'starts another program'],
  ['esconde arquivos', 'hides files'],
  ['decodifica texto escondido', 'decodes hidden text'],
  ['Lote (BAT/CMD)', 'Batch (BAT/CMD)'],
  ['HTA (aplicativo HTML)', 'HTA (HTML application)'],
  ['Base64 (bloco)', 'Base64 (block)'],
  ['monta texto a partir de códigos (ofuscação)', 'builds text from character codes (obfuscation)'],
  [
    'monta texto caractere a caractere (ofuscação)',
    'builds text one character at a time (obfuscation)',
  ],

  // ---- Reputacao externa (reputation.ts): nome dos servicos e resumo do resultado ----
  ['Registro (RDAP)', 'Registration (RDAP)'],
  ['Certificados (crt.sh)', 'Certificates (crt.sh)'],
  ['DNS passivo (VirusTotal)', 'Passive DNS (VirusTotal)'],
  ['não encontrado na base', 'not found in the database'],
  ['malware conhecido', 'known malware'],
  ['consultando...', 'checking...'],
  ['resposta inválida', 'invalid answer'],
  ['chave recusada pelo serviço', 'key refused by the service'],
  ['limite de consultas do serviço atingido', 'service query limit reached'],
  ['o serviço não respondeu a tempo', 'the service did not answer in time'],
  ['{0}/{1} motores detectaram{2}', '{0}/{1} engines detected{2}'],
  ['visto em {0}', 'seen on {0}'],
  [
    '{0} URL(s) de malware conhecida(s) neste host · {1} online',
    '{0} known malware URL(s) on this host · {1} online',
  ],
  ['confiança de abuso {0}%', 'abuse confidence {0}%'],
  ['confiança {0}%', 'confidence {0}%'],
  ['{0} denúncia(s) em 90 dias', '{0} report(s) in 90 days'],
  ['falha na consulta{0}', 'lookup failed{0}'],

  // ---- Atualizacao dos pacotes YARA (yara-update.ts): motivos de ter ficado retida ----
  ['o pacote tem arquivos demais', 'the pack has too many files'],
  [
    'A licença da fonte mudou: é preciso ler antes de aceitar.',
    'The source license changed: it must be read before accepting.',
  ],
  [
    'Mudança grande: {0} de {1} conjuntos alterados ou removidos.',
    'Large change: {0} of {1} rule sets changed or removed.',
  ],
  ['Regra nova dispara em amostra Limpa: {0}.', 'New rule fires on a Clean sample: {0}.'],
  ['Compilação mais lenta: de {0} ms para {1} ms.', 'Slower compilation: from {0} ms to {1} ms.'],
  ['{0}: atualização retida para aprovação', '{0}: update held for approval'],

  // ---- Importacao de indicadores (ioc-import.ts): por que uma linha ficou de fora ----
  ['URL inválida (só http e https)', 'Invalid URL (http and https only)'],
  ['faixa de IPs só vale na lista de permissões', 'IP ranges are only valid on the allowlist'],
  ['IP privado não aparece nos relatórios', 'A private IP does not show up in reports'],
  ['não é um indicador reconhecido', 'not a recognized indicator'],
  ['pattern sem indicador suportado', 'pattern without a supported indicator'],
  ['domínio', 'domain'],
  ['não é um {0} válido', 'not a valid {0}'],
  ['linha {0}', 'line {0}'],
  ['linha acima de {0} caracteres', 'line over {0} characters'],
  ['pattern {0} não é lido', 'pattern {0} is not read'],

  // Por ultimo: casaria com "empacotado com {0} (Detect It Easy): ..." (unpack) se viesse antes.
  ['empacotado com {0}', 'packed with {0}'],
];
