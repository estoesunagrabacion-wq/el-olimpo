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
    /** Nombre estándar PWG 5101.1 (lo usan IPP, ChromeOS y Android). */
    val nombrePwg: String,
    /** Medidas en centésimas de milímetro, como las expresa IPP. */
    val anchoCentMm: Int,
    val altoCentMm: Int,
) {
    A4("A4 (210 × 297 mm)", 595.0, 842.0, 2, 608, "iso_a4_210x297mm", 21000, 29700),
    CARTA("Carta (8,5 × 11\")", 612.0, 792.0, 0, 640, "na_letter_8.5x11in", 21590, 27940),
    OFICIO("Oficio (216 × 340 mm)", 612.0, 972.0, 28, 640, "na_oficio_8.5x13.4in", 21590, 34036),
    LEGAL("Legal (8,5 × 14\")", 612.0, 1008.0, 1, 640, "na_legal_8.5x14in", 21590, 35560),
    A5("A5 (148 × 210 mm)", 420.0, 595.0, 16, 416, "iso_a5_148x210mm", 14800, 21000);

    /** Ancho de la página completa en píxeles, redondeado a múltiplo de 8. */
    fun anchoPx(ppp: Int = PPP): Int = (ceil(anchoPt * ppp / 72.0).toInt() + 7) and 7.inv()

    /** Alto de la página completa en píxeles. */
    fun altoPx(ppp: Int = PPP): Int = ceil(altoPt * ppp / 72.0).toInt()

    companion object {
        /** Papel por nombre PWG (ej. "iso_a4_210x297mm"), o null si no se conoce. */
        fun porNombrePwg(nombre: String?): Papel? = entries.firstOrNull { it.nombrePwg == nombre }

        /** Papel más parecido a unas medidas en centésimas de mm (tolerancia 5 mm). */
        fun porMedidas(anchoCentMm: Int, altoCentMm: Int): Papel? {
            val (a, b) = if (anchoCentMm <= altoCentMm) anchoCentMm to altoCentMm else altoCentMm to anchoCentMm
            return entries
                .map { it to maxOf(kotlin.math.abs(it.anchoCentMm - a), kotlin.math.abs(it.altoCentMm - b)) }
                .filter { it.second <= 500 }
                .minByOrNull { it.second }?.first
        }

        /** Única resolución usada por la app. */
        const val PPP = 600

        /** Márgenes físicos de la impresora en puntos (HWMargins 12.5 en SpliX). */
        const val MARGEN_PT = 12.5
    }
}
