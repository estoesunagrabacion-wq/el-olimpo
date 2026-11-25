package ar.impresora.xerox

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PrintAttributes
import android.print.PrinterCapabilitiesInfo
import android.print.PrinterId
import android.print.PrinterInfo
import android.printservice.PrintJob
import android.printservice.PrintService
import android.printservice.PrinterDiscoverySession
import android.util.Log
import ar.impresora.ipp.Impresor
import ar.impresora.ipp.ServidorIpp
import ar.impresora.qpdl.Papel
import ar.impresora.qpdl.PwgRaster
import ar.impresora.qpdl.QpdlEncoder
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface

/** Imprime archivos ya recibidos (los usan los dos servicios). */
object Trabajos {
    /** Imprime un PDF entero. */
    fun imprimirPdf(contexto: Context, pdf: File, papel: Papel?, copias: Int, nombre: String, usuario: String = "android") {
        val ajustes = Ajustes.cargar(contexto)
        val opciones = ajustes.opciones(papel ?: ajustes.papel, copias, nombre, usuario)
        DocumentoPdf(ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY)).use { doc ->
            Envio.imprimir(contexto, ajustes) { out ->
                Impresion(doc, opciones, ajustes.modo, (0 until doc.cantidadDePaginas).toList()) { _, _ -> }.generar(out)
            }
        }
    }

    /** Imprime un PWG Raster (lo que manda ChromeOS si no usa PDF). */
    fun imprimirPwg(contexto: Context, pwg: File, papel: Papel?, copias: Int, nombre: String, usuario: String) {
        val ajustes = Ajustes.cargar(contexto)
        val elegido = papel ?: ajustes.papel
        val opciones = ajustes.opciones(elegido, copias, nombre, usuario)
        Envio.imprimir(contexto, ajustes) { out ->
            val enc = QpdlEncoder(out, opciones)
            enc.iniciar()
            pwg.inputStream().use { entrada ->
                PwgRaster.aPaginas(entrada, ajustes.modo, { elegido }) { pagina, _, _ -> enc.escribirPagina(pagina) }
            }
            enc.terminar()
        }
    }
}

/**
 * Servicio de impresión de Android: hace que la Phaser aparezca en el diálogo
 * "Imprimir" de Acrobat, Drive, Gmail y cualquier otra app de Android.
 */
class ServicioImpresion : PrintService() {
    private val principal = Handler(Looper.getMainLooper())

    override fun onCreatePrinterDiscoverySession(): PrinterDiscoverySession = object : PrinterDiscoverySession() {
        override fun onStartPrinterDiscovery(prioridad: List<PrinterId>) = addPrinters(listOf(impresora()))
        override fun onStopPrinterDiscovery() {}
        override fun onValidatePrinters(ids: List<PrinterId>) {}
        override fun onStartPrinterStateTracking(id: PrinterId) = addPrinters(listOf(impresora()))
        override fun onStopPrinterStateTracking(id: PrinterId) {}
        override fun onDestroy() {}
    }

    private fun impresora(): PrinterInfo {
        val id = generatePrinterId(ID_IMPRESORA)
        val ajustes = Ajustes.cargar(this)
        val margen = 174 // 12,5 pt en milésimas de pulgada
        val capacidades = PrinterCapabilitiesInfo.Builder(id).apply {
            for (p in Papel.entries) addMediaSize(tamanoAndroid(p), p == ajustes.papel)
            addResolution(PrintAttributes.Resolution("600", "600 ppp", 600, 600), true)
            setColorModes(PrintAttributes.COLOR_MODE_MONOCHROME, PrintAttributes.COLOR_MODE_MONOCHROME)
            setMinMargins(PrintAttributes.Margins(margen, margen, margen, margen))
        }.build()
        val descripcion = if (ajustes.usb) "Por cable USB" else "Wi-Fi ${ajustes.ip}"
        return PrinterInfo.Builder(id, "Xerox Phaser 3020", PrinterInfo.STATUS_IDLE)
            .setDescription(descripcion)
            .setCapabilities(capacidades)
            .build()
    }

    override fun onPrintJobQueued(trabajo: PrintJob) {
        Registro.anotar(this, "Android: llegó un trabajo (estado ${trabajo.info.state})")
        if (!trabajo.isQueued) return
        trabajo.start()
        val info = trabajo.info
        val papel = papelDesdeAndroid(info.attributes.mediaSize)
        val copias = info.copies.coerceIn(1, 99)
        val nombre = trabajo.document.info.name
        val datos = trabajo.document.data ?: run {
            Registro.anotar(this, "Android: \"$nombre\" llegó sin datos")
            trabajo.fail("El documento llegó vacío")
            return
        }
        Thread {
            val resultado = runCatching {
                val pdf = File.createTempFile("android", ".pdf", cacheDir)
                try {
                    ParcelFileDescriptor.AutoCloseInputStream(datos).use { e -> pdf.outputStream().use { e.copyTo(it) } }
                    Registro.anotar(this, "Android: \"$nombre\" recibido (${pdf.length() / 1024} KB, ${papel ?: "papel por defecto"}, $copias copia/s). Convirtiendo y enviando…")
                    Trabajos.imprimirPdf(this, pdf, papel, copias, nombre)
                } finally {
                    pdf.delete()
                }
            }
            resultado.onSuccess { Registro.anotar(this, "Android: \"$nombre\" enviado a la impresora ✔") }
                .onFailure {
                    val msg = it.message ?: it.javaClass.simpleName
                    Registro.anotar(this, "Android: \"$nombre\" falló: $msg")
                    avisarError(this, "No se pudo imprimir \"$nombre\"", msg)
                }
            principal.post {
                resultado.onSuccess { if (!trabajo.isCancelled) trabajo.complete() }
                    .onFailure { trabajo.fail(it.message ?: "Error al imprimir") }
            }
        }.start()
    }

    override fun onRequestCancelPrintJob(trabajo: PrintJob) {
        if (trabajo.isQueued || trabajo.isStarted) trabajo.cancel()
    }

    companion object {
        private const val ID_IMPRESORA = "phaser3020"

        private fun tamanoAndroid(p: Papel): PrintAttributes.MediaSize = when (p) {
            Papel.A4 -> PrintAttributes.MediaSize.ISO_A4
            Papel.A5 -> PrintAttributes.MediaSize.ISO_A5
            Papel.CARTA -> PrintAttributes.MediaSize.NA_LETTER
            Papel.LEGAL -> PrintAttributes.MediaSize.NA_LEGAL
            Papel.OFICIO -> PrintAttributes.MediaSize("OFICIO", "Oficio (216 × 340 mm)", 8500, 13400)
        }

        fun papelDesdeAndroid(m: PrintAttributes.MediaSize?): Papel? {
            m ?: return null
            Papel.entries.firstOrNull { tamanoAndroid(it).id == m.id }?.let { return it }
            // Milésimas de pulgada → centésimas de mm.
            return Papel.porMedidas(m.widthMils * 254 / 100, m.heightMils * 254 / 100)
        }
    }
}

/**
 * Servidor IPP en segundo plano: hace que la app se vea como una impresora de
 * red "IPP Everywhere", que ChromeOS puede agregar para imprimir desde Chrome,
 * Google Docs, Archivos, etc.
 */
class ServicioIpp : Service() {
    private var servidor: ServidorIpp? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val canal = NotificationChannel(CANAL, "Impresora para ChromeOS", NotificationManager.IMPORTANCE_LOW)
        getSystemService(NotificationManager::class.java).createNotificationChannel(canal)
        val abrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val aviso = Notification.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle("Impresora Xerox lista")
            .setContentText("Recibe trabajos de ChromeOS (puerto ${ServidorIpp.PUERTO})")
            .setContentIntent(abrir)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1, aviso)
        }
        val impresor = Impresor { t, archivo, formato ->
            Registro.anotar(this, "ChromeOS: \"${t.nombre}\" recibido ($formato, ${archivo.length() / 1024} KB). Convirtiendo y enviando…")
            try {
                if (formato == "application/pdf") {
                    Trabajos.imprimirPdf(this, archivo, t.papel, t.copias, t.nombre, t.usuario)
                } else {
                    Trabajos.imprimirPwg(this, archivo, t.papel, t.copias, t.nombre, t.usuario)
                }
                Registro.anotar(this, "ChromeOS: \"${t.nombre}\" enviado a la impresora ✔")
            } catch (e: Exception) {
                val msg = e.message ?: e.javaClass.simpleName
                Registro.anotar(this, "ChromeOS: \"${t.nombre}\" falló: $msg")
                avisarError(this, "No se pudo imprimir \"${t.nombre}\"", msg)
                throw e
            }
        }
        servidor = try {
            ServidorIpp(ServidorIpp.PUERTO, File(cacheDir, "ipp"), { Ajustes.cargar(this).papel }, impresor) {
                Log.i("ImpresoraXerox", it)
                ultimoMensaje = it
            }.also { it.iniciar() }
        } catch (e: Exception) {
            ultimoMensaje = "No se pudo abrir el puerto ${ServidorIpp.PUERTO}: ${e.message}"
            stopSelf()
            null
        }
        activo = servidor != null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        servidor?.close()
        servidor = null
        activo = false
        super.onDestroy()
    }

    companion object {
        private const val CANAL = "servidor_ipp"

        @Volatile var activo = false
            private set

        @Volatile var ultimoMensaje = ""
            private set

        fun iniciar(c: Context) = c.startForegroundService(Intent(c, ServicioIpp::class.java))
        fun detener(c: Context) = c.stopService(Intent(c, ServicioIpp::class.java))

        /** Direcciones IPv4 de este dispositivo (para agregar la impresora en ChromeOS). */
        fun direcciones(): List<String> = runCatching {
            NetworkInterface.getNetworkInterfaces().toList()
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }
                .filterIsInstance<Inet4Address>()
                .mapNotNull { it.hostAddress }
        }.getOrDefault(emptyList())
    }
}

/** Muestra una notificación con el error, para que no pase desapercibido. */
fun avisarError(c: Context, titulo: String, mensaje: String) {
    val nm = c.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel("errores", "Errores de impresión", NotificationManager.IMPORTANCE_HIGH))
    val abrir = PendingIntent.getActivity(c, 1, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val aviso = Notification.Builder(c, "errores")
        .setSmallIcon(R.drawable.ic_notificacion)
        .setContentTitle(titulo)
        .setContentText(mensaje)
        .setStyle(Notification.BigTextStyle().bigText(mensaje))
        .setContentIntent(abrir)
        .setAutoCancel(true)
        .build()
    runCatching { nm.notify((System.currentTimeMillis() % 100000).toInt() + 10, aviso) }
}

/** Vuelve a prender el servidor IPP cuando arranca Android, si estaba activado. */
class AlIniciar : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED && Ajustes.cargar(c).servidorIpp) ServicioIpp.iniciar(c)
    }
}
