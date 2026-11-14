# Security policy

> 🇧🇷 [Versão em português](#política-de-segurança) abaixo.

DeepLook handles malware: suspicious files, links and e-mails, isolated analysis services and
throwaway VMs. A flaw here can expose the people who use it, so reports are welcome and handled
privately.

## Supported versions

Only the latest release (and `main`) gets security fixes. Before reporting, check that the problem
still happens on the latest release.

## How to report

**Do not open a public issue.** Use GitHub's private reporting instead:
**Security › Report a vulnerability** on this repository. Only the maintainers see the report.

Please include:

- what is affected (component, route or screen) and the version or commit;
- how to reproduce it, step by step, and what an attacker gains;
- any proof of concept, logs or screenshots.

**Do not attach live malware.** If the issue depends on a specific sample, send its SHA-256, or a
ZIP protected with the password `infected` (the convention DeepLook itself uses), and say so in the
report.

## What is in scope

- Authentication and sessions: login, 2FA, LDAP/AD, password policy, account lockout.
- Access control: roles, what a regular user can see, API tokens and their scopes.
- Handling of submitted files, links and e-mails, and the isolated analysis services (capture,
  capa, Ghidra, unpacking, oletools, network capture): anything that escapes isolation, reaches the
  internal network or the host, or runs code outside the intended container.
- The Proxmox sandbox integration and the VM console: reaching other VMs or the hypervisor through
  DeepLook, or leaking Proxmox credentials.
- Backups, the audit hash chain and stored secrets.

Out of scope: vulnerabilities in third-party images and libraries that DeepLook doesn't make
exploitable (report those upstream), and problems that only exist when the deployment ignores the
[deployment checklist](docs/implantacao.md) (for example, publishing the app without Cloudflare
Access or with the default passwords, which the API refuses to start with).

## What to expect

This is a project maintained on a best-effort basis. Reports are acknowledged, investigated and,
when confirmed, fixed in a new release whose notes credit the reporter (unless you prefer
otherwise). Please give a reasonable time for the fix before disclosing publicly.

---

# Política de segurança

O DeepLook lida com malware: arquivos, links e e-mails suspeitos, serviços de análise isolados e
VMs descartáveis. Uma falha aqui pode expor quem o usa, então relatos são bem-vindos e tratados em
sigilo.

## Versões com suporte

Só a última versão publicada (e a `main`) recebe correções de segurança. Antes de relatar, confira
se o problema ainda acontece na última versão.

## Como relatar

**Não abra uma issue pública.** Use o relato privado do GitHub: **Security › Report a
vulnerability** neste repositório. Só os mantenedores veem o relato.

Inclua, por favor:

- o que é afetado (componente, rota ou tela) e a versão ou o commit;
- como reproduzir, passo a passo, e o que um atacante ganha;
- prova de conceito, logs ou prints, se houver.

**Não anexe malware vivo.** Se o problema depende de uma amostra específica, mande o SHA-256 dela,
ou um ZIP com a senha `infected` (a convenção que o próprio DeepLook usa), e avise no relato.

## O que está no escopo

- Autenticação e sessões: login, 2FA, LDAP/AD, política de senha, bloqueio por tentativas.
- Controle de acesso: papéis, o que o usuário comum vê, tokens de API e seus escopos.
- O tratamento de arquivos, links e e-mails enviados e os serviços de análise isolados (captura,
  capa, Ghidra, desempacotamento, oletools, captura de rede): qualquer coisa que escape do
  isolamento, alcance a rede interna ou o host, ou execute código fora do contêiner previsto.
- A integração com o sandbox no Proxmox e o console da VM: alcançar outras VMs ou o hipervisor pelo
  DeepLook, ou vazar as credenciais do Proxmox.
- Backups, a cadeia de hash da auditoria e os segredos armazenados.

Fora do escopo: falhas em imagens e bibliotecas de terceiros que o DeepLook não torna exploráveis
(relate a quem as mantém), e problemas que só existem quando a implantação ignora o
[checklist de implantação](docs/implantacao.pt-BR.md) (por exemplo, publicar o app sem o
Cloudflare Access ou com as senhas padrão, com as quais a API se recusa a subir).

## O que esperar

É um projeto mantido conforme a disponibilidade. Os relatos são confirmados, investigados e, quando
procedem, corrigidos numa nova versão cujas notas creditam quem relatou (a menos que você prefira o
contrário). Dê um prazo razoável para a correção antes de divulgar publicamente.
