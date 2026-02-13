import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export async function scheduleNativeTestLocalNotification() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Local notification tests run only on native devices.');
  }

  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== 'granted') {
    throw new Error('Local notification permission not granted.');
  }

  const id = Date.now() % 2147483647;
  const at = new Date(Date.now() + 5000);

  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: 'ILA Companion',
        body: 'Local notifications are working.',
        schedule: { at },
      },
    ],
  });

  return { id, at: at.toISOString() };
}
