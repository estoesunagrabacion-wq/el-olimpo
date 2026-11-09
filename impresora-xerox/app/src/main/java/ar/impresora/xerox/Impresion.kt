package ar.impresora.xerox

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import ar.impresora.qpdl.ModoTramado
import ar.impresora.qpdl.OpcionesTrabajo
import ar.impresora.qpdl.PaginaBits
import ar.impresora.qpdl.Papel
import ar.impresora.qpdl.QpdlEncoder
import ar.impresora.qpdl.Tramador
import java.io.OutputStream

/**
 * Convierte un [Documento] en un trabajo QPDL para la Phaser 3020.
 *
 * Cada página se dibuja a 600 ppp en franjas de [ALTO_FRANJA] líneas (para
 * no ocupar cientos de MB de memoria), se pasa a blanco y negro y se codifica.
 */
class Impresion(
    private val documento: Documento,
    private val opciones: OpcionesTrabajo,
    private val modo: ModoTramado,
    private val paginas: List<Int>,
    private val progreso: (pagina: Int, total: Int) -> Unit,
) {
    fun generar(salida: OutputStream) {
        val papel = opciones.papel
        val ancho = papel.anchoPx()
        val alto = papel.altoPx()
        val franja = Bitmap.createBitmap(ancho, ALTO_FRANJA, Bitmap.Config.ARGB_8888)
        val pixeles = IntArray(ancho * ALTO_FRANJA)
        val codificador = QpdlEncoder(salida, opciones)
        try {
            codificador.iniciar()
            paginas.forEachIndexed { n, indice ->
                if (Thread.currentThread().isInterrupted) throw InterruptedException()
                progreso(n + 1, paginas.size)
                val bits = PaginaBits(papel)
                val tramador = Tramador(bits, modo)
                documento.abrirPagina(indice).use { pagina ->
                    val base = ajustarAlPapel(pagina.ancho, pagina.alto, papel, documento.respetarMargenes)
                    var arriba = 0
                    while (arriba < alto) {
                        val filas = minOf(ALTO_FRANJA, alto - arriba)
                        franja.eraseColor(Color.WHITE)
                        val m = Matrix(base).apply { postTranslate(0f, -arriba.toFloat()) }
                        pagina.dibujar(franja, m)
                        franja.getPixels(pixeles, 0, ancho, 0, 0, ancho, filas)
                        tramador.procesar(pixeles, ancho, filas, arriba)
                        arriba += filas
                    }
                }
                codificador.escribirPagina(bits)
            }
            codificador.terminar()
        } finally {
            franja.recycle()
        }
    }

    companion object {
        const val ALTO_FRANJA = 512

        /**
         * Transformación que centra el contenido en el papel, lo gira si es
         * apaisado y lo escala para que entre entero.
         */
        fun ajustarAlPapel(ancho: Float, alto: Float, papel: Papel, respetarMargenes: Boolean): Matrix {
            val anchoPapel = papel.anchoPx().toFloat()
            val altoPapel = papel.altoPx().toFloat()
            val girar = (ancho > alto) != (anchoPapel > altoPapel)
            val anchoEf = if (girar) alto else ancho
            val altoEf = if (girar) ancho else alto
            val margen = if (respetarMargenes) (Papel.MARGEN_PT * Papel.PPP / 72.0).toFloat() * 1.5f else 0f
            val escala = minOf((anchoPapel - 2 * margen) / anchoEf, (altoPapel - 2 * margen) / altoEf)
            return Matrix().apply {
                if (girar) {
                    postRotate(90f)
                    postTranslate(alto, 0f)
                }
                postScale(escala, escala)
                postTranslate((anchoPapel - anchoEf * escala) / 2, (altoPapel - altoEf * escala) / 2)
            }
        }

        /** Interpreta "1-3, 5" como [0, 1, 2, 4]. Vacío = todas. */
        fun rangoDePaginas(texto: String, total: Int): List<Int> {
            if (texto.isBlank()) return (0 until total).toList()
            val resultado = sortedSetOf<Int>()
            for (parte in texto.split(',')) {
                val p = parte.trim()
                if (p.isEmpty()) continue
                val limites = p.split('-').map { it.trim() }
                val desde = limites[0].toIntOrNull() ?: throw IllegalArgumentException("Rango inválido: \"$p\"")
                val hasta = if (limites.size > 1) limites[1].toIntOrNull() ?: total else desde
                for (i in desde..hasta) if (i in 1..total) resultado.add(i - 1)
            }
            require(resultado.isNotEmpty()) { "Ninguna de esas páginas existe (el documento tiene $total)" }
            return resultado.toList()
        }
    }
}
