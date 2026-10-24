import type { FastifyReply } from 'fastify';
import type { ZodError, ZodIssue } from 'zod';

/** Mensagem curta em portugues para um problema de validacao do zod (v4). */
export function issueMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      // O zod 4 nao traz o valor recebido no problema, so no texto padrao.
      if (/received (undefined|null)$/.test(issue.message)) return 'obrigatório';
      if (issue.expected === 'int') return 'use um número inteiro';
      if (issue.expected === 'number') return 'informe um número';
      return 'valor inválido';
    case 'too_small':
      if (issue.origin === 'string') {
        return Number(issue.minimum) <= 1 ? 'obrigatório' : `mínimo de ${issue.minimum} caracteres`;
      }
      if (issue.origin === 'number' || issue.origin === 'int') return `mínimo ${issue.minimum}`;
      if (issue.origin === 'array') return `ao menos ${issue.minimum}`;
      return 'valor muito pequeno';
    case 'too_big':
      if (issue.origin === 'string') return `máximo de ${issue.maximum} caracteres`;
      if (issue.origin === 'number' || issue.origin === 'int') return `máximo ${issue.maximum}`;
      if (issue.origin === 'array') return `no máximo ${issue.maximum}`;
      return 'valor muito grande';
    case 'invalid_format':
      if (issue.format === 'email') return 'e-mail inválido';
      if (issue.format === 'url') return 'URL inválida';
      // Regex com mensagem propria (ex.: politica de senha).
      if (issue.format === 'regex' && !issue.message.startsWith('Invalid string')) {
        return issue.message;
      }
      return 'formato inválido';
    case 'invalid_value':
      return 'opção inválida';
    case 'custom':
      // superRefine/refine com mensagem propria (ex.: tecnica ATT&CK desconhecida).
      return issue.message && issue.message !== 'Invalid input' ? issue.message : 'valor inválido';
    default:
      return 'valor inválido';
  }
}

/** Erros por campo (primeiro nivel do caminho), com as mensagens em portugues. */
export function fieldErrors(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '_');
    (details[field] ??= []).push(issueMessage(issue));
  }
  return details;
}

/**
 * Resposta 400 padrao dos formularios: `error` (texto geral) + `details` por
 * campo, que o front usa para destacar o campo certo (useRequiredFields.fromApi).
 */
export function sendValidationError(
  reply: FastifyReply,
  error: ZodError,
  message = 'Dados invalidos.',
) {
  return reply.code(400).send({ error: message, details: fieldErrors(error) });
}
