import { buildApp } from './app';
import { env, sandboxEnabled } from './env';
import { startAuditCheck } from './lib/audit-check';
import { startSessionCleanup } from './lib/auth';
import { startBackups } from './lib/backup';
import { startBackupSchedule } from './lib/backup-schedule';
import { startCapaQueue } from './lib/capa';
import { startDataKeyRekey } from './lib/data-key-rekey';
import { unpackChildCreator } from './lib/entry-create';
import { startGhidraQueue } from './lib/ghidra';
import { startIntegrityScrub } from './lib/integrity-scrub';
import { reindexIocs } from './lib/ioc-reindex';
import { backfillReportIocs } from './lib/iocs';
import { startLdapSweep } from './lib/ldap-sweep';
import { setLogger } from './lib/log';
import { network } from './lib/network';
import { startOletoolsQueue } from './lib/oletools';
import { failInterruptedCaptures } from './lib/page-capture';
import { backfillPeAnalysis } from './lib/pe-backfill';
import { prisma } from './lib/prisma';
import { startRetention } from './lib/retention';
import { ensureBucket } from './lib/s3';
import { initSandbox } from './lib/sandbox';
import { startSlaEscalation } from './lib/sla-escalation';
import { backfillTlsh } from './lib/tlsh-backfill';
import { startUnpackQueue } from './lib/unpack';
import { installYaraPacks } from './lib/yara-packs';
import { failInterruptedRetroscans } from './lib/yara-retro';
import { startYaraPackUpdates } from './lib/yara-update';

async function main() {
  // Montagem do app (rotas, plugins, ganchos, tratador de erro): src/app.ts, a mesma dos testes.
  const app = await buildApp({ logger: true });

  // Trabalhos de fundo (bucket, retencao, backup, sandbox) escrevem no logger
  // do Fastify a partir daqui, e nao mais em texto solto no console (item 1.3).
  setLogger(app.log);

  if (network.networks.length) {
    app.log.info({ trusted: network.networks }, '[rede] conexoes so da rede confiavel');
  } else {
    app.log.warn('[rede] TRUSTED_NETWORK vazio: a API aceita conexao de qualquer rede privada');
  }

  // IOCs dos relatorios publicados ainda nao indexados (aba Relacionadas).
  try {
    const indexed = await backfillReportIocs();
    if (indexed) app.log.info({ indexed }, 'IOCs de relatorios indexados');
  } catch (err) {
    app.log.error({ err }, 'Falha ao indexar IOCs dos relatorios');
  }

  // Garante o bucket do MinIO (com tentativas, pois pode demorar a subir).
  try {
    await ensureBucket();
  } catch (err) {
    app.log.error({ err }, 'Falha ao garantir bucket do MinIO');
  }

  // Pacotes de regras YARA (item 143): instala os ligados que ainda nao instalaram.
  try {
    const installed = await installYaraPacks();
    if (installed.length) app.log.info({ installed }, 'Pacotes de regras YARA instalados');
  } catch (err) {
    app.log.error({ err }, 'Falha ao instalar os pacotes de regras YARA');
  }

  startYaraPackUpdates(app.log);

  // Retencao de amostras: expurgo do arquivo apos RETENTION_DAYS (0 = desligada).
  startRetention(app.log);
  // Conferencia de integridade dos arquivos guardados, em segundo plano (item 4.2).
  startIntegrityScrub();
  startBackups(app.log);
  // Backup agendado (item 6.13): confere a cada minuto se chegou a hora.
  startBackupSchedule();
  startLdapSweep(app.log);
  startSessionCleanup(app.log);
  // Auditoria (revisao de novembro, 1.3): encadeia o historico e confere a cadeia de hora em hora.
  startAuditCheck(app.log);

  // Desligamento controlado (item 119): termina o que esta em andamento, com teto.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info(`${signal}: encerrando`);
      setTimeout(() => process.exit(1), 15_000).unref();
      void app.close().then(() => process.exit(0));
    });
  }
  if (env.RETENTION_DAYS) {
    app.log.info(
      `[retencao] ligada: arquivos expurgados ${env.RETENTION_DAYS} dia(s) após a conclusão`,
    );
  }

  // YARA retroativo interrompido por reinicio: marcado como falha (nao continua sozinho).
  const interrupted = await failInterruptedRetroscans();
  if (interrupted)
    app.log.warn(`[yara] ${interrupted} varredura(s) retroativa(s) interrompida(s).`);
  // Captura de pagina interrompida por reinicio (item 80): marcada como falha.
  const captures = await failInterruptedCaptures();
  if (captures) app.log.warn(`[captura] ${captures} captura(s) interrompida(s).`);

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(`DeepLook API ouvindo em http://0.0.0.0:${env.PORT}`);

  // TLSH das amostras antigas (item 71) e, depois dele, a reanalise dos executaveis antigos
  // (item 7.1), em segundo plano e um de cada vez.
  void backfillTlsh(app.log).then(() => backfillPeAnalysis(app.log));

  // Analise de funcoes (item 7.2): fila do capa e do FLOSS, um executavel por vez.
  void startCapaQueue(app.log).catch((err) => app.log.error({ err }, '[capa] fila não subiu'));
  // Analise com o Ghidra (item 7.3): fila das analises pedidas, uma por vez.
  void startGhidraQueue(app.log).catch((err) => app.log.error({ err }, '[ghidra] fila não subiu'));
  // Desempacotar e extrair (item 7.8): a fila cria as filhas pelo mesmo caminho de um envio.
  void startUnpackQueue(app.log, unpackChildCreator(app.log)).catch((err) =>
    app.log.error({ err }, '[unpack] fila não subiu'),
  );

  // Chave de dados: recifra com o DATA_KEY atual o 2FA que ainda esta sob outra chave.
  void startDataKeyRekey(app.log);

  // Office e PDF mais fundo (item 7.14): fila do oletools, um documento por vez.
  void startOletoolsQueue(app.log).catch((err) =>
    app.log.error({ err }, '[oletools] fila não subiu'),
  );

  // URL e IPv6 nos indicadores ja gravados (item 165), em segundo plano, uma vez.
  void reindexIocs(app.log);

  // Escalonamento por prazo (item 73): avisos de alerta/atraso a cada 5 minutos.
  startSlaEscalation(app.log);

  // Sandbox: recupera provisionamentos travados, limpa orfaos e liga o reaper,
  // em segundo plano (o Proxmox fora do ar nao segura o login).
  if (sandboxEnabled) {
    app.log.info(
      `[sandbox] habilitado (node ${env.PROXMOX_NODE}, template ${env.PROXMOX_TEMPLATE_VMID}, ttl ${env.SANDBOX_TTL_MINUTES}min${env.PROXMOX_MOCK === 'true' ? ', MOCK' : ''}); limpeza inicial em andamento`,
    );
    void initSandbox(app.log);
  }
}

main().catch((err) => {
  // Console de proposito: aqui o Fastify pode nem ter chegado a existir.
  console.error('[fatal]', err);
  prisma.$disconnect().finally(() => process.exit(1));
});
