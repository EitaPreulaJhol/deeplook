# PEs de teste da analise estatica (item 7.1), gerados por ferramentas reais: mingw-w64,
# windres, mcs (Mono), upx e osslsigncode. O pefile e o dnfile, referencias de mercado
# (o imphash e o Rich hash do VirusTotal sao os do pefile), gravam o gabarito em
# reference.json; os testes conferem a analise do DeepLook contra ele.
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends gcc-mingw-w64-x86-64 gcc-mingw-w64-i686 \
  binutils-mingw-w64-x86-64 binutils-mingw-w64-i686 mingw-w64-x86-64-dev mingw-w64-i686-dev \
  osslsigncode upx-ucl mono-mcs python3-pefile python3-pip openssl >/dev/null
pip install --quiet --break-system-packages dnfile==0.15.1 >/dev/null
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
$X64-gcc -O1 -s -o ofuscado64.exe ofuscado.c
$X86-gcc -O1 -s -o ofuscado32.exe ofuscado.c
cp /usr/bin/true linux.elf
mcs -nologo -out:dotnet.exe hello.cs
upx -q --best -o upx64.exe prog64.exe >/dev/null
upx -q --best -o upx32.exe prog32.exe >/dev/null
upx -q --best -o upx-dll.dll teste.dll >/dev/null

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
  autoassinado.exe upx-dll.dll ofuscado64.exe ofuscado32.exe linux.elf reference.json /out/
# Arquivos com o dono de quem roda os testes (senao o proximo rm do runner falha).
if [ -n "$OWNER" ]; then chown -R "$OWNER" /out; fi
echo "pe ok"
