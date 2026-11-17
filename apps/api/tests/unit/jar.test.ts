// Java descompilado: o formato que o servico jarcfr devolve, os alertas e os IOCs, sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jarAlerts, jarIocs, jarSchema, jarWhy } from '../../src/lib/jar';

const base = {
  module: {
    name: null,
    mainClass: 'demo.Principal',
    agentClass: null,
    javaVersion: 'Java 11',
    createdBy: 'DeepLook Teste',
    classes: 1,
  },
  types: [{ path: 'demo/Principal.java', size: 939, lines: 26 }],
  findings: [],
  obfuscators: [],
  resources: [],
  urls: [],
  sources: { 'demo/Principal.java': 'class X {}' },
  failed: 0,
  truncated: false,
};
const find = (rule: string, level: 'high' | 'medium', line: number) => ({
  rule,
  level,
  why: 'texto do servico',
  path: 'demo/Principal.java',
  line,
  text: 'Runtime.getRuntime().exec(cmd);',
});

test('o formato do servico passa no schema e campo a mais ou de menos reprova', () => {
  assert.ok(jarSchema.safeParse(base).success);
  assert.ok(!jarSchema.safeParse({ ...base, failed: undefined }).success);
  assert.ok(
    !jarSchema.safeParse({ ...base, findings: [{ ...find('exec', 'high', 1), level: 'x' }] })
      .success,
  );
});

test('achados: um alerta por regra, com o porque do TypeScript e o primeiro lugar', () => {
  const alerts = jarAlerts({
    ...base,
    findings: [find('exec', 'high', 16), find('exec', 'high', 40), find('crypto', 'medium', 19)],
  });
  assert.deepEqual(alerts, [
    { level: 'high', text: `${jarWhy('exec', '')}: demo/Principal.java, linha 16` },
    { level: 'medium', text: `${jarWhy('crypto', '')}: demo/Principal.java, linha 19` },
  ]);
  // Regra que o TypeScript nao conhece: vale o texto que o servico mandou.
  assert.equal(jarWhy('nova-regra', 'do servico'), 'do servico');
});

test('agente, ofuscador, classes que falharam e arquivos embutidos', () => {
  const alerts = jarAlerts({
    ...base,
    module: { ...base.module, agentClass: 'demo.Agente' },
    obfuscators: ['Allatori', 'unknown'],
    failed: 3,
    resources: [
      { name: 'a/carga.exe', size: 10, sha256: 'x', kind: 'pe', entropy: 3 },
      { name: 'a/lib.so', size: 10, sha256: 'x', kind: 'elf', entropy: 3 },
      { name: 'a/pacote.zip', size: 10, sha256: 'x', kind: 'zip', entropy: 3 },
      { name: 'a/run.sh', size: 10, sha256: 'x', kind: 'script', entropy: 3 },
      { name: 'a/blob.bin', size: 128 * 1024, sha256: 'x', kind: null, entropy: 7.9 },
      { name: 'a/pequeno.bin', size: 100, sha256: 'x', kind: null, entropy: 7.9 },
      { name: 'a/Outra.class', size: 100, sha256: 'x', kind: 'class', entropy: 5 },
    ],
  });
  const texts = alerts.map((a) => `${a.level}: ${a.text}`);
  assert.deepEqual(texts, [
    'medium: Agente Java (demo.Agente): o JAR se anexa a outra JVM',
    'medium: Ofuscado com Allatori: a descompilação pode estar ilegível',
    'medium: Nomes ilegíveis: ofuscado por uma ferramenta não identificada',
    'info: 3 classe(s) não foram descompiladas por completo (ofuscação ou bytecode incomum)',
    'high: Recurso embutido executável: a/carga.exe',
    'high: Recurso embutido executável: a/lib.so',
    'medium: Recurso embutido ZIP: a/pacote.zip',
    'medium: Recurso embutido script: a/run.sh',
    'medium: Recurso grande e cifrado (entropia 7.9): a/blob.bin',
  ]);
});

test('IOCs: so as URLs do codigo, sem repetir e sem lixo', () => {
  const iocs = jarIocs({
    ...base,
    urls: ['http://carga.exemplo.test/stage2.jar', 'https://discord.com/api/webhooks/1/abc'],
  });
  assert.ok(iocs.some((i) => i.includes('carga.exemplo.test')));
  assert.ok(iocs.length >= 2);
  assert.deepEqual(jarIocs(base), []);
});
