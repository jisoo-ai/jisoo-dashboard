import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

const target = "supabase/functions/ai-sanbo/index.ts";

function findDeno() {
  if (process.env.DENO_BIN && existsSync(process.env.DENO_BIN)) {
    return process.env.DENO_BIN;
  }

  for (const dir of (process.env.PATH || "").split(delimiter)) {
    const candidate = join(dir, "deno");
    if (candidate && existsSync(candidate)) return candidate;
  }

  const cached = join(homedir(), ".cache", "line-clinic-deno", "v2.8.3", "bin", "deno");
  if (existsSync(cached)) return cached;

  return null;
}

const deno = findDeno();
if (!deno) {
  console.error("Deno 2.8.3 が見つかりません。CIでは自動導入します。ローカルで型チェックする場合は Deno を入れてください。");
  process.exit(1);
}

const result = spawnSync(deno, ["check", target], {
  stdio: "inherit",
  env: { ...process.env, DENO_NO_PACKAGE_JSON: "1" },
});

process.exit(result.status ?? 1);
