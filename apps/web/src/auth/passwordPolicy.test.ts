import { describe, expect, it } from 'vitest';

import { daysUntil, passwordProblem } from './passwordPolicy';

describe('passwordProblem (a mesma regra da API)', () => {
  it('aceita a senha que segue a regra', () => {
    expect(passwordProblem('Senha-Forte-77!')).toBeNull();
    expect(passwordProblem('abcdef1!')).toBeNull();
  });

  it('aponta o primeiro problema, na ordem da API', () => {
    expect(passwordProblem('abcde1!')).toBe('mínimo de 8 caracteres');
    expect(passwordProblem('abcdefgh!')).toBe('inclua ao menos um número');
    expect(passwordProblem('abcdefgh1')).toBe('inclua ao menos um caractere especial');
  });

  it('letra acentuada e espaço não contam como caractere especial', () => {
    expect(passwordProblem('açãoação1')).toBe('inclua ao menos um caractere especial');
    expect(passwordProblem('senha com 1 espaço')).toBe('inclua ao menos um caractere especial');
  });

  it('conta bytes, não caracteres, no teto de 72 do bcrypt', () => {
    expect(passwordProblem(`${'a'.repeat(70)}1!`)).toBeNull();
    expect(passwordProblem(`${'a'.repeat(71)}1!`)).toBe('no máximo 72 bytes (acentos contam 2)');
    // 36 acentos = 72 bytes: com o numero e o especial, passa do teto com 38 caracteres.
    expect(passwordProblem(`${'é'.repeat(36)}1!`)).toBe('no máximo 72 bytes (acentos contam 2)');
  });
});

describe('daysUntil', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);
  const at = (hours: number) => new Date(now + hours * 3600_000).toISOString();

  it('dias inteiros que faltam', () => {
    expect(daysUntil(at(24 * 10), now)).toBe(10);
    expect(daysUntil(at(47), now)).toBe(1);
  });

  it('menos de 24 h e data passada viram 0', () => {
    expect(daysUntil(at(23), now)).toBe(0);
    expect(daysUntil(at(-100), now)).toBe(0);
  });

  it('sem validade, null', () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil(undefined, now)).toBeNull();
    expect(daysUntil('', now)).toBeNull();
  });
});
