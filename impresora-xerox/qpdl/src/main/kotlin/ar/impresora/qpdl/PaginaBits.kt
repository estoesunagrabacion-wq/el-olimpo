package ar.impresora.qpdl

/**
 * Página en blanco y negro de 1 bit por píxel.
 *
 * Bit en 1 = punto negro (tóner). El bit más significativo de cada byte es el
 * píxel de más a la izquierda, igual que un raster de CUPS en espacio "K".
 */
class PaginaBits(val anchoPx: Int, val altoPx: Int) {
    val bytesPorLinea: Int = (anchoPx + 7) / 8
    val datos: ByteArray = ByteArray(bytesPorLinea * altoPx)

    constructor(papel: Papel) : this(papel.anchoPx(), papel.altoPx())

    fun ponerNegro(x: Int, y: Int) {
        val i = y * bytesPorLinea + (x ushr 3)
        datos[i] = (datos[i].toInt() or (0x80 ushr (x and 7))).toByte()
    }

    fun esNegro(x: Int, y: Int): Boolean {
        val i = y * bytesPorLinea + (x ushr 3)
        return (datos[i].toInt() and (0x80 ushr (x and 7))) != 0
    }

    fun estaVacia(): Boolean = datos.all { it.toInt() == 0 }
}
