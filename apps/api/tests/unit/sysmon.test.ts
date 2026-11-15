import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOCK_SYSMON_EVENTS } from '../../src/lib/proxmox-mock';
import { parseSysmon, sysmonCommand, sysmonIndicators } from '../../src/lib/sysmon';

// Sysmon no template (plano pos-revisao, item 5.3): comando do agente e leitura dos eventos.

test('comando: PowerShell em Base64 (UTF-16LE), lendo o canal desde o início da sessão', () => {
  const now = Date.parse('2026-11-13T12:10:00.000Z');
  const command = sysmonCommand(new Date('2026-11-13T12:00:00.000Z'), now);
  assert.deepEqual(command.slice(0, 4), [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
  ]);
  const script = Buffer.from(command[4], 'base64').toString('utf16le');
  assert.ok(script.includes('Microsoft-Windows-Sysmon/Operational'));
  // Janela no relogio da VM: os 600 s da sessao mais a folga de 300 s, sem a hora da API.
  assert.ok(script.includes('$since = (Get-Date).AddSeconds(-900)'), script);
  assert.ok(!script.includes('2026-11-13'));
  assert.ok(script.includes('Id = 1,3,11,12,13,14,22'));
  assert.ok(script.includes('-MaxEvents 2000 -Oldest'));
});

test('eventos de exemplo: processos, rede, arquivos, registro e DNS', () => {
  const s = parseSysmon(JSON.stringify(MOCK_SYSMON_EVENTS));
  assert.equal(s.available, true);
  if (!s.available) return;
  assert.equal(s.events, 6);
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

test('um evento só (o ConvertTo-Json o devolve sem lista) e nenhum evento', () => {
  const one = parseSysmon(JSON.stringify(MOCK_SYSMON_EVENTS[2]));
  assert.ok(one.available && one.dns.length === 1);
  const none = parseSysmon('');
  assert.ok(none.available && none.events === 0);
  const empty = parseSysmon('[]\r\n');
  assert.ok(empty.available && empty.events === 0);
  // BOM e um aviso antes do JSON (linha propria) nao atrapalham.
  const noisy = parseSysmon(`\uFEFFAVISO: algo\r\n${JSON.stringify(MOCK_SYSMON_EVENTS)}`);
  assert.ok(noisy.available && noisy.events === 6);
});

test('sem Sysmon e saída que não é JSON: indisponível, com o motivo', () => {
  const missing = parseSysmon('DEEPLOOK_SEM_SYSMON\r\n');
  assert.ok(!missing.available && missing.reason.includes('Sysmon não instalado'));
  const broken = parseSysmon('Get-WinEvent : erro');
  assert.ok(!broken.available && broken.reason.includes('formato inesperado'));
  assert.deepEqual(sysmonIndicators(missing), []);
});

test('IP privado e loopback não viram indicador', () => {
  const s = parseSysmon(
    JSON.stringify([
      { id: 3, data: { Image: 'a', DestinationIp: '10.0.0.5' } },
      { id: 3, data: { Image: 'a', DestinationIp: '127.0.0.1' } },
      { id: 3, data: { Image: 'a', DestinationIp: '192.168.1.1' } },
      { id: 3, data: { Image: 'a', DestinationIp: '8.8.8.8' } },
      // Multicast e broadcast (o DHCPv6 do Windows aparecia nos IOCs no teste real).
      { id: 3, data: { Image: 'a', DestinationIp: 'ff02:0:0:0:0:0:1:2' } },
      { id: 3, data: { Image: 'a', DestinationIp: '239.255.255.250' } },
      { id: 3, data: { Image: 'a', DestinationIp: '255.255.255.255' } },
    ]),
  );
  assert.deepEqual(sysmonIndicators(s), ['8.8.8.8']);
});

test('IOCs: sem o ruído do Windows (visto no teste real)', () => {
  const s = parseSysmon(
    JSON.stringify([
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
