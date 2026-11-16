import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOCK_SYSMON_EVENTS } from '../../src/lib/proxmox-mock';
import {
  parseSysmonRead,
  summarizeSysmon,
  type SummaryEvent,
  SYSMON_READ_MAX,
  sysmonCommand,
  sysmonIndicators,
  sysmonRow,
  sysmonWindowS,
  sysmonXPath,
} from '../../src/lib/sysmon';

// Sysmon no template (plano pos-revisao, item 5.3) e a leitura incremental
// (plans/sandbox-execucoes, fase 2): comando do agente, leitura e resumo dos eventos.

const script = (command: string[]) => Buffer.from(command[4], 'base64').toString('utf16le');
/** Os eventos de exemplo como o resumo os recebe (a hora da VM, sem diferenca de relogio). */
const asSummary = (events: { id: number; time?: string; data: object }[]): SummaryEvent[] =>
  events.map((e) => ({
    eventId: e.id,
    time: e.time ?? '',
    data: e.data as Record<string, unknown>,
  }));

test('comando: PowerShell em Base64 (UTF-16LE), com a hora da VM na saída', () => {
  const command = sysmonCommand({ windowS: 900 });
  assert.deepEqual(command.slice(0, 4), [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ]);
  const text = script(command);
  assert.ok(text.includes("$log = 'Microsoft-Windows-Sysmon/Operational'"));
  assert.ok(text.includes(`-FilterXPath $xpath -MaxEvents ${SYSMON_READ_MAX} -Oldest`));
  assert.ok(text.includes('rec = $e.RecordId'));
  assert.ok(text.includes('now = $now; events = $list'));
});

test('janela da primeira leitura: no relógio da VM (timediff), sem a hora da API', () => {
  const now = Date.parse('2026-11-13T12:10:00.000Z');
  // Os 600 s da sessao mais a folga de 300 s.
  const windowS = sysmonWindowS(new Date('2026-11-13T12:00:00.000Z'), now);
  assert.equal(windowS, 900);
  const xpath = sysmonXPath({ windowS });
  assert.equal(
    xpath,
    // Os eventos das regras Sigma (plans/novas-analises, item 1) tambem sao lidos.
    `*[System[(${[1, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 25, 26]
      .map((id) => `EventID=${id}`)
      .join(' or ')}) and TimeCreated[timediff(@SystemTime) <= 900000]]]`,
  );
  assert.ok(!script(sysmonCommand({ windowS })).includes('2026-11-13'));
});

test('leituras seguintes: a partir da hora do último evento guardado (da VM)', () => {
  const xpath = sysmonXPath({ after: new Date('2026-11-13T12:05:03.250Z') });
  assert.ok(xpath.endsWith('TimeCreated[@SystemTime>="2026-11-13T12:05:03.250Z"]]]'), xpath);
  // Dentro de aspas simples do PowerShell: o XPath so usa aspas duplas.
  assert.ok(!xpath.includes("'"));
});

test('leitura: eventos, a hora da VM e as linhas (com o ProcessGuid da árvore)', () => {
  const read = parseSysmonRead(
    JSON.stringify({ now: '2026-11-13T12:00:10.0000000Z', events: MOCK_SYSMON_EVENTS }),
  );
  assert.ok(read.available);
  if (!read.available) return;
  assert.equal(read.now, '2026-11-13T12:00:10.0000000Z');
  assert.equal(read.events.length, 6);
  const row = sysmonRow(read.events[1]);
  assert.equal(row.recordId, 102n);
  assert.equal(row.eventId, 1);
  assert.equal(row.time.toISOString(), '2026-11-13T12:00:02.000Z');
  assert.equal(row.processGuid, '{b0000000-0000-0000-0000-000000004512}');
  assert.equal(row.parentGuid, '{a0000000-0000-0000-0000-000000004410}');
});

test('um evento só (o ConvertTo-Json o devolve sem lista), nenhum, BOM e aviso antes', () => {
  const one = parseSysmonRead(JSON.stringify({ now: null, events: MOCK_SYSMON_EVENTS[2] }));
  assert.ok(one.available && one.events.length === 1);
  const none = parseSysmonRead(JSON.stringify({ now: '2026-11-13T12:00:00Z', events: [] }));
  assert.ok(none.available && none.events.length === 0);
  const noisy = parseSysmonRead(
    `\uFEFFAVISO: algo\r\n${JSON.stringify({ events: MOCK_SYSMON_EVENTS })}`,
  );
  assert.ok(noisy.available && noisy.events.length === 6);
  // Evento sem numero ou hora valida fica de fora.
  const bad = parseSysmonRead(
    JSON.stringify({ events: [{ id: 1, rec: 'x', time: 'ontem', data: {} }] }),
  );
  assert.ok(bad.available && bad.events.length === 0);
});

test('sem Sysmon e saída que não é JSON: indisponível, com o motivo', () => {
  const missing = parseSysmonRead('DEEPLOOK_SEM_SYSMON\r\n');
  assert.ok(!missing.available && missing.reason.includes('Sysmon não instalado'));
  const broken = parseSysmonRead('Get-WinEvent : erro');
  assert.ok(!broken.available && broken.reason.includes('formato inesperado'));
});

test('resumo: processos, rede, arquivos, registro e DNS', () => {
  const s = summarizeSysmon(asSummary(MOCK_SYSMON_EVENTS));
  assert.deepEqual(
    s.processes.map((p) => [p.pid, p.ppid, p.image]),
    [
      [4410, 3020, 'D:\\fatura.exe'],
      [4512, 4410, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    ],
  );
  assert.equal(s.processes[0].hashes, 'SHA256=AB12');
  assert.deepEqual(s.network[0], {
    time: '2026-11-13T12:00:04.0000000Z',
    image: 'powershell.exe',
    protocol: 'tcp',
    dstIp: '203.0.113.7',
    dstPort: 443,
    dstHost: null,
  });
  assert.equal(s.files[0].path, 'C:\\Users\\Public\\stage2.dll');
  assert.equal(s.registry[0].action, 'SetValue');
  assert.equal(s.dns[0].query, 'c2.evil.example');
  assert.deepEqual(sysmonIndicators(s), ['c2.evil.example', '203.0.113.7']);
});

test('IP privado e loopback não viram indicador', () => {
  const s = summarizeSysmon(
    asSummary(
      [
        '10.0.0.5',
        '127.0.0.1',
        '192.168.1.1',
        '8.8.8.8',
        // Multicast e broadcast (o DHCPv6 do Windows aparecia nos IOCs no teste real).
        'ff02:0:0:0:0:0:1:2',
        '239.255.255.250',
        '255.255.255.255',
      ].map((ip) => ({ id: 3, data: { Image: 'a', DestinationIp: ip } })),
    ),
  );
  assert.deepEqual(sysmonIndicators(s), ['8.8.8.8']);
});

test('IOCs: sem o ruído do Windows (visto no teste real)', () => {
  const s = summarizeSysmon(
    asSummary([
      ...[
        'wpad',
        '..localmachine',
        'deeplook-teste.invalid',
        'impressora.local',
        'x.lan',
        '1.0.168.192.in-addr.arpa',
        'Testmynids.org.',
      ].map((q) => ({ id: 22, data: { Image: 'a', QueryName: q } })),
      {
        id: 3,
        data: { Image: 'a', DestinationHostname: 'DESKTOP-1', DestinationIp: '203.0.113.9' },
      },
      {
        id: 3,
        data: {
          Image: 'a',
          DestinationHostname: 'cdn.evil.example',
          DestinationIp: '203.0.113.10',
        },
      },
    ]),
  );
  assert.deepEqual(sysmonIndicators(s), ['testmynids.org', '203.0.113.9', 'cdn.evil.example']);
});
