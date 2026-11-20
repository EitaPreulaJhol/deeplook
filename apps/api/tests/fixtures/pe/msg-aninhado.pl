#!/usr/bin/perl
# .msg com outro e-mail anexado (plans/analise-estatica-ampliada, item 10): o "Encaminhar como anexo"
# do Outlook. O e-mail de dentro (um armazenamento __substg1.0_3701000D) tem o proprio anexo, que a
# DeepLook deve tirar como amostra. Gerado com o OLE::Storage_Lite (escreve arquivos OLE).
#   perl msg-aninhado.pl <saida.msg> <arquivo anexado ao e-mail de dentro>
use strict;
use warnings;
use Encode qw(encode);
use OLE::Storage_Lite;

my ($out, $payload) = @ARGV;
open(my $fh, '<:raw', $payload) or die "payload: $!";
my $data = do { local $/; <$fh> };
close $fh;

sub name { OLE::Storage_Lite::Asc2Ucs($_[0]) }
sub file { OLE::Storage_Lite::PPS::File->new(name($_[0]), $_[1]) }
sub dir { OLE::Storage_Lite::PPS::Dir->new(name($_[0]), undef, undef, $_[1]) }
sub text { file('__substg1.0_' . $_[0] . '001F', encode('UTF-16LE', $_[1])) }
# O cabecalho do stream de propriedades: 32 bytes no topo, 24 dentro de um anexo ou e-mail anexado.
sub props { file('__properties_version1.0', "\0" x $_[0]) }

my $inner_attach = dir('__attach_version1.0_#00000000', [
  props(8),
  text('3707', 'fatura.exe'),
  file('__substg1.0_37010102', $data),
]);
my $inner = dir('__substg1.0_3701000D', [
  props(24),
  text('0037', 'Fatura em atraso'),
  text('0C1F', 'cobranca@evil.test'),
  text('1000', 'Segue a fatura.'),
  $inner_attach,
]);
my $outer_attach = dir('__attach_version1.0_#00000000', [
  props(8),
  text('3707', 'Fatura em atraso.msg'),
  $inner,
]);
my $root = OLE::Storage_Lite::PPS::Root->new(undef, undef, [
  props(32),
  text('0037', 'ENC: Fatura em atraso'),
  text('0C1F', 'usuario@empresa.test'),
  text('1000', 'Recebi este e-mail estranho, segue anexo.'),
  $outer_attach,
]);
$root->save($out) or die "save: $!";
