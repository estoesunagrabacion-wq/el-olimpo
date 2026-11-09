# Impresora Xerox: imprimir en la Phaser 3020 desde la Chromebook, sin publicidad

Esta app Android imprime PDF e imágenes en una **Xerox Phaser 3020** desde una
Chromebook (o desde cualquier dispositivo Android). Se conecta por **Wi-Fi** o
por **cable USB**. No tiene publicidad, no pide cuentas y no manda nada a
internet.

## Por qué hace falta

La Phaser 3020 la fabrica Samsung (es la misma máquina que la SL-M2020). No
entiende los formatos estándar que usa ChromeOS: solo habla un lenguaje propio
de Samsung llamado **QPDL/SPL**. La app hace lo mismo que un driver:

1. dibuja cada página a 600 ppp;
2. la pasa a blanco y negro (texto nítido o fotos tramadas);
3. la codifica en QPDL v3 (compresión 0x11, bandas de 128 líneas);
4. la manda a la impresora por la red (puerto 9100) o por USB.

La codificación QPDL se portó a Kotlin a partir de **SpliX**, el driver libre
para Linux que tiene soporte para la Phaser 3020.

## Cómo instalarla en la Chromebook

La app no está en Play Store. Se instala el archivo `.apk` a mano, una sola vez.

### 1. Descargar el APK

En este repositorio de GitHub, entrá a **Releases → "Impresora Xerox (última
versión)"** y descargá `ImpresoraXerox.apk`. Cada cambio al código genera una
versión nueva automáticamente.

### 2. Activar la instalación de apps Android ("ADB")

Necesitás tener activado el entorno de Linux.

1. Abrí **Configuración → Información de ChromeOS → Desarrolladores → Entorno de
   desarrollo de Linux**. Si todavía no está activado, activalo.
2. Entrá a **Desarrollar apps para Android** y activá **Habilitar la depuración
   de ADB**. La Chromebook se reinicia.

   > Si más adelante desactivás esta opción, ChromeOS borra la Chromebook
   > (powerwash). Lo más simple es dejarla activada. En Chromebooks
   > administradas por una escuela o una empresa, esta opción puede estar
   > bloqueada.

### 3. Instalar el APK

1. Copiá `ImpresoraXerox.apk` desde **Descargas** a la carpeta **Archivos de
   Linux**, usando la app Archivos.
2. Abrí la **Terminal** (Linux) y escribí:

   ```bash
   sudo apt install -y adb
   adb connect arc
   adb install -r ImpresoraXerox.apk
   ```

   Si `adb connect arc` no funciona, probá con `adb connect 100.115.92.2:5555`.
   La primera vez, ChromeOS pregunta si permitís la depuración: tocá
   **Permitir**.

3. La app aparece en el menú como **"Impresora Xerox"**.

## Cómo usarla

1. **Conexión**
   - **Wi-Fi:** escribí la IP de la impresora, o tocá **Buscar en la red**. Si
     no la conocés, NokoPrint la muestra, y también aparece en el informe de
     configuración de la impresora. Tocá **Probar conexión** para comprobarla.
   - **USB:** conectá el cable. Si ChromeOS pregunta, elegí **Conectar a
     Android**. La app pide permiso la primera vez.
2. Tocá **Imprimir página de prueba**. Si sale bien, todo funciona.
3. Para imprimir un archivo, tenés dos caminos:
   - tocá **Elegir PDF o imagen**, o
   - desde la app Archivos, hacé clic derecho en el archivo y elegí
     **Abrir con → Impresora Xerox**, o usá **Compartir → Impresora Xerox**.

   Elegí el papel (A4, Carta, Oficio, Legal, A5), la calidad, el tóner, las
   copias y las páginas (por ejemplo `1-3,5`), y tocá **Imprimir**.

> **Para imprimir una página web o un documento de Google:** usá
> "Imprimir → Guardar como PDF" en Chrome, y después abrí ese PDF con la app.

## Estado

Primera versión, **todavía no probada con la impresora real**:

- El codificador QPDL tiene tests automáticos: comprime, descomprime y verifica
  cada banda y cada checksum del trabajo generado.
- No fue posible comparar byte a byte la salida con la de SpliX.

Si la página de prueba no sale, o sale mal, anotá exactamente qué pasa: no hace
nada, parpadea la luz, sale en blanco, sale con basura, etc. Con eso se puede
ajustar el código.

## Estructura del código

| Carpeta | Qué hay |
| --- | --- |
| `qpdl/` | Codificador QPDL en Kotlin puro: `Papel`, `PaginaBits`, `Algo0x11` (compresión), `QpdlEncoder` (PJL + páginas + bandas) y `Tramador` (paso a blanco y negro). Tiene tests que corren en cualquier PC con Java. |
| `app/` | App Android: interfaz, lectura de PDF (`PdfRenderer`) e imágenes, página de prueba, envío por red (puerto 9100) y por USB. |

Para compilarla por tu cuenta (Android SDK y JDK 17):

```bash
./gradlew :qpdl:test :app:assembleDebug
```

## Licencia y créditos

La codificación QPDL deriva de [SpliX](https://github.com/OpenPrinting/splix)
(© Aurélien Croc y colaboradores), que tiene licencia GNU GPL versión 2. Por
eso, esta app también se distribuye bajo la **GPL v2**.
