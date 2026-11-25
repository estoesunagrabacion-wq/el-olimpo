package ar.impresora.qpdl

import ar.impresora.ipp.EstadoTrabajo
import ar.impresora.ipp.Op
import ar.impresora.ipp.PedidoIpp
import ar.impresora.ipp.ServidorIpp
import ar.impresora.ipp.Tag
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.net.Socket
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Arma un PWG Raster en escala de grises (para probar el lector). */
private fun pwgGris(paginas: List<Array<ByteArray>>, ppp: Int = 600): ByteArray {
    val out = ByteArrayOutputStream()
    out.write("RaS2".toByteArray())
    for (filas in paginas) {
        val ancho = filas[0].size
        val cab = ByteArray(1796)
        fun u32(pos: Int, v: Int) {
            cab[pos] = (v shr 24).toByte(); cab[pos + 1] = (v shr 16).toByte()
            cab[pos + 2] = (v shr 8).toByte(); cab[pos + 3] = v.toByte()
        }
        u32(276, ppp); u32(280, ppp); u32(340, 1)
        u32(352, ancho * 72 / ppp); u32(356, filas.size * 72 / ppp)
        u32(372, ancho); u32(376, filas.size); u32(384, 8); u32(388, 8); u32(392, ancho); u32(400, 18)
        out.write(cab)
        var i = 0
        while (i < filas.size) {
            // Repetición de líneas iguales.
            var rep = 0
            while (i + rep + 1 < filas.size && rep < 255 && filas[i + rep + 1].contentEquals(filas[i])) rep++
            out.write(rep)
            val f = filas[i]
            var x = 0
            while (x < f.size) {
                var n = 1
                while (x + n < f.size && n < 128 && f[x + n] == f[x]) n++
                if (n > 1) {
                    out.write(n - 1); out.write(f[x].toInt())
                } else {
                    // Literales.
                    var m = 1
                    while (x + m < f.size && m < 128 && (x + m + 1 >= f.size || f[x + m] != f[x + m + 1])) m++
                    if (m == 1) { out.write(0); out.write(f[x].toInt()) } else { out.write(257 - m); out.write(f, x, m) }
                    n = m
                }
                x += n
            }
            i += rep + 1
        }
    }
    return out.toByteArray()
}

class PwgTest {
    @Test
    fun leeFilasComprimidas() {
        val filas = Array(50) { y -> ByteArray(300) { x -> if ((x / 10 + y / 7) % 3 == 0) 0.toByte() else (x * 7 + y).toByte() } }
        filas[20] = filas[19].copyOf() // repetición
        val lector = PwgRaster(ByteArrayInputStream(pwgGris(listOf(filas))))
        val e = assertNotNull(lector.siguientePagina())
        assertEquals(300, e.ancho)
        assertEquals(50, e.alto)
        for (y in 0 until 50) assertContentEquals(filas[y], lector.leerFila(), "fila $y")
        assertEquals(null, lector.siguientePagina())
    }

    @Test
    fun convierteAPaginaCentrada() {
        // Página "A4" a 300 ppp con un cuadrado negro arriba a la izquierda.
        val ancho = 2480
        val alto = 3508
        val filas = Array(alto) { y -> ByteArray(ancho) { x -> if (x in 100 until 200 && y in 100 until 200) 0.toByte() else (-1).toByte() } }
        var paginas = 0
        PwgRaster.aPaginas(ByteArrayInputStream(pwgGris(listOf(filas), ppp = 300)), ModoTramado.TEXTO, { Papel.A4 }) { p, _, _ ->
            paginas++
            assertTrue(p.esNegro(300, 300))
            assertTrue(!p.esNegro(100, 100))
            assertTrue(!p.esNegro(500, 500))
        }
        assertEquals(1, paginas)
    }
}

class ServidorIppTest {
    private class Cliente(puerto: Int) : AutoCloseable {
        val s = Socket("127.0.0.1", puerto)
        val ent = DataInputStream(s.getInputStream().buffered())
        val sal = s.getOutputStream()

        fun pedido(ipp: ByteArray, documento: ByteArray = ByteArray(0), chunked: Boolean = false): PedidoIpp {
            val cuerpo = ipp + documento
            val cab = StringBuilder("POST /ipp/print HTTP/1.1\r\nHost: localhost:8631\r\nContent-Type: application/ipp\r\n")
            if (chunked) {
                cab.append("Transfer-Encoding: chunked\r\nExpect: 100-continue\r\n\r\n")
                sal.write(cab.toString().toByteArray())
                sal.flush()
                assertTrue(leerLinea().startsWith("HTTP/1.1 100")); leerLinea()
                var i = 0
                while (i < cuerpo.size) {
                    val n = minOf(1000, cuerpo.size - i)
                    sal.write("${n.toString(16)}\r\n".toByteArray()); sal.write(cuerpo, i, n); sal.write("\r\n".toByteArray())
                    i += n
                }
                sal.write("0\r\n\r\n".toByteArray())
            } else {
                cab.append("Content-Length: ${cuerpo.size}\r\n\r\n")
                sal.write(cab.toString().toByteArray()); sal.write(cuerpo)
            }
            sal.flush()
            assertEquals("HTTP/1.1 200 OK", leerLinea())
            var largo = 0
            while (true) {
                val h = leerLinea()
                if (h.isEmpty()) break
                if (h.startsWith("Content-Length:")) largo = h.substringAfter(':').trim().toInt()
            }
            val r = ByteArray(largo).also { ent.readFully(it) }
            return PedidoIpp.leer(ByteArrayInputStream(r))
        }

        fun leerLinea(): String {
            val sb = StringBuilder()
            while (true) {
                val b = ent.read()
                if (b < 0 || b == '\n'.code) return sb.toString().trimEnd('\r')
                sb.append(b.toChar())
            }
        }

        override fun close() = s.close()
    }

    private fun ipp(op: Int, id: Int, extra: DataOutputStream.() -> Unit = {}): ByteArray {
        val b = ByteArrayOutputStream()
        DataOutputStream(b).apply {
            writeShort(0x0200); writeShort(op); writeInt(id)
            writeByte(Tag.OPERACION)
            attr(Tag.CHARSET, "attributes-charset", "utf-8")
            attr(Tag.IDIOMA, "attributes-natural-language", "es")
            attr(Tag.URI, "printer-uri", "ipp://localhost:8631/ipp/print")
            extra()
            writeByte(Tag.FIN)
        }
        return b.toByteArray()
    }

    private fun DataOutputStream.attr(tag: Int, nombre: String, valor: String) = attrBytes(tag, nombre, valor.toByteArray())
    private fun DataOutputStream.attrBytes(tag: Int, nombre: String, valor: ByteArray) {
        writeByte(tag); writeShort(nombre.length); writeBytes(nombre); writeShort(valor.size); write(valor)
    }
    private fun DataOutputStream.attrInt(tag: Int, nombre: String, v: Int) =
        attrBytes(tag, nombre, byteArrayOf((v shr 24).toByte(), (v shr 16).toByte(), (v shr 8).toByte(), v.toByte()))

    @Test
    fun atributosEImpresionPdf() {
        val dir = Files.createTempDirectory("ipp").toFile()
        val recibido = CountDownLatch(1)
        var papel: Papel? = null
        var bytes = ByteArray(0)
        val pdf = "%PDF-1.4\n".toByteArray() + ByteArray(5000) { (it % 251).toByte() }
        val servidor = ServidorIpp(0, dir, { Papel.A4 }, { t, archivo, formato ->
            assertEquals("application/pdf", formato)
            papel = t.papel
            bytes = archivo.readBytes()
            recibido.countDown()
        })
        val puerto = ServidorIpp::class.java.getDeclaredField("socket").let { f ->
            servidor.iniciar()
            f.isAccessible = true
            (f.get(servidor) as java.net.ServerSocket).localPort
        }
        servidor.use {
            Cliente(puerto).use { c ->
                // Get-Printer-Attributes
                val r = c.pedido(ipp(Op.GET_PRINTER_ATTRIBUTES, 1))
                assertEquals(Op.OK, r.operacion) // en una respuesta es el código de estado
                assertEquals("Xerox Phaser 3020", r.atributo("printer-make-and-model")?.texto)
                assertTrue("application/pdf" in r.atributo("document-format-supported")!!.textos)
                assertEquals(21000, r.atributo("media-col-default/media-size/x-dimension")?.entero)
                assertEquals(Papel.entries.size, r.atributo("media-supported")!!.valores.size)

                // Print-Job con media-col (Carta) en la misma conexión, chunked.
                val pj = ipp(Op.PRINT_JOB, 2) {
                    attr(Tag.NOMBRE, "job-name", "Prueba")
                    attr(Tag.MIME, "document-format", "application/pdf")
                    writeByte(Tag.TRABAJO)
                    attrBytes(Tag.INICIO_COLECCION, "media-col", ByteArray(0))
                    attr(Tag.NOMBRE_MIEMBRO, "", "media-size")
                    attrBytes(Tag.INICIO_COLECCION, "", ByteArray(0))
                    attr(Tag.NOMBRE_MIEMBRO, "", "x-dimension"); attrInt(Tag.ENTERO, "", 21590)
                    attr(Tag.NOMBRE_MIEMBRO, "", "y-dimension"); attrInt(Tag.ENTERO, "", 27940)
                    attrBytes(Tag.FIN_COLECCION, "", ByteArray(0))
                    attrBytes(Tag.FIN_COLECCION, "", ByteArray(0))
                    attrInt(Tag.ENTERO, "copies", 2)
                }
                val r2 = c.pedido(pj, pdf, chunked = true)
                assertEquals(Op.OK, r2.operacion)
                val id = assertNotNull(r2.atributo("job-id")?.entero)
                assertTrue(recibido.await(5, TimeUnit.SECONDS))
                assertContentEquals(pdf, bytes)
                assertEquals(Papel.CARTA, papel)

                // Get-Job-Attributes hasta que figure completo.
                var estado = 0
                repeat(50) {
                    if (estado != EstadoTrabajo.COMPLETO) {
                        val r3 = c.pedido(ipp(Op.GET_JOB_ATTRIBUTES, 3) { attrInt(Tag.ENTERO, "job-id", id) })
                        estado = r3.atributo("job-state")?.entero ?: 0
                        if (estado != EstadoTrabajo.COMPLETO) Thread.sleep(50)
                    }
                }
                assertEquals(EstadoTrabajo.COMPLETO, estado)
            }
        }
        dir.deleteRecursively()
    }
}
