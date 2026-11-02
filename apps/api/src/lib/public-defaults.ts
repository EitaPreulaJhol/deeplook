/**
 * Senhas do admin publicadas no compose e no .env.example: quem as conhece entra como
 * admin enquanto ninguem as troca. Nenhuma passa na politica de senha (item 51), entao
 * so o seed as grava.
 */
export const PUBLIC_ADMIN_PASSWORDS: readonly string[] = ['admin12345', 'change-me-admin-password'];
