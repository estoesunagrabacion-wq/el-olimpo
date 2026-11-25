package ar.impresora.ipp

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.InputStream

/** Etiquetas de IPP (RFC 8010). */
object Tag {
    const val OPERACION = 0x01
    const val TRABAJO = 0x02
    const val FIN = 0x03
    const val IMPRESORA = 0x04
    const val NO_SOPORTADO = 0x05

    const val SIN_VALOR = 0x13
    const val ENTERO = 0x21
    const val BOOLEANO = 0x22
    const val ENUM = 0x23
    const val OCTETOS = 0x30
    const val RESOLUCION = 0x32
    const val RANGO = 0x33
    const val INICIO_COLECCION = 0x34
    const val TEXTO_CON_IDIOMA = 0x35
    const val NOMBRE_CON_IDIOMA = 0x36
    const val FIN_COLECCION = 0x37
    const val TEXTO = 0x41
    const val NOMBRE = 0x42
    const val PALABRA_CLAVE = 0x44
    const val URI = 0x45
    const val CHARSET = 0x47
    const val IDIOMA = 0x48
    const val MIME = 0x49
    const val NOMBRE_MIEMBRO = 0x4A
}

/** Operaciones y códigos de estado usados. */
object Op {
    const val PRINT_JOB = 0x0002
    const val VALIDATE_JOB = 0x0004
    const val CREATE_JOB = 0x0005
    const val SEND_DOCUMENT = 0x0006
    const val CANCEL_JOB = 0x0008
    const val GET_JOB_ATTRIBUTES = 0x0009
    const val GET_JOBS = 0x000A
    const val GET_PRINTER_ATTRIBUTES = 0x000B
    const val CLOSE_JOB = 0x003B
    const val IDENTIFY_PRINTER = 0x003C

    const val OK = 0x0000
    const val OK_IGNORADOS = 0x0001
    const val ERROR_PEDIDO = 0x0400
    const val ERROR_NO_POSIBLE = 0x0404
    const val ERROR_NO_ENCONTRADO = 0x0406
    const val ERROR_FORMATO = 0x040A
    const val ERROR_OPERACION = 0x0501
    const val ERROR_INTERNO = 0x0500
}

/**
 * Atributo leído. Los miembros de colecciones se guardan "aplanados" con su
 * ruta, por ejemplo "media-col/media-size/x-dimension".
 */
class Atributo(val nombre: String, val tag: Int, val valores: MutableList<ByteArray> = mutableListOf()) {
    val texto: String? get() = valores.firstOrNull()?.toString(Charsets.UTF_8)
    val textos: List<String> get() = valores.map { it.toString(Charsets.UTF_8) }
    val entero: Int?
        get() = valores.firstOrNull()?.takeIf { it.size == 4 }?.let {
            ((it[0].toInt() and 0xFF) shl 24) or ((it[1].toInt() and 0xFF) shl 16) or
                ((it[2].toInt() and 0xFF) shl 8) or (it[3].toInt() and 0xFF)
        }
    val booleano: Boolean? get() = valores.firstOrNull()?.takeIf { it.size == 1 }?.let { it[0].toInt() != 0 }
}

class Grupo(val tag: Int, val atributos: LinkedHashMap<String, Atributo> = LinkedHashMap())

/** Pedido IPP ya leído (sin el documento, que queda en el flujo de entrada). */
class PedidoIpp(
    val version: Int,
    val operacion: Int,
    val idPedido: Int,
    val grupos: List<Grupo>,
) {
    fun atributo(nombre: String): Atributo? = grupos.firstNotNullOfOrNull { it.atributos[nombre] }
    fun operacion(nombre: String): Atributo? = grupos.firstOrNull { it.tag == Tag.OPERACION }?.atributos?.get(nombre)

    companion object {
        /** Lee la cabecera IPP y los grupos hasta "end-of-attributes-tag". */
        fun leer(entrada: InputStream): PedidoIpp {
            val d = DataInputStream(entrada)
            val version = d.readUnsignedShort()
            val operacion = d.readUnsignedShort()
            val id = d.readInt()
            val grupos = mutableListOf<Grupo>()
            var grupo: Grupo? = null
            var ultimo: Atributo? = null
            val pila = ArrayDeque<String>() // rutas completas de las colecciones abiertas
            var miembro: String? = null
            var ultimoMiembro = ""
            while (true) {
                val tag = d.readUnsignedByte()
                if (tag == Tag.FIN) break
                if (tag < 0x10) { // delimitador de grupo
                    grupo = Grupo(tag).also { grupos.add(it) }
                    ultimo = null
                    pila.clear()
                    continue
                }
                val nombre = leerCadena(d)
                val valor = ByteArray(d.readUnsignedShort()).also { d.readFully(it) }
                val g = grupo ?: throw IOException("Atributo fuera de grupo")
                when {
                    tag == Tag.NOMBRE_MIEMBRO -> miembro = valor.toString(Charsets.UTF_8)
                    tag == Tag.FIN_COLECCION -> {
                        if (pila.isNotEmpty()) pila.removeLast()
                        miembro = null
                    }
                    tag == Tag.INICIO_COLECCION -> {
                        val ruta = if (pila.isEmpty()) {
                            if (nombre.isNotEmpty()) {
                                ultimo = Atributo(nombre, tag).also { g.atributos[nombre] = it }
                            }
                            ultimo?.nombre ?: nombre
                        } else {
                            pila.last() + "/" + (miembro ?: ultimoMiembro)
                        }
                        pila.addLast(ruta)
                        miembro = null
                    }
                    pila.isNotEmpty() -> {
                        val ruta = pila.last() + "/" + (miembro ?: ultimoMiembro)
                        ultimoMiembro = miembro ?: ultimoMiembro
                        g.atributos.getOrPut(ruta) { Atributo(ruta, tag) }.valores.add(valor)
                        miembro = null
                    }
                    nombre.isEmpty() -> ultimo?.valores?.add(valor)
                    else -> ultimo = Atributo(nombre, tag, mutableListOf(valor)).also { g.atributos[nombre] = it }
                }
            }
            return PedidoIpp(version, operacion, id, grupos)
        }

        private fun leerCadena(d: DataInputStream): String {
            val b = ByteArray(d.readUnsignedShort())
            d.readFully(b)
            return b.toString(Charsets.UTF_8)
        }
    }
}

/** Arma una respuesta IPP. */
class RespuestaIpp(version: Int, estado: Int, idPedido: Int) {
    private val buf = ByteArrayOutputStream()

    init {
        u16(version); u16(estado); u32(idPedido)
        grupo(Tag.OPERACION)
        cadena(Tag.CHARSET, "attributes-charset", "utf-8")
        cadena(Tag.IDIOMA, "attributes-natural-language", "en")
    }

    private fun u8(v: Int) = buf.write(v and 0xFF)
    private fun u16(v: Int) { u8(v shr 8); u8(v) }
    private fun u32(v: Int) { u16(v shr 16); u16(v) }

    private fun valor(tag: Int, nombre: String, datos: ByteArray) {
        u8(tag)
        val n = nombre.toByteArray(Charsets.UTF_8)
        u16(n.size); buf.write(n)
        u16(datos.size); buf.write(datos)
    }

    private fun int4(v: Int) = byteArrayOf((v shr 24).toByte(), (v shr 16).toByte(), (v shr 8).toByte(), v.toByte())

    fun grupo(tag: Int) = apply { u8(tag) }

    fun cadena(tag: Int, nombre: String, vararg valores: String) = apply {
        valores.forEachIndexed { i, v -> valor(tag, if (i == 0) nombre else "", v.toByteArray(Charsets.UTF_8)) }
    }

    fun palabras(nombre: String, vararg v: String) = cadena(Tag.PALABRA_CLAVE, nombre, *v)
    fun texto(nombre: String, v: String) = cadena(Tag.TEXTO, nombre, v)
    fun nombre(nombre: String, v: String) = cadena(Tag.NOMBRE, nombre, v)
    fun uri(nombre: String, vararg v: String) = cadena(Tag.URI, nombre, *v)
    fun mime(nombre: String, vararg v: String) = cadena(Tag.MIME, nombre, *v)

    fun enteros(nombre: String, vararg v: Int) = apply {
        v.forEachIndexed { i, x -> valor(Tag.ENTERO, if (i == 0) nombre else "", int4(x)) }
    }

    fun enums(nombre: String, vararg v: Int) = apply {
        v.forEachIndexed { i, x -> valor(Tag.ENUM, if (i == 0) nombre else "", int4(x)) }
    }

    fun booleano(nombre: String, v: Boolean) = apply { valor(Tag.BOOLEANO, nombre, byteArrayOf(if (v) 1 else 0)) }

    fun rango(nombre: String, desde: Int, hasta: Int) = apply { valor(Tag.RANGO, nombre, int4(desde) + int4(hasta)) }

    /** Resolución en puntos por pulgada. */
    fun resolucion(nombre: String, vararg ppp: Int) = apply {
        ppp.forEachIndexed { i, r -> valor(Tag.RESOLUCION, if (i == 0) nombre else "", int4(r) + int4(r) + byteArrayOf(3)) }
    }

    /** Colección: [miembros] escribe los miembros con [Coleccion]. */
    fun coleccion(nombre: String, vararg miembros: Coleccion.() -> Unit) = apply {
        miembros.forEachIndexed { i, m ->
            valor(Tag.INICIO_COLECCION, if (i == 0) nombre else "", ByteArray(0))
            Coleccion().m()
            valor(Tag.FIN_COLECCION, "", ByteArray(0))
        }
    }

    inner class Coleccion {
        private fun miembro(n: String) = valor(Tag.NOMBRE_MIEMBRO, "", n.toByteArray(Charsets.UTF_8))
        fun entero(n: String, v: Int) { miembro(n); valor(Tag.ENTERO, "", int4(v)) }
        fun palabra(n: String, v: String) { miembro(n); valor(Tag.PALABRA_CLAVE, "", v.toByteArray(Charsets.UTF_8)) }
        fun coleccion(n: String, contenido: Coleccion.() -> Unit) {
            miembro(n)
            valor(Tag.INICIO_COLECCION, "", ByteArray(0))
            contenido()
            valor(Tag.FIN_COLECCION, "", ByteArray(0))
        }
    }

    fun aBytes(): ByteArray {
        u8(Tag.FIN)
        return buf.toByteArray()
    }
}
