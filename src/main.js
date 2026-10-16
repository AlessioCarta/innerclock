import "./style.css";
import * as api from "./api.js";
import {
  ROUNDS,
  TIERS,
  dayNumber,
  msUntilTomorrow,
  targetsFor,
  roundMs,
  errorPct,
  tierFor,
  roundScore,
  totalScore,
  title,
  emojiGrid,
  shareText,
  updateStats,
  USERNAME_RE,
} from "./core.js";

const STORE = "innerclock:v1";
const REACTIONS = ["🔥", "🎯", "😂", "🫠", "⚡"];
const vs = (new URLSearchParams(location.search).get("vs") || "").toLowerCase();
const $app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);

const S = {
  online: !!api.sb,
  day: dayNumber(),
  targets: [],
  view: "home", // home | play | done
  round: 0,
  actuals: [],
  user: null,
  profile: null,
  server: null, // { id, actuals, score } once submitted
  players: null,
  vsStats: null,
  vsResult: null,
  board: [],
  boardTab: "global",
  rank: null,
  following: [],
  unsub: null,
  ac: null, // AbortController for the current view's listeners
};

// ---------- storage ----------

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORE, JSON.stringify(data));
  } catch {
    /* private mode: play still works, just not persisted */
  }
}

function saveDay() {
  const data = load();
  data.days = { ...data.days, [S.day]: { actuals: S.actuals } };
  save(data);
}

/** Count an event at most once per device per day, once we're signed in. */
function track(kind) {
  if (!S.online || !S.user) return;
  const data = load();
  const seen = data.tracked?.[S.day] ?? [];
  if (seen.includes(kind)) return;
  data.tracked = { [S.day]: [...seen, kind] }; // keep only today
  save(data);
  api.logEvent(S.day, kind);
}

// ---------- helpers ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDiff = (d) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}s`;

function myScore() {
  return S.server?.score ?? totalScore(S.targets, S.actuals);
}

function shareUrl() {
  const u = new URL(location.origin + location.pathname);
  if (S.profile) u.searchParams.set("vs", S.profile.username);
  return u.toString();
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

async function shareOrCopy(text) {
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied — paste it anywhere");
  } catch {
    prompt("Copy this:", text);
  }
}

function freshListeners() {
  S.ac?.abort();
  S.ac = new AbortController();
  return S.ac.signal;
}

// ---------- views ----------

function header() {
  const who = !S.online
    ? `<span class="chip muted">Offline</span>`
    : S.profile
      ? `<button class="chip" data-profile="${esc(S.profile.username)}">@${esc(S.profile.username)}</button>`
      : `<span class="chip muted">Guest</span>`;
  return `<header class="top">
    <a class="logo" href="./" aria-label="InnerClock home"><span class="logo-dot"></span>InnerClock</a>
    <div class="top-right"><span class="daytag">#${S.day}</span>${who}</div>
  </header>`;
}

function vsBanner() {
  if (!vs || vs === S.profile?.username) return "";
  const s = S.vsStats;
  const extra = s ? ` · best ${s.best ?? "—"} · 🔥${s.streak}` : "";
  return `<div class="banner">⚔️ <b>@${esc(vs)}</b> challenged you${esc(extra)}</div>`;
}

function render() {
  const signal = freshListeners();
  if (S.view === "play") renderPlay(signal);
  else if (S.view === "done") renderDone(signal);
  else renderHome(signal);
  $app.addEventListener(
    "click",
    (e) => {
      const p = e.target.closest("[data-profile]");
      if (p) openProfile(p.dataset.profile);
    },
    { signal },
  );
}

function renderHome(signal) {
  const resume = S.actuals.length > 0;
  $app.innerHTML = `${header()}
  <main class="home">
    ${vsBanner()}
    <p class="eyebrow">Daily challenge #${S.day}</p>
    <h1 class="hero">How accurate is your <em>inner&nbsp;clock</em>?</h1>
    <p class="lede">Five targets. No timer on screen. Hold the button for exactly the time shown —
      the whole world gets the same five today.</p>
    <button class="btn primary xl" id="play">${resume ? `Resume · round ${S.actuals.length + 1}` : "Play today’s clock"}</button>
    ${S.players != null ? `<p class="muted center"><b>${S.players.toLocaleString()}</b> ${S.players === 1 ? "person has" : "people have"} played today</p>` : ""}
    <ul class="how">
      <li><span>⏱️</span><div><b>Hold blind</b><p>Press and hold. Let go when you feel the time is up.</p></div></li>
      <li><span>🎯</span><div><b>Score up to 500</b><p>${TIERS.map((t) => `${t.emoji}&nbsp;${t.label}`).join(" · ")}</p></div></li>
      <li><span>🏆</span><div><b>Beat your friends</b><p>Live leaderboard unlocks after you play. No spoilers.</p></div></li>
    </ul>
  </main>`;
  $("#play").addEventListener(
    "click",
    () => {
      S.view = "play";
      track("play");
      S.round = S.actuals.length;
      render();
    },
    { signal },
  );
}

function renderPlay(signal) {
  const t = S.targets[S.round];
  const last = S.round === ROUNDS - 1;
  $app.innerHTML = `${header()}
  <main class="play">
    <div class="dots" aria-hidden="true">${S.targets
      .map((_, i) => `<span class="${i < S.round ? "done" : i === S.round ? "now" : ""}"></span>`)
      .join("")}</div>
    <p class="eyebrow">Round ${S.round + 1} of ${ROUNDS}</p>
    <h1 class="target" aria-live="polite">${t.toFixed(1)}<small>s</small></h1>
    <p class="hint" id="hint">Press &amp; hold the button<span class="kbd-hint"> — or hold <kbd>Space</kbd></span>.</p>
    <button id="pad" class="pad" aria-label="Hold for ${t.toFixed(1)} seconds">
      <span class="ripple"></span><span class="pad-label">HOLD</span>
    </button>
    <div id="reveal" class="reveal" hidden></div>
  </main>`;

  const pad = $("#pad");
  const hint = $("#hint");
  let state = "ready";
  let start = 0;

  const down = () => {
    if (state !== "ready") return;
    state = "holding";
    start = performance.now();
    pad.classList.add("holding");
    hint.textContent = "Counting in your head…";
    navigator.vibrate?.(8);
  };

  const up = () => {
    if (state !== "holding") return;
    const secs = (performance.now() - start) / 1000;
    pad.classList.remove("holding");
    if (secs < 0.15) {
      state = "ready";
      hint.textContent = "Too quick — press and keep holding.";
      return;
    }
    state = "revealed";
    reveal(roundMs(secs));
  };

  const reveal = (secs) => {
    S.actuals.push(secs);
    saveDay();
    const err = errorPct(t, secs);
    const tier = tierFor(err);
    const el = $("#reveal");
    pad.hidden = true;
    hint.hidden = true;
    el.hidden = false;
    el.innerHTML = `
      <div class="you-held">You held</div>
      <div class="big">${secs.toFixed(2)}<small>s</small></div>
      <div class="diff">${fmtDiff(secs - t)} · ${tier.emoji} ${tier.label}</div>
      <div class="pts">+${roundScore(t, secs)} pts</div>
      <button class="btn primary" id="next">${last ? "See my results" : "Next round"} →</button>`;
    const go = () => {
      S.round += 1;
      if (S.round >= ROUNDS) finishGame();
      else render();
    };
    $("#next").addEventListener("click", go, { signal });
    $("#next").focus();
  };

  pad.addEventListener(
    "pointerdown",
    (e) => {
      e.preventDefault();
      pad.setPointerCapture?.(e.pointerId);
      down();
    },
    { signal },
  );
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(ev, up, { signal });
  pad.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });
  addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "Space" || e.repeat || state === "revealed") return;
      e.preventDefault();
      down();
    },
    { signal },
  );
  addEventListener(
    "keyup",
    (e) => {
      if (e.code !== "Space" || state !== "holding") return;
      e.preventDefault();
      up();
    },
    { signal },
  );
  // Switching tabs mid-hold would be cheating-adjacent and confusing: retry.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && state === "holding") {
        state = "ready";
        pad.classList.remove("holding");
        hint.textContent = "Interrupted — try that one again.";
      }
    },
    { signal },
  );
}

async function finishGame() {
  const data = load();
  data.stats = updateStats(data.stats, S.day, totalScore(S.targets, S.actuals));
  save(data);
  track("finish");
  if (vs && vs !== S.profile?.username) track("vs_finish");
  S.view = "done";
  render();
  if (S.online && S.profile) {
    await submit();
    render();
  }
  loadSocial();
}

async function submit() {
  try {
    S.server = await api.submitResult(S.user.id, S.day, S.actuals);
    if (S.server) S.actuals = S.server.actuals.map(Number);
  } catch (e) {
    console.error(e);
    toast("Couldn’t post your score — check your connection");
  }
}

function renderDone(signal) {
  const total = myScore();
  const stats = load().stats || {};
  const rows = S.targets
    .map((t, i) => {
      const a = S.actuals[i];
      const tier = tierFor(errorPct(t, a));
      return `<li><span class="r-emoji">${tier.emoji}</span><span class="r-t">${t.toFixed(1)}s</span>
        <span class="r-a">${a.toFixed(2)}s</span><span class="r-d">${fmtDiff(a - t)}</span>
        <span class="r-p">${roundScore(t, a)}</span></li>`;
    })
    .join("");

  const claim =
    S.online && !S.profile
      ? `<form class="card claim" id="claim">
          <b>Claim your spot on today’s leaderboard</b>
          <p class="muted">Pick a username. No email, no password.</p>
          <div class="row"><span class="at">@</span><input id="uname" name="username" autocomplete="off"
            autocapitalize="off" spellcheck="false" maxlength="20" placeholder="time_lord" required />
          <button class="btn primary">Post score</button></div>
          <p class="err" id="claim-err" hidden></p>
        </form>`
      : "";

  $app.innerHTML = `${header()}
  <main class="done">
    <p class="eyebrow">InnerClock #${S.day}</p>
    <div class="score"><span>${total}</span><small>/500</small></div>
    <h2 class="title">${title(total)}</h2>
    <div class="grid">${emojiGrid(S.targets, S.actuals)}</div>
    <div class="actions">
      <button class="btn primary" id="share">Share result</button>
      <button class="btn" id="challenge">⚔️ Challenge a friend</button>
    </div>
    ${claim}
    <section id="social"></section>
    <details class="card">
      <summary>Round by round</summary>
      <ol class="rounds"><li class="head"><span></span><span>Target</span><span>You</span><span>Off</span><span>Pts</span></li>${rows}</ol>
    </details>
    <p class="stats-line muted">Played ${stats.played ?? 1} · Best ${stats.best ?? total} · Streak 🔥${stats.streak ?? 1}</p>
    <p class="next muted">Next clock in <b id="cd"></b></p>
  </main>`;

  $("#share").addEventListener(
    "click",
    () => {
      track("share");
      shareOrCopy(shareText({ day: S.day, targets: S.targets, actuals: S.actuals, url: shareUrl() }));
    },
    { signal },
  );
  $("#challenge").addEventListener(
    "click",
    () => {
      track("challenge");
      shareOrCopy(
        `I scored ${total}/500 on today’s InnerClock ⏱️ ${emojiGrid(S.targets, S.actuals)}\nThink your inner clock is better? ${shareUrl()}`,
      );
    },
    { signal },
  );

  $("#claim")?.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      const name = $("#uname").value.trim().toLowerCase();
      const err = $("#claim-err");
      if (!USERNAME_RE.test(name)) {
        err.hidden = false;
        err.textContent = "3–20 characters: letters, numbers, underscore.";
        return;
      }
      try {
        S.profile = await api.createProfile(S.user.id, name);
        await submit();
        render();
        loadSocial();
      } catch (ex) {
        err.hidden = false;
        err.textContent = ex.code === "taken" ? "That one’s taken — try another." : "Something went wrong. Try again.";
      }
    },
    { signal },
  );

  renderSocial();
  tick();
}

function renderSocial() {
  const el = $("#social");
  if (!el) return;
  if (!S.online) {
    el.innerHTML = `<div class="card muted center">Playing offline — leaderboards unavailable.</div>`;
    return;
  }
  if (!S.profile) return;

  const vsCard = (() => {
    if (!vs || vs === S.profile.username) return "";
    const followBtn = S.following.some((f) => f.username === vs)
      ? ""
      : `<button class="btn small" data-follow-vs>Follow @${esc(vs)}</button>`;
    if (!S.vsResult)
      return `<div class="card vs">@${esc(vs)} hasn’t played today yet — they’ll see your ${myScore()} when they do.
        <div>${followBtn}</div></div>`;
    const diff = myScore() - S.vsResult.score;
    const verdict = diff > 0 ? `You win by ${diff} 🏆` : diff < 0 ? `@${esc(vs)} wins by ${-diff}` : "Dead heat 🤝";
    return `<div class="card vs"><div class="vs-row"><span>You <b>${myScore()}</b></span><span class="muted">vs</span>
      <span data-profile="${esc(vs)}" class="link">@${esc(vs)} <b>${S.vsResult.score}</b></span></div>
      <div class="verdict">${verdict}</div>${followBtn}</div>`;
  })();

  const rank = S.rank ? `<p class="rank">You’re <b>#${S.rank.rank}</b> of ${Number(S.rank.total).toLocaleString()} today</p>` : "";
  const list = S.board.length
    ? S.board
        .map((r, i) => {
          const me = r.user_id === S.user.id;
          const reacts = REACTIONS.map((emo) => {
            const n = r.reactions?.[emo] || 0;
            const on = r.my_reactions?.includes(emo);
            return `<button class="react${on ? " on" : ""}" data-react="${r.result_id}" data-emoji="${emo}"
              aria-pressed="${on}" aria-label="React ${emo}">${emo}${n ? `<i>${n}</i>` : ""}</button>`;
          }).join("");
          return `<li class="${me ? "me" : ""}">
            <span class="pos">${i + 1}</span>
            <span class="who" data-profile="${esc(r.username)}">@${esc(r.username)}</span>
            <span class="g">${emojiGrid(S.targets, r.actuals.map(Number))}</span>
            <span class="pts">${r.score}</span>
            <div class="reacts">${reacts}</div>
          </li>`;
        })
        .join("")
    : `<li class="empty muted">${S.boardTab === "friends" ? "No friends yet — tap a name to follow, or challenge someone." : "You’re the first today. Legend."}</li>`;

  el.innerHTML = `${vsCard}${rank}
    <div class="card board">
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="global" aria-selected="${S.boardTab === "global"}">Everyone</button>
        <button role="tab" data-tab="friends" aria-selected="${S.boardTab === "friends"}">Friends</button>
        <span class="live"><i></i>live</span>
      </div>
      <ol class="lb">${list}</ol>
    </div>`;

  el.onclick = async (e) => {
    if (e.target.closest("[data-follow-vs]")) {
      try {
        const id = await api.follow(vs);
        S.following.unshift({ id, username: vs });
        toast(`Following @${vs}`);
      } catch {
        toast("Couldn’t follow");
      }
      await refreshBoard();
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      S.boardTab = tab.dataset.tab;
      await refreshBoard();
      return;
    }
    const btn = e.target.closest("[data-react]");
    if (btn) {
      const on = btn.getAttribute("aria-pressed") !== "true";
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on);
      try {
        await api.setReaction(Number(btn.dataset.react), btn.dataset.emoji, on);
      } catch {
        toast("Couldn’t react");
      }
      refreshBoard();
    }
  };
}

async function refreshBoard() {
  try {
    S.board = await api.leaderboard(S.day, S.boardTab === "friends");
    S.rank = await api.myRank(S.day);
  } catch (e) {
    console.error(e);
  }
  renderSocial();
}

async function loadSocial() {
  if (!S.online || !S.profile) return;
  const [vsResult, following] = await Promise.all([
    vs && vs !== S.profile.username ? api.resultOf(vs, S.day).catch(() => null) : null,
    api.following(S.user.id).catch(() => []),
  ]);
  S.vsResult = vsResult;
  S.following = following;
  await refreshBoard();
  S.unsub ??= api.subscribeDay(S.day, refreshBoard);
}

// ---------- profile sheet ----------

async function openProfile(username) {
  if (!S.online) return;
  const dlg = document.createElement("dialog");
  dlg.className = "sheet";
  dlg.innerHTML = `<div class="sheet-body"><p class="muted center">Loading…</p></div>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
  dlg.showModal();

  const body = $(".sheet-body", dlg);
  const stats = await api.profileStats(username).catch(() => null);
  if (!stats) {
    body.innerHTML = `<p class="center">Player not found.</p>`;
    return;
  }
  const isMe = stats.user_id === S.user?.id;
  const draw = () => {
    const follows = S.following.some((f) => f.id === stats.user_id);
    body.innerHTML = `
      <button class="close" aria-label="Close">✕</button>
      <div class="avatar">${esc(stats.username[0].toUpperCase())}</div>
      <h2 class="center">@${esc(stats.username)}</h2>
      <div class="stat-grid">
        <div><b>${stats.played}</b><span>played</span></div>
        <div><b>${stats.best ?? "—"}</b><span>best</span></div>
        <div><b>${stats.avg_score ?? "—"}</b><span>average</span></div>
        <div><b>🔥${stats.streak}</b><span>streak</span></div>
        <div><b>${stats.followers}</b><span>followers</span></div>
        <div><b>${stats.following}</b><span>following</span></div>
      </div>
      ${
        isMe
          ? `<form class="row" id="add-friend"><span class="at">@</span><input placeholder="add a friend" maxlength="20"
               autocapitalize="off" autocomplete="off" required/><button class="btn">Follow</button></form>
             <ul class="friends">${S.following
               .map((f) => `<li><span data-profile="${esc(f.username)}" class="link">@${esc(f.username)}</span>
                  <button class="btn small" data-unfollow="${f.id}">Unfollow</button></li>`)
               .join("")}</ul>
             <button class="btn wide" id="invite">Copy my challenge link</button>
             <details class="save"><summary>Keep this account on other devices</summary>
               <form class="row" id="email"><input type="email" placeholder="you@example.com" required/>
               <button class="btn">Send link</button></form></details>`
          : S.profile
            ? `<button class="btn ${follows ? "" : "primary"} wide" id="follow">${follows ? "Following ✓" : "Follow"}</button>`
            : ""
      }`;

    $(".close", body).onclick = () => dlg.close();
    $("#follow", body)?.addEventListener("click", async () => {
      if (follows) {
        await api.unfollow(stats.user_id);
        S.following = S.following.filter((f) => f.id !== stats.user_id);
      } else {
        await api.follow(stats.username);
        S.following.unshift({ id: stats.user_id, username: stats.username });
      }
      draw();
      refreshBoard();
    });
    $("#add-friend", body)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("input", e.target).value.trim().replace(/^@/, "").toLowerCase();
      try {
        const id = await api.follow(name);
        if (!S.following.some((f) => f.id === id)) S.following.unshift({ id, username: name });
        draw();
        refreshBoard();
      } catch (ex) {
        toast(ex.code === "missing" ? `No player called @${name}` : "Couldn’t follow");
      }
    });
    body.querySelectorAll("[data-unfollow]").forEach((b) =>
      b.addEventListener("click", async () => {
        await api.unfollow(b.dataset.unfollow);
        S.following = S.following.filter((f) => f.id !== b.dataset.unfollow);
        draw();
        refreshBoard();
      }),
    );
    $("#invite", body)?.addEventListener("click", () => shareOrCopy(`Beat my inner clock ⏱️ ${shareUrl()}`));
    $("#email", body)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.linkEmail($("input", e.target).value);
        toast("Check your inbox to confirm");
      } catch {
        toast("Couldn’t send — try again");
      }
    });
    body.querySelectorAll("[data-profile]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        dlg.close();
        openProfile(a.dataset.profile);
      }),
    );
  };
  draw();
}

// ---------- countdown ----------

function tick() {
  const el = $("#cd");
  if (!el) return;
  const ms = msUntilTomorrow();
  if (ms <= 1000) {
    location.reload();
    return;
  }
  const s = Math.floor(ms / 1000);
  el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
setInterval(tick, 1000);

// ---------- boot ----------

async function boot() {
  S.targets = await targetsFor(S.day);
  const mine = load().days?.[S.day]?.actuals ?? [];
  S.actuals = mine.slice(0, ROUNDS);
  S.round = S.actuals.length;
  if (S.actuals.length === ROUNDS) S.view = "done";
  render();

  if (!S.online) return;
  try {
    S.user = await api.ensureUser();
    S.profile = await api.getProfile(S.user.id);
    const server = await api.getResult(S.user.id, S.day);
    if (server) {
      // Played on another device: server is the source of truth.
      S.server = server;
      S.actuals = server.actuals.map(Number);
      S.view = "done";
      saveDay();
    } else if (S.view === "done" && S.profile) {
      await submit();
    }
  } catch (e) {
    console.warn("Going offline:", e);
    S.online = false;
    render();
    return;
  }

  const [players, vsStats] = await Promise.all([
    api.playersToday(S.day).catch(() => null),
    vs && vs !== S.profile?.username ? api.profileStats(vs).catch(() => null) : null,
  ]);
  S.players = players;
  track("visit");
  if (vs && vs !== S.profile?.username) track("vs_visit");
  S.vsStats = vsStats;
  if (S.view !== "play") render();
  if (S.view === "done") loadSocial();
}

boot();
