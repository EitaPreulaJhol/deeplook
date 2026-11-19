"""Gabarito dos PEs de teste (item 7.1), tirado do pefile, do dnfile e do osslsigncode."""
import json
import os
import re
import subprocess
import sys

import dnfile
import pefile

W = sys.argv[1]
FILES = [
    'prog64.exe', 'prog32.exe', 'teste.dll', 'dotnet.exe', 'upx64.exe', 'upx32.exe',
    'upx-disfarcado.exe', 'rich.exe', 'rich-forjado.exe', 'checksum-ok.exe',
    'checksum-errado.exe', 'overlay.exe', 'assinado.exe', 'adulterado.exe', 'autoassinado.exe', 'upx-dll.dll',
    'pdb.exe',
]
d = lambda b: b.decode('latin1') if isinstance(b, bytes) else b


def resources(pe):
    out = []
    if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        return out
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        for n in getattr(t, 'directory', None) and t.directory.entries or []:
            for lang in getattr(n, 'directory', None) and n.directory.entries or []:
                out.append({
                    'type': t.id if t.name is None else str(t.name),
                    'name': n.id if n.name is None else str(n.name),
                    'lang': lang.id,
                    'size': lang.data.struct.Size,
                })
    return out


def tls_callbacks(pe):
    if not hasattr(pe, 'DIRECTORY_ENTRY_TLS'):
        return None
    va = pe.DIRECTORY_ENTRY_TLS.struct.AddressOfCallBacks
    if not va:
        return []
    rva = va - pe.OPTIONAL_HEADER.ImageBase
    step = 8 if pe.PE_TYPE == pefile.OPTIONAL_HEADER_MAGIC_PE_PLUS else 4
    out = []
    while len(out) < 64:
        v = pe.get_qword_at_rva(rva) if step == 8 else pe.get_dword_at_rva(rva)
        if not v:
            break
        out.append(v - pe.OPTIONAL_HEADER.ImageBase)
        rva += step
    return out


def version(pe):
    out = {}
    for fi in getattr(pe, 'FileInfo', []) or []:
        for entry in fi:
            for st in getattr(entry, 'StringTable', []) or []:
                for k, v in st.entries.items():
                    out[d(k)] = d(v)
    return out


def dotnet(path):
    dn = dnfile.dnPE(path)
    if not dn.net:
        return None
    md = dn.net.metadata
    asm = dn.net.mdtables.Assembly
    a = asm.rows[0] if asm and asm.rows else None
    refs = [str(r.Name) for r in (dn.net.mdtables.AssemblyRef.rows if dn.net.mdtables.AssemblyRef else [])]
    pinv = []
    if dn.net.mdtables.ImplMap:
        for r in dn.net.mdtables.ImplMap.rows:
            pinv.append({'dll': str(r.ImportScope.row.Name), 'name': str(r.ImportName)})
    members = sorted({str(r.Name) for r in (dn.net.mdtables.MemberRef.rows if dn.net.mdtables.MemberRef else [])})
    typerefs = sorted({f'{r.TypeNamespace}.{r.TypeName}' for r in dn.net.mdtables.TypeRef.rows})
    return {
        'runtime': d(md.struct.Version).rstrip('\0'),
        'flags': dn.net.struct.Flags.value if hasattr(dn.net.struct.Flags, 'value') else int(dn.net.struct.Flags),
        'assembly': None if a is None else {
            'name': str(a.Name),
            'version': f'{a.MajorVersion}.{a.MinorVersion}.{a.BuildNumber}.{a.RevisionNumber}',
        },
        'module': str(dn.net.mdtables.Module.rows[0].Name),
        'assemblyRefs': refs,
        'pinvoke': pinv,
        'memberRefs': members,
        'typeRefs': typerefs,
    }


def signature(path):
    res = subprocess.run(['osslsigncode', 'verify', '-CAfile', f'{W}/ca.pem', '-in', path],
                         capture_output=True, text=True)
    text = res.stdout + res.stderr
    if 'No signature found' in text:
        return None
    current = re.search(r'Current message digest\s*:\s*([0-9A-F]+)', text)
    calc = re.search(r'Calculated message digest\s*:\s*([0-9A-F]+)', text)
    ts = re.search(r'Timestamp time\s*:\s*(.+)', text)
    return {
        'timestamp': ts.group(1).strip() if ts else None,
        'verifyOk': res.returncode == 0,
        'digest': current.group(1).lower() if current else None,
        'digestMatches': bool(current and calc and current.group(1) == calc.group(1)),
    }


out = {}
for name in FILES:
    path = f'{W}/{name}'
    pe = pefile.PE(path)
    r = {'size': os.path.getsize(path)}
    r['imphash'] = pe.get_imphash() or None
    r['richHash'] = pe.get_rich_header_hash() or None
    if pe.RICH_HEADER:
        v = pe.RICH_HEADER.values
        r['rich'] = {
            'key': pe.RICH_HEADER.key.hex(),
            'entries': [{'compId': v[i], 'count': v[i + 1]} for i in range(0, len(v), 2)],
        }
    r['machine'] = pe.FILE_HEADER.Machine
    r['entryPoint'] = pe.OPTIONAL_HEADER.AddressOfEntryPoint
    r['sections'] = [{'name': d(s.Name.rstrip(b'\0')), 'characteristics': s.Characteristics}
                     for s in pe.sections]
    r['imports'] = [
        {'dll': d(e.dll), 'functions': [d(i.name) if i.name else f'ord{i.ordinal}' for i in e.imports]}
        for e in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', [])
    ]
    if hasattr(pe, 'DIRECTORY_ENTRY_EXPORT'):
        ex = pe.DIRECTORY_ENTRY_EXPORT
        r['exports'] = {
            'name': d(ex.name),
            'symbols': [{'ordinal': s.ordinal, 'name': d(s.name), 'forwarder': d(s.forwarder)}
                        for s in ex.symbols],
        }
    ov = pe.get_overlay_data_start_offset()
    r['overlay'] = None if ov is None else {'offset': ov, 'size': r['size'] - ov}
    r['tlsCallbacks'] = tls_callbacks(pe)
    r['checksum'] = {'declared': pe.OPTIONAL_HEADER.CheckSum, 'computed': pe.generate_checksum()}
    r['resources'] = resources(pe)
    r['version'] = version(pe)
    sec = pe.OPTIONAL_HEADER.DATA_DIRECTORY[4]
    r['certTable'] = {'offset': sec.VirtualAddress, 'size': sec.Size} if sec.Size else None
    r['signature'] = signature(path)
    r['dotnet'] = dotnet(path) if pe.OPTIONAL_HEADER.DATA_DIRECTORY[14].Size else None
    r['debug'] = []
    for e in getattr(pe, 'DIRECTORY_ENTRY_DEBUG', []):
        cv = getattr(e, 'entry', None)
        item = {'type': e.struct.Type, 'timestamp': e.struct.TimeDateStamp}
        if cv is not None and getattr(cv, 'CvSignature', None) == b'RSDS':
            g = cv
            item['guid'] = f'{g.Signature_Data1:08X}-{g.Signature_Data2:04X}-{g.Signature_Data3:04X}-' \
                f'{g.Signature_Data4:02X}{g.Signature_Data5:02X}-{bytes(g.Signature_Data6).hex().upper()}'
            item['age'] = g.Age
            item['path'] = d(g.PdbFileName).rstrip('\0')
        r['debug'].append(item)
    out[name] = r
print(json.dumps(out, indent=1, sort_keys=True))
