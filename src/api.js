// Thin wrapper over Supabase. When env vars are missing the app runs in
// guest mode (solo play + share), and every function here is unused.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const sb = url && key ? createClient(url, key) : null;

function check({ data, error }) {
  if (error) throw error;
  return data;
}

const turnstileKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

/**
 * Cloudflare Turnstile token for Supabase's CAPTCHA protection, or undefined
 * when no site key is configured. Invisible unless Cloudflare wants a click.
 */
export function captchaToken() {
  if (!turnstileKey) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onerror = () => reject(new Error("CAPTCHA unavailable"));
    script.onload = () => {
      const box = document.createElement("div");
      box.className = "captcha";
      document.body.append(box);
      const done = (fn) => (arg) => {
        box.remove();
        fn(arg);
      };
      window.turnstile.render(box, {
        sitekey: turnstileKey,
        appearance: "interaction-only",
        callback: done(resolve),
        "error-callback": done(() => reject(new Error("CAPTCHA failed"))),
      });
    };
    document.head.append(script);
  });
}

/** Signed-in user, creating an anonymous one on first visit. */
export async function ensureUser() {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session.user;
  const token = await captchaToken();
  return check(await sb.auth.signInAnonymously({ options: { captchaToken: token } })).user;
}

export async function getProfile(id) {
  return check(await sb.from("profiles").select("id, username").eq("id", id).maybeSingle());
}

/** Returns the profile, or throws an Error with code "taken". */
export async function createProfile(id, username) {
  const res = await sb.from("profiles").insert({ id, username }).select("id, username").single();
  if (res.error?.code === "23505") throw Object.assign(new Error("Username taken"), { code: "taken" });
  return check(res);
}

export async function getResult(userId, day) {
  return check(
    await sb.from("results").select("id, actuals, score").eq("user_id", userId).eq("day", day).maybeSingle(),
  );
}

/** Server computes the score; returns the stored row. */
export async function submitResult(userId, day, actuals) {
  const res = await sb.from("results").insert({ day, actuals }).select("id, actuals, score").single();
  // Already submitted (another tab/device) — use the existing row instead.
  if (res.error?.code === "23505") return getResult(userId, day);
  return check(res);
}

export async function leaderboard(day, friends = false) {
  return check(await sb.rpc("leaderboard", { p_day: day, p_friends: friends, p_limit: 50 }));
}

export async function myRank(day) {
  return check(await sb.rpc("my_rank", { p_day: day }))?.[0] ?? null;
}

export async function playersToday(day) {
  return check(await sb.rpc("players_today", { p_day: day }));
}

export async function profileStats(username) {
  return check(await sb.rpc("profile_stats", { p_username: username }))?.[0] ?? null;
}

/** A specific player's result for a day (visible to you only after you've played). */
export async function resultOf(username, day) {
  const p = check(await sb.from("profiles").select("id").eq("username", username).maybeSingle());
  if (!p) return null;
  return check(await sb.from("results").select("score, actuals").eq("user_id", p.id).eq("day", day).maybeSingle());
}

export async function following(userId) {
  const rows = check(
    await sb
      .from("follows")
      .select("followee, profile:profiles!follows_followee_fkey(username)")
      .eq("follower", userId)
      .order("created_at", { ascending: false }),
  );
  return rows.map((r) => ({ id: r.followee, username: r.profile.username }));
}

export async function follow(username) {
  const p = check(await sb.from("profiles").select("id").eq("username", username.toLowerCase()).maybeSingle());
  if (!p) throw Object.assign(new Error("No such player"), { code: "missing" });
  const res = await sb.from("follows").insert({ followee: p.id });
  if (res.error && res.error.code !== "23505") throw res.error;
  return p.id;
}

export async function unfollow(followee) {
  check(await sb.from("follows").delete().eq("followee", followee));
}

export async function setReaction(resultId, emoji, on) {
  if (on) {
    const res = await sb.from("reactions").insert({ result_id: resultId, emoji });
    if (res.error && res.error.code !== "23505") throw res.error;
  } else {
    check(await sb.from("reactions").delete().eq("result_id", resultId).eq("emoji", emoji));
  }
}

/** Calls onChange (debounced) whenever today's board or reactions change. */
export function subscribeDay(day, onChange) {
  let t;
  const ping = () => {
    clearTimeout(t);
    t = setTimeout(onChange, 400);
  };
  const ch = sb
    .channel(`day-${day}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "results", filter: `day=eq.${day}` }, ping)
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, ping)
    .subscribe();
  return () => {
    clearTimeout(t);
    sb.removeChannel(ch);
  };
}

/** Anonymous analytics counter (no user id stored). Never throws. */
export async function logEvent(day, kind) {
  try {
    await sb.from("events").insert({ day, kind });
  } catch {
    /* analytics must never break the game */
  }
}

/** Upgrade an anonymous account so it survives across devices (magic link). */
export async function linkEmail(email) {
  check(await sb.auth.updateUser({ email }));
}
