import { describe, expect, it } from 'vitest';

import { linkTargets, tokenizeC } from './ghidraCode';

const kinds = (code: string) =>
  tokenizeC(code)
    .filter((t) => t.kind !== 'plain')
    .map((t) => `${t.kind}:${t.text}`);

const SAMPLE = `/* WARNING: Removing unreachable block (ram,0x140001500) */

undefined8 FUN_140001451(int param_1)
{
  HANDLE hProcess;
  LPVOID lpBuffer;
  char *url = "http://evil.test/stage2.bin // não é comentário";

  hProcess = OpenProcess(0x1fffff,0,param_1);
  if (hProcess == (HANDLE)0x0) {
    return 0xffffffff;
  }
  // continua
  FUN_140001180(url, 'x', 1.5e3);
  return 1;
}
`;

describe('tokenizeC', () => {
  it('juntar os pedaços devolve o código exato', () => {
    for (const code of [SAMPLE, '', 'a', '"sem fim', "'", '/* aberto', '//', 'x/y', '@#$%\n\t']) {
      expect(
        tokenizeC(code)
          .map((t) => t.text)
          .join(''),
      ).toBe(code);
    }
  });

  it('palavras-chave, tipos do C, do Ghidra e do Windows, números, textos e comentários', () => {
    const found = kinds(SAMPLE);
    expect(found).toContain('comment:/* WARNING: Removing unreachable block (ram,0x140001500) */');
    expect(found).toContain('type:undefined8');
    expect(found).toContain('type:int');
    expect(found).toContain('type:HANDLE');
    expect(found).toContain('type:LPVOID');
    expect(found).toContain('type:char');
    expect(found).toContain('keyword:if');
    expect(found).toContain('keyword:return');
    expect(found).toContain('number:0x1fffff');
    expect(found).toContain('number:0xffffffff');
    expect(found).toContain('number:1.5e3');
    expect(found).toContain("string:'x'");
    expect(found).toContain('comment:// continua');
    expect(found).toContain('name:OpenProcess');
    expect(found).toContain('name:FUN_140001180');
  });

  it('"//" dentro de um texto é texto, e "/*" dentro de um texto não abre comentário', () => {
    expect(kinds(SAMPLE)).toContain('string:"http://evil.test/stage2.bin // não é comentário"');
    expect(kinds('s = "/* x"; y = 1;')).toEqual(['name:s', 'string:"/* x"', 'name:y', 'number:1']);
  });

  it('texto e comentário sem fechamento vão até o fim, sem travar', () => {
    expect(kinds('a = "abc')).toEqual(['name:a', 'string:"abc']);
    expect(kinds('x; /* sem fim\nmais')).toEqual(['name:x', 'comment:/* sem fim\nmais']);
  });

  it('marcação no código continua texto (nada vira HTML)', () => {
    const code = '<img src=x onerror=alert(1)>';
    expect(
      tokenizeC(code)
        .map((t) => t.text)
        .join(''),
    ).toBe(code);
  });
});

describe('linkTargets', () => {
  it('liga o nome completo e o último pedaço do namespace', () => {
    const targets = linkTargets([
      { entry: '0x10', name: 'FUN_140001180' },
      { entry: '0x20', name: 'Classe::metodo' },
    ]);
    expect(targets.get('FUN_140001180')).toBe('0x10');
    expect(targets.get('Classe::metodo')).toBe('0x20');
    expect(targets.get('metodo')).toBe('0x20');
  });

  it('nome em duas funções não vira link; fora da lista (sem nome) também não', () => {
    const targets = linkTargets([
      { entry: '0x10', name: 'A::run' },
      { entry: '0x20', name: 'B::run' },
      { entry: '0x30', name: null },
    ]);
    expect(targets.has('run')).toBe(false);
    expect(targets.get('A::run')).toBe('0x10');
    expect(targets.size).toBe(2);
  });
});
