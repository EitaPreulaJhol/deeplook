import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

import { api } from '../api/client';
import type { CurrentUser } from '../api/types';

/** O navegador sabe fazer WebAuthn (e a pagina esta em HTTPS ou localhost). */
export const passkeysSupported = () =>
  typeof window !== 'undefined' && window.isSecureContext && browserSupportsWebAuthn();

/**
 * A pessoa fechou ou recusou o pedido do aparelho (cancelar, tempo esgotado): nao e erro do
 * sistema, so volta ao formulario sem mensagem de falha.
 */
export const passkeyCancelled = (err: unknown) =>
  err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');

/** Entra com uma passkey: o aparelho mostra as contas dele e a escolhida assina o desafio. */
export async function signInWithPasskey(): Promise<CurrentUser> {
  const { options, challengeId } = await api.post<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeId: string;
  }>('/auth/passkey/options', {});
  const response = await startAuthentication({ optionsJSON: options });
  const data = await api.post<{ user: CurrentUser }>('/auth/passkey/login', {
    challengeId,
    response,
  });
  return data.user;
}

/** Cadastra uma passkey na conta que esta logada (a API pede de novo a senha e, com 2FA, o codigo). */
export async function registerPasskey(input: {
  name: string;
  password: string;
  code?: string;
}): Promise<void> {
  const { options, challengeId } = await api.post<{
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeId: string;
  }>('/me/passkeys/options', {
    password: input.password,
    ...(input.code ? { code: input.code } : {}),
  });
  const response = await startRegistration({ optionsJSON: options });
  await api.post('/me/passkeys', { challengeId, response, name: input.name });
}
