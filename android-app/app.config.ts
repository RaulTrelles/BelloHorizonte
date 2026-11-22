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
    name: 'Bello Horizonte Alarma',
    slug: 'bello-horizonte-alarma',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    newArchEnabled: false,
    android: {
      package: 'pe.bellohorizonte.alarma',
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
      ],
    },
    plugins,
  };
};
