const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require('expo/config-plugins');

const ALARM_PACKAGE_IMPORT = 'import pe.bellohorizonte.alarma.alarm.PanicAlarmPackage';
const ALARM_PACKAGE_ADD = 'add(PanicAlarmPackage())';

/**
 * 1. Copia PanicAlarmModule.kt, PanicAlarmPackage.kt y panic_siren.wav al proyecto Android generado por prebuild.
 */
function withCopyNativeAlarmFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const androidRoot = modConfig.modRequest.platformProjectRoot;

      // Copiar archivos Kotlin al paquete pe.bellohorizonte.alarma.alarm
      const srcKotlinDir = path.join(projectRoot, 'native', 'android');
      const destKotlinDir = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        'pe',
        'bellohorizonte',
        'alarma',
        'alarm'
      );
      fs.mkdirSync(destKotlinDir, { recursive: true });

      for (const fileName of ['PanicAlarmModule.kt', 'PanicAlarmPackage.kt']) {
        const srcFile = path.join(srcKotlinDir, fileName);
        const destFile = path.join(destKotlinDir, fileName);
        if (!fs.existsSync(srcFile)) {
          throw new Error(`[withPanicAlarmNative] No se encontró ${srcFile}`);
        }
        fs.copyFileSync(srcFile, destFile);
      }

      // Copiar sirena local a res/raw/panic_siren.wav
      const srcSiren = path.join(projectRoot, 'assets', 'sounds', 'panic_siren.wav');
      const destRawDir = path.join(androidRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(destRawDir, { recursive: true });
      if (!fs.existsSync(srcSiren)) {
        throw new Error(
          `[withPanicAlarmNative] No se encontró ${srcSiren}. Ejecuta "npm run generate-siren".`
        );
      }
      fs.copyFileSync(srcSiren, path.join(destRawDir, 'panic_siren.wav'));

      return modConfig;
    },
  ]);
}

/**
 * 2. Registra PanicAlarmPackage en MainApplication.kt
 */
function withRegisterPanicAlarmPackage(config) {
  return withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    if (!contents.includes(ALARM_PACKAGE_IMPORT)) {
      contents = contents.replace(
        /^(package\s+[^\n]+\n)/m,
        `$1${ALARM_PACKAGE_IMPORT}\n`
      );
    }

    if (!contents.includes(ALARM_PACKAGE_ADD)) {
      if (contents.includes('PackageList(this).packages.apply {')) {
        contents = contents.replace(
          'PackageList(this).packages.apply {',
          `PackageList(this).packages.apply {\n              ${ALARM_PACKAGE_ADD}`
        );
      } else if (contents.includes('PackageList(this).packages')) {
        contents = contents.replace(
          'PackageList(this).packages',
          `PackageList(this).packages.apply { ${ALARM_PACKAGE_ADD} }`
        );
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

/**
 * 3. Configura MainActivity.kt para mostrarse sobre pantalla bloqueada y encender pantalla.
 */
function withLockScreenMainActivity(config) {
  return withMainActivity(config, (modConfig) => {
    let contents = modConfig.modResults.contents;

    const requiredImports = [
      'import android.os.Build',
      'import android.view.WindowManager',
    ];

    for (const imp of requiredImports) {
      if (!contents.includes(imp)) {
        contents = contents.replace(/^(package\s+[^\n]+\n)/m, `$1${imp}\n`);
      }
    }

    const helperMarker = 'enableLockScreenAlarmDisplay()';
    if (!contents.includes(helperMarker)) {
      // Invocar desde onCreate
      if (contents.includes('super.onCreate(null)')) {
        contents = contents.replace(
          'super.onCreate(null)',
          `super.onCreate(null)\n    ${helperMarker}`
        );
      } else if (contents.includes('super.onCreate(savedInstanceState)')) {
        contents = contents.replace(
          'super.onCreate(savedInstanceState)',
          `super.onCreate(savedInstanceState)\n    ${helperMarker}`
        );
      }

      const helperMethod = `
  private fun enableLockScreenAlarmDisplay() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      )
    }
  }
`;
      const lastBraceIndex = contents.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        contents =
          contents.slice(0, lastBraceIndex) +
          helperMethod +
          contents.slice(lastBraceIndex);
      }
    }

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

/**
 * 4. Configura android:showWhenLocked y android:turnScreenOn en MainActivity,
 *    y declara app.notifee.core.ForegroundService con foregroundServiceType="mediaPlayback"
 *    para compatibilidad estricta con Android 14/15 (targetSdk >= 34).
 */
function withAlarmManifestAttributes(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    if (manifest.manifest && manifest.manifest.$ && !manifest.manifest.$['xmlns:tools']) {
      manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const application = manifest.manifest.application?.[0];
    if (!application) {
      return modConfig;
    }

    const activities = application.activity || [];
    const mainActivity = activities.find(
      (activity) =>
        activity.$?.['android:name'] === '.MainActivity' ||
        activity.$?.['android:name']?.endsWith('.MainActivity')
    );

    if (mainActivity && mainActivity.$) {
      mainActivity.$['android:showWhenLocked'] = 'true';
      mainActivity.$['android:turnScreenOn'] = 'true';
    }

    if (!Array.isArray(application.service)) {
      application.service = [];
    }

    const notifeeServiceName = 'app.notifee.core.ForegroundService';
    const existingService = application.service.find(
      (service) => service.$?.['android:name'] === notifeeServiceName
    );

    if (existingService && existingService.$) {
      existingService.$['android:foregroundServiceType'] = 'mediaPlayback';
      existingService.$['android:exported'] = 'false';
      existingService.$['tools:replace'] = 'android:foregroundServiceType';
    } else {
      application.service.push({
        $: {
          'android:name': notifeeServiceName,
          'android:foregroundServiceType': 'mediaPlayback',
          'android:exported': 'false',
          'tools:replace': 'android:foregroundServiceType',
        },
      });
    }

    return modConfig;
  });
}

/**
 * 5. Configura signingConfigs.release leyendo android-app/keystore/key.properties
 *    cuando existe (para builds firmados de Google Play sin hardcodear claves en Git).
 */
function withReleaseSigningConfig(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (contents.includes('keystorePropertiesFile')) {
      return modConfig;
    }

    const loaderSnippet = `
def keystorePropertiesFile = rootProject.file("../keystore/key.properties")
def keystoreProperties = new Properties()
def hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
`;

    contents = contents.replace(
      'android {',
      `${loaderSnippet}\nandroid {`
    );

    contents = contents.replace(
      /signingConfigs\s*\{\s*debug\s*\{/,
      `signingConfigs {
        release {
            if (hasReleaseKeystore) {
                storeFile rootProject.file("../keystore/" + keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
        debug {`
    );

    contents = contents.replace(
      /release\s*\{([\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      'release {$1signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug'
    );

    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

module.exports = function withPanicAlarmNative(config) {
  let updated = config;
  updated = withCopyNativeAlarmFiles(updated);
  updated = withRegisterPanicAlarmPackage(updated);
  updated = withLockScreenMainActivity(updated);
  updated = withAlarmManifestAttributes(updated);
  updated = withReleaseSigningConfig(updated);
  return updated;
};
