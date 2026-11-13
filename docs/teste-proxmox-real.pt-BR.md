# 🧪 Plano de teste do sandbox contra o Proxmox real

> 🇬🇧 [Read in English](teste-proxmox-real.md)

Item 5.5 do [plano pós-revisão](plano-2026-11.pt-BR.md).

O sandbox tem testes contra o Proxmox simulado (`PROXMOX_MOCK=true`), contra um RouterOS falso e
contra pacotes TZSP gerados. Este plano cobre o que só a infraestrutura de verdade confirma, num
roteiro que dá para seguir em uma tarde. O resultado de cada passo vai na
[tabela de registro](#7-registro-dos-resultados).

## 1. O que só o ambiente real confirma

| # | Ponto | Por que o teste automático não pega |
|---|---|---|
| R1 | Permissões efetivas da conta no PVE (clone, config, console, agente) | o simulado aceita tudo |
| R2 | Envio da ISO, linked clone (ou a queda para cópia cheia) e tempos reais | o simulado responde em milissegundos |
| R3 | Console pelo navegador → nginx → API → PVE (WebSocket e senha VNC) | não há VNC de verdade no CI |
| R4 | Print da tela pelo console VNC no PVE 9 (que tirou o endpoint de screenshot) | o simulado tem o endpoint |
| R5 | `qemu-guest-agent`: `get-osinfo`, `exec` e a lista de processos no Windows | o simulado devolve um CSV pronto |
| R6 | Sysmon: o `Get-WinEvent` em Base64, a codificação UTF-8 e o JSON do PowerShell 5.1 | o Linux não tem o `Get-WinEvent` |
| R7 | API REST do sniffer do RouterOS 7: nomes dos parâmetros, parar, reconfigurar e ligar | o RouterOS do teste é falso |
| R8 | TZSP saindo do CHR e chegando ao `netcap` (rota, firewall, `DOCKER-USER`) | os pacotes do teste nascem no próprio host |
| R9 | Quadros reais: VLAN, offload de checksum, MTU | os quadros do teste são montados à mão |
| R10 | Suricata com as regras ET Open sobre tráfego real | o teste usa só a regra do DeepLook |
| R11 | Pausa na captura de um ambiente quando outro abre ou fecha | só acontece com o sniffer de verdade |
| R12 | Limpeza no PVE e no CHR depois de falhas (API caindo no meio, VM travada) | o simulado não guarda estado entre subidas |

## 2. Pré-requisitos

### 2.1 Infraestrutura

- [ ] PVE 8 ou 9 com o template pronto (`docs/proxmox.pt-BR.md`, seção 2): Windows 10 ou 11,
      `qemu-guest-agent` rodando, Sysmon com a `sysmon-modular`, snapshot criado e `qm template`.
- [ ] Rede isolada das VMs atrás do MikroTik CHR (RouterOS 7), com saída para a internet só por ele.
- [ ] CHR com o `www-ssl` e o usuário `deeplook` configurados (`docs/proxmox.pt-BR.md`, seção 9.1).
- [ ] Host do DeepLook com `COMPOSE_PROFILES=netcap` e as variáveis `MIKROTIK_*`, `NETCAP_*` e
      `SURICATA_*` (seção 9.2), e o firewall do TZSP liberado só para o IP do CHR.
- [ ] Wireshark (ou `tshark`) numa máquina de análise, para abrir o pcap.
- [ ] Acesso ao Winbox ou SSH do CHR e ao shell do PVE, para conferir por fora.

### 2.2 No DeepLook

- [ ] Um admin e um analista **só para o teste** (o analista abre os ambientes; o admin confere o
      status e a auditoria).
- [ ] `SANDBOX_TTL_MINUTES` com folga (60) e `SANDBOX_ARTIFACT_INTERVAL_S=60`.
- [ ] **Administração > Status do sistema** sem erro antes de começar (anote os avisos).
- [ ] Suricata com as regras ET Open baixadas (o status mostra a contagem; sem elas, o passo 5.4
      fica só com a regra de teste).

### 2.3 Amostra de teste (inofensiva)

Salve como `deeplook-teste.ps1` e envie pela tela **Enviar Amostra**. Ela não faz nada além de
gerar os eventos que o Sysmon e o Suricata precisam ver:

```powershell
# Amostra inofensiva do teste real do DeepLook (docs/teste-proxmox-real.pt-BR.md).
# 1. Consulta DNS da regra de teste do DeepLook (o dominio .invalid nunca resolve). O nslookup
#    manda direto (o Suricata ve); o Resolve-DnsName passa pelo cliente DNS do Windows (o Sysmon ve).
nslookup deeplook-teste.invalid 2>$null | Out-Null
Resolve-DnsName deeplook-teste.invalid -ErrorAction SilentlyContinue | Out-Null
# 2. Pedido HTTP que dispara uma regra ET Open conhecida ("GPL ATTACK_RESPONSE id check
#    returned root"): o testmynids.org existe para testar IDS.
try { Invoke-WebRequest -UseBasicParsing http://testmynids.org/uid/index.html | Out-Null } catch {}
# 3. Um arquivo e uma chave de inicializacao (Sysmon 11 e 13). A VM e descartada no fim.
Set-Content -Path "$env:PUBLIC\deeplook-teste.txt" -Value 'teste do DeepLook'
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' `
  -Name DeepLookTeste -Value 'notepad.exe' -Force | Out-Null
# 4. Um processo filho (arvore de processos).
Start-Process notepad.exe
```

Na VM, ela fica no CD-ROM (normalmente `D:`). Para rodar:
`powershell -ExecutionPolicy Bypass -File D:\deeplook-teste.ps1`.

## 3. Roteiro

Cada passo diz o que fazer, o que esperar e onde conferir. **O** marca um critério obrigatório (sem
ele o sandbox não está pronto para uso); **D**, um desejável (anote e siga).

### Fase 0 — Linha de base

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 0.1 | `GET /api/sandbox/health` (como admin, ou o `scripts/smoke-sandbox.ps1` só até a seção 1) | `pve-acessivel`, `template` e o storage da ISO ok | resposta JSON | **O** |
| 0.2 | Permissões efetivas: `pveum user permissions deeplook@pve --path /vms` | `VM.Clone`, `VM.Config.*`, `VM.PowerMgmt`, `VM.Console` e `VM.GuestAgent.Unrestricted` (PVE 9) ou `VM.Monitor` (PVE 8) | shell do PVE | **O** |
| 0.3 | Status do sistema | "Ambiente isolado", "Captura de rede (MikroTik)" e "Suricata" sem erro; a captura mostra a versão do RouterOS | Administração > Status do sistema | **O** |
| 0.4 | Sniffer parado antes do teste | `/tool/sniffer/print`: `running=no`, `filter-mac-address` vazio | Winbox ou SSH do CHR | **O** |
| 0.5 | Nenhuma VM órfã com a etiqueta `SANDBOX_TAG` e nenhuma ISO `deeplook-*` no storage | lista vazia | PVE (Datacenter > Search) | D |

### Fase 1 — Provisionamento (R1, R2)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 1.1 | Na amostra, aba **Análise**, "Abrir ambiente"; cronometre | fases: gerando a ISO, enviando, clonando, configurando, iniciando, em execução | painel do ambiente | **O** |
| 1.2 | Tempo total até "em execução" | anote; com linked clone, alguns minutos no máximo | cronômetro | D |
| 1.3 | Tipo de clone | linked clone (o disco da VM aponta para o template); se cair para cópia cheia, o snapshot do template falta | PVE: Hardware da VM | D |
| 1.4 | ISO como CD-ROM somente leitura | `ide2` com a ISO, `media=cdrom` | PVE: Hardware da VM | **O** |
| 1.5 | Captura aberta antes de ligar | "Tráfego de rede: capturando o tráfego da VM (MAC …)"; no CHR, o MAC da VM em `filter-mac-address` e `running=yes` | painel e `/tool/sniffer/print` | **O** |

### Fase 2 — Console (R3, R4)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 2.1 | "Abrir console (nova janela)" pelo endereço público (com o nginx) | tela da VM, teclado e mouse funcionando | navegador | **O** |
| 2.2 | `DEEPLOOK_BASE=https://<endereço> node scripts/ws-console-check.mjs <id do ambiente> <cookie dl_session>` | handshake RFB e autenticação VNC ok | terminal | D |
| 2.3 | Esperar duas coletas (2 min) | miniaturas novas da tela; no PVE 9, vindas do console VNC | seção "Artefatos do ambiente" | **O** |
| 2.4 | Com o console aberto, conferir que a coleta não derruba quem está nele | o console segue conectado | janela do console | **O** |

### Fase 3 — Agente e processos (R5)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 3.1 | Depois da primeira coleta | lista de processos sem aviso de agente; nada em "surgiram" | Artefatos do ambiente | **O** |
| 3.2 | No console, rodar a amostra (seção 2.3) | na coleta seguinte, `notepad.exe` em "processos que surgiram" (o PowerShell da amostra já terminou; ele aparece na árvore do Sysmon) | Artefatos do ambiente | **O** |

### Fase 4 — Sysmon (R6)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 4.1 | Depois da coleta seguinte à amostra | seção "Sysmon da VM" com eventos, sem "formato inesperado" | Artefatos do ambiente | **O** |
| 4.2 | Árvore de processos | `powershell.exe` com `notepad.exe` embaixo | árvore | **O** |
| 4.3 | Consultas DNS | `deeplook-teste.invalid` (do `Resolve-DnsName`; o `nslookup` não passa pelo cliente DNS e o Sysmon não o vê) e `testmynids.org` | tabela DNS | **O** |
| 4.4 | Conexões, arquivos e registro | conexão para o IP do `testmynids.org`:80; `C:\Users\Public\deeplook-teste.txt`; a chave `…\Run\DeepLookTeste` | tabelas | D (a configuração do Sysmon pode filtrar alguns) |
| 4.5 | Caminho com acento: criar `C:\Users\Public\ação.txt` e esperar uma coleta | o nome aparece certo, sem `?` ou caracteres trocados | tabela de arquivos | D |
| 4.6 | IOCs sugeridos | `testmynids.org` aparece em "Inserir IOCs sugeridos" no Novo relatório | aba Relatórios | **O** |

### Fase 5 — Captura de rede e Suricata (R7 a R10)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 5.1 | Durante o ambiente | "Último pacote" recente no componente "Captura de rede (MikroTik)" | Status do sistema | **O** |
| 5.2 | Encerrar o ambiente ("Descartar ambiente") | "N pacote(s), X MB" e o link "Baixar o pcap" | Tráfego de rede | **O** |
| 5.3 | Baixar o pcap e abrir no Wireshark; filtro `dns.qry.name == "deeplook-teste.invalid"` e depois `http.host == "testmynids.org"` | os dois aparecem; só tráfego da VM do teste (confira os MACs em `eth.addr`) | Wireshark | **O** |
| 5.4 | Esperar o Suricata (uns 30 s com as regras ET Open) | alerta "DEEPLOOK teste da captura de rede" e o alerta GPL/ET do `testmynids.org`; DNS e HTTP nas tabelas | Tráfego de rede | **O** |
| 5.5 | Pontuação de risco | o alerta do `testmynids.org` soma (motivo "Suricata"); o da regra de teste não | aba Detalhes, risco | **O** |
| 5.6 | Auditoria | "Captura de rede do ambiente baixada" com o ambiente e o tamanho | Administração > Auditoria | **O** |
| 5.7 | VLAN e checksum: se as VMs saem por uma VLAN no CHR, confira que o pcap tem os quadros com a etiqueta e que o Suricata ainda viu o DNS e o HTTP | alertas e tabelas presentes | Wireshark e a seção | D |

### Fase 6 — Encerramento e limpeza (R12)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 6.1 | Depois do 5.2 | VM destruída (sem o VMID no PVE) e ISO `deeplook-<id>.iso` removida | PVE | **O** |
| 6.2 | Sniffer | `running=no` e `filter-mac-address` vazio (era o único ambiente) | `/tool/sniffer/print` | **O** |
| 6.3 | netcap | nenhuma sessão aberta: `docker compose exec netcap node -e "fetch('http://127.0.0.1:3700/health').then(r=>r.text()).then(console.log)"` mostra `"sessions":0` | host | **O** |
| 6.4 | Artefatos depois do fim | prints, processos, Sysmon e tráfego continuam na amostra | aba Análise | **O** |

### Fase 7 — Dois ambientes ao mesmo tempo (R11)

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 7.1 | Abrir o ambiente A; no console, `ping -t <gateway da rede isolada>` | — | — | — |
| 7.2 | Abrir o ambiente B (outra amostra); esperar ligar; encerrar o B | o sniffer passa a ter os dois MACs e volta a ter só o de A | `/tool/sniffer/print` | **O** |
| 7.3 | Encerrar o A e abrir o pcap dele; filtro `icmp` | a sequência do ping com no máximo alguns pacotes faltando nos momentos em que B abriu e fechou; anote quantos | Wireshark | D |
| 7.4 | pcap do B | só os quadros do MAC de B | Wireshark (`eth.addr`) | **O** |

### Fase 8 — Falhas provocadas (R12)

Faça cada uma num ambiente novo e confira que **a VM segue funcionando** e o motivo aparece na tela.

| Passo | Provocar | Esperado | |
|---|---|---|---|
| 8.1 | Parar o serviço do agente na VM (`Stop-Service QEMU-GA`) | aviso "o qemu-guest-agent não respondeu…"; prints continuam | **O** |
| 8.2 | Trocar a senha do usuário `deeplook` no CHR e abrir um ambiente | "A captura de rede não funcionou: sniffer do MikroTik: o RouterOS recusou o usuário ou a senha"; VM em execução; status do sistema em erro e linha `status.down` no log de alertas (se ligado). Volte a senha | **O** |
| 8.3 | `docker compose stop netcap` e abrir um ambiente | captura com falha ("o serviço netcap não respondeu"); VM em execução. `docker compose start netcap` | **O** |
| 8.4 | Com um ambiente em execução, `docker compose restart api` | na subida a API confere: o ambiente continua, o MAC segue no sniffer e a captura segue gravando (pcap com pacotes de antes e depois) | **O** |
| 8.5 | Com um ambiente em execução, `docker compose stop api`, destruir a VM à mão no PVE, `docker compose start api` | hoje a API **não** percebe a VM sumida antes do prazo: o ambiente segue "em execução" (com o aviso do agente nos artefatos) até o reaper encerrá-lo sem erro, tirar o MAC do sniffer e guardar o pcap até ali. Confira esse fim e anote quanto tempo o MAC ficou no sniffer | D |
| 8.6 | `SANDBOX_TTL_MINUTES=5` (só para este passo), abrir e esperar | o reaper encerra no prazo; captura guardada; VM e ISO removidas | **O** |
| 8.7 | Abrir mais ambientes que `SANDBOX_MAX_PER_USER` | recusa com a mensagem do limite, sem VM criada | D |

### Fase 9 — Lixeira e backup

| Passo | Ação | Esperado | Onde conferir | |
|---|---|---|---|---|
| 9.1 | Gerar um backup com os arquivos | o ZIP tem `objects/sandbox/<amostra>/<ambiente>/captura.pcap` e os prints | ZIP | D |
| 9.2 | Mandar a amostra para a lixeira e esvaziar | os objetos `sandbox/<amostra>/…` saem do MinIO | console do MinIO (`127.0.0.1:9001`) | **O** |

## 4. Medidas a anotar

- Tempo do provisionamento (1.2) e do encerramento (do clique até "encerrado").
- Tamanho do pcap e número de pacotes de um ambiente de 10 minutos com a amostra.
- Tempo do Suricata com as regras ET Open (`idsMs` na resposta dos artefatos) e a memória do
  container no pico (`docker stats suricata`).
- Pacotes perdidos no 7.3.

Elas servem para ajustar `NETCAP_MAX_MB`, `SURICATA_TIMEOUT_S`, `SURICATA_MEM_LIMIT` e o
`SANDBOX_ARTIFACT_INTERVAL_S`.

## 5. Critério de saída

- **Pronto para uso:** todos os passos **O** ok. Desejáveis com falha viram item no plano, com o que
  foi visto.
- **Não pronto:** qualquer **O** falhando. O que fazer depende da fase: permissões (0.2) e template
  (fase 1) são do ambiente; console, agente, Sysmon e captura com o ambiente certo apontam para o
  código, e o registro do passo vira o caso de teste da correção (no simulado, no RouterOS falso
  ou no gerador de pacotes).

## 6. Cuidados

- Use só a amostra da seção 2.3. Malware de verdade fica para depois de o roteiro passar.
- O pcap tem o tráfego da VM: abra-o na máquina de análise, não na estação do dia a dia.
- Volte o que foi mudado nas falhas provocadas (senha do CHR, `netcap` parado, TTL curto).
- No fim, repita 0.4 e 0.5: nada de sniffer ligado, VM órfã ou ISO esquecida.

## 7. Registro dos resultados

Copie a tabela para o registro do teste (data, versões do PVE, do RouterOS, do Windows do template
e o commit do DeepLook no cabeçalho):

| Passo | O/D | Resultado (ok, falha, pulado) | Tempo / medida | Observação |
|---|---|---|---|---|
| 0.1 | O | | | |
| 0.2 | O | | | |
| … | | | | |

## 8. Automação (proposta)

Depois da primeira rodada manual, o script `scripts/sandbox-real-check.mjs` (item 5.5 do plano)
pode repetir sozinho a parte que não depende de mão na VM: fases 0, 1, 2.2, 3.1, 5.1, 6 e 9.2, pela
API do DeepLook com um token de admin, com tempo-limite em cada passo e o relatório no formato da
seção 7. A amostra rodando na VM (fases 3.2, 4 e 5.3 a 5.5) pode entrar também, pelo
`agent/exec` do PVE, se a conta tiver a permissão do agente: o script roda a amostra da seção 2.3
no guest e espera os eventos. Fases 7 e 8 ficam manuais (mexem na infraestrutura).
