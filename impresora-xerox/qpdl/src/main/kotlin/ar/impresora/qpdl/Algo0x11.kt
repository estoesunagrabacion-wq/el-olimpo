/*
 * Derivado de SpliX (https://github.com/OpenPrinting/splix), (C) Aurélien Croc y colaboradores.
 * Este programa es software libre: GNU General Public License, versión 2.
 */
package ar.impresora.qpdl

/**
 * Compresión "0x11" de QPDL (un LZ77 sencillo con tabla de distancias).
 *
 * Portado de src/algo0x11.cpp de SpliX (GPL v2, Aurélien Croc).
 *
 * Formato de salida:
 *  - 4 bytes (little endian): cantidad de bytes iniciales sin comprimir (N).
 *  - 64 × 2 bytes (little endian): tabla de distancias hacia atrás.
 *  - N bytes copiados tal cual.
 *  - Secuencia de bloques:
 *      * Copia:  byte0 = 0x80 | (L-3) & 0x7F
 *                byte1 = ((L-3) >> 1) & 0xC0 | índiceTabla
 *                (copia L bytes desde "distancia" posiciones atrás, 3 ≤ L ≤ 514)
 *      * Literal: byte = n-1 (0..127) seguido de n bytes tal cual.
 */
object Algo0x11 {
    const val CODIGO = 0x11

    private const val MUESTREO = 0x800
    const val TAMANO_TABLA = 0x40
    private const val MAX_SIN_COMPRIMIR = 0x80
    private const val MAX_COMPRIMIDO = 0x202
    private const val MIN_COMPRIMIDO = 0x2
    private const val BANDERA = 0x80

    /** Elige las 64 distancias que más se repiten (lookupBestOccurs). */
    internal fun tablaDistancias(datos: ByteArray): IntArray {
        val tam = datos.size
        val ocurrencias = IntArray(MUESTREO)
        var i = MUESTREO
        while (i < tam) {
            val b = datos[i]
            for (j in 1 until MUESTREO) {
                if (datos[i - j] == b) ocurrencias[j - 1]++
            }
            i += MUESTREO
        }
        // Orden descendente por cantidad (estable: a igual cantidad, menor distancia primero).
        val orden = (0 until MUESTREO).sortedByDescending { ocurrencias[it] }
        val tabla = IntArray(TAMANO_TABLA) { orden[it] + 1 }
        if (tabla.none { it == 1 }) tabla[TAMANO_TABLA - 1] = 1
        return tabla
    }

    fun comprimir(datos: ByteArray): ByteArray = comprimir(datos, tablaDistancias(datos))

    internal fun comprimir(datos: ByteArray, tabla: IntArray): ByteArray {
        val tam = datos.size
        val salida = Bufer(tam / 4 + 1024)

        // Cabecera: cantidad inicial sin comprimir + tabla.
        var sinComprimir = tabla.max()
        if (sinComprimir > MAX_SIN_COMPRIMIR) sinComprimir = MAX_SIN_COMPRIMIR
        if (sinComprimir > tam) sinComprimir = tam
        salida.u32le(sinComprimir)
        for (d in tabla) salida.u16le(d)

        var r = 0
        while (r < sinComprimir) salida.byte(datos[r++].toInt())

        var literales = 0
        var posContador = 0
        while (true) {
            val maxLargo = minOf(tam - r, MAX_COMPRIMIDO)
            if (maxLargo == 0) {
                if (literales != 0) salida.poner(posContador, literales - 1)
                break
            }
            if (maxLargo >= 2) {
                var mejorLargo = 0
                var mejorIndice = 0
                for (k in 0 until TAMANO_TABLA) {
                    val distancia = tabla[k]
                    if (distancia > r) continue
                    val origen = r - distancia
                    var n = 0
                    while (n < maxLargo && datos[r + n] == datos[origen + n]) n++
                    if (n > mejorLargo) {
                        mejorLargo = n
                        mejorIndice = k
                    }
                }
                if (mejorLargo > MIN_COMPRIMIDO) {
                    r += mejorLargo
                    val l = mejorLargo - 3
                    salida.byte(BANDERA or (l and 0x7F))
                    salida.byte(((l shr 1) and 0xC0) or (mejorIndice and 0x3F))
                    if (literales != 0) {
                        salida.poner(posContador, literales - 1)
                        literales = 0
                    }
                    continue
                }
            }
            // Byte literal.
            literales++
            if (literales == 1) {
                posContador = salida.tamano
                salida.byte(0)
            } else if (literales == MAX_SIN_COMPRIMIR) {
                salida.poner(posContador, 0x7F)
                literales = 0
            }
            salida.byte(datos[r].toInt())
            r++
        }
        return salida.aArreglo()
    }

    /** Descompresor (usado por los tests para verificar el compresor). */
    fun descomprimir(comprimido: ByteArray, tamanoOriginal: Int): ByteArray {
        fun u8(i: Int) = comprimido[i].toInt() and 0xFF
        val salida = ByteArray(tamanoOriginal)
        val sinComprimir = u8(0) or (u8(1) shl 8) or (u8(2) shl 16) or (u8(3) shl 24)
        val tabla = IntArray(TAMANO_TABLA) { u8(4 + 2 * it) or (u8(5 + 2 * it) shl 8) }
        var p = 4 + 2 * TAMANO_TABLA
        var w = 0
        repeat(sinComprimir) { salida[w++] = comprimido[p++] }
        while (p < comprimido.size) {
            val b0 = u8(p++)
            if (b0 and BANDERA != 0) {
                val b1 = u8(p++)
                val largo = ((b0 and 0x7F) or ((b1 and 0xC0) shl 1)) + 3
                val origen = w - tabla[b1 and 0x3F]
                for (n in 0 until largo) salida[w + n] = salida[origen + n]
                w += largo
            } else {
                val n = b0 + 1
                System.arraycopy(comprimido, p, salida, w, n)
                p += n
                w += n
            }
        }
        require(w == tamanoOriginal) { "Tamaño descomprimido $w ≠ $tamanoOriginal" }
        return salida
    }
}

/** Arreglo de bytes que crece según haga falta. */
internal class Bufer(capacidadInicial: Int) {
    private var datos = ByteArray(maxOf(capacidadInicial, 16))
    var tamano = 0
        private set

    private fun asegurar(extra: Int) {
        if (tamano + extra > datos.size) datos = datos.copyOf(maxOf(datos.size * 2, tamano + extra))
    }

    fun byte(v: Int) {
        asegurar(1)
        datos[tamano++] = v.toByte()
    }

    fun poner(pos: Int, v: Int) {
        datos[pos] = v.toByte()
    }

    fun u16le(v: Int) {
        byte(v); byte(v shr 8)
    }

    fun u32le(v: Int) {
        byte(v); byte(v shr 8); byte(v shr 16); byte(v shr 24)
    }

    fun aArreglo(): ByteArray = datos.copyOf(tamano)
}
