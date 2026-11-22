import React, { useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HomeScreen } from './screens/HomeScreen';
import { PanicAlertScreen } from './screens/PanicAlertScreen';
import {
  ensureNotificationChannels,
  getActiveAlarmState,
  rehydrateActiveAlarmState,
  subscribeAlarmState,
} from './services/alarmController';
import {
  subscribeForegroundFcmMessages,
  subscribeForegroundNotifeeEvents,
} from './services/fcmHandler';
import type { ActiveAlarmState } from './types/alarm';

export default function App(): React.JSX.Element {
  const [alarmState, setAlarmState] = useState<ActiveAlarmState>(() => getActiveAlarmState());

  useEffect(() => {
    ensureNotificationChannels().catch((err) => {
      console.warn('[App] Error creando canales Notifee:', err);
    });

    const unsubscribeState = subscribeAlarmState(setAlarmState);
    const unsubscribeFcm = subscribeForegroundFcmMessages();
    const unsubscribeNotifee = subscribeForegroundNotifeeEvents();

    // Rehidratar estado si la app se abrió en frío desde Full-Screen Intent o alarma activa
    rehydrateActiveAlarmState().catch((err) => {
      console.warn('[App] Error rehidratando estado de alarma:', err);
    });

    return () => {
      unsubscribeState();
      unsubscribeFcm();
      unsubscribeNotifee();
    };
  }, []);

  const isPanicActive = alarmState.alert !== null;

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isPanicActive ? 'light-content' : 'dark-content'}
        backgroundColor={isPanicActive ? '#B91C1C' : '#F3F4F6'}
      />
      {isPanicActive ? <PanicAlertScreen alarmState={alarmState} /> : <HomeScreen />}
    </SafeAreaProvider>
  );
}
