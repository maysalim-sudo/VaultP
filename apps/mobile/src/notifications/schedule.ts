/**
 * Handing the plan to Android.
 *
 * `core` decides what is worth an interruption; this only schedules it. Local
 * notifications, so nothing leaves the device and no server is needed — the phone
 * holds the alarms whether or not the app is ever opened again.
 *
 * Permission is requested lazily, the first time there is actually something to
 * schedule. Asking on first launch, before the app has anything to tell you, earns
 * a refusal — and a refusal is sticky.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  loadAllowanceConfig,
  planNotifications,
  todayIn,
  type PlannedNotification,
} from '@vaultp/core';

import type { OpenVault } from '../vault/open.js';

/** Notifications fire at this hour, local time. */
const HOUR_OF_DAY = 9;
const CHANNEL_ID = 'vaultp-reminders';

export interface ScheduleResult {
  readonly planned: number;
  readonly scheduled: number;
  readonly permitted: boolean;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function whenToFire(notification: PlannedNotification): Date {
  const [year, month, day] = notification.date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day, HOUR_OF_DAY, 0, 0, 0);
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  // Do not re-ask once refused: Android stops showing the dialog anyway, and the
  // app should not behave as though the answer might change.
  if (!current.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function syncNotifications(vault: OpenVault): Promise<ScheduleResult> {
  const planned = planNotifications(
    vault.expenses,
    vault.db,
    loadAllowanceConfig(vault.store),
    todayIn(),
    {},
    vault.documents,
    vault.notes,
  );

  if (planned.length === 0) {
    // Clear anything left over from rules that have since been paused or logged.
    await Notifications.cancelAllScheduledNotificationsAsync();
    return { planned: 0, scheduled: 0, permitted: true };
  }

  const permitted = await ensurePermission();
  if (!permitted) return { planned: planned.length, scheduled: 0, permitted: false };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    });
  }

  // Replace wholesale rather than reconcile. The plan is cheap to recompute and
  // small, and diffing it against whatever Android currently holds would be more
  // code and more ways to end up with a stale alarm nobody can explain.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = Date.now();
  let scheduled = 0;

  for (const notification of planned) {
    const fireAt = whenToFire(notification);
    // A slot that has already passed today is dropped: the in-app reminder strip
    // already covers it, and firing on launch is startling rather than useful.
    if (fireAt.getTime() <= now) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: notification.id,
      content: {
        title: notification.title,
        body: notification.body,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
    scheduled += 1;
  }

  return { planned: planned.length, scheduled, permitted: true };
}
