// ai-sanbo: JISOO AI 月次経営分析エッジ関数
// mode=comments → ai_comments生成・保存
// mode=report   → ai_reports生成・保存

// ─── Gemini モデル定数（主→フォールバックの順） ───
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

// 再試行すべきステータスか（混雑/一時障害）
function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status === 500 || status === 503;
}

// 1モデルを最大3回リトライ
async function callGeminiModel(model: string, apiKey: string, payload: unknown): Promise<Response | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let res: Response | null = null;
  for (let i = 0; i < 3; i++) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      });
    } catch (_e) {
      res = null;
    }
    const code = res ? res.status : 0;
    if (!isRetryable(code)) break;
    if (i < 2) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return res;
}

// 主モデル→フォールバックの順にGeminiを呼ぶ
async function callGemini(apiKey: string, payload: unknown): Promise<Response | null> {
  let res: Response | null = null;
  for (const model of GEMINI_MODELS) {
    res = await callGeminiModel(model, apiKey, payload);
    if (res && res.ok) break;
    if (res && !isRetryable(res.status)) break;
  }
  return res;
}

// Geminiレスポンスからテキストを取り出す
function extractText(body: unknown): string | null {
  try {
    const b = body as Record<string, unknown>;
    const candidates = b?.candidates as Array<Record<string, unknown>>;
    const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>;
    return (parts?.[0]?.text as string) ?? null;
  } catch (_e) {
    return null;
  }
}

// ─── 数字テーブルの行型 ───
interface MetricsRow {
  year_month: string;
  billing: number | null;
  payment: number | null;
  expense: number | null;
  companies_trained: number | null;
  annual_contracts: number | null;
  instructors: number | null;
  ai_products: number | null;
  prospects: number | null;
  confirmed_revenue: number | null;
  memo: string | null;
}

// 数字を読みやすい文字列に整形（null は "未入力"）
function fmtMetrics(row: MetricsRow): string {
  const f = (v: number | null, unit = "円") => v == null ? "未入力" : `${v.toLocaleString()}${unit}`;
  const fi = (v: number | null, unit = "社") => v == null ? "未入力" : `${v}${unit}`;
  const uncollected = (row.billing != null && row.payment != null) ? row.billing - row.payment : null;
  const profit = (row.payment != null && row.expense != null) ? row.payment - row.expense : null;
  return [
    `  請求額: ${f(row.billing)}`,
    `  入金額: ${f(row.payment)}`,
    `  未回収: ${f(uncollected)}`,
    `  費用: ${f(row.expense)}`,
    `  利益: ${f(profit)}`,
    `  研修先企業数: ${fi(row.companies_trained)}`,
    `  年間契約社数: ${fi(row.annual_contracts)}`,
    `  講師数: ${fi(row.instructors, "人")}`,
    `  AIプロダクト数: ${fi(row.ai_products, "個")}`,
    `  見込み案件: ${fi(row.prospects, "件")}`,
    `  確定売上: ${f(row.confirmed_revenue)}`,
    row.memo ? `  メモ: ${row.memo}` : "",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  const ALLOW_ORIGIN = Deno.env.get("ALLOW_ORIGIN") ?? "https://jisoo-ai.github.io";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // OPTIONSは即200
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // ─── JWT検証 ───
  const authz = req.headers.get("Authorization") ?? "";
  const token = authz.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "認証が必要です" }, 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SR, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ ok: false, error: "認証トークンが無効です" }, 401);
  const user = await userRes.json();
  if (!user?.id) return json({ ok: false, error: "認証トークンが無効です" }, 401);

  // ─── リクエストボディ解析 ───
  let body: { year_month?: string; mode?: string };
  try {
    body = await req.json();
  } catch (_e) {
    return json({ ok: false, error: "リクエストの形式が正しくありません" });
  }

  const mode = body.mode;
  if (mode !== "comments" && mode !== "report") {
    return json({ ok: false, error: "mode は 'comments' または 'report' を指定してください" });
  }

  // ─── monthly_metrics 全行取得（年月昇順） ───
  const metricsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/monthly_metrics?select=*&order=year_month.asc`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } },
  );
  if (!metricsRes.ok) return json({ ok: false, error: "数字データの取得に失敗しました" });
  const allMetrics: MetricsRow[] = await metricsRes.json();

  if (allMetrics.length === 0) {
    return json({ ok: false, error: "数字データがまだ登録されていません" });
  }

  // 対象月の確定（mode=commentsは必須、mode=reportは省略時に最新月）
  let targetYearMonth = body.year_month;
  if (!targetYearMonth) {
    if (mode === "comments") {
      return json({ ok: false, error: "comments モードでは year_month が必要です" });
    }
    // reportは最新月を使用
    targetYearMonth = allMetrics[allMetrics.length - 1].year_month;
  }

  const targetRow = allMetrics.find((r) => r.year_month === targetYearMonth);
  if (!targetRow) {
    return json({ ok: false, error: `${targetYearMonth} のデータが見つかりません` });
  }

  const targetIdx = allMetrics.findIndex((r) => r.year_month === targetYearMonth);
  const prevRow = targetIdx > 0 ? allMetrics[targetIdx - 1] : null;

  // ─── mode=comments ───
  if (mode === "comments") {
    // 全履歴の数字サマリーを作成
    const historyText = allMetrics
      .map((r) => `【${r.year_month}】\n${fmtMetrics(r)}`)
      .join("\n\n");

    const prompt = `あなたはJISOO AI株式会社の経営アドバイザーです。
以下の月次経営データをもとに、JSON形式で分析コメントを生成してください。

【対象月: ${targetYearMonth}】
${fmtMetrics(targetRow)}

${prevRow ? `【前月: ${prevRow.year_month}】\n${fmtMetrics(prevRow)}` : "（前月データなし）"}

【全履歴】
${historyText}

以下のJSONを返してください（キーは変えないこと）：
{
  "monthly_comment": "前月比の変化と注目点を経営者向けに3行で（数字を羅列せず、変化の意味や注目すべき点を伝える文章で）",
  "ma_watch": "M&Aバイヤー視点で①ストック売上（年間契約）②属人性（講師数・体制）③市場希少性 の観点から、強み1つと改善点1つを合わせて100字以内で",
  "forecast_note": "年内目標（年間契約10社・AIプロダクト30個）への到達ペースについて一言（50字以内）"
}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    };

    const res = await callGemini(GEMINI_API_KEY, payload);
    if (!res || !res.ok) {
      return json({ ok: false, error: "AI生成に失敗しました。後でもう一度お試しください" });
    }

    let comments: { monthly_comment: string; ma_watch: string; forecast_note: string };
    try {
      const resBody = await res.json();
      const text = extractText(resBody);
      if (!text) throw new Error("テキスト取得失敗");
      comments = JSON.parse(text);
    } catch (_e) {
      return json({ ok: false, error: "AI生成に失敗しました。後でもう一度お試しください" });
    }

    // ai_comments にupsert（service_role権限）
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_comments`, {
      method: "POST",
      headers: {
        apikey: SR,
        Authorization: `Bearer ${SR}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        year_month: targetYearMonth,
        monthly_comment: comments.monthly_comment,
        ma_watch: comments.ma_watch,
        forecast_note: comments.forecast_note,
        generated_at: new Date().toISOString(),
      }),
    });
    if (!upsertRes.ok) {
      return json({ ok: false, error: "コメントの保存に失敗しました" });
    }

    return json({ ok: true, comments });
  }

  // ─── mode=report ───
  // ai_comments も参照して充実したレポートを作る
  const commentsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_comments?year_month=eq.${targetYearMonth}`,
    { headers: { apikey: SR, Authorization: `Bearer ${SR}` } },
  );
  const commentsRows = commentsRes.ok ? (await commentsRes.json() as Array<Record<string, string>>) : [];
  const latestComment = commentsRows[0] ?? null;

  const [yyyy, mm] = targetYearMonth.split("-");
  const displayMonth = `${yyyy}年${parseInt(mm)}月`;

  // 未回収・利益の計算
  const uncollected = (targetRow.billing != null && targetRow.payment != null)
    ? targetRow.billing - targetRow.payment
    : null;
  const profit = (targetRow.payment != null && targetRow.expense != null)
    ? targetRow.payment - targetRow.expense
    : null;

  const metricsTableRows = [
    ["請求額", targetRow.billing?.toLocaleString() ?? "未入力"],
    ["入金額", targetRow.payment?.toLocaleString() ?? "未入力"],
    ["未回収", uncollected?.toLocaleString() ?? "未入力"],
    ["費用", targetRow.expense?.toLocaleString() ?? "未入力"],
    ["利益", profit?.toLocaleString() ?? "未入力"],
    ["年間契約社数", targetRow.annual_contracts?.toString() ?? "未入力"],
    ["講師数", targetRow.instructors?.toString() ?? "未入力"],
    ["AIプロダクト数", targetRow.ai_products?.toString() ?? "未入力"],
    ["見込み案件", targetRow.prospects?.toString() ?? "未入力"],
  ].map(([k, v]) => `| ${k} | ${v} |`).join("\n");

  const aiCommentSection = latestComment
    ? `AIコメント（月次）: ${latestComment.monthly_comment ?? "なし"}
M&Aウォッチ: ${latestComment.ma_watch ?? "なし"}
目標ペース: ${latestComment.forecast_note ?? "なし"}`
    : "（AIコメント未生成）";

  const prompt = `あなたはJISOO AI株式会社のM&A面談資料を作成する専門家です。
以下のデータをもとに、M&A面談で使う1枚レポートをマークダウンで作成してください。

【対象月】${targetYearMonth}（${displayMonth}）

【数字】
${fmtMetrics(targetRow)}

【AIコメント】
${aiCommentSection}

以下の構成で作成してください：
1. # JISOO AI株式会社 月次レポート（${displayMonth}）
2. ## 今月のサマリー（前月比の変化と注目点を3行で）
3. ## 数字（下記の表ヘッダーをそのまま使い、実際の値を埋める）
   | 項目 | 値 |
   |---|---|
${metricsTableRows}
4. ## M&A 3条件の進捗（ストック売上・属人性排除・市場希少性をそれぞれ1〜2行で）
5. ## 来月の見込みと打ち手（2〜3行）

注意事項：
- 誇張・断定しすぎを避け、数字に忠実に書く
- 未入力の項目は「未入力」と記載する
- 表の値は実際の数字をそのまま使い、改変しない
- マークダウンのみ返す（JSON不要）`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "text/plain" },
  };

  const res = await callGemini(GEMINI_API_KEY, payload);
  if (!res || !res.ok) {
    return json({ ok: false, error: "AI生成に失敗しました。後でもう一度お試しください" });
  }

  let reportMd: string;
  try {
    const resBody = await res.json();
    const text = extractText(resBody);
    if (!text) throw new Error("テキスト取得失敗");
    reportMd = text;
  } catch (_e) {
    return json({ ok: false, error: "AI生成に失敗しました。後でもう一度お試しください" });
  }

  // ai_reports にupsert
  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_reports`, {
    method: "POST",
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      year_month: targetYearMonth,
      report_md: reportMd,
      generated_at: new Date().toISOString(),
    }),
  });
  if (!upsertRes.ok) {
    return json({ ok: false, error: "レポートの保存に失敗しました" });
  }

  return json({ ok: true, report_md: reportMd });
});
