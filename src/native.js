// Native iOS/Android touches via Capacitor. Every function is a safe no-op
// (or a web fallback) when running in a normal browser.
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { LocalNotifications } from "@capacitor/local-notifications";

export const isNative = Capacitor.isNativePlatform();

// Links shared from the app must point at the public site, not capacitor://localhost.
export const PUBLIC_URL = "https://alessiocarta.github.io/innerclock/";

export function haptic(kind) {
  if (!isNative) return;
  if (kind === "success") Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  else Haptics.impact({ style: kind === "release" ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
}

/** Native share sheet for text. Returns false on the web so callers can fall back. */
export async function shareText(text) {
  if (!isNative) return false;
  try {
    await Share.share({ text });
  } catch {
    /* user dismissed the sheet */
  }
  return true;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/** Native share sheet for an image (Instagram/TikTok stories, Photos…). */
export async function shareImage(blob, name) {
  if (!isNative) return false;
  const { uri } = await Filesystem.writeFile({
    path: name,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ files: [uri] });
  } catch {
    /* dismissed */
  }
  return true;
}

const REMINDER_DAYS = 7;
const REMINDER_HOUR = 19;

/**
 * After finishing today's game: remind at 19:00 on each of the next 7 days.
 * Notification ids are day numbers, so a played day can be cancelled.
 */
export async function scheduleReminders(today) {
  if (!isNative) return;
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return;
    await cancelReminder(today);
    const notifications = [];
    for (let i = 1; i <= REMINDER_DAYS; i++) {
      const at = new Date();
      at.setDate(at.getDate() + i);
      at.setHours(REMINDER_HOUR, 0, 0, 0);
      notifications.push({
        id: today + i,
        title: "InnerClock ⏱️",
        body: i === 1 ? "Today’s clock is live. Keep your 🔥 streak going!" : "A new clock is waiting. How sharp are you today?",
        schedule: { at, allowWhileIdle: true },
      });
    }
    await LocalNotifications.schedule({ notifications });
  } catch (e) {
    console.warn("Reminders unavailable", e);
  }
}

/** Already played today: don't nag at 19:00. */
export async function cancelReminder(day) {
  if (!isNative) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: day }] });
  } catch {
    /* nothing scheduled */
  }
}
