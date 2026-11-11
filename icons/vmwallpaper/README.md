# Papéis de parede das VMs (Proxmox)

Fundo no azul da topbar do site com a lupa do favicon e o nome **DeepLook**,
em duas versões: **desktop** (marca centralizada) e **tela de bloqueio** (fundo
mais escuro, marca no canto inferior esquerdo).

| Arquivo | Uso |
|---|---|
| `deeplook-wallpaper.svg` | Fonte vetorial do desktop (editável, escala sem perder qualidade) |
| `deeplook-vm-*.png` | Versões rasterizadas prontas para o guest |
| `deeplook-lock-wallpaper.svg` | Fonte vetorial da tela de bloqueio |
| `deeplook-lock-*.png` | Versões rasterizadas da tela de bloqueio |
| `render.sh` | Regera os PNGs a partir dos SVGs |

## Cores

Tiradas de `apps/web/src/styles/_tokens.scss`, as mesmas da topbar:

- `--dl-topbar-1`: `#2c7cc0` (topo)
- `--dl-topbar-2`: `#0d5a9e` (base)

A versão de tela de bloqueio usa o mesmo matiz com a luminosidade rebaixada
(`#1b4b78` → `#05192d`). A tela de bloqueio do SO já escurece (Windows) ou
escurece e desfoca (GNOME) a imagem antes de desenhar o login, então um fundo
claro demais lava a marca; o tom noturno mantém o "azul DeepLook" legível
mesmo com o scrim do sistema por cima.

## Tamanhos gerados

`1024x768` (4:3), `1280x800` (16:10), `1366x768`, `1600x900`,
`1920x1080`, `1920x1200` (16:10), `2560x1440`, `3840x2160` (4K).

Cada SVG tem duas camadas: o fundo usa `slice` (preenche a tela e corta as
bordas em proporções diferentes) e a marca usa `meet` (escala inteira, sem
distorcer). No wallpaper normal a marca fica centralizada (`xMidYMid`); no de
lock screen ela é ancorada embaixo à esquerda (`xMinYMax`). Por isso a mesma
arte funciona em 4:3, 16:9, 16:10 e ultrawide.

## Tela de bloqueio

- **Marca no canto inferior esquerdo**: lupa + `DeepLook`, com 96 px de margem
  (em unidades de 1080p). É a área que sobra livre no Windows (relógio/avatar e
  caixa de senha ficam no centro e na faixa superior) e no GNOME (relógio no
  topo, campo de senha no centro).
- **Fundo fechado**: gradiente diagonal escuro, aros de lente concêntricos na
  marca (quase imperceptíveis, dão profundidade sem competir com o texto do
  login) e um bolsão de luz atrás da marca para ela não sumir com o scrim.
- A palavra e a lupa ficam a 94% de opacidade: é assinatura, não interface.

## Regerar os PNGs

Requer Chromium ou Chrome:

```bash
./render.sh              # os dois conjuntos
./render.sh vm           # só o do desktop
./render.sh lock         # só o da tela de bloqueio
# ou, se o binário tiver outro nome/caminho:
CHROMIUM=/usr/bin/chromium ./render.sh
```

Para incluir outro tamanho, acrescente `LARGURAxALTURA` ao array `SIZES` do
`render.sh` e rode de novo.

## Aplicar nas VMs

Aplique no **template** do Proxmox (assim os clones do sandbox já nascem com
ele) ou direto no guest.

### Desktop

- **Windows 11**: Configurações → Personalização → Plano de fundo → Imagem.
  Para valer para todos os usuários, use `C:\Windows\Web\Wallpaper\DeepLook\`
  e o caminho em `HKCU\Control Panel\Desktop\Wallpaper` (ou política
  `Desktop Wallpaper` em `User Configuration`).
- **Linux (GNOME)**: `gsettings set org.gnome.desktop.background picture-uri
  'file:///caminho/deeplook-vm-1920x1080.png'` (idem para
  `picture-uri-dark`).
- **Linux (XFCE)**: `xfconf-query -c xfce4-desktop -p
  /backdrop/screen0/monitor0/workspace0/last-image -s /caminho/arquivo.png`.

### Tela de bloqueio

- **Windows 11**: Configurações → Personalização → Tela de bloqueio →
  "Imagem" → escolher `deeplook-lock-<resolução>.png`. No template, copie para
  `C:\Windows\Web\Screen\DeepLook\` e aponte a política
  `HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization\LockScreenImage`
  (vale para todos os usuários, inclusive antes do logon; a Microsoft documenta
  essa política para Enterprise/Education).
- **Linux (GNOME)**: `gsettings set org.gnome.desktop.screensaver picture-uri
  'file:///caminho/deeplook-lock-1920x1080.png'`.
- **Linux (XFCE)**: o `light-locker` não tem imagem própria — ele mostra o plano
  de fundo atual da sessão, então aplique o `deeplook-lock-*` como fundo de área
  de trabalho e bloqueie com `light-locker-command -l`. Com `xfce4-screensaver`,
  escolha a imagem em Configurações → Protetor de tela.

Escolha o PNG da resolução do convidado; as proporções da marca são mantidas
em qualquer uma delas.

## Nota sobre o ícone

O SVG original (`apps/web/public/icons/magnifier.svg`) tem um `circle` de
brilho sem `fill` (o padrão do SVG é preto), o que pinta o interior da lupa de
preto no navegador. Nos papéis de parede esse círculo foi mantido como
`fill="none"`, que é o desenho pretendido (lente azul-clara). Se quiser a arte
idêntica ao que o site renderiza hoje, remova o `fill="none"` do círculo de
`r="3.5"` nos dois SVGs e rode `./render.sh` novamente.
