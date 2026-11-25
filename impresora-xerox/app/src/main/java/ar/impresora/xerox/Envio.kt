package ar.impresora.xerox

import android.content.Context
import ar.impresora.qpdl.ModoTramado
import ar.impresora.qpdl.OpcionesTrabajo
import ar.impresora.qpdl.Papel
import java.io.File
import java.io.OutputStream
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors

/** Ajustes guardados de la app (los usa la pantalla y también los servicios). */
data class Ajustes(
    val usb: Boolean = false,
    val ip: String = "",
    val papel: Papel = Papel.A4,
    val modo: ModoTramado = ModoTramado.TEXTO,
    val densidad: Int = 3,
    val ahorro: Boolean = false,
    val manual: Boolean = false,
    val servidorIpp: Boolean = false,
) {
    fun opciones(papel: Papel = this.papel, copias: Int = 1, nombre: String = "Documento", usuario: String = "chromebook") =
        OpcionesTrabajo(
            papel = papel,
            copias = copias,
            densidad = densidad,
            ahorroToner = ahorro,
            bandejaManual = manual,
            nombreTrabajo = nombre,
            usuario = usuario,
        )

    fun guardar(contexto: Context) {
        preferencias(contexto).edit()
            .putBoolean("usb", usb)
            .putString("ip", ip)
            .putString("papel_nombre", papel.name)
            .putString("modo_nombre", modo.name)
            .putInt("densidad_valor", densidad)
            .putBoolean("ahorro", ahorro)
            .putBoolean("manual", manual)
            .putBoolean("servidor_ipp", servidorIpp)
            .apply()
    }

    companion object {
        private fun preferencias(c: Context) = c.getSharedPreferences("ajustes", Context.MODE_PRIVATE)

        fun cargar(contexto: Context): Ajustes {
            val p = preferencias(contexto)
            return Ajustes(
                usb = p.getBoolean("usb", false),
                ip = p.getString("ip", "") ?: "",
                papel = runCatching { Papel.valueOf(p.getString("papel_nombre", "A4")!!) }.getOrDefault(Papel.A4),
                modo = runCatching { ModoTramado.valueOf(p.getString("modo_nombre", "TEXTO")!!) }.getOrDefault(ModoTramado.TEXTO),
                densidad = p.getInt("densidad_valor", 3),
                ahorro = p.getBoolean("ahorro", false),
                manual = p.getBoolean("manual", false),
                servidorIpp = p.getBoolean("servidor_ipp", false),
            )
        }
    }
}

/** Anota lo que pasa con los trabajos que llegan de otras apps, para mostrarlo en pantalla. */
object Registro {
    private const val MAX = 12

    fun anotar(contexto: Context, mensaje: String) {
        android.util.Log.i("ImpresoraXerox", mensaje)
        val p = contexto.getSharedPreferences("registro", Context.MODE_PRIVATE)
        val hora = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date())
        val lineas = (listOf("$hora  $mensaje") + leer(contexto)).take(MAX)
        p.edit().putString("lineas", lineas.joinToString("\n")).apply()
    }

    fun leer(contexto: Context): List<String> =
        contexto.getSharedPreferences("registro", Context.MODE_PRIVATE).getString("lineas", "")!!
            .split("\n").filter { it.isNotBlank() }
}

/**
 * Cola única de impresión: la pantalla, el servicio de Android y el servidor
 * IPP mandan sus trabajos por acá, de a uno, para no pisarse en el USB.
 */
object Envio {
    private val cola = Executors.newSingleThreadExecutor { Thread(it, "cola-impresion") }

    /**
     * Genera el trabajo con [generar] en un archivo temporal y lo manda a la
     * impresora según los [ajustes]. Bloquea hasta terminar; llamar desde un
     * hilo en segundo plano. [alEnviar] recibe el tamaño en bytes.
     */
    fun imprimir(
        contexto: Context,
        ajustes: Ajustes,
        alEnviar: (Long) -> Unit = {},
        generar: (OutputStream) -> Unit,
    ) {
        val app = contexto.applicationContext
        try {
            cola.submit(Callable {
                val temporal = File.createTempFile("trabajo", ".prn", app.cacheDir)
                try {
                    temporal.outputStream().buffered(256 * 1024).use(generar)
                    alEnviar(temporal.length())
                    if (ajustes.usb) {
                        Usb.enviar(app, temporal)
                    } else {
                        require(ajustes.ip.isNotBlank()) { "Falta la IP de la impresora (abrí la app y configurala)" }
                        Red.enviar(ajustes.ip, temporal)
                    }
                } finally {
                    temporal.delete()
                }
            }).get()
        } catch (e: ExecutionException) {
            throw e.cause ?: e
        }
    }
}
