import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

let listenersInitialized = false;

function initPushListeners(onLog) {
  if (listenersInitialized) return;

  PushNotifications.addListener('registration', (token) => {
    onLog(`Push token: ${token.value}`);
  });

  PushNotifications.addListener('registrationError', (error) => {
    onLog(`Push registration error: ${JSON.stringify(error)}`);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    onLog(`Push received: ${JSON.stringify(notification)}`);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    onLog(`Push action: ${JSON.stringify(action)}`);
  });

  listenersInitialized = true;
}

export async function registerNativeTestPush(onLog = console.log) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Push registration tests run only on native devices.');
  }

  let permissions = await PushNotifications.checkPermissions();
  if (permissions.receive !== 'granted') {
    permissions = await PushNotifications.requestPermissions();
  }

  if (permissions.receive !== 'granted') {
    throw new Error('Push notification permission not granted.');
  }

  initPushListeners(onLog);
  await PushNotifications.register();
}
