package pe.bellohorizonte.alarma.alarm

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Módulo nativo de alarma crítica para Asociación Bello Horizonte.
 *
 * Garantiza reproducción por AudioManager.STREAM_ALARM (USAGE_ALARM + CONTENT_TYPE_SONIFICATION),
 * elevando el volumen al máximo (o >= 85%), manteniendo PARTIAL_WAKE_LOCK (máx. 90s),
 * deduplicando por alertId y restaurando siempre el volumen original al detener o destruir.
 */
class PanicAlarmModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "PanicAlarmModule"
        private const val MAX_SAFETY_TIMEOUT_MS = 90_000L
        private const val MIN_ALARM_VOLUME_PERCENT = 85
        private const val DEFAULT_ALARM_VOLUME_PERCENT = 100
        private const val WAKE_LOCK_TAG = "pe.bellohorizonte.alarma:PanicAlarmWakeLock"
    }

    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var mediaPlayer: MediaPlayer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var previousAlarmVolume: Int? = null
    private var activeAlertId: String? = null
    private var isPlaying: Boolean = false
    private var autoStopRunnable: Runnable? = null

    override fun getName(): String = "PanicAlarmModule"

    @ReactMethod
    fun startAlarm(
        alertId: String,
        volumePercent: Int,
        maxDurationMs: Double,
        promise: Promise
    ) {
        synchronized(lock) {
            try {
                // Deduplicación estricta: nunca superponer dos audios para el mismo alertId
                if (isPlaying && activeAlertId == alertId) {
                    Log.i(TAG, "Alarma ya activa para alertId=$alertId; ignorando duplicado.")
                    promise.resolve(false)
                    return
                }

                // Si había otra alarma activa con otro alertId, detener audio previo preservando volumen guardado
                if (isPlaying) {
                    stopPlaybackOnlyLocked()
                }

                val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                if (previousAlarmVolume == null) {
                    previousAlarmVolume = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
                }

                val effectivePercent = min(100, max(MIN_ALARM_VOLUME_PERCENT, if (volumePercent <= 0) DEFAULT_ALARM_VOLUME_PERCENT else volumePercent))
                val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
                val targetVolume = max(1, ceil(maxVolume * (effectivePercent / 100.0)).toInt())

                try {
                    audioManager.setStreamVolume(AudioManager.STREAM_ALARM, targetVolume, 0)
                } catch (secEx: SecurityException) {
                    Log.w(TAG, "No se pudo modificar STREAM_ALARM por restricción DND: ${secEx.message}")
                }

                val effectiveTimeoutMs = when {
                    maxDurationMs <= 0.0 -> MAX_SAFETY_TIMEOUT_MS
                    maxDurationMs.toLong() > MAX_SAFETY_TIMEOUT_MS -> MAX_SAFETY_TIMEOUT_MS
                    else -> maxDurationMs.toLong()
                }

                acquireWakeLockLocked(effectiveTimeoutMs)
                startMediaPlayerLocked()
                try {
                    startVibrationLocked()
                } catch (vibEx: Exception) {
                    Log.w(TAG, "No se pudo iniciar vibración de alarma: ${vibEx.message}")
                }

                activeAlertId = alertId
                isPlaying = true

                scheduleAutoStopLocked(effectiveTimeoutMs)

                Log.i(TAG, "Alarma iniciada para alertId=$alertId (vol=$targetVolume/$maxVolume, timeout=${effectiveTimeoutMs}ms)")
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error iniciando alarma crítica: ${e.message}", e)
                stopAlarmInternalLocked()
                promise.reject("PANIC_ALARM_START_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopAlarm(promise: Promise) {
        synchronized(lock) {
            try {
                stopAlarmInternalLocked()
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error deteniendo alarma crítica: ${e.message}", e)
                promise.reject("PANIC_ALARM_STOP_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun isAlarmPlaying(promise: Promise) {
        synchronized(lock) {
            promise.resolve(isPlaying)
        }
    }

    @ReactMethod
    fun getActiveAlertId(promise: Promise) {
        synchronized(lock) {
            promise.resolve(activeAlertId)
        }
    }

    @ReactMethod
    fun isBatteryOptimizationIgnored(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
                promise.resolve(powerManager.isIgnoringBatteryOptimizations(reactContext.packageName))
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("BATTERY_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openBatteryOptimizationSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                if (intent.resolveActivity(reactContext.packageManager) != null) {
                    reactContext.startActivity(intent)
                } else {
                    val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactContext.startActivity(fallback)
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BATTERY_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun hasDndAccess(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val notificationManager =
                    reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                promise.resolve(notificationManager.isNotificationPolicyAccessGranted)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("DND_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openDndSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DND_SETTINGS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun canUseFullScreenIntent(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val notificationManager =
                    reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                promise.resolve(notificationManager.canUseFullScreenIntent())
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("FSI_CHECK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun openFullScreenIntentSettings(promise: Promise) {
        try {
            val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            } else {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(fallback)
                promise.resolve(true)
            } catch (fallbackEx: Exception) {
                promise.reject("FSI_SETTINGS_ERROR", fallbackEx.message, fallbackEx)
            }
        }
    }

    override fun invalidate() {
        synchronized(lock) {
            stopAlarmInternalLocked()
        }
        super.invalidate()
    }

    private fun startMediaPlayerLocked() {
        val resId = reactContext.resources.getIdentifier(
            "panic_siren",
            "raw",
            reactContext.packageName
        )
        if (resId == 0) {
            throw IllegalStateException("Recurso R.raw.panic_siren no encontrado en la compilación.")
        }

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val player = MediaPlayer()
        val afd = reactContext.resources.openRawResourceFd(resId)
        try {
            player.setAudioAttributes(audioAttributes)
            player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            player.isLooping = true
            player.setVolume(1.0f, 1.0f)
            player.prepare()
            player.start()
            mediaPlayer = player
        } catch (e: Exception) {
            try {
                player.release()
            } catch (_: Exception) {
                // Ignorar error secundario al liberar MediaPlayer fallido
            }
            throw e
        } finally {
            afd.close()
        }
    }

    private fun startVibrationLocked() {
        val vibrator = getVibrator() ?: return
        val pattern = longArrayOf(0, 800, 300, 800, 300)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val effect = VibrationEffect.createWaveform(pattern, 0)
            val attrs = VibrationAttributes.Builder()
                .setUsage(VibrationAttributes.USAGE_ALARM)
                .build()
            vibrator.vibrate(effect, attrs)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val effect = VibrationEffect.createWaveform(pattern, 0)
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            @Suppress("DEPRECATION")
            vibrator.vibrate(effect, attrs)
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, 0)
        }
    }

    private fun stopVibrationLocked() {
        try {
            getVibrator()?.cancel()
        } catch (e: Exception) {
            Log.w(TAG, "Error cancelando vibración: ${e.message}")
        }
    }

    private fun getVibrator(): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager =
                reactContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            reactContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }

    private fun acquireWakeLockLocked(timeoutMs: Long) {
        releaseWakeLockLocked()
        val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
        wl.setReferenceCounted(false)
        wl.acquire(timeoutMs)
        wakeLock = wl
    }

    private fun releaseWakeLockLocked() {
        try {
            wakeLock?.let {
                if (it.isHeld) {
                    it.release()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error liberando WakeLock: ${e.message}")
        } finally {
            wakeLock = null
        }
    }

    private fun scheduleAutoStopLocked(timeoutMs: Long) {
        cancelAutoStopLocked()
        val runnable = Runnable {
            synchronized(lock) {
                Log.w(TAG, "Timeout de seguridad alcanzado (${timeoutMs}ms); deteniendo alarma y restaurando volumen.")
                stopAlarmInternalLocked()
            }
        }
        autoStopRunnable = runnable
        mainHandler.postDelayed(runnable, timeoutMs)
    }

    private fun cancelAutoStopLocked() {
        autoStopRunnable?.let { mainHandler.removeCallbacks(it) }
        autoStopRunnable = null
    }

    private fun stopPlaybackOnlyLocked() {
        cancelAutoStopLocked()
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.stop()
                }
                it.reset()
                it.release()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error liberando MediaPlayer: ${e.message}")
        } finally {
            mediaPlayer = null
        }
        stopVibrationLocked()
        releaseWakeLockLocked()
    }

    private fun stopAlarmInternalLocked() {
        stopPlaybackOnlyLocked()

        previousAlarmVolume?.let { originalVolume ->
            try {
                val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                audioManager.setStreamVolume(AudioManager.STREAM_ALARM, originalVolume, 0)
                Log.i(TAG, "Volumen STREAM_ALARM restaurado a $originalVolume")
            } catch (e: Exception) {
                Log.w(TAG, "Error restaurando volumen STREAM_ALARM: ${e.message}")
            } finally {
                previousAlarmVolume = null
            }
        }

        activeAlertId = null
        isPlaying = false
    }
}
