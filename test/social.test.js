// Runs the real migrations on PGlite with a minimal stub of Supabase's auth
// schema, then exercises RLS as two different users.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { targetsFor } from "../src/core.js";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const migration = (f) => readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

let db;
let today;

// Run `fn` as an authenticated Supabase user (RLS enforced).
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

const q = async (sql, params) => (await db.query(sql, params)).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create publication supabase_realtime;
    create role authenticated;
    create role anon;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    -- Same broad defaults Supabase applies, so the migration's revokes are exercised.
    alter default privileges in schema public grant all on tables to authenticated, anon;
    alter default privileges in schema public grant all on functions to authenticated, anon;
  `);
  await db.exec(await migration("20261016000001_game_functions.sql"));
  await db.exec(await migration("20261016000002_social.sql"));
  await db.exec(await migration("20261016000003_analytics.sql"));
  await db.exec(await migration("20261016000004_delete_account.sql"));
  await db.exec(await migration("20261016000005_moderation.sql"));
  await db.exec(`insert into auth.users values ('${A}'), ('${B}');`);
  today = (await q("select public.ic_utc_day() d"))[0].d;
  await as(A, () => q("insert into profiles (id, username) values ($1, 'alice')", [A]));
  await as(B, () => q("insert into profiles (id, username) values ($1, 'bob')", [B]));
});

test("cannot create a profile for someone else", async () => {
  const C = "00000000-0000-0000-0000-00000000000c";
  await q("insert into auth.users values ($1)", [C]);
  await assert.rejects(
    as(A, () => q("insert into profiles (id, username) values ($1, 'impostor')", [C])),
    /row-level security/,
  );
});

test("server computes the score, ignoring client-sent score and user_id", async () => {
  const targets = await targetsFor(today);
  const rows = await as(A, () =>
    q("insert into results (day, actuals, score, user_id) values ($1, $2, 9999, $3) returning score, user_id", [
      today,
      targets,
      A,
    ]),
  );
  assert.equal(rows[0].score, 500);
  assert.equal(rows[0].user_id, A);
});

test("cannot submit twice or for a far-away day", async () => {
  await assert.rejects(as(A, () => q("insert into results (day, actuals) values ($1, '{1,2,3,4,5}')", [today])));
  await assert.rejects(
    as(B, () => q("insert into results (day, actuals) values ($1, '{1,2,3,4,5}')", [today + 5])),
    /not playable/,
  );
  await assert.rejects(
    as(B, () => q("insert into results (day, actuals) values ($1, '{1,2,3,4,-1}')", [today])),
    /invalid hold/,
  );
});

test("no spoilers: today's results hidden until you play", async () => {
  assert.equal((await as(B, () => q("select * from results where day = $1", [today]))).length, 0);
  assert.equal((await as(B, () => q("select * from leaderboard($1)", [today]))).length, 0);
  assert.equal((await as(B, () => q("select * from my_rank($1)", [today]))).length, 0);
  const stats = await as(B, () => q("select best, avg_score, played, streak from profile_stats('alice')"));
  assert.equal(stats[0].best, null, "best score must not leak");
  assert.equal(Number(stats[0].played), 0, "must not reveal alice played today");
  assert.equal(Number(stats[0].streak), 0);
  // Can't react to a result you can't see.
  const [{ id }] = await q("select id from results where user_id = $1", [A]);
  await assert.rejects(
    as(B, () => q("insert into reactions (result_id, emoji) values ($1, '🔥')", [id])),
    /row-level security/,
  );
  // Nor see others' reactions on it.
  await q("insert into reactions (result_id, user_id, emoji) values ($1, $2, '⚡')", [id, A]);
  assert.equal((await as(B, () => q("select * from reactions"))).length, 0);
  await q("delete from reactions");
});

test("malformed actuals arrays are rejected", async () => {
  for (const bad of ["{{1,2,3},{1,2,3},{1,2,3},{1,2,3},{1,2,3}}", "[0:4]={1,2,3,4,5}", "{1,2,3,4}"]) {
    await assert.rejects(as(B, () => q("insert into results (day, actuals) values ($1, $2)", [today, bad])));
  }
});

test("signed-out visitors (anon) get nothing", async () => {
  await db.exec("set role anon;");
  try {
    await assert.rejects(q("select * from results"), /permission denied/);
    await assert.rejects(q("select * from leaderboard(1)"), /permission denied/);
  } finally {
    await db.exec("reset role;");
  }
});

test("after playing: leaderboard, rank, reactions, friends", async () => {
  const targets = await targetsFor(today);
  await as(B, () =>
    q("insert into results (day, actuals) values ($1, $2)", [today, targets.map((t) => +(t * 1.1).toFixed(3))]),
  );
  const board = await as(B, () => q("select username, score from leaderboard($1)", [today]));
  assert.deepEqual(
    board.map((r) => r.username),
    ["alice", "bob"],
  );
  const rank = await as(B, () => q("select rank, total from my_rank($1)", [today]));
  assert.deepEqual([Number(rank[0].rank), Number(rank[0].total)], [2, 2]);

  const [{ id }] = await q("select id from results where user_id = $1", [A]);
  await as(B, () => q("insert into reactions (result_id, emoji) values ($1, '🎯')", [id]));
  const [top] = await as(B, () => q("select reactions, my_reactions from leaderboard($1)", [today]));
  assert.deepEqual(top.reactions, { "🎯": 1 });
  assert.deepEqual(top.my_reactions, ["🎯"]);

  assert.equal((await as(B, () => q("select * from leaderboard($1, true)", [today]))).length, 1, "only me before following");
  await as(B, () => q("insert into follows (followee) values ($1)", [A]));
  assert.equal((await as(B, () => q("select * from leaderboard($1, true)", [today]))).length, 2);
});

test("results are immutable and usernames can't be changed", async () => {
  await assert.rejects(as(A, () => q("update results set score = 0 where user_id = $1", [A])), /permission denied/);
  await assert.rejects(as(A, () => q("delete from results where user_id = $1", [A])), /permission denied/);
  await assert.rejects(as(A, () => q("update profiles set username = 'bob2' where id = $1", [A])), /permission denied/);
  const [{ score }] = await q("select score from results where user_id = $1", [A]);
  assert.equal(score, 500);
});

test("analytics: players can log events but never read them", async () => {
  for (const kind of ["visit", "visit", "finish", "share"]) {
    await as(A, () => q("insert into events (day, kind) values ($1, $2)", [today, kind]));
  }
  await assert.rejects(as(A, () => q("select * from events")), /permission denied/);
  await assert.rejects(as(A, () => q("select * from stats_daily")), /permission denied/);
  await assert.rejects(as(A, () => q("delete from events")), /permission denied/);
  await assert.rejects(as(A, () => q("insert into events (day, kind) values ($1, 'hack')", [today])), /check/);
  await assert.rejects(as(A, () => q("insert into events (day, kind) values ($1, 'visit')", [today + 9])), /row-level security/);
  await db.exec("set role anon;");
  await assert.rejects(q("insert into events (day, kind) values (1, 'visit')"), /permission denied/);
  await db.exec("reset role;");

  // Owner (dashboard) view.
  const [row] = await q("select visitors, finished, shared, finish_rate_pct, share_rate_pct from stats_daily where day = $1", [today]);
  assert.deepEqual(
    [row.visitors, row.finished, row.shared, Number(row.finish_rate_pct), Number(row.share_rate_pct)].map(Number),
    [2, 1, 1, 50, 100],
  );
  const [ret] = await q("select new_players, returned_next_day from stats_retention where cohort_day = $1", [today]);
  assert.deepEqual([Number(ret.new_players), Number(ret.returned_next_day)], [2, 0]);
});

test("cannot follow or react as someone else", async () => {
  await assert.rejects(
    as(A, () => q("insert into follows (follower, followee) values ($1, $2)", [B, A])),
    /row-level security/,
  );
});

test("delete my account removes only my data", async () => {
  const D = "00000000-0000-0000-0000-00000000000d";
  await q("insert into auth.users values ($1)", [D]);
  await as(D, () => q("insert into profiles (id, username) values ($1, 'dora')", [D]));
  await as(D, () => q("insert into results (day, actuals) values ($1, '{1,2,3,4,5}')", [today]));
  await as(D, () => q("insert into follows (followee) values ($1)", [A]));
  await as(D, () => q("select public.delete_my_account()"));
  for (const [table, col] of [["auth.users", "id"], ["profiles", "id"], ["results", "user_id"], ["follows", "follower"]]) {
    assert.equal((await q(`select 1 from ${table} where ${col} = $1`, [D])).length, 0, table);
  }
  assert.equal((await q("select 1 from profiles where id = $1", [A])).length, 1, "others untouched");
  await db.exec("set role anon;");
  await assert.rejects(q("select public.delete_my_account()"), /permission denied/);
  await db.exec("reset role;");
});

test("moderation: offensive and reserved usernames are rejected", async () => {
  const E = "00000000-0000-0000-0000-00000000000e";
  await q("insert into auth.users values ($1)", [E]);
  for (const bad of ["xx_fuck_xx", "stronzo99", "admin"]) {
    await assert.rejects(as(E, () => q("insert into profiles (id, username) values ($1, $2)", [E, bad])), /username_allowed/);
  }
  await as(E, () => q("insert into profiles (id, username) values ($1, 'evelyn')", [E]));
});

test("moderation: block hides a player, report is write-only", async () => {
  const before = await as(B, () => q("select username from leaderboard($1)", [today]));
  assert.ok(before.some((r) => r.username === "alice"));
  await as(B, () => q("insert into blocks (blocked) values ($1)", [A]));
  const after = await as(B, () => q("select username from leaderboard($1)", [today]));
  assert.ok(!after.some((r) => r.username === "alice"), "blocked player hidden");
  assert.ok((await as(A, () => q("select username from leaderboard($1)", [today]))).some((r) => r.username === "bob"), "only for the blocker");
  assert.equal((await as(A, () => q("select * from blocks"))).length, 0, "blocks are private");

  await as(B, () => q("insert into reports (reported, reason) values ($1, 'offensive username')", [A]));
  await assert.rejects(as(B, () => q("select * from reports")), /permission denied/);
  await assert.rejects(as(B, () => q("insert into reports (reporter, reported) values ($1, $2)", [A, B])), /row-level security/);
  const [row] = await q("select username, reports from moderation_queue");
  assert.deepEqual([row.username, Number(row.reports)], ["alice", 1]);
});
