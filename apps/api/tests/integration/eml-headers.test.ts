import { parseEmail } from '../../src/lib/eml';

// Cabecalhos repetidos e dobrados no .eml. O postal-mime 3.0 mudou os dois comportamentos
// (o primeiro cabecalho repetido passou a valer, e o espaco de dobra e mantido); estes
// testes fixam o que o analista ve, para a proxima atualizacao nao mudar isso em silencio.

let fails = 0;
const ok = (label: string, cond: boolean | undefined, detail: unknown = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${label}${cond ? '' : ' ' + JSON.stringify(detail)}`);
};

/** .eml com os cabecalhos dados (CRLF, como e-mail de verdade) e um corpo curto. */
const eml = (headers: string[]) =>
  Buffer.from(`${headers.join('\r\n')}\r\n\r\ncorpo da mensagem\r\n`);
const MAX = 1024 * 1024;

async function main() {
  // 1. Remetente e assunto repetidos (truque de falsificacao): vale o primeiro, como a RFC 5322
  //    manda (um so de cada) e como o postal-mime 3+ resolve.
  const dup = await parseEmail(
    eml([
      'From: Primeiro <primeiro@legit.test>',
      'From: Segundo <segundo@evil.test>',
      'To: vitima@x.test',
      'Subject: Fatura',
      'Subject: Outro assunto',
      'Date: Mon, 02 Nov 2026 10:00:00 +0000',
      'Message-ID: <1@x.test>',
    ]),
    MAX,
  );
  ok(
    'From repetido: vale o primeiro',
    dup.info.from?.address === 'primeiro@legit.test',
    dup.info.from,
  );
  ok('Subject repetido: vale o primeiro', dup.info.subject === 'Fatura', dup.info.subject);

  // 2. Assunto dobrado em duas linhas (continuacao): sai numa linha so, sem quebra.
  const folded = await parseEmail(
    eml([
      'From: a@x.test',
      'To: b@x.test',
      'Subject: primeira parte',
      ' segunda parte',
      'Date: Mon, 02 Nov 2026 10:00:00 +0000',
    ]),
    MAX,
  );
  ok(
    'Subject dobrado: sai numa linha',
    folded.info.subject === 'primeira parte segunda parte',
    folded.info.subject,
  );

  // 3. Received dobrado em varias linhas (o normal num e-mail real): os saltos saem na ordem,
  //    do primeiro servidor ao ultimo, com de onde veio, por onde passou e quando.
  const hops = await parseEmail(
    eml([
      'Received: from mx2.legit.test (mx2.legit.test [203.0.113.5])',
      '\tby mx1.x.test with ESMTPS id abc123',
      '\tfor <vitima@x.test>;',
      '\tMon, 02 Nov 2026 10:00:05 +0000',
      'Received: from origem.test (origem.test [198.51.100.7])',
      ' by mx2.legit.test with SMTP id def456;',
      ' Mon, 02 Nov 2026 10:00:01 +0000',
      'From: a@x.test',
      'To: vitima@x.test',
      'Subject: oi',
    ]),
    MAX,
  );
  const [first, last] = hops.info.received;
  ok('Received dobrado: dois saltos', hops.info.received.length === 2, hops.info.received);
  ok(
    'primeiro salto: de onde veio, por onde entrou e quando',
    first?.from === 'origem.test (origem.test [198.51.100.7])' &&
      first?.by === 'mx2.legit.test' &&
      first?.date === '2026-11-02T10:00:01.000Z',
    first,
  );
  ok(
    'último salto: o servidor que entregou',
    last?.from === 'mx2.legit.test (mx2.legit.test [203.0.113.5])' &&
      last?.by === 'mx1.x.test' &&
      last?.date === '2026-11-02T10:00:05.000Z',
    last,
  );

  // 4. Authentication-Results dobrado: vale o primeiro (o do servidor que entregou), mesmo
  //    que outro, mais abaixo, diga que esta tudo bem.
  const auth = await parseEmail(
    eml([
      'Authentication-Results: mx1.x.test;',
      ' spf=pass smtp.mailfrom=legit.test;',
      ' dkim=fail header.d=legit.test;',
      ' dmarc=fail (p=reject) header.from=legit.test',
      'Authentication-Results: forjado.test; spf=pass; dkim=pass; dmarc=pass',
      'From: a@x.test',
      'To: vitima@x.test',
      'Subject: oi',
    ]),
    MAX,
  );
  ok(
    'Authentication-Results: o primeiro vale, e o forjado de baixo não o desfaz',
    auth.info.auth.spf === 'pass' &&
      auth.info.auth.dkim === 'fail' &&
      auth.info.auth.dmarc === 'fail',
    auth.info.auth,
  );

  // 5. Um arquivo que nao e e-mail continua sendo recusado.
  const notMail = await parseEmail(Buffer.from('isto nao e um e-mail\r\n'), MAX).catch(
    (e: Error) => e,
  );
  ok(
    'arquivo que não é e-mail: recusado',
    notMail instanceof Error && notMail.message.includes('não parece um e-mail'),
    String(notMail),
  );

  console.log(fails ? `\n${fails} falha(s)` : '\ntudo ok');
  process.exit(fails ? 1 : 0);
}
main();
