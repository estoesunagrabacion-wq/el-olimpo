package ar.impresora.qpdl

import java.io.ByteArrayOutputStream
import java.time.LocalDate
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class Algo0x11Test {
    private fun idaYVuelta(datos: ByteArray) {
        val comprimido = Algo0x11.comprimir(datos)
        assertContentEquals(datos, Algo0x11.descomprimir(comprimido, datos.size))
    }

    @Test
    fun bandaBlanca() {
        val datos = ByteArray(608 * 128) { 0xFF.toByte() }
        idaYVuelta(datos)
        assertTrue(Algo0x11.comprimir(datos).size < 2000, "una banda blanca debe comprimir mucho")
    }

    @Test
    fun ruidoAleatorio() = idaYVuelta(Random(1).nextBytes(608 * 128))

    @Test
    fun patronesTipoTexto() {
        val r = Random(7)
        val datos = ByteArray(640 * 128) { 0xFF.toByte() }
        repeat(3000) {
            val p = r.nextInt(datos.size - 40)
            val v = r.nextInt(256).toByte()
            for (k in 0 until r.nextInt(1, 40)) datos[p + k] = v
        }
        idaYVuelta(datos)
    }

    @Test
    fun tamanosChicos() {
        for (n in listOf(1, 2, 3, 5, 127, 128, 129, 300, 5000)) idaYVuelta(Random(n).nextBytes(n))
    }

    @Test
    fun tablaIncluyeDistanciaUno() {
        val tabla = Algo0x11.tablaDistancias(Random(3).nextBytes(77824))
        assertEquals(Algo0x11.TAMANO_TABLA, tabla.size)
        assertTrue(1 in tabla)
        assertTrue(tabla.all { it in 1..0x800 })
    }
}

class QpdlEncoderTest {
    private fun paginaDePrueba(papel: Papel): PaginaBits {
        val p = PaginaBits(papel)
        // Marco a 1 cm, una diagonal y un bloque negro.
        val m = 236
        for (x in m until p.anchoPx - m) { p.ponerNegro(x, m); p.ponerNegro(x, p.altoPx - m) }
        for (y in m until p.altoPx - m) { p.ponerNegro(m, y); p.ponerNegro(p.anchoPx - m, y) }
        for (i in m until minOf(p.anchoPx, p.altoPx) - m) p.ponerNegro(i, i)
        for (y in 1000 until 1300) for (x in 800 until 1500) p.ponerNegro(x, y)
        return p
    }

    /** Lee el flujo QPDL y reconstruye la imagen recortada que verá la impresora. */
    private class Lector(val b: ByteArray) {
        var p = 0
        fun u8() = b[p++].toInt() and 0xFF
        fun u16() = (u8() shl 8) or u8()
        fun u32() = (u16() shl 16) or u16()
    }

    @Test
    fun trabajoCompletoSeDecodificaIgual() {
        for (papel in Papel.entries) {
            val pagina = paginaDePrueba(papel)
            val out = ByteArrayOutputStream()
            val opciones = OpcionesTrabajo(papel = papel, copias = 2, nombreTrabajo = "Prueba ñandú")
            QpdlEncoder(out, opciones, LocalDate.of(2026, 11, 9)).apply {
                iniciar(); escribirPagina(pagina); terminar()
            }
            val bytes = out.toByteArray()
            val texto = String(bytes, Charsets.ISO_8859_1)
            assertTrue(texto.startsWith("\u001B%-12345X@PJL DEFAULT SERVICEDATE=20261109\n"))
            assertTrue(texto.contains("@PJL SET JOBNAME=\"Prueba nandu\"\n"))
            assertTrue(texto.endsWith("\t\u001B%-12345X"))

            val inicio = texto.indexOf("@PJL ENTER LANGUAGE = QPDL\n") + "@PJL ENTER LANGUAGE = QPDL\n".length
            val l = Lector(bytes).apply { p = inicio }

            // Cabecera de página.
            assertEquals(0, l.u8())
            assertEquals(6, l.u8())
            assertEquals(2, l.u16())
            assertEquals(papel.codigo, l.u8())
            l.u16(); l.u16()
            assertEquals(listOf(1, 0, 1, 0, 0, 3, 1, 6), List(8) { l.u8() })

            // Bandas.
            val margenXBytes = 14
            val margenY = 105
            val bandaBytes = papel.anchoBandaBytes
            var bandasLeidas = 0
            while ((bytes[l.p].toInt() and 0xFF) == 0x0C) {
                l.u8()
                val numero = l.u8()
                assertEquals(bandaBytes * 8, l.u16())
                assertEquals(128, l.u16())
                assertEquals(0x11, l.u8())
                val tamano = l.u32()
                val firma = List(4) { l.u8() }
                assertEquals(listOf(0xEF, 0xCD, 0xAB, 0x09), firma)
                val datos = bytes.copyOfRange(l.p, l.p + tamano - 8)
                l.p += tamano - 8
                val suma = l.u32()
                assertEquals(firma.sum() + datos.sumOf { it.toInt() and 0xFF }, suma)

                val banda = Algo0x11.descomprimir(datos, bandaBytes * 128)
                for (y in 0 until 128) {
                    val py = margenY + numero * 128 + y
                    for (x in 0 until bandaBytes) {
                        val esperado = if (py < pagina.altoPx && x < pagina.bytesPorLinea - margenXBytes)
                            pagina.datos[py * pagina.bytesPorLinea + margenXBytes + x] else 0
                        assertEquals(esperado.toInt().inv() and 0xFF, banda[x * 128 + y].toInt() and 0xFF,
                            "${papel.name}: banda $numero, fila $y, byte $x")
                    }
                }
                bandasLeidas++
            }
            assertTrue(bandasLeidas > 0)

            // Pie de página y fin.
            assertEquals(listOf(1, 0, 2), List(3) { l.u8() })
            assertEquals(bytes.size - 10, l.p)
        }
    }

    @Test
    fun paginaBlancaNoMandaBandas() {
        val out = ByteArrayOutputStream()
        val enc = QpdlEncoder(out, OpcionesTrabajo())
        assertEquals(0, enc.bandas(PaginaBits(Papel.A4)).count())
    }

    @Test
    fun medidasA4() {
        assertEquals(4960, Papel.A4.anchoPx())
        assertEquals(7017, Papel.A4.altoPx())
        // 7017 - 105 de margen = 6912 = 54 bandas exactas.
        val p = PaginaBits(Papel.A4)
        p.datos.fill(0x55)
        assertEquals(54, QpdlEncoder(ByteArrayOutputStream(), OpcionesTrabajo()).bandas(p).count())
    }
}

class TramadorTest {
    @Test
    fun grisMedioDaMitadDePuntos() {
        val pagina = PaginaBits(200, 200)
        val gris = 0xFF808080.toInt()
        Tramador(pagina, ModoTramado.FOTO).procesar(IntArray(200 * 200) { gris }, 200, 200, 0)
        var negros = 0
        for (y in 0 until 200) for (x in 0 until 200) if (pagina.esNegro(x, y)) negros++
        assertTrue(negros in 18000..22000, "negros=$negros")
    }

    @Test
    fun textoUsaUmbral() {
        val pagina = PaginaBits(16, 1)
        val px = IntArray(16) { if (it < 8) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
        Tramador(pagina, ModoTramado.TEXTO).procesar(px, 16, 1, 0)
        assertEquals(0xFF.toByte(), pagina.datos[0])
        assertEquals(0.toByte(), pagina.datos[1])
    }

    @Test
    fun transparenteEsBlanco() {
        assertEquals(255, Tramador.luminancia(0x00000000))
        assertEquals(0, Tramador.luminancia(0xFF000000.toInt()))
    }
}
