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
    'A data do cabeçalho ({0}) não bate com a do diretório de debug ({1}): a data de compilação foi alterada.',
    'The header date ({0}) does not match the debug directory date ({1}): the compile date was changed.',
  ],
  [
    'A data do cabeçalho ({0}) não bate com a da tabela de exportações ({1}): a data de compilação foi alterada.',
    'The header date ({0}) does not match the export table date ({1}): the compile date was changed.',
  ],
  [
    'Os recursos têm data posterior à compilação ({0}): foram editados depois.',
    'The resources are dated after the compilation ({0}): they were edited later.',
  ],
  [
    'Compilado na configuração Debug (caminho do PDB).',
    'Built in the Debug configuration (PDB path).',
  ],
  // ---- PDF (doc-analysis.ts, delivery-formats.ts; item 8) ----
  ['Link com javascript:.', 'Link with javascript:.'],
  [
    'Envia os dados do formulário para fora (SubmitForm): típico de phishing em PDF.',
    'Sends the form data out (SubmitForm): typical of PDF phishing.',
  ],
  [
    'Abre outro documento ou anexo (GoToR/GoToE).',
    'Opens another document or attachment (GoToR/GoToE).',
  ],
  ['Importa dados de fora (ImportData).', 'Imports outside data (ImportData).'],
  ['Conteúdo RichMedia (Flash ou vídeo).', 'RichMedia content (Flash or video).'],
  [
    'Imagem JBIG2: formato de exploits conhecidos do leitor de PDF.',
    'JBIG2 image: a format of known PDF reader exploits.',
  ],
  [
    'Cifrado ({0}) com senha de usuário vazia: decifrado para a análise.',
    'Encrypted ({0}) with an empty user password: decrypted for the analysis.',
  ],
  ['PDF com {0} embutido ({1})', 'PDF with an embedded {0} ({1})'],
  ['Arquivo embutido no PDF: {0}', 'File embedded in the PDF: {0}'],
  // ---- Abuso conhecido (lol/index.ts) ----
  ['Driver malicioso conhecido (LOLDrivers): {0}.', 'Known malicious driver (LOLDrivers): {0}.'],
  [
    'Driver vulnerável conhecido (LOLDrivers): {0}. É usado para desligar o antivírus a partir do kernel (BYOVD).',
    'Known vulnerable driver (LOLDrivers): {0}. It is used to turn off the antivirus from the kernel (BYOVD).',
  ],
  [
    'Ferramenta de acesso remoto legítima (LOLRMM): {0}. Entregue por e-mail ou link, é golpe comum.',
    'Legitimate remote access tool (LOLRMM): {0}. Delivered by email or link, it is a common scam.',
  ],
  [
    'Binário do sistema usado para baixar ou executar carga: {0}.',
    'System binary used to download or run a payload: {0}.',
  ],
  // ---- Criptografia e codificacao (crypto-scan.ts) ----
  ['S-box inversa', 'inverse S-box'],
  ['tabela Te0', 'Te0 table'],
  ['tabela Te0 (big-endian)', 'Te0 table (big-endian)'],
  ['constante "expand 32-byte k"', '"expand 32-byte k" constant'],
  ['constante "expand 16-byte k"', '"expand 16-byte k" constant'],
  ['constantes T', 'T constants'],
  ['valores iniciais', 'initial values'],
  ['constantes K', 'K constants'],
  ['P-array inicial (dígitos de pi)', 'initial P-array (digits of pi)'],
  ['delta 0x9E3779B9', '0x9E3779B9 delta'],
  ['constantes P32 e Q32', 'P32 and Q32 constants'],
  ['chave pública RSA (PUBLICKEYBLOB do CryptoAPI)', 'RSA public key (CryptoAPI PUBLICKEYBLOB)'],
  ['chave privada RSA (PRIVATEKEYBLOB do CryptoAPI)', 'RSA private key (CryptoAPI PRIVATEKEYBLOB)'],
  ['chave RSA (BCRYPT_RSAKEY_BLOB do CNG)', 'RSA key (CNG BCRYPT_RSAKEY_BLOB)'],
  ['chave pública em PEM', 'PEM public key'],
  ['chave RSA em PEM', 'PEM RSA key'],
  [
    'Chave RSA embutida na posição 0x{0}: típico de ransomware e de carregador que confere a carga.',
    'RSA key embedded at offset 0x{0}: typical of ransomware and of loaders that verify their payload.',
  ],
  ['[executável (MZ)]', '[executable (MZ)]'],
  [
    'Alfabeto Base64 próprio, que decodifica {0} string(s) do arquivo: texto escondido da extração comum.',
    'Custom Base64 alphabet, which decodes {0} string(s) of the file: text hidden from the usual extraction.',
  ],
  [
    'Alfabeto Base64 próprio: o programa codifica dados de um jeito que o Base64 comum não lê.',
    'Custom Base64 alphabet: the program encodes data in a way the usual Base64 does not read.',
  ],
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

  // ---- Mach-O (macho-analysis.ts) ----
  ['comandos de carga fora do arquivo', 'load commands outside the file'],
  ['comando de carga corrompido', 'corrupted load command'],
  ['sem segmentos de memória', 'no memory segments'],
  [
    'injeção em outro processo (task_for_pid e mach_vm_write)',
    'injection into another process (task_for_pid and mach_vm_write)',
  ],
  [
    '{0} funções de risco importadas (ver lista abaixo)',
    '{0} risky functions imported (see the list below)',
  ],
  ['sem assinatura de código', 'no code signature'],
  [
    'assinatura ad-hoc (sem certificado de desenvolvedor)',
    'ad-hoc signature (no developer certificate)',
  ],
  ['entitlements que afrouxam a proteção: {0}', 'entitlements that weaken the protection: {0}'],
  ['conteúdo criptografado (LC_ENCRYPTION_INFO)', 'encrypted content (LC_ENCRYPTION_INFO)'],
  [
    'código com entropia alta (possível empacotamento ou criptografia)',
    'high-entropy code (possible packing or encryption)',
  ],
  ['biblioteca de VM fixa', 'fixed VM library'],
  ['pré-carregado', 'preloaded'],
  ['biblioteca dinâmica', 'dynamic library'],
  ['carregador dinâmico', 'dynamic loader'],
  ['stub de biblioteca', 'library stub'],
  ['símbolos de depuração (dSYM)', 'debug symbols (dSYM)'],
  ['extensão de kernel', 'kernel extension'],
  ['plataforma {0}', 'platform {0}'],

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
  // Trabalho cancelado no Monitoramento (plans/monitoramento, itens 3 e 4).
  ['cancelado pela administração', 'cancelled by administration'],
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
  // Formatos de entrega: OneNote, HTML smuggling e MSI (delivery-formats.ts; plans/caca-e-formatos,
  // item 4). As variantes "(como SYSTEM)" vem antes das gerais.
  ['Caderno do OneNote', 'OneNote notebook'],
  ['Arquivo executável ou script anexado ({0})', 'Attached executable or script ({0})'],
  [
    'Imagem junto do anexo: o "clique duas vezes para ver" que esconde o arquivo',
    'Image next to the attachment: the "double-click to view" that hides the file',
  ],
  ['{0} arquivo(s) anexado(s)', '{0} attached file(s)'],
  [
    'HTML smuggling: monta {0} ({1}) no navegador e entrega como download',
    'HTML smuggling: assembles {0} ({1}) in the browser and delivers it as a download',
  ],
  ['Arquivo {0} embutido na página ({1})', '{0} file embedded in the page ({1})'],
  [
    'Monta um arquivo no navegador (Blob/download), mas a carga não foi decodificada',
    'Assembles a file in the browser (Blob/download), but the payload was not decoded',
  ],
  ['Ação {0} (como SYSTEM) roda: {1}', 'Action {0} (as SYSTEM) runs: {1}'],
  ['Ação {0} roda: {1}', 'Action {0} runs: {1}'],
  ['Ação {0} roda um programa (como SYSTEM)', 'Action {0} runs a program (as SYSTEM)'],
  ['Ação {0} roda um programa', 'Action {0} runs a program'],
  ['Ação {0} carrega {1} (como SYSTEM) ({2})', 'Action {0} loads {1} (as SYSTEM) ({2})'],
  ['Ação {0} carrega {1} ({2})', 'Action {0} loads {1} ({2})'],
  ['Ação {0}: {1} (como SYSTEM)', 'Action {0}: {1} (as SYSTEM)'],
  ['Ação {0}: {1}', 'Action {0}: {1}'],
  ['{0} da tabela Binary', '{0} from the Binary table'],
  ['{0} instalado pelo pacote', '{0} installed by the package'],
  ['EXE com linha de comando', 'EXE with a command line'],
  ['{0} embutido na ação', '{0} embedded in the action'],
  ['{0} indicado numa propriedade', '{0} named in a property'],
  ['Mensagem de erro', 'Error message'],
  ['Define um diretório', 'Sets a directory'],
  ['Define uma propriedade', 'Sets a property'],
  ['Instalação aninhada', 'Nested installation'],
  ['Tipo {0}', 'Type {0}'],
  ['adiada (durante a instalação)', 'deferred (during installation)'],
  ['como SYSTEM (sem personificação)', 'as SYSTEM (no impersonation)'],
  ['ignora erro', 'ignores errors'],
  ['assíncrona', 'asynchronous'],
  ['objeto {0}', 'object {0}'],
  ['ação {0}', 'action {0}'],
  // Java (jar.ts e apps/jarcfr/analyze.py)
  ['inicia outro programa ou comando do sistema', 'starts another program or system command'],
  [
    'carrega classes a partir de bytes ou de uma URL (carga em memória)',
    'loads classes from bytes or from a URL (in-memory loading)',
  ],
  ['chama métodos por reflexão', 'calls methods through reflection'],
  [
    'acessa a rede (download de carga ou envio de dados)',
    'accesses the network (payload download or data upload)',
  ],
  [
    'cifra ou decifra conteúdo (carga ou configuração cifrada)',
    'encrypts or decrypts content (encrypted payload or configuration)',
  ],
  [
    'carrega código nativo ou mexe na memória (Unsafe)',
    'loads native code or touches memory (Unsafe)',
  ],
  ['executa script (JavaScript) em tempo de execução', 'runs a script (JavaScript) at run time'],
  [
    'consulta JNDI (vetor de execução remota, como o Log4Shell)',
    'performs a JNDI lookup (remote execution vector, like Log4Shell)',
  ],
  ['desserializa objetos (execução por gadget)', 'deserializes objects (gadget execution)'],
  ['grava em local de inicialização (persistência)', 'writes to a startup location (persistence)'],
  ['tira print da tela ou captura teclas', 'takes screenshots or captures keystrokes'],
  [
    'lê o token da sessão do Minecraft (roubo de conta)',
    'reads the Minecraft session token (account theft)',
  ],
  ['agente Java ou anexa a outra JVM', 'Java agent or attaches to another JVM'],
  [
    'Agente Java ({0}): o JAR se anexa a outra JVM',
    'Java agent ({0}): the JAR attaches to another JVM',
  ],
  [
    '{0} classe(s) não foram descompiladas por completo (ofuscação ou bytecode incomum)',
    '{0} class(es) were not fully decompiled (obfuscation or unusual bytecode)',
  ],
  ['Arquivo embutido no JAR "{0}" ({1}).', 'File embedded in the JAR "{0}" ({1}).'],
  ['o arquivo não é um JAR válido (ZIP corrompido)', 'the file is not a valid JAR (corrupt ZIP)'],
  ['JAR com {0} entradas (limite {1})', 'JAR with {0} entries (limit {1})'],
  [
    'o conteúdo descompactado das classes passa do limite (possível bomba de descompressão)',
    'the uncompressed size of the classes is over the limit (possible decompression bomb)',
  ],
  ['o JAR não tem nenhuma classe Java', 'the JAR has no Java classes'],
  ['não é um JAR nem um .class', 'not a JAR or a .class file'],
  ['o CFR não descompilou o arquivo: {0}', 'CFR did not decompile the file: {0}'],
  ['o CFR não terminou em {0} s', 'CFR did not finish in {0} s'],
  // .NET (dotnet.ts e apps/dotnet/analyze.py; plans/caca-e-formatos, item 3)
  [
    'Ofuscado com {0}: a descompilação pode estar ilegível',
    'Obfuscated with {0}: the decompilation may be unreadable',
  ],
  [
    'Nomes ilegíveis: ofuscado por uma ferramenta não identificada',
    'Unreadable names: obfuscated by an unidentified tool',
  ],
  ['Recurso embutido {0}: {1}', 'Embedded {0} resource: {1}'],
  ['Recurso grande e cifrado (entropia {0}): {1}', 'Large encrypted resource (entropy {0}): {1}'],
  ['{0}: {1}, linha {2}', '{0}: {1}, line {2}'],
  [
    'Recurso embutido no assembly .NET "{0}" ({1}).',
    'Resource embedded in the .NET assembly "{0}" ({1}).',
  ],
  [
    'carrega um assembly a partir de bytes ou de um arquivo (carga em memória)',
    'loads an assembly from bytes or from a file (in-memory loading)',
  ],
  [
    'chama por reflexão um método carregado em tempo de execução',
    'calls through reflection a method loaded at run time',
  ],
  ['grava na chave Run do registro (persistência)', 'writes to the Run registry key (persistence)'],
  [
    'decifra conteúdo (carga ou configuração cifrada)',
    'decrypts content (encrypted payload or configuration)',
  ],
  ['decodifica conteúdo em Base64', 'decodes Base64 content'],
  [
    'mexe na memória de processos (injeção ou shellcode)',
    'touches process memory (injection or shellcode)',
  ],
  ['procura depurador (anti-análise)', 'looks for a debugger (anti-analysis)'],
  [
    'procura máquina virtual ou sandbox (anti-análise)',
    'looks for a virtual machine or sandbox (anti-analysis)',
  ],
  ['lê dados de navegador ou carteira (credenciais)', 'reads browser or wallet data (credentials)'],
  ['captura teclas', 'captures keystrokes'],
  ['tira print da tela', 'takes screenshots'],
  ['envia dados por Telegram ou Discord', 'sends data over Telegram or Discord'],
  ['mexe no Defender', 'tampers with Defender'],
  ['não é um assembly .NET (sem metadados do CLR)', 'not a .NET assembly (no CLR metadata)'],
  ['o ILSpy não descompilou o arquivo: {0}', 'ILSpy did not decompile the file: {0}'],
  ['o ILSpy não terminou em {0} s', 'ILSpy did not finish in {0} s'],
  ['não foi possível guardar o resultado', 'the result could not be stored'],
  ['data: ({0})', 'data: ({0})'],
  ['sem tipo', 'no type'],
  ['lista de bytes', 'byte list'],
  ['falha ao criar a amostra', 'failed to create the sample'],
  ['limite de {0} arquivos', 'limit of {0} files'],
  ['limite de tamanho somado', 'combined size limit'],
  ['manifesto inesperado', 'unexpected manifest'],
  // Historico da amostra (parte 3): o evento de arquivos extraidos.
  ['{0} arquivo(s) pelo desempacotador {1}', '{0} file(s) by the {1} unpacker'],
  // Ghidra: por que a amostra nao pode ser analisada (aparece na ficha).
  ['Só arquivos.', 'Files only.'],
  [
    'Executável .NET: o Ghidra não descompila o código intermediário (IL).',
    '.NET executable: Ghidra does not decompile the intermediate code (IL).',
  ],
  // Ghidra: por que o pseudo-C completo (plans/ghidra-pseudo-c) ou uma funcao dele faltou.
  ['o pseudo-C completo não foi gerado', 'the full pseudo-C was not generated'],
  ['pseudo-C completo acima de {0} MB', 'full pseudo-C above {0} MB'],
  ['pseudo-C completo acima do limite', 'full pseudo-C above the limit'],
  ['pseudo-C completo em formato inesperado', 'full pseudo-C in an unexpected format'],
  [
    'não foi possível gravar o pseudo-C no armazenamento',
    'could not write the pseudo-C to storage',
  ],
  ['sem resultado', 'no result'],

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
  ['Classe Java (.class)', 'Java class (.class)'],
  ['Extensão do Chrome (CRX)', 'Chrome extension (CRX)'],
  ['Pacote Electron (ASAR)', 'Electron package (ASAR)'],
  ['Bytecode Python (.pyc)', 'Python bytecode (.pyc)'],
  ['Pacote MSIX/AppX', 'MSIX/AppX package'],
  ['Extensão do Firefox (XPI)', 'Firefox extension (XPI)'],
  ['Manifesto ClickOnce', 'ClickOnce manifest'],
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
  // Desofuscacao mais funda (script-deobfuscate.ts; plans/novas-analises, item 5)
  ['Crase de escape (PowerShell)', 'Backtick escapes (PowerShell)'],
  ['Concatenação de literais', 'Literal concatenation'],
  ['Operador de formato -f', 'Format operator -f'],
  ['[char] e listas de códigos', '[char] and character code lists'],
  ['Substituição de texto (-replace/Replace)', 'Text replacement (-replace/Replace)'],
  ['Texto invertido', 'Reversed text'],
  ['Variável com valor fixo', 'Variable with a fixed value'],
  ['Circunflexo de escape (lote)', 'Caret escapes (batch)'],
  ['Variáveis do lote (set, %var:~a,b%)', 'Batch variables (set, %var:~a,b%)'],
  ['Escapes hexadecimais e Unicode (JavaScript)', 'Hex and Unicode escapes (JavaScript)'],
  ['Chr() no meio do texto', 'Chr() inside the text'],
  ['Lista de bytes', 'Byte list'],
  ['XOR de um byte (chave {0})', 'Single-byte XOR (key {0})'],
  // AutoIt (script-analysis.ts; plans/caca-e-formatos, item 5)
  ['DllCall de memória executável', 'DllCall for executable memory'],
  [
    'põe código na memória e o executa (shellcode ou PE carregado à mão)',
    'puts code in memory and runs it (shellcode or a hand-loaded PE)',
  ],
  [
    'reserva um buffer de bytes (costuma receber o shellcode)',
    'reserves a byte buffer (it usually receives the shellcode)',
  ],
  ['RegWrite na chave Run', 'RegWrite to the Run key'],
  ['decodifica ou decifra conteúdo escondido', 'decodes or decrypts hidden content'],
  [
    'grava no disco um arquivo embutido no executável',
    'writes a file embedded in the executable to disk',
  ],
  [
    'esconde o ícone da bandeja (roda sem o usuário perceber)',
    'hides the tray icon (runs without the user noticing)',
  ],
  ['PE em binário 0x', 'PE in a 0x binary'],
  [
    'o script traz um executável inteiro em hexadecimal (grava ou carrega na memória)',
    'the script carries a whole executable in hexadecimal (it writes it out or loads it into memory)',
  ],
  ['Binário 0x (AutoIt)', '0x binary (AutoIt)'],

  // ---- Emulacao (emulation.ts; plans/novas-analises, item 4) ----
  ['Injeta código em outro processo ({0}).', 'Injects code into another process ({0}).'],
  [
    'Contata a rede e abre outro programa: {0} → {1}',
    'Contacts the network and starts another program: {0} → {1}',
  ],
  ['Contata a rede: {0}', 'Contacts the network: {0}'],
  ['Abre outro programa: {0}', 'Starts another program: {0}'],
  ['Mexe numa chave de inicialização: {0}', 'Touches a startup key: {0}'],
  ['Grava {0} arquivo(s): {1}', 'Writes {0} file(s): {1}'],
  ['Checa se está sendo depurado.', 'Checks whether it is being debugged.'],
  [
    'Gera código em memória ({0} região(ões)): costuma ser desempacotamento.',
    'Generates code in memory ({0} region(s)): usually unpacking.',
  ],
  [
    'Nenhuma chamada de API emulada: o código pode depender de algo que o emulador não tem.',
    'No API call emulated: the code may depend on something the emulator does not have.',
  ],
  ['A emulação parou antes do fim: {0}', 'The emulation stopped before the end: {0}'],
  ['o Speakeasy não emulou o arquivo: {0}', 'Speakeasy did not emulate the file: {0}'],

  // ---- APK/Android (android.ts; plans/novas-analises, item 6) ----
  [
    'Acessibilidade com SMS: a combinação típica de trojan bancário (lê a tela e intercepta códigos).',
    'Accessibility with SMS: the typical banking trojan combination (reads the screen and intercepts codes).',
  ],
  [
    'Usa o serviço de acessibilidade (pode ler a tela e tocar por quem usa o aparelho).',
    'Uses the accessibility service (can read the screen and tap on behalf of the user).',
  ],
  [
    'Envia SMS (fraude por SMS pago, espalha links).',
    'Sends SMS (premium SMS fraud, spreads links).',
  ],
  [
    'Pede administrador do dispositivo (dificulta a remoção, pode bloquear a tela).',
    'Asks for device admin (makes removal harder, can lock the screen).',
  ],
  ['Carrega código em tempo de execução{0}.', 'Loads code at run time{0}.'],
  [
    'Desenha sobre outros aplicativos (telas falsas de login).',
    'Draws over other apps (fake login screens).',
  ],
  [
    'Lê as notificações (códigos de verificação, mensagens).',
    'Reads notifications (verification codes, messages).',
  ],
  ['Instala outros aplicativos.', 'Installs other apps.'],
  ['Grava ou transmite a tela.', 'Records or streams the screen.'],
  ['Executa comandos do sistema (ou procura o su).', 'Runs system commands (or looks for su).'],
  [
    'Assinado com o certificado de depuração do Android.',
    'Signed with the Android debug certificate.',
  ],
  [
    'O APK não está assinado (o Android não instala assim).',
    'The APK is not signed (Android will not install it).',
  ],
  ['{0} permissão(ões) perigosa(s): {1}', '{0} dangerous permission(s): {1}'],
  ['não foi possível ler o APK: {0}', 'could not read the APK: {0}'],
  [
    'o arquivo não é um APK válido (sem AndroidManifest.xml)',
    'the file is not a valid APK (no AndroidManifest.xml)',
  ],

  // ---- Configuracao de familias (config-extract.ts; plans/novas-analises, item 2) ----
  [
    'Configuração de {0} extraída (família identificada).',
    '{0} configuration extracted (family identified).',
  ],
  [
    'Regra do CAPE reconhece {0}, sem configuração extraída.',
    'A CAPE rule recognizes {0}, with no configuration extracted.',
  ],
  ['O extrator de {0} falhou: {1}', 'The {0} extractor failed: {1}'],

  // ---- Reputacao externa (reputation.ts): nome dos servicos e resumo do resultado ----
  ['Registro (RDAP)', 'Registration (RDAP)'],
  ['Certificados (crt.sh)', 'Certificates (crt.sh)'],
  ['DNS passivo (VirusTotal)', 'Passive DNS (VirusTotal)'],
  ['Arquivo conhecido (CIRCL hashlookup)', 'Known file (CIRCL hashlookup)'],
  ['arquivo conhecido ({0})', 'known file ({0})'],
  ['arquivo conhecido', 'known file'],
  ['confiança {0}', 'trust {0}'],
  ['{0} regra(s) YARA', '{0} YARA rule(s)'],
  ['sem informação', 'no information'],
  ['porta(s) {0}', 'port(s) {0}'],
  ['nenhuma porta aberta', 'no open port'],
  ['não encontrado na base', 'not found in the database'],
  ['malware conhecido', 'known malware'],
  ['consultando...', 'checking...'],
  ['resposta inválida', 'invalid answer'],
  ['chave recusada pelo serviço', 'key refused by the service'],
  ['limite de consultas do serviço atingido', 'service query limit reached'],
  ['o serviço não respondeu a tempo', 'the service did not answer in time'],
  ['{0}/{1} motores detectaram', '{0}/{1} engines detected'],
  ['família {0} ({1} antivírus)', 'family {0} ({1} antivirus)'],
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

  // ---- Leitor de QR code (apps/oletools/qr.py, plano pos-revisao 2.2): o motivo de uma falha ----
  ['imagem acima de {0} pixels', 'image over {0} pixels'],
  ['não foi possível ler o arquivo: {0}', 'could not read the file: {0}'],

  // ---- Artefatos do ambiente (sandbox-artifacts.ts, sysmon.ts): por que o agente nao trouxe nada ----
  [
    'sem permissão para usar o agente da VM no Proxmox (VM.GuestAgent.Unrestricted no PVE 9, VM.Monitor no 8)',
    'no permission to use the VM agent on Proxmox (VM.GuestAgent.Unrestricted on PVE 9, VM.Monitor on 8)',
  ],
  [
    'o qemu-guest-agent não respondeu na VM (instalado e rodando no template?)',
    'the qemu-guest-agent did not answer in the VM (installed and running in the template?)',
  ],
  ['o agente da VM falhou: {0}', 'the VM agent failed: {0}'],
  ['sem leitura', 'no reading'],
  [
    'o agente da VM não respondeu a tempo, nem repetindo (a amostra pode estar ocupando a VM)',
    'the VM agent did not answer in time, even when retried (the sample may be keeping the VM busy)',
  ],
  [
    'o agente da VM não confirmou a execução a tempo (VM ocupada); confira no console se a amostra rodou',
    'the VM agent did not confirm the run in time (VM busy); check in the console whether the sample ran',
  ],
  ['{0} não terminou a tempo', '{0} did not finish in time'],
  ['a listagem de processos', 'the process listing'],
  ['a leitura do Sysmon', 'the Sysmon read'],
  // Dump de memoria (sandbox-memdump.ts; plans/novas-analises, item 3)
  ['a leitura do dump', 'the dump read'],
  ['o dump de memória', 'the memory dump'],
  ['a limpeza do dump', 'the dump cleanup'],
  ['o processo já terminou', 'the process has already ended'],
  [
    'dump de {0} MB, acima do teto (SANDBOX_MEMDUMP_MAX_MB)',
    '{0} MB dump, above the cap (SANDBOX_MEMDUMP_MAX_MB)',
  ],
  ['o MiniDumpWriteDump falhou (erro {0})', 'MiniDumpWriteDump failed (error {0})'],
  [
    'resposta inesperada da VM ao tirar o dump',
    'unexpected answer from the VM while taking the dump',
  ],
  ['pedaço do dump com tamanho errado', 'dump chunk with the wrong size'],
  [
    'o dump chegou diferente do que a VM gravou (SHA-256)',
    'the dump arrived different from what the VM wrote (SHA-256)',
  ],
  [
    'o agente da VM não respondeu a tempo (VM ocupada)',
    'the VM agent did not answer in time (VM busy)',
  ],
  ['o dump não está mais no armazenamento', 'the dump is no longer in storage'],
  ['dump acima de {0} MB', 'dump above {0} MB'],
  ['não é um minidump legível: {0}', 'not a readable minidump: {0}'],
  [
    'Sysmon não instalado no template (canal Microsoft-Windows-Sysmon/Operational ausente)',
    'Sysmon not installed in the template (Microsoft-Windows-Sysmon/Operational channel missing)',
  ],
  ['resposta do Sysmon em formato inesperado', 'Sysmon answer in an unexpected format'],

  // ---- Captura de rede e Suricata (network-capture.ts, suricata.ts; plano pos-revisao 5.4) ----
  ['o netcap respondeu {0}{1}', 'netcap answered {0}{1}'],
  ['a VM não tem placa de rede com MAC (net0)', 'the VM has no network card with a MAC (net0)'],
  ['sniffer do MikroTik: {0}', 'MikroTik sniffer: {0}'],
  ['arquivo acima de {0} MB', 'file over {0} MB'],
  // Do servico (apps/suricata/server.py).
  ['o Suricata falhou: {0}', 'Suricata failed: {0}'],
  ['o arquivo não é um pcap', 'the file is not a pcap'],
  ['suricata-update falhou: {0}', 'suricata-update failed: {0}'],

  // ---- Execucao automatica da amostra (sandbox-autorun.ts) ----
  [
    'o agente da VM não respondeu a tempo; a amostra não foi executada',
    'the VM agent did not answer in time; the sample was not run',
  ],
  ['a execução automática é só para VMs Windows', 'automatic run is only for Windows VMs'],
  ['a amostra não foi encontrada no CD da VM', 'the sample was not found on the VM CD'],
  [
    'a tarefa que abre a amostra terminou com o código {0}',
    'the task that opens the sample ended with code {0}',
  ],
  [
    'resposta inesperada da VM ao executar a amostra',
    'unexpected VM answer when running the sample',
  ],
  [
    'a API reiniciou durante a execução; confira no console se a amostra rodou',
    'the API restarted during the run; check in the console whether the sample ran',
  ],
  ['a conferência do Sysmon', 'the Sysmon check'],
  ['a execução da amostra', 'the sample run'],

  // Por ultimo: casaria com "empacotado com {0} (Detect It Easy): ..." (unpack) se viesse antes.
  ['empacotado com {0}', 'packed with {0}'],
];
