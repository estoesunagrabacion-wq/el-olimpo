package ar.impresora.ipp

import ar.impresora.qpdl.Papel
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/** Estados de trabajo IPP. */
object EstadoTrabajo {
    const val PENDIENTE = 3
    const val PROCESANDO = 5
    const val CANCELADO = 7
    const val ABORTADO = 8
    const val COMPLETO = 9
}

class TrabajoIpp(
    val id: Int,
    val nombre: String,
    val usuario: String,
    val copias: Int,
    /** Papel pedido por el sistema, o null si no vino o no se reconoce. */
    val papel: Papel?,
) {
    @Volatile var estado = EstadoTrabajo.PENDIENTE
    @Volatile var mensaje = ""
    @Volatile var formato = "application/octet-stream"
    val creado = (System.currentTimeMillis() / 1000).toInt()
    @Volatile var completado = 0

    val terminado get() = estado >= EstadoTrabajo.CANCELADO
}

/** Lo que hace la app con cada trabajo recibido (convertirlo y mandarlo a la Phaser). */
fun interface Impresor {
    /** [formato] es "application/pdf" o "image/pwg-raster". Lanza una excepción si falla. */
    fun imprimir(trabajo: TrabajoIpp, documento: File, formato: String)
}

/**
 * Impresora IPP Everywhere mínima: ChromeOS (u otro sistema con CUPS) la puede
 * agregar como impresora de red y mandarle trabajos en PDF o PWG Raster.
 * Cada trabajo se guarda en un archivo y se pasa al [impresor], de a uno.
 */
class ServidorIpp(
    val puerto: Int,
    private val carpetaTemporal: File,
    private val papelPorDefecto: () -> Papel,
    private val impresor: Impresor,
    private val registro: (String) -> Unit = {},
) : Closeable {
    private var socket: ServerSocket? = null
    private val proximoId = AtomicInteger(1)
    private val trabajos = LinkedHashMap<Int, TrabajoIpp>()
    private val cola = Executors.newSingleThreadExecutor { Thread(it, "ipp-cola").apply { isDaemon = true } }
    private val conexiones = Executors.newCachedThreadPool { Thread(it, "ipp-conexion").apply { isDaemon = true } }
    private val inicio = System.currentTimeMillis()
    private val uuid = "urn:uuid:" + UUID.nameUUIDFromBytes("impresora-xerox-phaser-3020".toByteArray())

    fun iniciar() {
        val s = ServerSocket()
        s.reuseAddress = true
        s.bind(InetSocketAddress(puerto))
        socket = s
        Thread({
            while (!s.isClosed) {
                val c = try { s.accept() } catch (e: IOException) { break }
                conexiones.execute { atender(c) }
            }
        }, "ipp-servidor").apply { isDaemon = true }.start()
        registro("Servidor IPP escuchando en el puerto $puerto")
    }

    override fun close() {
        socket?.close()
        conexiones.shutdownNow()
        cola.shutdownNow()
    }

    fun listaDeTrabajos(): List<TrabajoIpp> = synchronized(trabajos) { trabajos.values.toList() }

    // ---------------- HTTP ----------------

    private fun atender(c: Socket) {
        c.use { s ->
            try {
                s.soTimeout = 120_000
                val ent = BufferedInputStream(s.getInputStream(), 64 * 1024)
                val sal = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
                while (true) {
                    var linea = leerLinea(ent) ?: return
                    while (linea.isEmpty()) linea = leerLinea(ent) ?: return
                    val partes = linea.split(' ')
                    if (partes.size < 3) return
                    val metodo = partes[0]
                    val cabeceras = HashMap<String, String>()
                    while (true) {
                        val h = leerLinea(ent) ?: return
                        if (h.isEmpty()) break
                        val i = h.indexOf(':')
                        if (i > 0) cabeceras[h.substring(0, i).trim().lowercase()] = h.substring(i + 1).trim()
                    }
                    val cuerpo: InputStream = when {
                        cabeceras["transfer-encoding"]?.contains("chunked", true) == true -> EntradaChunked(ent)
                        cabeceras["content-length"] != null -> EntradaLimitada(ent, cabeceras["content-length"]!!.toLong())
                        else -> EntradaLimitada(ent, 0)
                    }
                    if (cabeceras["expect"]?.contains("100-continue", true) == true) {
                        sal.write("HTTP/1.1 100 Continue\r\n\r\n".toByteArray()); sal.flush()
                    }
                    val host = cabeceras["host"] ?: "localhost:$puerto"
                    val cerrar = cabeceras["connection"]?.contains("close", true) == true ||
                        partes[2] == "HTTP/1.0"
                    when (metodo) {
                        "POST" -> {
                            val respuesta = try {
                                procesarIpp(cuerpo, host)
                            } catch (e: Exception) {
                                registro("Pedido IPP inválido: ${e.message}")
                                RespuestaIpp(0x0200, Op.ERROR_PEDIDO, 0).aBytes()
                            }
                            drenar(cuerpo)
                            responder(sal, "200 OK", "application/ipp", respuesta, cerrar)
                        }
                        "GET", "HEAD" -> {
                            drenar(cuerpo)
                            val html = paginaWeb(host).toByteArray(Charsets.UTF_8)
                            responder(sal, "200 OK", "text/html; charset=utf-8", if (metodo == "HEAD") ByteArray(0) else html, cerrar)
                        }
                        else -> {
                            responder(sal, "405 Method Not Allowed", "text/plain", ByteArray(0), true)
                            return
                        }
                    }
                    if (cerrar) return
                }
            } catch (_: SocketException) {
            } catch (_: IOException) {
            }
        }
    }

    private fun responder(sal: OutputStream, estado: String, tipo: String, cuerpo: ByteArray, cerrar: Boolean) {
        val cab = "HTTP/1.1 $estado\r\nContent-Type: $tipo\r\nContent-Length: ${cuerpo.size}\r\n" +
            (if (cerrar) "Connection: close\r\n" else "") + "Server: ImpresoraXerox\r\n\r\n"
        sal.write(cab.toByteArray(Charsets.ISO_8859_1))
        sal.write(cuerpo)
        sal.flush()
    }

    private fun paginaWeb(host: String) = """
        <!doctype html><meta charset="utf-8"><title>Impresora Xerox</title>
        <body style="font-family:sans-serif;max-width:40em;margin:2em auto">
        <h1>Impresora Xerox Phaser 3020</h1>
        <p>La app está funcionando y recibe trabajos de impresión.</p>
        <p>Para agregarla en ChromeOS usá la dirección <b>${host}</b>,
        protocolo <b>IPP</b> y cola <b>ipp/print</b>.</p>
        </body>
    """.trimIndent()

    // ---------------- IPP ----------------

    private fun procesarIpp(cuerpo: InputStream, host: String): ByteArray {
        val p = PedidoIpp.leer(cuerpo)
        val version = if (p.version >= 0x0200) 0x0200 else 0x0101
        val uriImpresora = "ipp://$host/ipp/print"
        fun ok() = RespuestaIpp(version, Op.OK, p.idPedido)
        fun error(codigo: Int, mensaje: String) =
            RespuestaIpp(version, codigo, p.idPedido).texto("status-message", mensaje).aBytes()

        return when (p.operacion) {
            Op.GET_PRINTER_ATTRIBUTES -> ok().also { atributosImpresora(it, uriImpresora, host) }.aBytes()

            Op.VALIDATE_JOB, Op.IDENTIFY_PRINTER, Op.CLOSE_JOB -> ok().aBytes()

            Op.PRINT_JOB -> {
                val formato = p.operacion("document-format")?.texto
                if (formato != null && formato !in FORMATOS) return error(Op.ERROR_FORMATO, "Formato $formato no soportado")
                val t = crearTrabajo(p)
                recibirDocumento(t, cuerpo, formato)
                ok().also { atributosTrabajo(it, t, uriImpresora) }.aBytes()
            }

            Op.CREATE_JOB -> {
                val t = crearTrabajo(p)
                ok().also { atributosTrabajo(it, t, uriImpresora) }.aBytes()
            }

            Op.SEND_DOCUMENT -> {
                val t = buscarTrabajo(p) ?: return error(Op.ERROR_NO_ENCONTRADO, "Trabajo inexistente")
                val formato = p.operacion("document-format")?.texto
                if (formato != null && formato !in FORMATOS) return error(Op.ERROR_FORMATO, "Formato $formato no soportado")
                recibirDocumento(t, cuerpo, formato)
                ok().also { atributosTrabajo(it, t, uriImpresora) }.aBytes()
            }

            Op.CANCEL_JOB -> {
                val t = buscarTrabajo(p) ?: return error(Op.ERROR_NO_ENCONTRADO, "Trabajo inexistente")
                if (t.terminado) return error(Op.ERROR_NO_POSIBLE, "El trabajo ya terminó")
                t.estado = EstadoTrabajo.CANCELADO
                ok().aBytes()
            }

            Op.GET_JOB_ATTRIBUTES -> {
                val t = buscarTrabajo(p) ?: return error(Op.ERROR_NO_ENCONTRADO, "Trabajo inexistente")
                ok().also { atributosTrabajo(it, t, uriImpresora) }.aBytes()
            }

            Op.GET_JOBS -> {
                val terminados = p.operacion("which-jobs")?.texto == "completed"
                val r = ok()
                listaDeTrabajos().filter { it.terminado == terminados }.forEach { atributosTrabajo(r, it, uriImpresora) }
                r.aBytes()
            }

            else -> error(Op.ERROR_OPERACION, "Operación no soportada")
        }
    }

    private fun crearTrabajo(p: PedidoIpp): TrabajoIpp {
        val papel = Papel.porNombrePwg(p.atributo("media")?.texto) ?: run {
            val x = p.atributo("media-col/media-size/x-dimension")?.entero
            val y = p.atributo("media-col/media-size/y-dimension")?.entero
            if (x != null && y != null) Papel.porMedidas(x, y) else null
        }
        val t = TrabajoIpp(
            id = proximoId.getAndIncrement(),
            nombre = p.operacion("job-name")?.texto ?: "Documento",
            usuario = p.operacion("requesting-user-name")?.texto ?: "chromeos",
            copias = (p.atributo("copies")?.entero ?: 1).coerceIn(1, 99),
            papel = papel,
        )
        synchronized(trabajos) {
            trabajos[t.id] = t
            // Guardamos sólo los últimos 30 trabajos.
            while (trabajos.size > 30) trabajos.remove(trabajos.keys.first())
        }
        registro("Trabajo ${t.id} \"${t.nombre}\" (papel ${papel?.nombrePwg ?: "por defecto"}, ${t.copias} copia/s)")
        return t
    }

    private fun buscarTrabajo(p: PedidoIpp): TrabajoIpp? {
        val id = p.operacion("job-id")?.entero
            ?: p.operacion("job-uri")?.texto?.substringAfterLast('/')?.toIntOrNull()
            ?: return null
        return synchronized(trabajos) { trabajos[id] }
    }

    private fun recibirDocumento(t: TrabajoIpp, cuerpo: InputStream, formatoPedido: String?) {
        carpetaTemporal.mkdirs()
        val archivo = File.createTempFile("ipp-${t.id}-", ".doc", carpetaTemporal)
        archivo.outputStream().use { cuerpo.copyTo(it, 64 * 1024) }
        val cabecera = ByteArray(4)
        archivo.inputStream().use { it.read(cabecera) }
        val formato = when {
            String(cabecera, Charsets.ISO_8859_1) == "%PDF" -> "application/pdf"
            String(cabecera, Charsets.ISO_8859_1) == "RaS2" -> "image/pwg-raster"
            else -> formatoPedido ?: "application/octet-stream"
        }
        t.formato = formato
        if (formato !in FORMATOS_REALES) {
            t.estado = EstadoTrabajo.ABORTADO
            t.mensaje = "Formato no soportado"
            archivo.delete()
            return
        }
        cola.execute {
            try {
                if (t.estado == EstadoTrabajo.CANCELADO) return@execute
                t.estado = EstadoTrabajo.PROCESANDO
                impresor.imprimir(t, archivo, formato)
                t.completado = 1
                t.estado = EstadoTrabajo.COMPLETO
                registro("Trabajo ${t.id} impreso")
            } catch (e: Throwable) {
                t.estado = EstadoTrabajo.ABORTADO
                t.mensaje = e.message ?: e.javaClass.simpleName
                registro("Trabajo ${t.id} falló: ${t.mensaje}")
            } finally {
                archivo.delete()
            }
        }
    }

    private fun atributosTrabajo(r: RespuestaIpp, t: TrabajoIpp, uriImpresora: String) {
        r.grupo(Tag.TRABAJO)
            .enteros("job-id", t.id)
            .uri("job-uri", "$uriImpresora/${t.id}")
            .uri("job-printer-uri", uriImpresora)
            .nombre("job-name", t.nombre)
            .nombre("job-originating-user-name", t.usuario)
            .enums("job-state", t.estado)
            .palabras("job-state-reasons", motivo(t))
            .enteros("time-at-creation", t.creado)
            .enteros("job-impressions-completed", t.completado)
            .enteros("job-printer-up-time", segundosEncendida())
        if (t.mensaje.isNotEmpty()) r.texto("job-state-message", t.mensaje)
    }

    private fun motivo(t: TrabajoIpp) = when (t.estado) {
        EstadoTrabajo.PENDIENTE -> "job-incoming"
        EstadoTrabajo.PROCESANDO -> "job-printing"
        EstadoTrabajo.CANCELADO -> "job-canceled-by-user"
        EstadoTrabajo.ABORTADO -> "aborted-by-system"
        else -> "job-completed-successfully"
    }

    private fun segundosEncendida() = ((System.currentTimeMillis() - inicio) / 1000).toInt() + 1

    private fun atributosImpresora(r: RespuestaIpp, uri: String, host: String) {
        val ocupada = listaDeTrabajos().any { !it.terminado }
        val porDefecto = papelPorDefecto()
        val margen = 441 // 12,5 pt en centésimas de mm
        fun coleccionMedia(p: Papel): RespuestaIpp.Coleccion.() -> Unit = {
            coleccion("media-size") {
                entero("x-dimension", p.anchoCentMm)
                entero("y-dimension", p.altoCentMm)
            }
            entero("media-top-margin", margen)
            entero("media-bottom-margin", margen)
            entero("media-left-margin", margen)
            entero("media-right-margin", margen)
            palabra("media-source", "auto")
            palabra("media-type", "stationery")
        }
        val papeles = Papel.entries
        r.grupo(Tag.IMPRESORA)
            .uri("printer-uri-supported", uri)
            .palabras("uri-security-supported", "none")
            .palabras("uri-authentication-supported", "none")
            .nombre("printer-name", "Xerox Phaser 3020")
            .texto("printer-info", "Xerox Phaser 3020 (Impresora Xerox)")
            .texto("printer-location", "Chromebook")
            .texto("printer-make-and-model", "Xerox Phaser 3020")
            .uri("printer-more-info", "http://$host/")
            .uri("printer-uuid", uuid)
            .texto("printer-device-id", "MFG:Xerox;MDL:Phaser 3020;CMD:PDF,PWGRaster;CLS:PRINTER;")
            .enums("printer-state", if (ocupada) 4 else 3)
            .palabras("printer-state-reasons", "none")
            .booleano("printer-is-accepting-jobs", true)
            .enteros("queued-job-count", listaDeTrabajos().count { !it.terminado })
            .enteros("printer-up-time", segundosEncendida())
            .enteros("printer-state-change-time", 1)
            .enteros("printer-config-change-time", 1)
            .palabras("ipp-versions-supported", "1.1", "2.0")
            .palabras("ipp-features-supported", "ipp-everywhere")
            .enums(
                "operations-supported",
                Op.PRINT_JOB, Op.VALIDATE_JOB, Op.CREATE_JOB, Op.SEND_DOCUMENT, Op.CANCEL_JOB,
                Op.GET_JOB_ATTRIBUTES, Op.GET_JOBS, Op.GET_PRINTER_ATTRIBUTES, Op.CLOSE_JOB, Op.IDENTIFY_PRINTER,
            )
            .cadena(Tag.CHARSET, "charset-configured", "utf-8")
            .cadena(Tag.CHARSET, "charset-supported", "utf-8")
            .cadena(Tag.IDIOMA, "natural-language-configured", "en")
            .cadena(Tag.IDIOMA, "generated-natural-language-supported", "en")
            .mime("document-format-default", "application/pdf")
            .mime("document-format-supported", *FORMATOS.toTypedArray())
            .palabras("compression-supported", "none")
            .palabras("pdl-override-supported", "attempted")
            .booleano("multiple-document-jobs-supported", false)
            .enteros("multiple-operation-time-out", 120)
            .palabras("which-jobs-supported", "completed", "not-completed")
            .palabras(
                "job-creation-attributes-supported",
                "copies", "media", "media-col", "print-color-mode", "print-quality", "sides",
                "orientation-requested", "print-scaling", "printer-resolution",
            )
            .booleano("color-supported", false)
            .palabras("print-color-mode-supported", "monochrome", "auto")
            .palabras("print-color-mode-default", "monochrome")
            .palabras("output-mode-supported", "monochrome")
            .palabras("output-mode-default", "monochrome")
            .rango("copies-supported", 1, 99)
            .enteros("copies-default", 1)
            .palabras("sides-supported", "one-sided")
            .palabras("sides-default", "one-sided")
            .enums("orientation-requested-supported", 3, 4)
            .enums("orientation-requested-default", 3)
            .palabras("print-scaling-supported", "auto", "fit", "fill", "none")
            .palabras("print-scaling-default", "auto")
            .enums("print-quality-supported", 4)
            .enums("print-quality-default", 4)
            .resolucion("printer-resolution-supported", 600)
            .resolucion("printer-resolution-default", 600)
            .resolucion("pwg-raster-document-resolution-supported", 600)
            .palabras("pwg-raster-document-type-supported", "sgray_8")
            .palabras("pwg-raster-document-sheet-back", "normal")
            .palabras("media-supported", *papeles.map { it.nombrePwg }.toTypedArray())
            .palabras("media-default", porDefecto.nombrePwg)
            .palabras("media-ready", porDefecto.nombrePwg)
            .coleccion("media-col-database", *papeles.map { coleccionMedia(it) }.toTypedArray())
            .coleccion("media-col-default", coleccionMedia(porDefecto))
            .coleccion("media-col-ready", coleccionMedia(porDefecto))
            .coleccion("media-size-supported", *papeles.map { p ->
                val f: RespuestaIpp.Coleccion.() -> Unit = {
                    entero("x-dimension", p.anchoCentMm)
                    entero("y-dimension", p.altoCentMm)
                }
                f
            }.toTypedArray())
            .palabras(
                "media-col-supported",
                "media-size", "media-top-margin", "media-bottom-margin",
                "media-left-margin", "media-right-margin", "media-source", "media-type",
            )
            .enteros("media-top-margin-supported", margen)
            .enteros("media-bottom-margin-supported", margen)
            .enteros("media-left-margin-supported", margen)
            .enteros("media-right-margin-supported", margen)
            .palabras("media-source-supported", "auto")
            .palabras("media-type-supported", "stationery")
            .palabras("printer-kind", "document")
    }

    companion object {
        const val PUERTO = 8631
        private val FORMATOS_REALES = setOf("application/pdf", "image/pwg-raster")
        private val FORMATOS = listOf("application/pdf", "image/pwg-raster", "application/octet-stream")

        private fun drenar(e: InputStream) {
            val b = ByteArray(16 * 1024)
            while (e.read(b) >= 0) { /* descartar */ }
        }

        private fun leerLinea(e: InputStream): String? {
            val sb = StringBuilder()
            while (true) {
                val b = e.read()
                if (b < 0) return if (sb.isEmpty()) null else sb.toString()
                if (b == '\n'.code) return sb.toString().trimEnd('\r')
                if (sb.length > 8192) throw IOException("Línea demasiado larga")
                sb.append(b.toChar())
            }
        }
    }

    /** Cuerpo con Content-Length. */
    private class EntradaLimitada(private val e: InputStream, private var restante: Long) : InputStream() {
        override fun read(): Int {
            if (restante <= 0) return -1
            val b = e.read()
            if (b >= 0) restante--
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (restante <= 0) return -1
            val n = e.read(b, off, minOf(len.toLong(), restante).toInt())
            if (n > 0) restante -= n
            return n
        }
    }

    /** Cuerpo con "Transfer-Encoding: chunked". */
    private class EntradaChunked(private val e: InputStream) : InputStream() {
        private var restante = 0
        private var fin = false

        private fun prepararTrozo(): Boolean {
            if (fin) return false
            if (restante > 0) return true
            val linea = leerLinea(e) ?: throw IOException("Fin inesperado")
            val tamano = linea.substringBefore(';').trim().ifEmpty { leerLinea(e)?.substringBefore(';')?.trim() ?: "0" }
            restante = tamano.toInt(16)
            if (restante == 0) {
                // Trailers hasta la línea vacía.
                while (true) {
                    val t = leerLinea(e) ?: break
                    if (t.isEmpty()) break
                }
                fin = true
                return false
            }
            return true
        }

        private fun terminarTrozo() {
            if (restante == 0) leerLinea(e) // CRLF después de cada trozo
        }

        override fun read(): Int {
            if (!prepararTrozo()) return -1
            val b = e.read()
            if (b < 0) throw IOException("Fin inesperado")
            restante--
            terminarTrozo()
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            if (!prepararTrozo()) return -1
            val n = e.read(b, off, minOf(len, restante))
            if (n < 0) throw IOException("Fin inesperado")
            restante -= n
            terminarTrozo()
            return n
        }
    }
}
