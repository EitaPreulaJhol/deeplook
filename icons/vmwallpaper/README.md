# Papel de parede das VMs (Proxmox)

Fundo no azul da topbar do site com a lupa do favicon e o nome **DeepLook**.

| Arquivo | Uso |
|---|---|
| `deeplook-wallpaper.svg` | Fonte vetorial (editável, escala sem perder qualidade) |
| `deeplook-vm-*.png` | Versões rasterizadas prontas para o guest |
| `render.sh` | Regera os PNGs a partir do SVG |

## Cores

Tiradas de `apps/web/src/styles/_tokens.scss`, as mesmas da topbar:

- `--dl-topbar-1`: `#2c7cc0` (topo)
- `--dl-topbar-2`: `#0d5a9e` (base)

## Tamanhos gerados

`1024x768` (4:3), `1280x800` (16:10), `1366x768`, `1600x900`,
`1920x1080`, `1920x1200` (16:10), `2560x1440`, `3840x2160` (4K).

O SVG tem duas camadas: o fundo usa `slice` (preenche a tela e corta as bordas
em proporções diferentes) e o logo usa `meet` (escala inteiro, sem distorcer,
sempre centralizado). Por isso a mesma arte funciona em 4:3, 16:9, 16:10 e
ultrawide.

## Regerar os PNGs

Requer Chromium ou Chrome:

```bash
./render.sh
# ou, se o binário tiver outro nome/caminho:
CHROMIUM=/usr/bin/chromium ./render.sh
```

Para incluir outro tamanho, acrescente `LARGURAxALTURA` ao array `SIZES` do
`render.sh` e rode de novo.

## Aplicar nas VMs

Aplique no **template** do Proxmox (assim os clones do sandbox já nascem com
ele) ou direto no guest:

- **Windows 11**: Configurações → Personalização → Plano de fundo → Imagem.
  Para valer para todos os usuários, use `C:\Windows\Web\Wallpaper\DeepLook\`
  e o caminho em `HKCU\Control Panel\Desktop\Wallpaper` (ou política
  `Desktop Wallpaper` em `User Configuration`).
- **Linux (GNOME)**: `gsettings set org.gnome.desktop.background picture-uri
  'file:///caminho/deeplook-vm-1920x1080.png'` (idem para
  `picture-uri-dark`).
- **Linux (XFCE)**: `xfconf-query -c xfce4-desktop -p
  /backdrop/screen0/monitor0/workspace0/last-image -s /caminho/arquivo.png`.

Escolha o PNG da resolução do convidado; as proporções do logo são mantidas
em qualquer uma delas.

## Nota sobre o ícone

O SVG original (`apps/web/public/icons/magnifier.svg`) tem um `circle` de
brilho sem `fill` (o padrão do SVG é preto), o que pinta o interior da lupa de
preto no navegador. No papel de parede esse círculo foi mantido como
`fill="none"`, que é o desenho pretendido (lente azul-clara). Se quiser o
wallpaper idêntico ao que o site renderiza hoje, remova o `fill="none"` do
círculo de `r="3.5"` no `deeplook-wallpaper.svg` e rode `./render.sh`
novamente.
