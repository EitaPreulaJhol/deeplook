// Regras Sigma sobre o Sysmon do sandbox (plans/novas-analises, item 1): o avaliador, sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attackTechniques,
  compileSigma,
  type SigmaEvent,
  SigmaUnsupported,
} from '../../src/lib/sigma';
import {
  compileTeamRule,
  isTeamRule,
  matchSigma,
  sigmaManifest,
  sigmaRules,
  sigmaRuleUrl,
} from '../../src/lib/sigma-rules';

const rule = (detection: string, logsource = 'category: process_creation', extra = '') =>
  compileSigma(
    `title: Teste\nid: 00000000-0000-0000-0000-000000000001\nlevel: high\ntags:\n  - attack.execution\n  - attack.t1059.001\n${extra}logsource:\n  product: windows\n  ${logsource}\ndetection:\n${detection}`,
    'rules/windows/teste.yml',
  );
const proc = (data: Record<string, string>): SigmaEvent => ({ eventId: 1, data });

test('contains, startswith, endswith e igualdade, sem diferenciar maiúsculas', () => {
  const r = rule(
    `  sel:\n    Image|endswith: '\\\\powershell.exe'\n    CommandLine|contains: ' -enc '\n    ParentImage|startswith: 'C:\\\\Windows\\\\'\n    User: 'SANDBOX\\\\analista'\n  condition: sel`,
  );
  const base = {
    Image: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE',
    CommandLine: 'powershell -nop -ENC abc',
    ParentImage: 'c:\\windows\\explorer.exe',
    User: 'sandbox\\Analista',
  };
  assert.ok(r.match(proc(base)));
  assert.ok(!r.match(proc({ ...base, CommandLine: 'powershell -nop' })));
  assert.ok(!r.match(proc({ ...base, User: 'SANDBOX\\outro' })));
  // Outro tipo de evento: a logsource nao cobre.
  assert.ok(!r.match({ eventId: 3, data: base }));
  assert.deepEqual(r.eventIds, [1]);
  assert.deepEqual(r.techniques, ['T1059.001']);
});

test('lista de valores é "qualquer um"; |all pede todos', () => {
  const any = rule(
    `  sel:\n    CommandLine|contains:\n      - 'vssadmin'\n      - 'wbadmin'\n  condition: sel`,
  );
  assert.ok(any.match(proc({ CommandLine: 'wbadmin delete catalog' })));
  const all = rule(
    `  sel:\n    CommandLine|contains|all:\n      - 'delete'\n      - 'shadows'\n  condition: sel`,
  );
  assert.ok(all.match(proc({ CommandLine: 'vssadmin delete shadows /all' })));
  assert.ok(!all.match(proc({ CommandLine: 'vssadmin list shadows' })));
});

test('curingas * e ?, com escape', () => {
  const r = rule(`  sel:\n    CommandLine: 'cmd /c *.bat ?'\n  condition: sel`);
  assert.ok(r.match(proc({ CommandLine: 'cmd /c run.bat x' })));
  assert.ok(!r.match(proc({ CommandLine: 'cmd /c run.bat xy' })));
  const lit = rule(`  sel:\n    CommandLine|contains: 'a\\*b'\n  condition: sel`);
  assert.ok(lit.match(proc({ CommandLine: 'xa*by' })));
  assert.ok(!lit.match(proc({ CommandLine: 'xaZby' })));
});

test('windash: traço ou barra no começo do parâmetro', () => {
  const r = rule(`  sel:\n    CommandLine|windash|contains: ' -enc '\n  condition: sel`);
  for (const c of ['-', '/', '\u2013', '\u2014', '\u2015']) {
    assert.ok(r.match(proc({ CommandLine: `powershell ${c}enc abc` })), c);
  }
  assert.ok(!r.match(proc({ CommandLine: 'powershell xenc abc' })));
});

test('re (com (?i) do Python), cidr, números, exists, null e cased', () => {
  const re = rule(`  sel:\n    CommandLine|re: '(?i)invoke-[a-z]+expression'\n  condition: sel`);
  assert.ok(re.match(proc({ CommandLine: 'INVOKE-ABCExpression' })));
  const cidr = rule(
    `  sel:\n    DestinationIp|cidr:\n      - '10.0.0.0/8'\n      - 'fe80::/10'\n  condition: sel`,
    'category: network_connection',
  );
  assert.ok(cidr.match({ eventId: 3, data: { DestinationIp: '10.1.2.3' } }));
  assert.ok(cidr.match({ eventId: 3, data: { DestinationIp: 'fe80::1' } }));
  assert.ok(!cidr.match({ eventId: 3, data: { DestinationIp: '11.0.0.1' } }));
  const port = rule(
    `  sel:\n    DestinationPort|gte: 4444\n    Initiated: 'true'\n  condition: sel`,
    'category: network_connection',
  );
  assert.ok(port.match({ eventId: 3, data: { DestinationPort: '4444', Initiated: 'true' } }));
  assert.ok(!port.match({ eventId: 3, data: { DestinationPort: '443', Initiated: 'true' } }));
  const exists = rule(`  sel:\n    OriginalFileName|exists: false\n  condition: sel`);
  assert.ok(exists.match(proc({ Image: 'a' })));
  assert.ok(!exists.match(proc({ OriginalFileName: 'a' })));
  const empty = rule(`  sel:\n    Description: null\n  condition: sel`);
  assert.ok(empty.match(proc({ Image: 'a' })));
  const cased = rule(`  sel:\n    CommandLine|cased|contains: 'IEX'\n  condition: sel`);
  assert.ok(!cased.match(proc({ CommandLine: 'iex' })));
});

test('base64offset|contains acha o texto em qualquer posição do Base64', () => {
  const r = rule(`  sel:\n    CommandLine|base64offset|contains: 'IEX ('\n  condition: sel`);
  for (const prefix of ['', 'a', 'ab']) {
    const b64 = Buffer.from(`${prefix}IEX (New-Object Net.WebClient)`).toString('base64');
    assert.ok(r.match(proc({ CommandLine: `powershell -e ${b64}` })), prefix);
  }
});

test('condição: and, or, not, parênteses, 1 of, all of e them', () => {
  const r = rule(
    `  sel_a:\n    Image|endswith: '\\\\a.exe'\n  sel_b:\n    Image|endswith: '\\\\b.exe'\n  filter:\n    User: 'SYSTEM'\n  condition: 1 of sel_* and not filter`,
  );
  assert.ok(r.match(proc({ Image: 'C:\\b.exe', User: 'x' })));
  assert.ok(!r.match(proc({ Image: 'C:\\b.exe', User: 'SYSTEM' })));
  const all = rule(
    `  sel_a:\n    Image|endswith: '.exe'\n  sel_b:\n    CommandLine|contains: 'x'\n  condition: all of them`,
  );
  assert.ok(all.match(proc({ Image: 'a.exe', CommandLine: 'x' })));
  assert.ok(!all.match(proc({ Image: 'a.exe', CommandLine: 'y' })));
  const paren = rule(
    `  a:\n    Image: 'a'\n  b:\n    Image: 'b'\n  c:\n    User: 'u'\n  condition: (a or b) and c`,
  );
  assert.ok(paren.match(proc({ Image: 'b', User: 'u' })));
  assert.ok(!paren.match(proc({ Image: 'b', User: 'v' })));
  // Lista de mapas: qualquer um.
  const maps = rule(`  sel:\n    - Image: 'a'\n    - OriginalFileName: 'b'\n  condition: sel`);
  assert.ok(maps.match(proc({ OriginalFileName: 'B' })));
});

test('registro: a categoria escolhe o EventType', () => {
  const r = rule(
    `  sel:\n    TargetObject|contains: '\\\\Run\\\\'\n  condition: sel`,
    'category: registry_delete',
  );
  assert.ok(
    r.match({ eventId: 12, data: { EventType: 'DeleteValue', TargetObject: 'HKU\\x\\Run\\a' } }),
  );
  assert.ok(
    !r.match({ eventId: 12, data: { EventType: 'CreateKey', TargetObject: 'HKU\\x\\Run\\a' } }),
  );
});

test('fora do suportado: keywords, agregação, serviço que não é o Sysmon, condição quebrada', () => {
  const unsupported = (fn: () => unknown, why: RegExp) =>
    assert.throws(fn, (err: unknown) => err instanceof SigmaUnsupported && why.test(err.message));
  unsupported(() => rule(`  kw:\n    - 'mimikatz'\n  condition: kw`), /keywords/);
  unsupported(() => rule(`  sel:\n    Image: 'a'\n  condition: sel | count() > 5`), /agregação/);
  unsupported(
    () => rule(`  sel:\n    Image: 'a'\n  condition: sel`, 'service: security'),
    /fora do Sysmon/,
  );
  unsupported(() => rule(`  sel:\n    Image: 'a'\n  condition: (sel`), /parênteses/);
  unsupported(() => rule(`  sel:\n    Image: 'a'\n  condition: outro`), /não existe/);
  unsupported(() => rule(`  sel:\n    Image|xpto: 'a'\n  condition: sel`), /modificador/);
});

test('tags ATT&CK viram técnicas', () => {
  assert.deepEqual(
    attackTechniques(['attack.t1059', 'attack.T1003.001', 'attack.execution', 'cve.2021']),
    ['T1059', 'T1003.001'],
  );
});

test('as regras vendorizadas compilam e acham o comportamento típico', () => {
  const { rules, failed } = sigmaRules();
  assert.deepEqual(failed, []);
  assert.ok(rules.length > 1000, String(rules.length));
  assert.equal(sigmaManifest()?.license, 'DRL 1.1');
  const titles = (e: SigmaEvent) => matchSigma(e).map((r) => r.title);
  assert.ok(
    titles(
      proc({
        Image: 'C:\\Windows\\System32\\vssadmin.exe',
        OriginalFileName: 'VSSADMIN.EXE',
        CommandLine: 'vssadmin.exe delete shadows /all /quiet',
      }),
    ).some((t) => /shadow cop/i.test(t)),
  );
  assert.ok(
    titles({
      eventId: 13,
      data: {
        EventType: 'SetValue',
        Image: 'C:\\Users\\a\\AppData\\Local\\Temp\\x.exe',
        TargetObject: 'HKU\\S-1-5-21-1\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater',
        Details: 'C:\\Users\\a\\AppData\\Roaming\\upd.exe',
      },
    }).some((t) => /autorun/i.test(t)),
  );
  // Processo comum do Windows: nada.
  assert.deepEqual(
    titles(
      proc({
        Image: 'C:\\Windows\\System32\\svchost.exe',
        OriginalFileName: 'svchost.exe',
        CommandLine: 'C:\\Windows\\system32\\svchost.exe -k netsvcs -p -s Schedule',
        ParentImage: 'C:\\Windows\\System32\\services.exe',
      }),
    ),
    [],
  );
});

// Regras da equipe (plans/caca-e-formatos, item 1): o id das deteccoes e "team:<id do banco>".
test('regra da equipe: id "team:" e sem link do GitHub', () => {
  const rule = compileTeamRule(
    [
      'title: Equipe',
      'id: 11111111-2222-3333-4444-555555555555',
      'logsource: { product: windows, category: process_creation }',
      'detection: { sel: { Image|endswith: \\vssadmin.exe }, condition: sel }',
    ].join('\n'),
    'abc',
  );
  assert.equal(rule.id, 'team:abc');
  assert.ok(isTeamRule(rule.id) && !isTeamRule('11111111-2222-3333-4444-555555555555'));
  assert.equal(sigmaRuleUrl(rule), null);
  assert.ok(rule.match({ eventId: 1, data: { Image: 'C:\\Windows\\System32\\vssadmin.exe' } }));
});
