package ar.impresora.xerox

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import java.io.BufferedOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Puerto "RAW" / JetDirect, habilitado de fábrica en la Phaser 3020. */
const val PUERTO_RAW = 9100

object Red {
    fun conectar(ip: String): Socket {
        require(ip.isNotBlank()) { "Escribí la IP de la impresora" }
        val s = Socket()
        try {
            s.connect(InetSocketAddress(ip.trim(), PUERTO_RAW), 6000)
        } catch (e: IOException) {
            s.close()
            throw IOException("No se pudo conectar a $ip:$PUERTO_RAW. ¿Está prendida y en la misma red Wi-Fi? (${e.message})")
        }
        s.soTimeout = 60_000
        return s
    }

    fun enviar(ip: String, archivo: File) {
        conectar(ip).use { s ->
            BufferedOutputStream(s.getOutputStream(), 64 * 1024).use { out ->
                archivo.inputStream().use { it.copyTo(out, 64 * 1024) }
                out.flush()
                s.shutdownOutput()
            }
        }
    }

    /**
     * Busca impresoras que anuncian el servicio RAW (_pdl-datastream._tcp) por
     * Bonjour/mDNS. Devuelve pares (nombre, IP). Puede no encontrar nada si la
     * red o ChromeOS no dejan pasar mDNS; en ese caso hay que escribir la IP.
     */
    fun buscar(contexto: Context, segundos: Long = 6): List<Pair<String, String>> {
        val nsd = contexto.getSystemService(Context.NSD_SERVICE) as NsdManager
        val wifi = contexto.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val candado = wifi.createMulticastLock("buscar-impresora").apply { setReferenceCounted(false); acquire() }
        val vistos = mutableListOf<NsdServiceInfo>()
        val oyente = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(tipo: String) {}
            override fun onDiscoveryStopped(tipo: String) {}
            override fun onStartDiscoveryFailed(tipo: String, error: Int) {}
            override fun onStopDiscoveryFailed(tipo: String, error: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                synchronized(vistos) { vistos.add(info) }
            }
        }
        try {
            nsd.discoverServices("_pdl-datastream._tcp", NsdManager.PROTOCOL_DNS_SD, oyente)
            Thread.sleep(segundos * 1000)
            runCatching { nsd.stopServiceDiscovery(oyente) }
        } finally {
            candado.release()
        }
        val resultado = mutableListOf<Pair<String, String>>()
        for (info in synchronized(vistos) { vistos.toList() }) {
            val listo = CountDownLatch(1)
            @Suppress("DEPRECATION")
            nsd.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(i: NsdServiceInfo, error: Int) = listo.countDown()
                override fun onServiceResolved(i: NsdServiceInfo) {
                    @Suppress("DEPRECATION")
                    val host = i.host
                    if (host is Inet4Address) {
                        synchronized(resultado) { resultado.add(i.serviceName to host.hostAddress!!) }
                    }
                    listo.countDown()
                }
            })
            listo.await(5, TimeUnit.SECONDS)
        }
        return resultado.distinctBy { it.second }
    }
}

object Usb {
    private const val ACCION_PERMISO = "ar.impresora.xerox.PERMISO_USB"
    private const val VENDOR_XEROX = 0x0924

    class Impresora(val dispositivo: UsbDevice, val interfaz: UsbInterface, val salida: UsbEndpoint) {
        val nombre: String
            get() = listOfNotNull(dispositivo.manufacturerName, dispositivo.productName)
                .joinToString(" ").ifBlank { dispositivo.deviceName }
    }

    fun buscar(contexto: Context): Impresora? {
        val usb = contexto.getSystemService(Context.USB_SERVICE) as UsbManager
        val candidatas = mutableListOf<Impresora>()
        for (d in usb.deviceList.values) {
            for (i in 0 until d.interfaceCount) {
                val intf = d.getInterface(i)
                if (intf.interfaceClass != UsbConstants.USB_CLASS_PRINTER) continue
                for (e in 0 until intf.endpointCount) {
                    val ep = intf.getEndpoint(e)
                    if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                        candidatas.add(Impresora(d, intf, ep))
                    }
                }
            }
        }
        return candidatas.firstOrNull { it.dispositivo.vendorId == VENDOR_XEROX } ?: candidatas.firstOrNull()
    }

    /** Pide permiso al usuario (si hace falta) y espera la respuesta. */
    fun pedirPermiso(contexto: Context, dispositivo: UsbDevice): Boolean {
        val usb = contexto.getSystemService(Context.USB_SERVICE) as UsbManager
        if (usb.hasPermission(dispositivo)) return true
        val listo = CountDownLatch(1)
        val receptor = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) = listo.countDown()
        }
        val filtro = IntentFilter(ACCION_PERMISO)
        if (Build.VERSION.SDK_INT >= 33) {
            contexto.registerReceiver(receptor, filtro, Context.RECEIVER_EXPORTED)
        } else {
            contexto.registerReceiver(receptor, filtro)
        }
        try {
            val intent = Intent(ACCION_PERMISO).setPackage(contexto.packageName)
            val pi = PendingIntent.getBroadcast(contexto, 0, intent, PendingIntent.FLAG_MUTABLE)
            usb.requestPermission(dispositivo, pi)
            listo.await(2, TimeUnit.MINUTES)
        } finally {
            contexto.unregisterReceiver(receptor)
        }
        return usb.hasPermission(dispositivo)
    }

    fun enviar(contexto: Context, archivo: File) {
        val imp = buscar(contexto)
            ?: throw IOException("No encuentro la impresora por USB. Conectala y, si ChromeOS pregunta, elegí \"Conectar a Android\".")
        if (!pedirPermiso(contexto, imp.dispositivo)) throw IOException("No se dio permiso para usar la impresora USB")
        val usb = contexto.getSystemService(Context.USB_SERVICE) as UsbManager
        val conexion = usb.openDevice(imp.dispositivo) ?: throw IOException("No se pudo abrir la impresora USB")
        try {
            if (!conexion.claimInterface(imp.interfaz, true)) throw IOException("La impresora USB está ocupada por otro programa")
            SalidaUsb(conexion, imp.salida).use { out -> archivo.inputStream().use { it.copyTo(out, 16 * 1024) } }
            conexion.releaseInterface(imp.interfaz)
        } finally {
            conexion.close()
        }
    }

    private class SalidaUsb(private val conexion: UsbDeviceConnection, private val ep: UsbEndpoint) : OutputStream() {
        override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

        override fun write(b: ByteArray, off: Int, len: Int) {
            var enviado = 0
            var reintentos = 0
            while (enviado < len) {
                val n = conexion.bulkTransfer(ep, b, off + enviado, minOf(16 * 1024, len - enviado), 20_000)
                if (n > 0) {
                    enviado += n
                    reintentos = 0
                } else if (++reintentos > 6) {
                    throw IOException("La impresora dejó de responder por USB")
                }
            }
        }
    }
}
