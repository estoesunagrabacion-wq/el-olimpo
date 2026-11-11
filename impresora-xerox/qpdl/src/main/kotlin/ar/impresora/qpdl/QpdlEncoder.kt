/*
 * Derivado de SpliX (https://github.com/OpenPrinting/splix), (C) Aurélien Croc y colaboradores.
 * Este programa es software libre: GNU General Public License, versión 2.
 */
package ar.impresora.qpdl

import java.io.OutputStream
import java.time.LocalDate
import kotlin.math.ceil

/** Opciones del trabajo de impresión. */
data class OpcionesTrabajo(
    val papel: Papel = Papel.A4,
    val copias: Int = 1,
    /** Densidad del tóner: 1 = clara, 3 = media, 5 = oscura. */
    val densidad: Int = 3,
    val ahorroToner: Boolean = false,
    val bandejaManual: Boolean = false,
    val nombreTrabajo: String = "Documento",
    val usuario: String = "chromebook",
)

/**
 * Genera un trabajo de impresión en lenguaje QPDL v3 (SPL de Samsung), el que
 * entiende la Xerox Phaser 3020 (y la Samsung SL-M2020, de la que deriva).
 *
 * Es un port de rastertoqpdl de SpliX (src/printer.cpp, src/compress.cpp,
 * src/qpdl.cpp) con los parámetros que SpliX usa para "Phaser 3020":
 * QPDL versión 3, compresión 0x11, bandas de 128 líneas, ancho de banda
 * especial (SpecialBandWidth), cabecera de documento <0><0><1>, 600 ppp.
 *
 * Uso: [iniciar], luego [escribirPagina] por cada página, luego [terminar].
 */
class QpdlEncoder(
    private val salida: OutputStream,
    private val opciones: OpcionesTrabajo,
    private val fecha: LocalDate = LocalDate.now(),
) {
    private val papel = opciones.papel
    private val ppp = Papel.PPP

    private var iniciado = false

    fun iniciar() {
        check(!iniciado)
        iniciado = true
        val sb = StringBuilder()
        sb.append("\u001B%-12345X")
        sb.append("@PJL DEFAULT SERVICEDATE=%04d%02d%02d\n".format(fecha.year, fecha.monthValue, fecha.dayOfMonth))
        sb.append("@PJL SET USERNAME=\"${ascii(opciones.usuario)}\"\n")
        sb.append("@PJL SET JOBNAME=\"${ascii(opciones.nombreTrabajo)}\"\n")
        if (opciones.ahorroToner) sb.append("@PJL SET ECONOMODE=ON\n")
        sb.append("@PJL DEFAULT POWERSAVE=ON\n")
        sb.append("@PJL DEFAULT POWERSAVETIME=5\n")
        sb.append("@PJL SET JAMRECOVERY=OFF\n")
        sb.append("@PJL SET DUPLEX=OFF\n")
        sb.append("@PJL SET PAPERTYPE=OFF\n")
        sb.append("@PJL SET ALTITUDE=LOW\n")
        sb.append("@PJL SET DENSITY=${opciones.densidad.coerceIn(1, 5)}\n")
        sb.append("@PJL SET RET=NORMAL\n")
        sb.append("@PJL ENTER LANGUAGE = QPDL\n")
        salida.write(sb.toString().toByteArray(Charsets.US_ASCII))
    }

    fun escribirPagina(pagina: PaginaBits) {
        check(iniciado) { "Llamar a iniciar() primero" }
        require(pagina.anchoPx == papel.anchoPx() && pagina.altoPx == papel.altoPx()) {
            "La página debe medir ${papel.anchoPx()}×${papel.altoPx()} px"
        }
        val copias = opciones.copias.coerceIn(1, 999)

        // Cabecera de página (renderPage en qpdl.cpp).
        val ancho300 = ceil(300 * papel.anchoPt / 72.0).toInt()
        val alto300 = ceil(300 * papel.altoPt / 72.0).toInt()
        salida.write(
            byteArrayOf(
                0,                                   // firma
                (ppp / 100).toByte(),                // resolución Y
                (copias shr 8).toByte(), copias.toByte(),
                papel.codigo.toByte(),               // tipo de papel
                (ancho300 shr 8).toByte(), ancho300.toByte(),
                (alto300 shr 8).toByte(), alto300.toByte(),
                (if (opciones.bandejaManual) 2 else 1).toByte(), // origen del papel
                0,                                   // desconocido 1
                1,                                   // dúplex (1 = simple en compresión ≠ 0x15)
                0,                                   // tumble
                0,                                   // desconocido 2
                3,                                   // versión QPDL
                1,                                   // desconocido 3
                (ppp / 100).toByte(),                // resolución X
            )
        )

        for (banda in bandas(pagina)) escribirBanda(banda)

        // Pie de página.
        salida.write(byteArrayOf(1, (copias shr 8).toByte(), copias.toByte()))
    }

    fun terminar() {
        salida.write("\t\u001B%-12345X".toByteArray(Charsets.US_ASCII))
        salida.flush()
    }

    /** Banda ya comprimida, lista para enviar. */
    internal class Banda(val numero: Int, val anchoPx: Int, val altoPx: Int, val datos: ByteArray)

    /**
     * Corta la página en bandas de 128 líneas, cada una "traspuesta" (columna de
     * bytes por columna), invertida y comprimida (_compressBandedPage).
     */
    internal fun bandas(pagina: PaginaBits): Sequence<Banda> = sequence {
        val margenX = (ceil(MARGEN_PX).toInt() + 7) and 7.inv()
        val margenXBytes = margenX / 8
        val margenY = ceil(MARGEN_PX).toInt()
        val bytesLinea = pagina.bytesPorLinea
        var restante = pagina.altoPx - margenY
        val altoBanda = ALTO_BANDA
        val anchoBandaBytes = papel.anchoBandaBytes
        val bytesACopiar = minOf(bytesLinea - margenXBytes, anchoBandaBytes)
        val banda = ByteArray(anchoBandaBytes * altoBanda)
        val plano = pagina.datos
        var indice = margenY * bytesLinea
        var numero = 0

        while (restante > 0) {
            val ultima = restante < altoBanda
            val filas = if (ultima) restante else altoBanda
            if (ultima) banda.fill(0)
            for (y in 0 until filas) {
                val base = indice + margenXBytes + y * bytesLinea
                for (x in 0 until bytesACopiar) banda[x * altoBanda + y] = plano[base + x]
                for (x in bytesACopiar until anchoBandaBytes) banda[x * altoBanda + y] = 0
            }
            if (!banda.all { it.toInt() == 0 }) {
                val invertida = ByteArray(banda.size) { banda[it].toInt().inv().toByte() }
                yield(Banda(numero, anchoBandaBytes * 8, altoBanda, Algo0x11.comprimir(invertida)))
            }
            numero++
            indice += bytesLinea * altoBanda
            restante = if (ultima) 0 else restante - altoBanda
        }
    }

    /** Registro de banda (_renderBand, QPDL v3, monocromo, compresión 0x11). */
    private fun escribirBanda(banda: Banda) {
        val tamano = banda.datos.size + 4 + 4 // datos + firma + checksum
        salida.write(
            byteArrayOf(
                0x0C,
                banda.numero.toByte(),
                (banda.anchoPx shr 8).toByte(), banda.anchoPx.toByte(),
                (banda.altoPx shr 8).toByte(), banda.altoPx.toByte(),
                Algo0x11.CODIGO.toByte(),
                (tamano shr 24).toByte(), (tamano shr 16).toByte(), (tamano shr 8).toByte(), tamano.toByte(),
            )
        )
        // Firma 0x09ABCDEF en little endian (byte order nativo de x86/ARM).
        val firma = byteArrayOf(0xEF.toByte(), 0xCD.toByte(), 0xAB.toByte(), 0x09)
        salida.write(firma)
        salida.write(banda.datos)
        var suma = 0
        for (b in firma) suma += b.toInt() and 0xFF
        for (b in banda.datos) suma += b.toInt() and 0xFF
        salida.write(byteArrayOf((suma shr 24).toByte(), (suma shr 16).toByte(), (suma shr 8).toByte(), suma.toByte()))
    }

    private fun ascii(s: String): String {
        val limpio = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
            .replace(Regex("[^\\x20-\\x7E]"), "")
            .replace("\"", "'")
        return limpio.take(60).ifBlank { "Documento" }
    }

    companion object {
        const val ALTO_BANDA = 128
        private const val MARGEN_PX = Papel.MARGEN_PT * Papel.PPP / 72.0
    }
}
