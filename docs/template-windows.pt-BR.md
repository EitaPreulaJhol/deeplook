# 🧰 Programas para o template Windows do sandbox

> 🇬🇧 [Read in English](template-windows.md)

Sugestões do que instalar na VM que vira o template do ambiente isolado (passo 2.1 do
[guia do Proxmox](proxmox.pt-BR.md)). O template tem três papéis ao mesmo tempo:

- **parecer a máquina de uma vítima comum**, para a amostra executar o que faria de verdade (muito
  malware desiste quando não acha o Office, o navegador ou um runtime, ou quando a máquina parece
  um laboratório);
- **dar ao analista ferramentas de observação** quando ele abre o console;
- **não vazar nada**: nenhuma conta real, nenhum envio automático de amostra para fora.

Tudo é instalado **antes** do snapshot e da conversão em template; cada ambiente nasce de um clone
e é descartado no fim do prazo, então nada do que a amostra faz chega ao template.

> **Licenças:** Office e WinRAR são pagos; o resto da lista é gratuito. Use licenças que você tem
> direito de usar numa VM de análise.

## 1. Base (o DeepLook depende disto)

| Programa | Para quê | Download oficial |
|---|---|---|
| Drivers VirtIO e QEMU Guest Agent | disco e rede paravirtualizados; o agente é por onde o DeepLook lê os processos, roda a amostra e coleta os arquivos | [Windows VirtIO Drivers](https://pve.proxmox.com/wiki/Windows_VirtIO_Drivers) · [Qemu-guest-agent](https://pve.proxmox.com/wiki/Qemu-guest-agent) |
| Sysmon (com o `sysmon.bat`) | árvore de processos, rede, arquivos, registro e DNS nos artefatos do ambiente | [Sysmon](https://learn.microsoft.com/sysinternals/downloads/sysmon) · configuração no [guia do Proxmox](proxmox.pt-BR.md), passo 2.1 |
| Autologon | entra sozinho num usuário comum: a execução automática roda na sessão dele e aparece no console | [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon) |

## 2. Para a amostra executar

O que a amostra espera encontrar numa máquina de escritório. Sem isso, documentos não abrem,
instaladores falham e muito malware simplesmente não faz nada.

| Programa | Por quê | Download oficial |
|---|---|---|
| Microsoft Office (Word, Excel, PowerPoint) | macros, DDE e objetos embutidos só executam com o Office; a análise estática do DeepLook (oletools) mostra o código, a VM mostra o efeito | [Office Deployment Tool](https://learn.microsoft.com/microsoft-365-apps/deploy/overview-office-deployment-tool) · [Office LTSC 2024](https://learn.microsoft.com/office/ltsc/2024/deploy) |
| Adobe Acrobat Reader | PDFs com JavaScript ou que se fazem passar por fatura | [Acrobat Reader](https://get.adobe.com/reader/) |
| Google Chrome e Mozilla Firefox (o Edge já vem) | links de phishing e cargas que procuram perfis e senhas salvas do navegador | [Chrome](https://www.google.com/chrome/) · [Firefox](https://www.mozilla.org/firefox/new/) |
| 7-Zip e WinRAR | anexos compactados (ZIP, RAR, 7z) com senha, o formato mais comum de entrega | [7-Zip](https://www.7-zip.org/) · [WinRAR](https://www.win-rar.com/download.html) |
| .NET Framework 3.5 e 4.8, .NET Desktop Runtime | grande parte dos stealers e RATs é .NET; o 3.5 se liga pelo Windows (`DISM /Online /Enable-Feature /FeatureName:NetFx3 /All`) | [.NET Framework](https://dotnet.microsoft.com/download/dotnet-framework) · [.NET](https://dotnet.microsoft.com/download/dotnet) |
| Visual C++ Redistributable (x64 e x86) | dependência de muito executável nativo; sem ele, a amostra falha antes de começar | [Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist) |
| Java (JRE) | arquivos `.jar` (o DeepLook identifica o JAR, mas só executa com Java) | [Eclipse Temurin JRE](https://adoptium.net/temurin/releases/?os=windows&package=jre) |
| Python | scripts `.py` e executáveis gerados com PyInstaller que chamam o interpretador | [Python para Windows](https://www.python.org/downloads/windows/) |

## 3. Ferramentas de observação (pelo console)

Para o analista acompanhar a execução ao vivo. A análise estática (capa, Ghidra, Detect It Easy,
oletools, YARA) já roda no servidor do DeepLook; aqui entra o que só a execução mostra.

| Programa | Para quê | Download oficial |
|---|---|---|
| Sysinternals Suite | o conjunto inteiro, com os quatro abaixo | [Sysinternals Suite](https://learn.microsoft.com/sysinternals/downloads/sysinternals-suite) |
| Process Explorer | processos, DLLs carregadas, handles e cadeia pai-filho | [Process Explorer](https://learn.microsoft.com/sysinternals/downloads/process-explorer) |
| Process Monitor | cada acesso a arquivo, registro e processo, com filtro | [Process Monitor](https://learn.microsoft.com/sysinternals/downloads/procmon) |
| Autoruns | o que a amostra deixou para iniciar sozinha (persistência) | [Autoruns](https://learn.microsoft.com/sysinternals/downloads/autoruns) |
| TCPView | conexões abertas por processo, em tempo real | [TCPView](https://learn.microsoft.com/sysinternals/downloads/tcpview) |
| System Informer | alternativa ao Process Explorer, com memória, serviços e rede numa tela só | [System Informer](https://systeminformer.sourceforge.io/downloads.php) |
| Regshot | fotografa o registro antes e depois e lista o que mudou | [Regshot](https://sourceforge.net/projects/regshot/) |
| x64dbg | depurador, para acompanhar a amostra passo a passo | [x64dbg](https://x64dbg.com/) |

A captura de rede fica do lado de fora, no MikroTik e no Suricata (seção 9 do guia do Proxmox): não
é preciso Wireshark na VM.

> **Deixe essas ferramentas fechadas no boot.** Muito malware procura processos como `procmon`,
> `procexp`, `x64dbg` e `regshot` e para quando os encontra. Instaladas e fechadas, elas não
> atrapalham: o analista abre pelo console quando quiser. O Sysmon é a exceção, porque precisa
> rodar o tempo todo; se quiser escondê-lo, renomeie o executável antes de instalar (o serviço leva
> o nome do arquivo) e ajuste o `sysmon.bat`.

## 4. Realismo (contra evasão)

Amostras que checam se estão num laboratório olham sinais simples. Uma VM "usada" passa por mais
dessas checagens:

- **Programas comuns de usuário**, além dos da seção 2: um leitor de mídia e um editor de texto, por
  exemplo [VLC](https://www.videolan.org/vlc/) e [Notepad++](https://notepad-plus-plus.org/downloads/).
- **Arquivos e histórico**: alguns documentos em Documentos e na Área de Trabalho, downloads antigos,
  histórico e favoritos no navegador, itens recentes no Office.
- **Nomes comuns**: usuário e máquina com nomes de pessoa e de empresa, nunca `sandbox`, `malware`,
  `analysis`, `test` ou o nome de uma ferramenta.
- **Hardware plausível**: 2 núcleos ou mais, 4 GB de memória ou mais, disco de 60 GB ou mais e uma
  resolução comum (o papel de parede em `scripts/template-windows/wallpaper` tem os tamanhos usuais).
  Troque o SMBIOS do QEMU pelo de um fabricante real com o `args` do template (como root no host do
  PVE; os linked clones herdam), cobrindo a BIOS (tipo 0) e o sistema (tipo 1), que é onde as amostras
  procuram "QEMU", "SeaBIOS" ou "Proxmox". Por exemplo:
  ```bash
  qm set <template> --args "-smbios type=0,vendor='Dell Inc.',version=2.18.0,date=03/15/2024 -smbios type=1,manufacturer='Dell Inc.',product='OptiPlex 7090',serial=4F2KJ53"
  ```
  A opção `smbios1` (Opções › Configurações SMBIOS) dispensa o root, mas só cobre o tipo 1.

## 5. Configurações do Windows

- **Defender sem enviar amostras:** com o envio automático ligado, a amostra vai para a Microsoft
  antes de você terminar a análise. Num PowerShell como administrador:
  ```powershell
  Set-MpPreference -MAPSReporting Disabled -SubmitSamplesConsent NeverSend
  Get-MpPreference | Select-Object MAPSReporting, SubmitSamplesConsent   # 0 e 2
  ```
  Referência: [Set-MpPreference](https://learn.microsoft.com/powershell/module/defender/set-mppreference)
  e [proteção na nuvem](https://learn.microsoft.com/defender-endpoint/enable-cloud-protection-microsoft-defender-antivirus).
- **Proteção em tempo real:** ligada, o Defender pode apagar a amostra antes de ela rodar; desligada,
  você vê o comportamento inteiro. Para desligar, desative antes a **Proteção contra
  adulteração** em Segurança do Windows (sem isso o Windows desfaz a mudança), depois rode
  `Set-MpPreference -DisableRealtimeMonitoring $true` e confira, depois de reiniciar, com
  `Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled`. Ligar ou não depende do que
  você quer ver: com ela ligada, a VM também mostra se o Defender pega a amostra.
- **Windows Update desligado:** o template não deve mudar sozinho entre um ambiente e outro (e a
  rede isolada nem deixa atualizar). Em `gpedit.msc`: Configuração do Computador › Modelos
  Administrativos › Componentes do Windows › Windows Update › *Configurar Atualizações Automáticas* =
  Desabilitado. Atualize o template de propósito, de tempos em tempos, e refaça o snapshot.
- **Nenhuma conta real:** conta local, sem Microsoft, OneDrive, e-mail ou navegador sincronizado.
  Senhas salvas no navegador, se quiser realismo, só falsas.

## 6. Fechando o template

1. Feche todas as ferramentas de observação e confira que nada delas sobe no boot (Gerenciador de
   Tarefas › Inicializar).
2. Reinicie uma vez e confira o `sysmon.log` (passo 2.1 do guia do Proxmox) e o login automático.
3. Desligue a VM, crie o snapshot e converta em template (passos 3 e 4 do guia do Proxmox).
4. Abra um ambiente pelo DeepLook e rode `node scripts/sandbox-real-check.mjs`: ele confere console,
   agente, processos, Sysmon e a execução automática num clone de verdade.
