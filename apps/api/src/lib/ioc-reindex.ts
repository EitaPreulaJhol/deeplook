import { normalizeUrl, urlKey } from './ioc-normalize';
import { rememberUrls, syncReportIocs } from './iocs';
import { prisma } from './prisma';
import { readSetting, writeSetting } from './settings';

const KEY = 'iocIndexVersion';
/** 2: URL e IPv6 como indicador, e-mail e dominio da query fora (item 165). */
const VERSION = 2;
const PAGE = 200;

/**
 * Reindexa o que ja existia quando a extracao muda: a chave do link das amostras e os
 * IOCs dos relatorios publicados, sem avisar quem segue (nao sao aparicoes novas). Em
 * segundo plano, depois de a API comecar a responder; se cair no meio, recomeca.
 */
export async function reindexIocs(log: {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}): Promise<void> {
  try {
    const stored = (await readSetting(KEY)) as { version?: number } | null;
    if ((stored?.version ?? 1) >= VERSION) return;

    let links = 0;
    for (let cursor: string | undefined; ;) {
      const page = await prisma.entry.findMany({
        where: { type: 'URL', url: { not: null } },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: { id: true, url: true },
      });
      if (!page.length) break;
      for (const entry of page) {
        const value = normalizeUrl(entry.url!);
        if (value) await rememberUrls(prisma, [{ kind: 'URL', value }]);
        await prisma.entry.update({
          where: { id: entry.id },
          data: { urlKey: value ? urlKey(value) : null },
        });
        links++;
      }
      cursor = page[page.length - 1].id;
    }

    let reports = 0;
    for (let cursor: string | undefined; ;) {
      const page = await prisma.report.findMany({
        where: { status: 'PUBLISHED', iocs: { not: null } },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        select: { id: true },
      });
      if (!page.length) break;
      for (const report of page) {
        await syncReportIocs(prisma, report.id, { notify: false });
        reports++;
      }
      cursor = page[page.length - 1].id;
    }

    await writeSetting(KEY, { version: VERSION });
    log.info({ links, reports }, 'Indicadores reindexados (URL e IPv6)');
  } catch (err) {
    log.error({ err }, 'Falha ao reindexar os indicadores');
  }
}
