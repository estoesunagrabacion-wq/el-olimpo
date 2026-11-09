package ar.impresora.xerox

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.RadioButton
import android.widget.Spinner
import android.widget.TextView
import ar.impresora.qpdl.ModoTramado
import ar.impresora.qpdl.OpcionesTrabajo
import ar.impresora.qpdl.Papel
import java.io.File

class MainActivity : Activity() {

    private lateinit var tvArchivo: TextView
    private lateinit var rbWifi: RadioButton
    private lateinit var rbUsb: RadioButton
    private lateinit var etIp: EditText
    private lateinit var spPapel: Spinner
    private lateinit var spModo: Spinner
    private lateinit var spDensidad: Spinner
    private lateinit var etCopias: EditText
    private lateinit var etPaginas: EditText
    private lateinit var cbAhorro: CheckBox
    private lateinit var cbManual: CheckBox
    private lateinit var pbProgreso: ProgressBar
    private lateinit var tvEstado: TextView
    private lateinit var botones: List<Button>

    private var archivo: Uri? = null
    private var tipoArchivo: String? = null
    @Volatile private var trabajando = false

    private val densidades = listOf("Clara" to 1, "Media" to 3, "Oscura" to 5)
    private val ajustes by lazy { getSharedPreferences("ajustes", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvArchivo = findViewById(R.id.tvArchivo)
        rbWifi = findViewById(R.id.rbWifi)
        rbUsb = findViewById(R.id.rbUsb)
        etIp = findViewById(R.id.etIp)
        spPapel = findViewById(R.id.spPapel)
        spModo = findViewById(R.id.spModo)
        spDensidad = findViewById(R.id.spDensidad)
        etCopias = findViewById(R.id.etCopias)
        etPaginas = findViewById(R.id.etPaginas)
        cbAhorro = findViewById(R.id.cbAhorro)
        cbManual = findViewById(R.id.cbManual)
        pbProgreso = findViewById(R.id.pbProgreso)
        tvEstado = findViewById(R.id.tvEstado)

        spPapel.adapter = adaptador(Papel.entries.map { it.etiqueta })
        spModo.adapter = adaptador(ModoTramado.entries.map { it.etiqueta })
        spDensidad.adapter = adaptador(densidades.map { it.first })
        cargarAjustes()

        rbWifi.setOnCheckedChangeListener { _, _ -> actualizarConexion() }
        actualizarConexion()

        val btnElegir = findViewById<Button>(R.id.btnElegir)
        val btnBuscar = findViewById<Button>(R.id.btnBuscar)
        val btnProbar = findViewById<Button>(R.id.btnProbar)
        val btnImprimir = findViewById<Button>(R.id.btnImprimir)
        val btnPrueba = findViewById<Button>(R.id.btnPrueba)
        botones = listOf(btnElegir, btnBuscar, btnProbar, btnImprimir, btnPrueba)

        btnElegir.setOnClickListener { elegirArchivo() }
        btnBuscar.setOnClickListener { buscarEnRed() }
        btnProbar.setOnClickListener { probarConexion() }
        btnImprimir.setOnClickListener { imprimirArchivo() }
        btnPrueba.setOnClickListener { imprimir(DocumentoPrueba(papelElegido()), "Pagina de prueba", "") }

        recibir(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        recibir(intent)
    }

    override fun onPause() {
        super.onPause()
        guardarAjustes()
    }

    // ---------- Archivo ----------

    private fun recibir(intent: Intent?) {
        intent ?: return
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_SEND -> adjunto(intent)
            Intent.ACTION_VIEW -> intent.data
            UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                rbUsb.isChecked = true
                estado("Impresora USB conectada.")
                null
            }
            else -> null
        }
        if (uri != null) usarArchivo(uri, intent.type)
    }

    private fun adjunto(intent: Intent): Uri? =
        if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        }

    private fun elegirArchivo() {
        val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "image/*"))
        }
        startActivityForResult(i, PEDIDO_ARCHIVO)
    }

    @Deprecated("Activity sin AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PEDIDO_ARCHIVO && resultCode == RESULT_OK) data?.data?.let { usarArchivo(it, null) }
    }

    private fun usarArchivo(uri: Uri, tipo: String?) {
        archivo = uri
        tipoArchivo = contentResolver.getType(uri) ?: tipo
        tvArchivo.text = nombreDe(uri)
        estado("Archivo listo. Tocá \"Imprimir\".")
    }

    private fun nombreDe(uri: Uri): String =
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull() ?: uri.lastPathSegment ?: "archivo"

    // ---------- Acciones ----------

    private fun imprimirArchivo() {
        val uri = archivo ?: return estado("Primero elegí un PDF o una imagen.")
        val tipo = tipoArchivo ?: ""
        val nombre = tvArchivo.text.toString()
        val esPdf = tipo == "application/pdf" || nombre.endsWith(".pdf", ignoreCase = true)
        val esImagen = tipo.startsWith("image/")
        if (!esPdf && !esImagen) return estado("Solo se pueden imprimir PDF e imágenes (este archivo es \"$tipo\").")
        val documento = try {
            if (esPdf) DocumentoPdf(this, uri) else DocumentoImagen(this, uri)
        } catch (e: Exception) {
            return estado("No se pudo abrir el archivo: ${e.message}")
        }
        imprimir(documento, nombre, etPaginas.text.toString())
    }

    private fun imprimir(documento: Documento, nombre: String, rango: String) {
        if (trabajando) return
        guardarAjustes()
        val paginas = try {
            Impresion.rangoDePaginas(rango, documento.cantidadDePaginas)
        } catch (e: IllegalArgumentException) {
            documento.close()
            return estado(e.message ?: "Rango de páginas inválido")
        }
        val opciones = OpcionesTrabajo(
            papel = papelElegido(),
            copias = etCopias.text.toString().toIntOrNull()?.coerceIn(1, 99) ?: 1,
            densidad = densidades[spDensidad.selectedItemPosition].second,
            ahorroToner = cbAhorro.isChecked,
            bandejaManual = cbManual.isChecked,
            nombreTrabajo = nombre,
        )
        val modo = ModoTramado.entries[spModo.selectedItemPosition]
        val usarUsb = rbUsb.isChecked
        val ip = etIp.text.toString().trim()
        if (!usarUsb && ip.isEmpty()) {
            documento.close()
            return estado("Escribí la IP de la impresora (o tocá \"Buscar en la red\").")
        }

        enSegundoPlano {
            val temporal = File.createTempFile("trabajo", ".prn", cacheDir)
            try {
                documento.use { doc ->
                    temporal.outputStream().buffered(256 * 1024).use { out ->
                        Impresion(doc, opciones, modo, paginas) { n, total ->
                            progreso(n - 1, total, "Preparando página $n de $total…")
                        }.generar(out)
                    }
                }
                progreso(paginas.size, paginas.size, "Enviando a la impresora (${temporal.length() / 1024} KB)…")
                if (usarUsb) Usb.enviar(this, temporal) else Red.enviar(ip, temporal)
                "Listo: se enviaron ${paginas.size} página(s) a la impresora."
            } finally {
                temporal.delete()
            }
        }
    }

    private fun probarConexion() {
        val usarUsb = rbUsb.isChecked
        val ip = etIp.text.toString().trim()
        enSegundoPlano {
            if (usarUsb) {
                val imp = Usb.buscar(this)
                    ?: return@enSegundoPlano "No veo ninguna impresora USB. Conectá el cable y, si ChromeOS lo pregunta, elegí \"Conectar a Android\"."
                if (Usb.pedirPermiso(this, imp.dispositivo)) "Impresora USB encontrada: ${imp.nombre}"
                else "Encontré ${imp.nombre}, pero no se dio permiso para usarla."
            } else {
                Red.conectar(ip).close()
                "Conexión correcta con $ip (puerto $PUERTO_RAW)."
            }
        }
    }

    private fun buscarEnRed() {
        rbWifi.isChecked = true
        enSegundoPlano {
            progreso(0, 0, "Buscando impresoras en la red (6 segundos)…")
            val encontradas = Red.buscar(this)
            if (encontradas.isEmpty()) {
                "No encontré impresoras automáticamente. Escribí la IP a mano: la podés ver en NokoPrint o " +
                    "imprimiendo el informe de configuración de la impresora."
            } else {
                val (nombre, ip) = encontradas.first()
                runOnUiThread { etIp.setText(ip) }
                "Encontré: " + encontradas.joinToString { "${it.first} (${it.second})" } + ". Usando $ip ($nombre)."
            }
        }
    }

    // ---------- Utilidades de interfaz ----------

    private fun enSegundoPlano(tarea: () -> String) {
        if (trabajando) return
        trabajando = true
        botones.forEach { it.isEnabled = false }
        pbProgreso.visibility = View.VISIBLE
        pbProgreso.isIndeterminate = true
        Thread {
            val mensaje = try {
                tarea()
            } catch (e: Exception) {
                "Error: ${e.message ?: e.javaClass.simpleName}"
            } catch (e: OutOfMemoryError) {
                "Error: no alcanzó la memoria para procesar el archivo."
            }
            runOnUiThread {
                trabajando = false
                botones.forEach { it.isEnabled = true }
                pbProgreso.visibility = View.GONE
                estado(mensaje)
            }
        }.start()
    }

    private fun progreso(hecho: Int, total: Int, mensaje: String) = runOnUiThread {
        pbProgreso.isIndeterminate = total == 0
        if (total > 0) {
            pbProgreso.max = total
            pbProgreso.progress = hecho
        }
        tvEstado.text = mensaje
    }

    private fun estado(mensaje: String) {
        tvEstado.text = mensaje
    }

    private fun actualizarConexion() {
        val wifi = rbWifi.isChecked
        etIp.isEnabled = wifi
        etIp.alpha = if (wifi) 1f else 0.4f
    }

    private fun papelElegido() = Papel.entries[spPapel.selectedItemPosition]

    private fun adaptador(items: List<String>) =
        ArrayAdapter(this, android.R.layout.simple_spinner_item, items).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }

    private fun cargarAjustes() {
        if (ajustes.getBoolean("usb", false)) rbUsb.isChecked = true else rbWifi.isChecked = true
        etIp.setText(ajustes.getString("ip", ""))
        spPapel.setSelection(ajustes.getInt("papel", 0).coerceIn(0, Papel.entries.size - 1))
        spModo.setSelection(ajustes.getInt("modo", 0).coerceIn(0, ModoTramado.entries.size - 1))
        spDensidad.setSelection(ajustes.getInt("densidad", 1).coerceIn(0, densidades.size - 1))
        cbAhorro.isChecked = ajustes.getBoolean("ahorro", false)
        cbManual.isChecked = ajustes.getBoolean("manual", false)
    }

    private fun guardarAjustes() {
        ajustes.edit()
            .putBoolean("usb", rbUsb.isChecked)
            .putString("ip", etIp.text.toString().trim())
            .putInt("papel", spPapel.selectedItemPosition)
            .putInt("modo", spModo.selectedItemPosition)
            .putInt("densidad", spDensidad.selectedItemPosition)
            .putBoolean("ahorro", cbAhorro.isChecked)
            .putBoolean("manual", cbManual.isChecked)
            .apply()
    }

    private companion object {
        const val PEDIDO_ARCHIVO = 1
    }
}
