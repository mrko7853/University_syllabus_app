import { Capacitor } from '@capacitor/core';
import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';

const APP_CALENDAR_NAME = 'ILA Companion';

function unwrapResult(payload) {
  if (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')) {
    return payload.result;
  }
  return payload;
}

function parsePermissionGranted(permissionPayload) {
  const result = unwrapResult(permissionPayload);

  if (result === true || result === 'granted') return true;
  if (!result || typeof result !== 'object') return false;

  if (result.fullCalendar === true || result.fullCalendar === 'granted') return true;
  if (result.writeCalendar === true || result.writeCalendar === 'granted') return true;
  if (result.calendar === true || result.calendar === 'granted') return true;

  return false;
}

async function callFirstAvailable(methodNames, args) {
  for (const methodName of methodNames) {
    const method = CapacitorCalendar?.[methodName];
    if (typeof method === 'function') {
      return method.call(CapacitorCalendar, args);
    }
  }
  throw new Error(`No compatible Calendar API method found (${methodNames.join(', ')})`);
}

async function requestCalendarAccess() {
  const permissionMethods = [
    'requestFullCalendarAccess',
    'requestAllPermissions',
    'requestPermissions',
  ];

  for (const methodName of permissionMethods) {
    const method = CapacitorCalendar?.[methodName];
    if (typeof method !== 'function') continue;

    const response = await method.call(CapacitorCalendar);
    if (parsePermissionGranted(response)) {
      return;
    }
  }

  throw new Error('Calendar permission not granted.');
}

function extractCalendars(listResponse) {
  const unwrapped = unwrapResult(listResponse);

  if (Array.isArray(unwrapped)) return unwrapped;
  if (unwrapped && Array.isArray(unwrapped.calendars)) return unwrapped.calendars;

  return [];
}

function getCalendarTitle(calendar) {
  return String(
    calendar?.title
      || calendar?.name
      || calendar?.calendarName
      || ''
  );
}

function getCalendarId(calendar) {
  return String(
    calendar?.id
      || calendar?.calendarId
      || calendar?.identifier
      || ''
  );
}

function extractCreatedId(response) {
  const unwrapped = unwrapResult(response);

  if (typeof unwrapped === 'string' || typeof unwrapped === 'number') return String(unwrapped);
  if (!unwrapped || typeof unwrapped !== 'object') return '';

  return String(
    unwrapped.id
      || unwrapped.calendarId
      || unwrapped.identifier
      || unwrapped.eventId
      || ''
  );
}

export async function ensureIlaCalendar() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Calendar tests run only on native devices.');
  }

  await requestCalendarAccess();

  const calendarsResponse = await callFirstAvailable(['listCalendars', 'getCalendars']);
  const calendars = extractCalendars(calendarsResponse);

  const existing = calendars.find((calendar) => getCalendarTitle(calendar) === APP_CALENDAR_NAME);
  if (existing) {
    const existingId = getCalendarId(existing);
    if (existingId) return existingId;
  }

  const createdResponse = await callFirstAvailable(['createCalendar'], {
    title: APP_CALENDAR_NAME,
    color: '#2A6DF4',
  });

  const createdId = extractCreatedId(createdResponse);
  if (!createdId) {
    throw new Error('Calendar created but no calendar id was returned.');
  }

  return createdId;
}

export async function createNativeTestCalendarEvent() {
  const calendarId = await ensureIlaCalendar();

  const startDate = Date.now() + (2 * 60 * 1000);
  const endDate = startDate + (30 * 60 * 1000);

  const createResponse = await callFirstAvailable(['createEvent'], {
    calendarId,
    title: 'ILA Companion Native Calendar Test',
    notes: 'Created by /native-tests in Capacitor.',
    location: 'iOS Device',
    startDate,
    endDate,
  });

  const eventId = extractCreatedId(createResponse) || '(plugin did not return an event id)';

  return {
    calendarId,
    eventId,
    startDate,
    endDate,
  };
}
