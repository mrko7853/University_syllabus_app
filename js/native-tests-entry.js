import { Capacitor } from '@capacitor/core';
import { createNativeTestCalendarEvent } from './native/calendar.js';
import { scheduleNativeTestLocalNotification } from './native/notifications.js';
import { registerNativeTestPush } from './native/push.js';

function appendLog(logEl, message) {
  const timestamp = new Date().toLocaleTimeString();
  logEl.textContent += `[${timestamp}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function replaceWithBoundHandler(buttonId, handler) {
  const button = document.getElementById(buttonId);
  if (!button || !button.parentNode) return;

  const clonedButton = button.cloneNode(true);
  button.parentNode.replaceChild(clonedButton, button);
  clonedButton.addEventListener('click', handler);
}

export async function initializeNativeTests() {
  const logEl = document.getElementById('native-tests-log');
  if (!logEl) return;

  const log = (message) => appendLog(logEl, message);

  log(`Platform: ${Capacitor.getPlatform()} | Native: ${Capacitor.isNativePlatform()}`);

  replaceWithBoundHandler('btn-native-calendar', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      log('Requesting calendar access and creating test event...');
      const result = await createNativeTestCalendarEvent();
      log(`Calendar test success. Calendar: ${result.calendarId}, Event: ${result.eventId}`);
    } catch (error) {
      log(`Calendar test failed: ${error?.message || String(error)}`);
    } finally {
      button.disabled = false;
    }
  });

  replaceWithBoundHandler('btn-native-local', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      log('Scheduling local notification for 5 seconds from now...');
      const result = await scheduleNativeTestLocalNotification();
      log(`Local notification scheduled. ID: ${result.id}, Time: ${result.at}`);
    } catch (error) {
      log(`Local notification test failed: ${error?.message || String(error)}`);
    } finally {
      button.disabled = false;
    }
  });

  replaceWithBoundHandler('btn-native-push', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;

    try {
      log('Registering for push notifications...');
      await registerNativeTestPush(log);
      log('Push registration requested. Waiting for token callback...');
    } catch (error) {
      log(`Push test failed: ${error?.message || String(error)}`);
    } finally {
      button.disabled = false;
    }
  });
}

window.initializeNativeTests = initializeNativeTests;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeNativeTests();
  });
} else {
  initializeNativeTests();
}
