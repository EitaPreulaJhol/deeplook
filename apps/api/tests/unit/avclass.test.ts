import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avclass } from '../../src/lib/avclass';

// Familia por consenso (plans/analise-estatica-ampliada, item 6). Os resultados esperados sao os do
// common.py do AVclass original sobre os mesmos rotulos (conferidos em 19/11/2026).

const MD5 = 'd41d8cd98f00b204e9800998ecf8427e';
const tags = (labels: [string, string][]) =>
  avclass(labels, [MD5]).tags.map((t) => [t.tag, t.votes, t.category]);

test('AgentTesla: o apelido Agensla vira agenttesla, e os genéricos saem', () => {
  const labels: [string, string][] = [
    ['Kaspersky', 'HEUR:Trojan-PSW.MSIL.Agensla.gen'],
    ['ESET-NOD32', 'a variant of MSIL/Spy.AgentTesla.F'],
    ['Microsoft', 'Trojan:MSIL/AgentTesla.JQK!MTB'],
    ['BitDefender', 'Gen:Variant.MSILHeracles.12345'],
    ['Avast', 'Win32:PWSX-gen [Trj]'],
    ['Fortinet', 'MSIL/AgentTesla.FFW!tr'],
    ['Sophos', 'Troj/MSIL-AGT'],
    ['Symantec', 'Trojan.Gen.MBT'],
    ['CrowdStrike', 'win/malicious_confidence_100% (W)'],
    ['Ikarus', 'Trojan-Spy.AgentTesla'],
  ];
  assert.deepEqual(tags(labels), [
    ['msil', 5, 'FILE'],
    ['agenttesla', 5, 'FAM'],
    ['windows', 2, 'FILE'],
  ]);
  const r = avclass(labels, [MD5]);
  assert.equal(r.family, 'agenttesla');
  assert.equal(r.familyUnknown, false);
  assert.equal(r.detections, 10);
});

test('Emotet, só genéricos e família fora da taxonomia', () => {
  assert.deepEqual(
    tags([
      ['Kaspersky', 'Trojan-Banker.Win32.Emotet.abcd'],
      ['ESET-NOD32', 'a variant of Win32/Kryptik.HFGH'],
      ['Microsoft', 'Trojan:Win32/Emotet.ARJ!MTB'],
      ['Avira', 'TR/Crypt.Agent.abcde'],
      ['Fortinet', 'W32/Emotet.ABCD!tr'],
      ['DrWeb', 'Trojan.Emotet.999'],
    ]),
    [
      ['emotet', 4, 'FAM'],
      ['windows', 3, 'FILE'],
      ['packed', 2, 'FILE'],
    ],
  );
  const generic = avclass(
    [
      ['Symantec', 'ML.Attribute.HighConfidence'],
      ['Avast', 'Win32:Malware-gen'],
      ['AVG', 'Win32:Malware-gen'],
      ['Cylance', 'Unsafe'],
    ],
    [MD5],
  );
  assert.equal(generic.family, null);
  const unknown = avclass(
    [
      ['Kaspersky', 'Trojan.Win32.Zzqqxx.a'],
      ['ESET-NOD32', 'Win32/Zzqqxx.A'],
      ['Fortinet', 'W32/Zzqqxx.A!tr'],
    ],
    [MD5],
  );
  assert.equal(unknown.family, 'zzqqxx');
  assert.equal(unknown.familyUnknown, true);
});
