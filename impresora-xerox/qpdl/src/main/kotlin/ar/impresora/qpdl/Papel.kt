package ar.impresora.qpdl

import kotlin.math.ceil

/**
 * Tamaños de papel soportados.
 *
 * Los valores (medidas en puntos de 1/72", código de papel y ancho de banda)
 * vienen de la definición de la Xerox Phaser 3020 / Samsung M2020 en el
 * driver libre SpliX (ppd/xerox.drv.in, ppd/media.defs y src/compress.cpp).
 */
enum class Papel(
    val etiqueta: String,
    val anchoPt: Double,
    val altoPt: Double,
    /** Código de papel que se envía en la cabecera de página QPDL. */
    val codigo: Int,
    /** Ancho de banda en bytes a 600 ppp (tabla _get2020BandWidthInB). */
    val anchoBandaBytes: Int,
) {
    A4("A4 (210 × 297 mm)", 595.0, 842.0, 2, 608),
    CARTA("Carta (8,5 × 11\")", 612.0, 792.0, 0, 640),
    OFICIO("Oficio (216 × 340 mm)", 612.0, 972.0, 28, 640),
    LEGAL("Legal (8,5 × 14\")", 612.0, 1008.0, 1, 640),
    A5("A5 (148 × 210 mm)", 420.0, 595.0, 16, 416);

    /** Ancho de la página completa en píxeles, redondeado a múltiplo de 8. */
    fun anchoPx(ppp: Int = PPP): Int = (ceil(anchoPt * ppp / 72.0).toInt() + 7) and 7.inv()

    /** Alto de la página completa en píxeles. */
    fun altoPx(ppp: Int = PPP): Int = ceil(altoPt * ppp / 72.0).toInt()

    companion object {
        /** Única resolución usada por la app. */
        const val PPP = 600

        /** Márgenes físicos de la impresora en puntos (HWMargins 12.5 en SpliX). */
        const val MARGEN_PT = 12.5
    }
}
