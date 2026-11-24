import fs from 'fs';
import path from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const googleServicesPath = path.resolve(__dirname, 'google-services.json');
const hasGoogleServicesFile = fs.existsSync(googleServicesPath);

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins: ExpoConfig['plugins'] = ['./plugins/withPanicAlarmNative.js'];

  if (hasGoogleServicesFile) {
    plugins.unshift('@react-native-firebase/app');
  }

  return {
    ...config,
    name: 'Bello Horizonte',
    slug: 'bello-horizonte-alarma',
    scheme: 'pe.bellohorizonte.alarma',
    version: '1.0.0',
    icon: './assets/icon.png',
    splash: {
      image: './assets/images/bello-horizonte-banner.png',
      resizeMode: 'cover',
      backgroundColor: '#0A6EE1',
    },
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    android: {
      package: 'pe.bellohorizonte.alarma',
      versionCode: 4,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0A6EE1',
      },
      ...(hasGoogleServicesFile ? { googleServicesFile: './google-services.json' } : {}),
      permissions: [
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.USE_FULL_SCREEN_INTENT',
        'android.permission.WAKE_LOCK',
        'android.permission.VIBRATE',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
        'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
        'android.permission.ACCESS_NOTIFICATION_POLICY',
        'android.permission.RECORD_AUDIO',
      ],
    },
    plugins,
  };
};
