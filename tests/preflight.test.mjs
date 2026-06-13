import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));

test("package scripts: default failing test script is replaced with real local checks", () => {
  const pkg = json("package.json");
  assert.ok(pkg.scripts, "scripts がありません");
  assert.notEqual(pkg.scripts.test, 'echo "Error: no test specified" && exit 1');
  assert.match(pkg.scripts.test, /node --test/);
  assert.match(pkg.scripts.check, /npm run test/);
  assert.match(pkg.scripts.check, /npm run check:deno/);
  assert.match(pkg.scripts["check:deno"], /scripts\/deno-check\.mjs/);
});

test("deploy workflow: CI tools are pinned and not floating latest versions", () => {
  const workflow = read(".github/workflows/deploy.yml");
  assert.doesNotMatch(workflow, /deno-version:\s*v2\.x\b/, "Denoが v2.x のままです");
  assert.doesNotMatch(workflow, /version:\s*latest\b/, "Supabase CLIが latest のままです");
  assert.match(workflow, /deno-version:\s*2\.8\.3\b/);
  assert.match(workflow, /version:\s*2\.106\.0\b/);
});

test("quality gate workflow: every push runs checks without deploying", () => {
  const workflow = read(".github/workflows/quality-gate.yml");
  assert.match(workflow, /name:\s*Quality Gate/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /node-version:\s*22/);
  assert.match(workflow, /deno-version:\s*2\.8\.3/);
  assert.match(workflow, /npm run check/);
  assert.doesNotMatch(workflow, /supabase functions deploy/i);
});

test("config: public config keeps placeholders and does not contain live secrets", () => {
  const config = read("config.js");
  assert.match(config, /SUPABASE_URL:\s*"__SUPABASE_URL__"/);
  assert.match(config, /SUPABASE_ANON_KEY:\s*"__SUPABASE_ANON_KEY__"/);
  assert.doesNotMatch(config, /service[_-]?role/i);
  assert.doesNotMatch(config, /GEMINI_API_KEY/i);
  assert.doesNotMatch(config, /AIza[0-9A-Za-z_-]{20,}/, "Gemini APIキーらしき文字列があります");
  assert.doesNotMatch(config, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "JWTらしき実キーがあります");
});

test("frontend: Iron Man style dashboard has core private-business views and demo mode", () => {
  const html = read("index.html");
  for (const text of [
    "JISOO AI",
    "ATLAS",
    "AI経営参謀ダッシュボード",
    "MONTHLY SUMMARY",
    "AI EXECUTIVE BRIEFING",
    "面談レポート",
    "DEMO DATA",
    "demo=1",
  ]) {
    assert.ok(html.includes(text), `${text} が見つかりません`);
  }
});

test("database: RLS is enabled and anon gets no explicit policy", () => {
  const sql = read("supabase/migrations/001_init.sql");
  for (const table of ["monthly_metrics", "ai_comments", "ai_reports"]) {
    assert.match(sql, new RegExp(`alter table ${table} enable row level security`, "i"));
  }
  assert.match(sql, /to authenticated using \(true\)/i);
  assert.doesNotMatch(sql, /to anon/i);
  assert.doesNotMatch(sql, /for delete/i);
});

test("ai-sanbo: Gemini and service role are server-side only with auth check", () => {
  const fn = read("supabase/functions/ai-sanbo/index.ts");
  for (const text of [
    'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")',
    'Deno.env.get("GEMINI_API_KEY")',
    "/auth/v1/user",
    'mode !== "comments" && mode !== "report"',
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ]) {
    assert.ok(fn.includes(text), `${text} が見つかりません`);
  }
});
