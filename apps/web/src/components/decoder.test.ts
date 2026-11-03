import { describe, expect, it } from 'vitest';

import {
  DECODER_MAX,
  hexDump,
  resultText,
  runSteps,
  type Step,
  type StepId,
  suggestStep,
} from './decoder';

const utf8 = new TextEncoder();

/** Roda os passos e devolve o texto do resultado junto com o erro (se houver). */
async function decode(input: string, steps: Step[]) {
  const { bytes, error } = await runSteps(input, steps);
  return { text: resultText(bytes), error };
}

const step = (id: StepId, param?: string): Step => ({ id, param });

describe('runSteps — passos isolados', () => {
  it('Base64 decodifica, aceita url-safe e preenche o padding que falta', async () => {
    expect((await decode('SGVsbG8=', [step('base64')])).text).toBe('Hello');
    // Sem padding e com os caracteres url-safe (- _) no lugar de + /.
    expect((await decode('SGVsbG8', [step('base64')])).text).toBe('Hello');
    expect((await decode('aGk_', [step('base64')])).text).toBe('hi?');
  });

  it('Base64 invalido para no passo 0 com o motivo', async () => {
    const { error } = await decode('!!!nao-base64!!!', [step('base64')]);
    expect(error?.index).toBe(0);
    expect(error?.message).toMatch(/Base64/);
  });

  it('Hex ignora separadores e 0x, e reclama de tamanho impar', async () => {
    expect((await decode('48656c6c6f', [step('hex')])).text).toBe('Hello');
    expect((await decode('48 65 6c 6c 6f', [step('hex')])).text).toBe('Hello');
    expect((await decode('0x48,0x69', [step('hex')])).text).toBe('Hi');
    expect((await decode('abc', [step('hex')])).error?.message).toMatch(/ímpar/);
    expect((await decode('xyz', [step('hex')])).error?.message).toMatch(/não é hex/);
  });

  it('URL decodifica %xx, %uXXXX e troca + por espaco', async () => {
    expect((await decode('a%20b%2Fc', [step('url')])).text).toBe('a b/c');
    expect((await decode('a+b', [step('url')])).text).toBe('a b');
    expect((await decode('%u0041%u0042', [step('url')])).text).toBe('AB');
  });

  it('PowerShell -EncodedCommand = Base64 de UTF-16LE', async () => {
    expect((await decode('SABpAA==', [step('psenc')])).text).toBe('Hi');
    // Equivale a encadear base64 e depois utf16.
    expect((await decode('SABpAA==', [step('base64'), step('utf16')])).text).toBe('Hi');
  });

  it('UTF-16LE vira texto', async () => {
    expect((await decode('H\u0000i\u0000', [step('utf16')])).text).toBe('Hi');
  });

  it('XOR: identidade com 0x00, chave em hex e ida-e-volta com a mesma chave', async () => {
    expect((await decode('Hello', [step('xor', '0x00')])).text).toBe('Hello');
    expect((await decode('Hello', [step('xor', '0x20')])).text).toBe('hELLO');
    // XOR duas vezes com a mesma chave (inclusive multibyte) volta ao original.
    expect((await decode('Hello', [step('xor', '0x5a'), step('xor', '0x5a')])).text).toBe('Hello');
    expect((await decode('Hello', [step('xor', '0x01 0x02'), step('xor', '0x01 0x02')])).text).toBe(
      'Hello',
    );
  });

  it('XOR sem chave para com o motivo', async () => {
    const { error } = await decode('Hello', [step('xor', '   ')]);
    expect(error?.message).toMatch(/chave do XOR/);
  });

  it('ROT13 decodifica e e seu proprio inverso', async () => {
    expect((await decode('Uryyb', [step('rot13')])).text).toBe('Hello');
    expect((await decode('Hello', [step('rot13'), step('rot13')])).text).toBe('Hello');
  });

  it('Inverter respeita os pontos de codigo', async () => {
    expect((await decode('abc', [step('reverse')])).text).toBe('cba');
    expect((await decode('áé', [step('reverse')])).text).toBe('éá');
  });

  it('Codigos de caractere aceitam decimal e hex, e reclamam sem numero', async () => {
    expect((await decode('72,101,108,108,111', [step('charcodes')])).text).toBe('Hello');
    expect((await decode('0x48 0x69', [step('charcodes')])).text).toBe('Hi');
    expect((await decode('sem numero aqui', [step('charcodes')])).error?.message).toMatch(
      /nenhum número/,
    );
  });
});

describe('runSteps — encadeamento, limites e erros', () => {
  it('descompacta gzip apos o base64 (ida e volta) e recusa o que nao e compactado', async () => {
    const original = 'hello deeplook — amostra compactada';
    const gz = await gzip(original);
    const b64 = btoa(String.fromCharCode(...gz));
    expect((await decode(b64, [step('base64'), step('inflate')])).text).toBe(original);

    // 'hello' em base64 nao e gzip/zlib/deflate: o inflate (passo 1) falha.
    const { error } = await decode('aGVsbG8=', [step('base64'), step('inflate')]);
    expect(error?.index).toBe(1);
    expect(error?.message).toMatch(/gzip/);
  });

  it('o indice do erro aponta o passo que falhou', async () => {
    // base64 ok (passo 0) -> 'Hello'; hex falha (passo 1), 'Hello' nao e hex.
    const { error } = await decode('SGVsbG8=', [step('base64'), step('hex')]);
    expect(error?.index).toBe(1);
  });

  it('entrada acima de 1 MB para antes de qualquer passo', async () => {
    const { error } = await decode('a'.repeat(DECODER_MAX + 1), [step('base64')]);
    expect(error?.index).toBe(-1);
    expect(error?.message).toMatch(/1 MB/);
  });

  it('sem passos devolve o proprio texto', async () => {
    expect((await decode('inalterado', [])).text).toBe('inalterado');
  });
});

describe('suggestStep', () => {
  it('reconhece a assinatura do gzip (1f 8b)', () => {
    expect(suggestStep(Uint8Array.from([0x1f, 0x8b, 0x08, 0x00]))).toBe('inflate');
  });

  it('reconhece hex, base64, url, codigos de caractere e utf16', () => {
    expect(suggestStep(utf8.encode('48656c6c6f20776f726c64'))).toBe('hex');
    expect(suggestStep(utf8.encode('TWFsd2FyZVNhbXBsZQ=='))).toBe('base64');
    expect(suggestStep(utf8.encode('%41%42%43'))).toBe('url');
    expect(suggestStep(utf8.encode('72, 101, 108, 108, 111'))).toBe('charcodes');
    expect(suggestStep(utf8.encode('H\u0000e\u0000l\u0000l\u0000o\u0000'))).toBe('utf16');
  });

  it('devolve null para vazio ou texto curto e sem cara de nada', () => {
    expect(suggestStep(new Uint8Array())).toBeNull();
    expect(suggestStep(utf8.encode('hi'))).toBeNull();
  });
});

describe('hexDump e resultText', () => {
  it('monta offset, bytes e a coluna de caracteres', () => {
    const dump = hexDump(utf8.encode('Hello'));
    expect(dump.startsWith('00000000  48 65 6c 6c 6f')).toBe(true);
    expect(dump.endsWith('Hello')).toBe(true);
  });

  it('bytes nao imprimiveis viram ponto', () => {
    expect(hexDump(Uint8Array.from([0x00, 0x41])).endsWith('.A')).toBe(true);
  });

  it('quebra em linhas de 16 bytes e respeita o limite', () => {
    expect(hexDump(new Uint8Array(20)).split('\n')).toHaveLength(2);
    expect(hexDump(new Uint8Array(20), 16).split('\n')).toHaveLength(1);
  });

  it('resultText usa UTF-8 e marca byte invalido com \uFFFD', () => {
    expect(resultText(utf8.encode('áé'))).toBe('áé');
    expect(resultText(Uint8Array.from([0xff]))).toBe('\uFFFD');
  });
});

/** Compacta em gzip com a mesma API de navegador que o decoder usa para descompactar. */
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([utf8.encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
