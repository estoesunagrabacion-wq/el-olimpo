package ar.impresora.xerox

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import ar.impresora.qpdl.Papel
import java.io.Closeable
import java.io.IOException

/** Algo que se puede imprimir: un PDF, una imagen o la página de prueba. */
interface Documento : Closeable {
    val cantidadDePaginas: Int

    /** Si es true, el contenido se achica para no perder nada en los márgenes. */
    val respetarMargenes: Boolean

    fun abrirPagina(indice: Int): Pagina
}

interface Pagina : Closeable {
    /** Tamaño del contenido (en puntos para PDF, en píxeles para imágenes). */
    val ancho: Float
    val alto: Float

    /**
     * Dibuja la página en [destino] aplicando [transformacion], que lleva las
     * coordenadas de la página a píxeles del Bitmap.
     */
    fun dibujar(destino: Bitmap, transformacion: Matrix)
}

class DocumentoPdf(contexto: Context, uri: Uri) : Documento {
    private val descriptor: ParcelFileDescriptor =
        contexto.contentResolver.openFileDescriptor(uri, "r")
            ?: throw IOException("No se pudo abrir el archivo")
    private val renderer = try {
        PdfRenderer(descriptor)
    } catch (e: SecurityException) {
        descriptor.close()
        throw IOException("El PDF está protegido con contraseña")
    }

    override val cantidadDePaginas: Int get() = renderer.pageCount
    override val respetarMargenes = false

    override fun abrirPagina(indice: Int): Pagina {
        val p = renderer.openPage(indice)
        return object : Pagina {
            override val ancho = p.width.toFloat()
            override val alto = p.height.toFloat()
            override fun dibujar(destino: Bitmap, transformacion: Matrix) =
                p.render(destino, null, transformacion, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)

            override fun close() = p.close()
        }
    }

    override fun close() {
        renderer.close()
        descriptor.close()
    }
}

class DocumentoImagen(contexto: Context, uri: Uri) : Documento {
    private val imagen: Bitmap = ImageDecoder.decodeBitmap(
        ImageDecoder.createSource(contexto.contentResolver, uri)
    ) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val lado = maxOf(info.size.width, info.size.height)
        if (lado > MAX_LADO) decoder.setTargetSampleSize((lado + MAX_LADO - 1) / MAX_LADO)
    }

    override val cantidadDePaginas = 1
    override val respetarMargenes = true

    override fun abrirPagina(indice: Int): Pagina = object : Pagina {
        override val ancho = imagen.width.toFloat()
        override val alto = imagen.height.toFloat()
        private val pincel = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        override fun dibujar(destino: Bitmap, transformacion: Matrix) {
            Canvas(destino).drawBitmap(imagen, transformacion, pincel)
        }

        override fun close() {}
    }

    override fun close() = imagen.recycle()

    private companion object {
        const val MAX_LADO = 5000
    }
}

/** Página de prueba con marco, texto, líneas finas y escala de grises. */
class DocumentoPrueba(private val papel: Papel) : Documento {
    override val cantidadDePaginas = 1
    override val respetarMargenes = false

    override fun abrirPagina(indice: Int): Pagina = object : Pagina {
        override val ancho = papel.anchoPt.toFloat()
        override val alto = papel.altoPt.toFloat()

        override fun dibujar(destino: Bitmap, transformacion: Matrix) {
            val c = Canvas(destino)
            c.concat(transformacion)
            val trazo = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = 1.5f
                color = Color.BLACK
            }
            val texto = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }
            val m = 28.35f // 1 cm
            c.drawRect(m, m, ancho - m, alto - m, trazo)

            texto.textSize = 28f
            texto.isFakeBoldText = true
            c.drawText("Página de prueba", 2 * m, 3 * m, texto)
            texto.isFakeBoldText = false
            texto.textSize = 13f
            var y = 4.2f * m
            for (linea in listOf(
                "Xerox Phaser 3020 — impresión sin publicidad desde la Chromebook.",
                "Si leés esto, la app y la impresora se entienden. ¡Listo!",
                "Papel: ${papel.etiqueta}. El marco está a 1 cm del borde.",
                "Texto chico (8 pt) abajo, para ver la nitidez:",
            )) {
                c.drawText(linea, 2 * m, y, texto)
                y += 20f
            }
            texto.textSize = 8f
            c.drawText("abcdefghijklmnñopqrstuvwxyz ABCDEFGHIJKLMNÑOPQRSTUVWXYZ 0123456789 áéíóú ¿?¡!", 2 * m, y, texto)
            y += 30f

            // Escala de grises en 11 pasos.
            val relleno = Paint().apply { style = Paint.Style.FILL }
            val anchoPaso = (ancho - 4 * m) / 11
            for (i in 0..10) {
                val g = 255 - i * 255 / 10
                relleno.color = Color.rgb(g, g, g)
                c.drawRect(2 * m + i * anchoPaso, y, 2 * m + (i + 1) * anchoPaso, y + 2 * m, relleno)
            }
            c.drawRect(2 * m, y, 2 * m + 11 * anchoPaso, y + 2 * m, trazo)
            y += 3 * m

            // Líneas cada vez más finas.
            for (i in 0 until 6) {
                trazo.strokeWidth = 2f / (1 shl i)
                c.drawLine(2 * m, y, ancho - 2 * m, y, trazo)
                y += 10f
            }
            trazo.strokeWidth = 1.5f
            y += 10f

            // Círculo y diagonales, para ver que no hay deformación.
            val lado = minOf(ancho - 4 * m, alto - y - 2 * m)
            c.drawCircle(ancho / 2, y + lado / 2, lado / 2, trazo)
            c.drawLine(ancho / 2 - lado / 2, y, ancho / 2 + lado / 2, y + lado, trazo)
            c.drawLine(ancho / 2 + lado / 2, y, ancho / 2 - lado / 2, y + lado, trazo)
        }

        override fun close() {}
    }

    override fun close() {}
}
