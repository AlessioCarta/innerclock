// The server recomputes scores in SQL. These tests make sure Postgres and
// src/core.js agree exactly, using an in-process Postgres (PGlite).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { targetsFor, totalScore, roundMs } from "../src/core.js";

const sql = await readFile(
  new URL("../supabase/migrations/20261016000001_game_functions.sql", import.meta.url),
  "utf8",
);
let db;

before(async () => {
  db = new PGlite();
  await db.exec(sql);
});

test("ic_targets matches targetsFor for 2 years of days", async () => {
  const { rows } = await db.query(
    "select d, ic_targets(d)::float8[] as t from generate_series(1, 730) d",
  );
  for (const { d, t } of rows) {
    assert.deepEqual(t, await targetsFor(d), `day ${d}`);
  }
});

test("ic_score matches totalScore for random holds", async () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let k = 0; k < 400; k++) {
    const day = 1 + Math.floor(rand() * 500);
    const targets = await targetsFor(day);
    const actuals = targets.map((t) => roundMs(t * (0.6 + rand() * 0.8)));
    const { rows } = await db.query("select ic_score($1, $2::numeric[]) as s", [day, actuals]);
    assert.equal(rows[0].s, totalScore(targets, actuals), `day ${day} ${actuals}`);
  }
});

test("perfect holds score 500", async () => {
  const targets = await targetsFor(7);
  const { rows } = await db.query("select ic_score(7, $1::numeric[]) as s", [targets]);
  assert.equal(rows[0].s, 500);
});
