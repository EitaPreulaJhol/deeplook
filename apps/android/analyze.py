"""APK/Android com o androguard (plans/novas-analises, item 6): roda num processo filho do server.py.

  python analyze.py <arquivo.apk>

Le o manifesto, os certificados, a lista de arquivos e a tabela de strings dos DEX; nada do
aplicativo e executado. Escreve no stdout um resumo em JSON com tetos. Os alertas (combinacoes de
permissoes, APIs sensiveis) sao montados na API, no idioma de quem pede.
"""

import hashlib
import json
import logging
import re
import sys

from androguard.core.apk import APK
from androguard.core.dex import DEX

MAX_ITEMS = 300
MAX_STRINGS_SCANNED = 400_000
MAX_TEXT = 500
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"

# Permissoes perigosas (as de nivel "dangerous" do Android) e as especiais que o malware pede.
DANGEROUS = {
    "READ_SMS", "SEND_SMS", "RECEIVE_SMS", "RECEIVE_MMS", "RECEIVE_WAP_PUSH", "READ_CONTACTS",
    "WRITE_CONTACTS", "READ_CALL_LOG", "WRITE_CALL_LOG", "PROCESS_OUTGOING_CALLS", "CALL_PHONE",
    "READ_PHONE_STATE", "READ_PHONE_NUMBERS", "ANSWER_PHONE_CALLS", "RECORD_AUDIO", "CAMERA",
    "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "ACCESS_BACKGROUND_LOCATION",
    "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "MANAGE_EXTERNAL_STORAGE", "READ_CALENDAR",
    "WRITE_CALENDAR", "BODY_SENSORS", "GET_ACCOUNTS", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO",
    "SYSTEM_ALERT_WINDOW", "REQUEST_INSTALL_PACKAGES", "REQUEST_DELETE_PACKAGES",
    "QUERY_ALL_PACKAGES", "PACKAGE_USAGE_STATS", "BIND_ACCESSIBILITY_SERVICE",
    "BIND_DEVICE_ADMIN", "BIND_NOTIFICATION_LISTENER_SERVICE", "WRITE_SETTINGS",
    "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS", "RECEIVE_BOOT_COMPLETED", "DISABLE_KEYGUARD",
    "USE_FULL_SCREEN_INTENT", "FOREGROUND_SERVICE",
}

# APIs sensiveis, pelo descritor da classe (e o metodo, quando so o metodo diz) na tabela de
# strings do DEX: id -> (classe, metodo ou None).
APIS = {
    "sms_send": ("Landroid/telephony/SmsManager;", "sendTextMessage"),
    "sms_read": ("Landroid/provider/Telephony$Sms;", None),
    "accessibility": ("Landroid/accessibilityservice/AccessibilityService;", None),
    "device_admin": ("Landroid/app/admin/DeviceAdminReceiver;", None),
    "dex_loader": ("Ldalvik/system/DexClassLoader;", None),
    "in_memory_dex": ("Ldalvik/system/InMemoryDexClassLoader;", None),
    "runtime_exec": ("Ljava/lang/Runtime;", "exec"),
    "reflection": ("Ljava/lang/reflect/Method;", "invoke"),
    "camera": ("Landroid/hardware/Camera;", None),
    "camera2": ("Landroid/hardware/camera2/CameraManager;", None),
    "audio_record": ("Landroid/media/AudioRecord;", None),
    "media_recorder": ("Landroid/media/MediaRecorder;", None),
    "screen_capture": ("Landroid/media/projection/MediaProjectionManager;", None),
    "overlay": ("Landroid/view/WindowManager$LayoutParams;", "TYPE_APPLICATION_OVERLAY"),
    "location": ("Landroid/location/LocationManager;", None),
    "contacts": ("Landroid/provider/ContactsContract;", None),
    "call_log": ("Landroid/provider/CallLog;", None),
    "package_install": ("Landroid/content/pm/PackageInstaller;", None),
    "crypto": ("Ljavax/crypto/Cipher;", None),
    "native_load": ("Ljava/lang/System;", "loadLibrary"),
    "webview_js": ("Landroid/webkit/WebView;", "addJavascriptInterface"),
    "su_binary": (None, "/system/xbin/su"),
    "telephony_id": ("Landroid/telephony/TelephonyManager;", "getDeviceId"),
    "notification_listener": ("Landroid/service/notification/NotificationListenerService;", None),
}

URL_RE = re.compile(r"\bhttps?://[^\s\"'<>`]{4,300}", re.I)
IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
# Dominios com TLD de letras; sem o pacote Java (com.exemplo.app) e sem nomes de arquivo comuns.
DOMAIN_RE = re.compile(r"\b(?:[a-z0-9-]{1,63}\.)+(?:com|net|org|io|ru|cn|top|xyz|info|biz|br|tk|ml|ga|cf|gq|pw|cc|su|onion)\b", re.I)
NOT_HOSTS = re.compile(r"\.(?:png|jpg|xml|java|kt|so|dex|json|html|js|css)$", re.I)


def text(value, limit=MAX_TEXT):
    if value is None:
        return None
    return str(value).replace("\x00", "")[:limit]


def short(name):
    """android.permission.SEND_SMS -> SEND_SMS (as de outros pacotes ficam inteiras)."""
    return name.split(".")[-1] if name.startswith("android.permission.") else name


def exported_components(apk):
    """Componentes exportados: android:exported="true", ou com intent-filter e sem o atributo."""
    out = []
    try:
        manifest = apk.get_android_manifest_xml()
    except Exception:  # noqa: BLE001 - manifesto que nao le: sem a lista
        return out
    if manifest is None:
        return out
    app = manifest.find("application")
    if app is None:
        return out
    for tag in ("activity", "activity-alias", "service", "receiver", "provider"):
        for node in app.findall(tag):
            name = node.get(f"{ANDROID_NS}name")
            exported = node.get(f"{ANDROID_NS}exported")
            filters = node.findall("intent-filter")
            if exported == "true" or (exported is None and filters):
                actions = [
                    a.get(f"{ANDROID_NS}name")
                    for f in filters
                    for a in f.findall("action")
                    if a.get(f"{ANDROID_NS}name")
                ]
                out.append(
                    {
                        "kind": tag,
                        "name": text(name, 300),
                        "permission": text(node.get(f"{ANDROID_NS}permission"), 300),
                        "actions": [text(a, 200) for a in actions[:10]],
                    }
                )
            if len(out) >= MAX_ITEMS:
                return out
    return out


def certificates(apk):
    out = []
    try:
        certs = apk.get_certificates()
    except Exception:  # noqa: BLE001 - assinatura quebrada: sem a lista, com o aviso
        return out
    for cert in certs[:5]:
        der = cert.dump()
        subject = cert.subject.human_friendly
        issuer = cert.issuer.human_friendly
        out.append(
            {
                "subject": text(subject, 400),
                "issuer": text(issuer, 400),
                "serial": text(hex(cert.serial_number), 80),
                "sha256": hashlib.sha256(der).hexdigest(),
                "notBefore": text(cert["tbs_certificate"]["validity"]["not_before"].native.isoformat(), 40),
                "notAfter": text(cert["tbs_certificate"]["validity"]["not_after"].native.isoformat(), 40),
                "selfSigned": subject == issuer,
                # O certificado de depuracao do Android Studio: "CN=Android Debug".
                "debug": "android debug" in subject.lower(),
            }
        )
    return out


def dex_strings(apk):
    """A tabela de strings de todos os DEX (com teto)."""
    strings = []
    errors = []
    for raw in apk.get_all_dex():
        try:
            dex = DEX(raw)
        except Exception as exc:  # noqa: BLE001 - DEX quebrado ou protegido: segue com os outros
            errors.append(text(exc, 200))
            continue
        for s in dex.get_strings():
            strings.append(s if isinstance(s, str) else str(s))
            if len(strings) >= MAX_STRINGS_SCANNED:
                return strings, errors
    return strings, errors


def main():
    logging.disable(logging.CRITICAL)
    # O androguard registra no loguru: nada no stdout alem do JSON.
    try:
        from loguru import logger

        logger.remove()
    except Exception:  # noqa: BLE001
        pass
    path = sys.argv[1]
    try:
        apk = APK(path)
    except Exception as exc:  # noqa: BLE001 - nao e APK
        print(json.dumps({"ok": False, "error": f"não foi possível ler o APK: {text(exc, 200)}"}))
        return
    if not apk.is_valid_APK():
        print(json.dumps({"ok": False, "error": "o arquivo não é um APK válido (sem AndroidManifest.xml)"}))
        return

    permissions = sorted(set(apk.get_permissions() or []))
    strings, dex_errors = dex_strings(apk)
    pool = set(strings)
    apis = []
    for api_id, (cls, method) in APIS.items():
        hit = (cls is None or cls in pool) and (method is None or method in pool)
        if hit:
            apis.append(api_id)

    urls, ips, domains = [], [], []
    seen = set()
    for s in strings:
        if len(urls) < MAX_ITEMS:
            for m in URL_RE.findall(s):
                if m not in seen:
                    seen.add(m)
                    urls.append(text(m))
        if len(ips) < MAX_ITEMS:
            for m in IP_RE.findall(s):
                parts = [int(p) for p in m.split(".")]
                if all(p <= 255 for p in parts) and m not in seen and not m.startswith(("0.", "127.")):
                    seen.add(m)
                    ips.append(m)
        if len(domains) < MAX_ITEMS and "." in s and len(s) < 300:
            for m in DOMAIN_RE.findall(s):
                d = m.lower()
                if d not in seen and not NOT_HOSTS.search(d):
                    seen.add(d)
                    domains.append(d)

    files = apk.get_files() or []
    native = sorted({f for f in files if f.startswith("lib/") and f.endswith(".so")})
    dex_files = [f for f in files if re.match(r"^classes\d*\.dex$", f)]
    # DEX ou APK escondidos em assets (carregados depois com o DexClassLoader).
    hidden = [f for f in files if f.startswith("assets/") and re.search(r"\.(dex|apk|jar|zip|bin|dat)$", f, re.I)]

    signed = {}
    for name, fn in (("v1", "is_signed_v1"), ("v2", "is_signed_v2"), ("v3", "is_signed_v3")):
        try:
            signed[name] = bool(getattr(apk, fn)())
        except Exception:  # noqa: BLE001
            signed[name] = False

    with open(path, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()

    def safe(fn, default=None):
        try:
            return fn()
        except Exception:  # noqa: BLE001 - manifesto incompleto
            return default

    out = {
        "ok": True,
        "sha256": sha,
        "package": text(safe(apk.get_package), 300),
        "appName": text(safe(apk.get_app_name), 300),
        "versionName": text(safe(apk.get_androidversion_name), 100),
        "versionCode": text(safe(apk.get_androidversion_code), 40),
        "minSdk": text(safe(apk.get_min_sdk_version), 10),
        "targetSdk": text(safe(apk.get_target_sdk_version), 10),
        "mainActivity": text(safe(apk.get_main_activity), 300),
        "permissions": [
            {"name": text(p, 300), "short": text(short(p), 200), "dangerous": short(p) in DANGEROUS}
            for p in permissions[:MAX_ITEMS]
        ],
        "components": {
            "activities": len(safe(apk.get_activities, []) or []),
            "services": len(safe(apk.get_services, []) or []),
            "receivers": len(safe(apk.get_receivers, []) or []),
            "providers": len(safe(apk.get_providers, []) or []),
        },
        "exported": exported_components(apk),
        "certificates": certificates(apk),
        "signed": signed,
        "apis": apis,
        "urls": urls,
        "ips": ips[:MAX_ITEMS],
        "domains": domains[:MAX_ITEMS],
        "dexFiles": dex_files[:50],
        "nativeLibs": [text(f, 300) for f in native[:MAX_ITEMS]],
        "hiddenPayloads": [text(f, 300) for f in hidden[:MAX_ITEMS]],
        "fileCount": len(files),
        "dexErrors": dex_errors[:10],
    }
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
