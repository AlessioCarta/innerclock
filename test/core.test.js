import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANDS,
  dayNumber,
  targetsFor,
  roundScore,
  tierFor,
  shareText,
  updateStats,
  USERNAME_RE,
} from "../src/core.js";

test("day 1 is launch day, local calendar based", () => {
  assert.equal(dayNumber(new Date(2026, 9, 16, 0, 1)), 1);
  assert.equal(dayNumber(new Date(2026, 9, 16, 23, 59)), 1);
  assert.equal(dayNumber(new Date(2026, 9, 17, 0, 0)), 2);
  assert.equal(dayNumber(new Date(2027, 9, 16)), 366);
});

test("targets are deterministic and inside their bands", async () => {
  for (let d = 1; d <= 200; d++) {
    const t = await targetsFor(d);
    assert.deepEqual(t, await targetsFor(d));
    t.forEach((s, i) => {
      assert.ok(s * 10 >= BANDS[i][0] && s * 10 <= BANDS[i][1], `day ${d} round ${i}: ${s}`);
    });
  }
  assert.notDeepEqual(await targetsFor(1), await targetsFor(2));
});

test("round score curve", () => {
  assert.equal(roundScore(4, 4), 100);
  assert.equal(roundScore(4, 4.4), 60); // 10% off
  assert.equal(roundScore(4, 3.6), 60);
  assert.equal(roundScore(4, 5), 0); // 25% off
  assert.equal(roundScore(4, 9), 0);
});

test("tiers", () => {
  assert.equal(tierFor(0).emoji, "🟪");
  assert.equal(tierFor(0.04).emoji, "🟩");
  assert.equal(tierFor(0.09).emoji, "🟨");
  assert.equal(tierFor(0.15).emoji, "🟧");
  assert.equal(tierFor(0.9).emoji, "🟥");
});

test("share text has header, grid and link", () => {
  const txt = shareText({
    day: 3,
    targets: [2, 3, 5, 8, 10],
    actuals: [2, 3.1, 5.6, 8, 14],
    url: "https://x.test/?vs=bob",
  });
  const lines = txt.split("\n");
  assert.match(lines[0], /^⏱️ InnerClock #3 — \d+\/500$/);
  assert.ok(lines[1].startsWith("🟪🟩🟧🟪🟥"));
  assert.ok(txt.endsWith("https://x.test/?vs=bob"));
});

test("streaks", () => {
  let s = updateStats({}, 1, 300);
  s = updateStats(s, 2, 400);
  assert.equal(s.streak, 2);
  assert.deepEqual(updateStats(s, 2, 999), s, "same day counts once");
  s = updateStats(s, 5, 100);
  assert.deepEqual([s.streak, s.maxStreak, s.played, s.best], [1, 2, 3, 400]);
});

test("usernames", () => {
  assert.ok(USERNAME_RE.test("time_lord42"));
  assert.ok(!USERNAME_RE.test("ab"));
  assert.ok(!USERNAME_RE.test("Bad Name"));
});
