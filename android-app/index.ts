import { registerRootComponent } from 'expo';
import { registerBackgroundAlarmHandlers } from './src/services/fcmHandler';
import App from './src/App';

// Obligatorio registrar handlers de FCM y Notifee antes de montar React
registerBackgroundAlarmHandlers();

registerRootComponent(App);
