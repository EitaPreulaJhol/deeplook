import { define, type Pairs } from './core';

/** Textos da area "sandbox" (revisao de novembro, 2.5). */
export const messages = {
  consultingEnv: ['Consultando o ambiente...', 'Checking the environment...'],
  title: ['Ambiente isolado', 'Isolated environment'],
  disabled: [
    'O sandbox (VM isolada no Proxmox) não está habilitado neste servidor.',
    'The sandbox (isolated VM in Proxmox) is not enabled on this server.',
  ],
  noActive: ['nenhum ambiente ativo', 'no active environment'],
  intro: [
    'Cria um clone do template no Proxmox com a amostra dentro (CD-ROM somente leitura) e abre o console em uma janela dedicada. O ambiente é destruído automaticamente no fim do prazo.',
    'Creates a clone of the template in Proxmox with the sample inside (read-only CD-ROM) and opens the console in a dedicated window. The environment is destroyed automatically at the end of the time limit.',
  ],
  popupBlocked: [
    'Pop-up bloqueado. Permita pop-ups para este site e clique em “Abrir ambiente isolado” novamente.',
    'Pop-up blocked. Allow pop-ups for this site and click “Open isolated environment” again.',
  ],
  opening: ['Abrindo...', 'Opening...'],
  openEnv: ['Abrir ambiente isolado', 'Open isolated environment'],
  shuttingDown: [
    'Desligando a VM e apagando a ISO da amostra...',
    'Shutting down the VM and deleting the sample ISO...',
  ],
  preparing: ['preparando o ambiente', 'preparing the environment'],
  takesMoment: ['Isso leva alguns instantes.', 'This takes a few moments.'],
  waitingQueue: [
    'Aguardando uma vaga na fila de provisionamento.',
    'Waiting for a slot in the provisioning queue.',
  ],
  expiresIn: ['expira em {time}', 'expires in {time}'],
  runningHelp: [
    'A amostra está no CD-ROM da VM (somente leitura), junto com o SHA-256 e um LEIA-ME. O console abre em uma janela dedicada (com a toolbar de controle da VM). Não exponha esta VM à rede.',
    "The sample is in the VM's CD-ROM (read-only), together with the SHA-256 and a README. The console opens in a dedicated window (with the VM control toolbar). Do not expose this VM to the network.",
  ],
  popupBlockedConsole: [
    'Pop-up bloqueado. Permita pop-ups para este site e clique em “Abrir console” novamente.',
    'Pop-up blocked. Allow pop-ups for this site and click “Open console” again.',
  ],
  openConsole: ['Abrir console (nova janela)', 'Open console (new window)'],
  extendTime: ['Estender prazo', 'Extend time'],
  discardEnv: ['Descartar ambiente', 'Discard environment'],
  discardConfirm: [
    'Deseja realmente descartar o ambiente? A VM e a ISO da amostra serão destruídas e o console será desconectado.',
    'Do you really want to discard the environment? The VM and the sample ISO will be destroyed and the console will be disconnected.',
  ],
  discard: ['Descartar', 'Discard'],
  envFailed: ['Falha no ambiente: {error}', 'Environment failure: {error}'],
  envExpired: [
    'O prazo do ambiente terminou e a VM foi destruída.',
    'The environment time ran out and the VM was destroyed.',
  ],
  envClosed: [
    'Ambiente encerrado: a VM e a ISO da amostra foram removidas.',
    'Environment closed: the VM and the sample ISO were removed.',
  ],
  openNewEnv: ['Abrir novo ambiente', 'Open a new environment'],
  consoleSessionEnded: ['Sessão do console encerrada.', 'Console session ended.'],
  passwordUnavailable: ['senha indisponível', 'password unavailable'],
  authFailed: [
    'Falha ao autenticar no console: {error}',
    'Failed to authenticate on the console: {error}',
  ],
  noImageYet: [
    'Ainda não há imagem no console para capturar.',
    'There is no image on the console to capture yet.',
  ],
  captureFailedConsole: [
    'Não foi possível capturar a tela do console.',
    'Could not capture the console screen.',
  ],
  connecting: ['conectando ao console...', 'connecting to the console...'],
  connected: ['console conectado', 'console connected'],
  disconnected: ['console desconectado', 'console disconnected'],
  consoleFailure: ['falha no console', 'console failure'],
  pastePlaceholder: ['Texto para colar na VM', 'Text to paste into the VM'],
  paste: ['Colar', 'Paste'],
  reconnect: ['Reconectar', 'Reconnect'],
  consoleDisconnected: ['Console desconectado{detail}.', 'Console disconnected{detail}.'],
  firstCollect: [
    'A primeira coleta (print e processos) sai em até {n} s.',
    'The first collection (screenshot and processes) comes out within {n} s.',
  ],
  artifactsTitle: ['Artefatos do ambiente', 'Environment artifacts'],
  processesNote: ['Processos: {note}.', 'Processes: {note}.'],
  vmShotsAria: ['Prints da tela da VM', 'VM screen captures'],
  vmScreenAt: ['Tela da VM às {time}', 'VM screen at {time}'],
  shotsKept: [
    '{n} prints guardados; aqui, o primeiro e os mais recentes.',
    '{n} screenshots kept; here, the first and the most recent ones.',
  ],
  processesAppeared: [
    '{n} processo(s) surgiram desde a primeira listagem ({time}):',
    '{n} process(es) appeared since the first listing ({time}):',
  ],
  noNewProcesses: [
    'Nenhum processo novo desde a primeira listagem ({lists} listagem(ns), a última às {time}).',
    'No new process since the first listing ({lists} listing(s), the last at {time}).',
  ],
  appearedAria: ['Processos que surgiram', 'Processes that appeared'],
  parent: ['Pai', 'Parent'],
  process: ['Processo', 'Process'],
  commandLine: ['Linha de comando', 'Command line'],
  agentNote: [
    'É o que o próprio sistema da VM informa pelo agente: um malware pode esconder processos.',
    "It is what the VM's own system reports through the agent: malware can hide processes.",
  ],
  stRequested: ['solicitado', 'requested'],
  stProvisioning: ['provisionando', 'provisioning'],
  stRunning: ['em execução', 'running'],
  stStopping: ['encerrando', 'stopping'],
  stStopped: ['encerrado', 'stopped'],
  stExpired: ['expirado', 'expired'],
  stFailed: ['falhou', 'failed'],
  phQueue: ['na fila do Proxmox', 'in the Proxmox queue'],
  phIso: ['gerando a ISO com a amostra', 'building the ISO with the sample'],
  phUpload: ['enviando a ISO para o Proxmox', 'uploading the ISO to Proxmox'],
  phClone: ['clonando o template da VM', 'cloning the VM template'],
  phConfig: ['configurando a VM isolada', 'configuring the isolated VM'],
  phStart: ['ligando a VM', 'starting the VM'],
  phStop: ['encerrando o ambiente', 'shutting down the environment'],
  consoleTitle: ['Console · {title}', 'Console · {title}'],
  consoleNotReady: [
    'O console ainda não está disponível para captura.',
    'The console is not available for capture yet.',
  ],
  captureNotRendered: [
    'Não foi possível capturar a tela (o console ainda não renderizou).',
    'Could not capture the screen (the console has not rendered yet).',
  ],
  envNotFound: [
    'Ambiente não encontrado para esta amostra.',
    'Environment not found for this sample.',
  ],
  consoleDisabled: [
    'O console está desabilitado neste servidor.',
    'The console is disabled on this server.',
  ],
  waitingProvisioning: ['Aguardando o provisionamento...', 'Waiting for provisioning...'],
  captureScreen: ['Capturar tela', 'Capture screen'],
} as const satisfies Pairs;

export const t = define(messages);
