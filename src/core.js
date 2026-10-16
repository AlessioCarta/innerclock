// Pure game logic — no DOM, no network. Shared by the app and the tests.
// IMPORTANT: targetsFor / roundScore are mirrored in supabase/migrations
// (ic_targets / ic_round_score). Change both together.

export const ROUNDS = 5;
export const EPOCH = Date.UTC(2026, 9, 16); // Day #1 = 2026-10-16

// Target bands per round, in tenths of a second: short → long.
export const BANDS = [
  [10, 30],
  [25, 50],
  [40, 70],
  [60, 100],
  [80, 150],
];

/** Day number since launch, based on the player's local calendar date. */
export function dayNumber(date = new Date()) {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - EPOCH) / 86_400_000) + 1;
}

/** Milliseconds until the player's next local midnight. */
export function msUntilTomorrow(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return next - date;
}

async function sha256Uint32(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new DataView(buf).getUint32(0, false);
}

/**
 * Targets in seconds (one decimal), identical for everyone on a given day.
 * Integer math only so Postgres reproduces it exactly.
 */
export async function targetsFor(day) {
  return Promise.all(
    BANDS.map(async ([lo, hi], i) => {
      const n = await sha256Uint32(`innerclock:${day}:${i}`);
      const tenths = lo + Math.floor((n * (hi - lo + 1)) / 4294967296);
      return tenths / 10;
    }),
  );
}

/** Holds are recorded at millisecond precision. */
export const roundMs = (seconds) => Math.round(seconds * 1000) / 1000;

/** Relative error, always >= 0. */
export function errorPct(target, actual) {
  return Math.abs(actual - target) / target;
}

export const TIERS = [
  { max: 0.02, emoji: "🟪", label: "Atomic", color: "#a855f7" },
  { max: 0.05, emoji: "🟩", label: "Sharp", color: "#22c55e" },
  { max: 0.1, emoji: "🟨", label: "Close", color: "#eab308" },
  { max: 0.2, emoji: "🟧", label: "Drifting", color: "#f97316" },
  { max: Infinity, emoji: "🟥", label: "Lost in time", color: "#ef4444" },
];

export function tierFor(err) {
  return TIERS.find((t) => err <= t.max);
}

/**
 * 0–100 points per round; perfect = 100, 25%+ off = 0.
 * round(100 - 400·|a−t|/t) in integer milliseconds, so SQL matches exactly.
 */
export function roundScore(target, actual) {
  const t = Math.round(target * 1000);
  const d = Math.abs(Math.round(actual * 1000) - t);
  return Math.max(0, Math.floor((201 * t - 800 * d) / (2 * t)));
}

export function totalScore(targets, actuals) {
  return targets.reduce((s, t, i) => s + roundScore(t, actuals[i]), 0);
}

export function title(total, rounds = ROUNDS) {
  const p = total / (rounds * 100);
  if (p >= 0.95) return "Human Atomic Clock";
  if (p >= 0.85) return "Metronome";
  if (p >= 0.7) return "Swiss Watch";
  if (p >= 0.5) return "Sundial";
  if (p >= 0.3) return "Cracked Hourglass";
  return "Accidental Time Traveller";
}

export function emojiGrid(targets, actuals) {
  return targets.map((t, i) => tierFor(errorPct(t, actuals[i])).emoji).join("");
}

export function shareText({ day, targets, actuals, url }) {
  const total = totalScore(targets, actuals);
  const lines = targets.map((t, i) => {
    const d = actuals[i] - t;
    const e = tierFor(errorPct(t, actuals[i])).emoji;
    return `${e} ${t.toFixed(1)}s → ${actuals[i].toFixed(2)}s (${d >= 0 ? "+" : ""}${d.toFixed(2)})`;
  });
  return [
    `⏱️ InnerClock #${day} — ${total}/${targets.length * 100}`,
    `${emojiGrid(targets, actuals)}  ${title(total, targets.length)}`,
    "",
    ...lines,
    "",
    `Can you beat me? ${url}`,
  ].join("\n");
}

/** Local streak/stat record, used in guest mode (server keeps its own). */
export function updateStats(stats, day, total) {
  const s = { played: 0, best: 0, streak: 0, maxStreak: 0, lastDay: null, sum: 0, ...stats };
  if (s.lastDay === day) return s;
  s.streak = s.lastDay === day - 1 ? s.streak + 1 : 1;
  s.maxStreak = Math.max(s.maxStreak, s.streak);
  s.played += 1;
  s.sum += total;
  s.best = Math.max(s.best, total);
  s.lastDay = day;
  return s;
}

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
