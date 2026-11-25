package ar.impresora.qpdl

import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream

/**
 * Lector de "PWG Raster" (PWG 5102.4), el formato de imagen que ChromeOS (CUPS)
 * manda a las impresoras IPP Everywhere.
 *
 * Estructura: "RaS2" y, por cada página, una cabecera de 1796 bytes seguida de
 * las líneas comprimidas. Cada línea empieza con un byte de repetición (la
 * línea se repite N veces más) y sigue con bloques: n ≤ 127 → el píxel que
 * sigue se repite n+1 veces; n ≥ 129 → siguen 257-n píxeles literales;
 * n = 128 → el resto de la línea es blanco.
 */
class PwgRaster(entrada: InputStream) {
    private val datos = DataInputStream(entrada.buffered(64 * 1024))

    data class Encabezado(
        val ppp: Int,
        val pppY: Int,
        val ancho: Int,
        val alto: Int,
        val bitsPorPixel: Int,
        val bytesPorLinea: Int,
        val espacioDeColor: Int,
        val copias: Int,
        /** Tamaño de página en puntos. */
        val anchoPt: Int,
        val altoPt: Int,
    ) {
        val bytesPorPixel get() = bitsPorPixel / 8
    }

    private var encabezado: Encabezado? = null
    private var filasLeidas = 0
    private var repeticiones = 0
    private var filaActual: ByteArray = ByteArray(0)

    init {
        val firma = ByteArray(4)
        datos.readFully(firma)
        if (String(firma, Charsets.US_ASCII) != "RaS2") throw IOException("No es PWG Raster")
    }

    /** Lee la cabecera de la página siguiente, o devuelve null si no hay más. */
    fun siguientePagina(): Encabezado? {
        encabezado?.let { e -> while (filasLeidas < e.alto) leerFila() }
        val cab = ByteArray(1796)
        try {
            datos.readFully(cab)
        } catch (e: EOFException) {
            return null
        }
        fun u32(pos: Int) = ((cab[pos].toInt() and 0xFF) shl 24) or ((cab[pos + 1].toInt() and 0xFF) shl 16) or
            ((cab[pos + 2].toInt() and 0xFF) shl 8) or (cab[pos + 3].toInt() and 0xFF)
        val e = Encabezado(
            ppp = u32(276), pppY = u32(280),
            copias = u32(340).coerceAtLeast(1),
            anchoPt = u32(352), altoPt = u32(356),
            ancho = u32(372), alto = u32(376),
            bitsPorPixel = u32(388), bytesPorLinea = u32(392), espacioDeColor = u32(400),
        )
        if (e.bitsPorPixel != 8 && e.bitsPorPixel != 24) throw IOException("PWG con ${e.bitsPorPixel} bits por píxel no soportado")
        if (e.ancho <= 0 || e.alto <= 0 || e.bytesPorLinea != e.ancho * e.bytesPorPixel) throw IOException("Cabecera PWG inválida")
        encabezado = e
        filasLeidas = 0
        repeticiones = 0
        filaActual = ByteArray(e.bytesPorLinea)
        return e
    }

    /** Devuelve la fila siguiente de la página actual (el arreglo se reutiliza). */
    fun leerFila(): ByteArray {
        val e = encabezado ?: throw IllegalStateException("Llamar a siguientePagina() primero")
        check(filasLeidas < e.alto) { "No quedan filas en la página" }
        filasLeidas++
        if (repeticiones > 0) {
            repeticiones--
            return filaActual
        }
        repeticiones = datos.readUnsignedByte()
        val bpp = e.bytesPorPixel
        val fila = filaActual
        var pos = 0
        while (pos < fila.size) {
            val n = datos.readUnsignedByte()
            when {
                n == 128 -> {
                    fila.fill(0xFF.toByte(), pos, fila.size)
                    pos = fila.size
                }
                n < 128 -> {
                    val cuantos = n + 1
                    datos.readFully(fila, pos, bpp)
                    for (k in 1 until cuantos) System.arraycopy(fila, pos, fila, pos + k * bpp, bpp)
                    pos += cuantos * bpp
                }
                else -> {
                    val cuantos = 257 - n
                    datos.readFully(fila, pos, cuantos * bpp)
                    pos += cuantos * bpp
                }
            }
        }
        return fila
    }

    companion object {
        /**
         * Lee un trabajo PWG completo y entrega cada página ya convertida a
         * blanco y negro sobre el papel que [papelPara] elija.
         */
        fun aPaginas(
            entrada: InputStream,
            modo: ModoTramado,
            papelPara: (Encabezado) -> Papel,
            alPagina: (PaginaBits, Papel, Encabezado) -> Unit,
        ) {
            val lector = PwgRaster(entrada)
            while (true) {
                val e = lector.siguientePagina() ?: break
                val papel = papelPara(e)
                val pagina = PaginaBits(papel)
                val tramador = Tramador(pagina, modo)
                val ancho = pagina.anchoPx
                val argb = IntArray(ancho)
                // Escala a 600 ppp y centra la imagen en el papel.
                val anchoDestino = (e.ancho.toLong() * Papel.PPP / e.ppp).toInt()
                val altoDestino = (e.alto.toLong() * Papel.PPP / e.pppY).toInt()
                val dx = (ancho - anchoDestino) / 2
                val dy = (pagina.altoPx - altoDestino) / 2
                val origenX = IntArray(ancho) { x ->
                    val xd = x - dx
                    if (xd < 0 || xd >= anchoDestino) -1 else minOf(e.ancho - 1, (xd.toLong() * e.ppp / Papel.PPP).toInt())
                }
                var yDestino = 0
                for (fila in 0 until e.alto) {
                    val datos = lector.leerFila()
                    // Filas de la página que salen de esta fila de origen.
                    val hasta = (((fila + 1).toLong() * Papel.PPP + e.pppY - 1) / e.pppY).toInt()
                    while (yDestino < hasta) {
                        val y = yDestino + dy
                        if (y in 0 until pagina.altoPx) {
                            for (x in 0 until ancho) {
                                val sx = origenX[x]
                                argb[x] = if (sx < 0) BLANCO else if (e.bytesPorPixel == 1) {
                                    val g = datos[sx].toInt() and 0xFF
                                    (0xFF shl 24) or (g shl 16) or (g shl 8) or g
                                } else {
                                    val p = sx * 3
                                    (0xFF shl 24) or ((datos[p].toInt() and 0xFF) shl 16) or
                                        ((datos[p + 1].toInt() and 0xFF) shl 8) or (datos[p + 2].toInt() and 0xFF)
                                }
                            }
                            tramador.procesar(argb, ancho, 1, y)
                        }
                        yDestino++
                    }
                }
                alPagina(pagina, papel, e)
            }
        }

        private const val BLANCO = -1 // 0xFFFFFFFF
    }
}
