package ar.impresora.qpdl

/** Cómo convertir grises a puntos blancos y negros. */
enum class ModoTramado(val etiqueta: String) {
    /** Umbral fijo: texto nítido, ideal para documentos. */
    TEXTO("Texto (nítido)"),

    /** Difusión de error Floyd–Steinberg: ideal para fotos y grises. */
    FOTO("Fotos (tramado)"),
}

/**
 * Convierte franjas de píxeles ARGB (como las de un Bitmap de Android) en una
 * [PaginaBits]. Se procesa de arriba hacia abajo, franja por franja, para no
 * tener que guardar la página entera en color (a 600 ppp serían ~140 MB).
 */
class Tramador(private val pagina: PaginaBits, private val modo: ModoTramado, private val umbral: Int = 160) {
    private val ancho = pagina.anchoPx
    private var errorActual = IntArray(ancho + 2)
    private var errorSiguiente = IntArray(ancho + 2)

    /**
     * @param pixeles filas ARGB contiguas, cada una de [anchoFila] píxeles.
     * @param filas cantidad de filas válidas en [pixeles].
     * @param filaInicial fila de la página donde empieza la franja.
     */
    fun procesar(pixeles: IntArray, anchoFila: Int, filas: Int, filaInicial: Int) {
        val n = minOf(anchoFila, ancho)
        for (f in 0 until filas) {
            val y = filaInicial + f
            if (y >= pagina.altoPx) return
            val base = f * anchoFila
            when (modo) {
                ModoTramado.TEXTO -> for (x in 0 until n) {
                    if (luminancia(pixeles[base + x]) < umbral) pagina.ponerNegro(x, y)
                }
                ModoTramado.FOTO -> {
                    for (x in 0 until n) {
                        val valor = luminancia(pixeles[base + x]) + errorActual[x + 1] / 16
                        val negro = valor < 128
                        if (negro) pagina.ponerNegro(x, y)
                        val e = (valor - if (negro) 0 else 255).coerceIn(-255, 255)
                        errorActual[x + 2] += e * 7
                        errorSiguiente[x] += e * 3
                        errorSiguiente[x + 1] += e * 5
                        errorSiguiente[x + 2] += e
                    }
                    val t = errorActual
                    errorActual = errorSiguiente
                    errorSiguiente = t
                    errorSiguiente.fill(0)
                }
            }
        }
    }

    companion object {
        /** Luminancia 0..255 de un píxel ARGB, compuesto sobre fondo blanco. */
        fun luminancia(argb: Int): Int {
            val a = argb ushr 24
            val r = (argb shr 16) and 0xFF
            val g = (argb shr 8) and 0xFF
            val b = argb and 0xFF
            val l = (r * 299 + g * 587 + b * 114) / 1000
            return (l * a + 255 * (255 - a)) / 255
        }
    }
}
