-- JISOO AI 月次経営ダッシュボード 初期スキーマ

-- ────────────────────────────────────────────
-- 1. monthly_metrics（経営数字の実績）
-- ────────────────────────────────────────────
create table if not exists monthly_metrics (
  year_month        text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  billing           bigint,           -- 請求額（円）
  payment           bigint,           -- 入金額（円）
  expense           bigint,           -- 費用（円）
  companies_trained int,              -- 研修先企業数
  annual_contracts  int,              -- 年間契約社数
  instructors       int,              -- 講師数
  ai_products       int,              -- 完成AIプロダクト数
  prospects         int,              -- 見込み案件数
  confirmed_revenue bigint,           -- 確定売上（円）
  memo              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table monthly_metrics enable row level security;

-- updated_at 自動更新トリガー
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_monthly_metrics_updated_at
  before update on monthly_metrics
  for each row execute function set_updated_at();

-- ────────────────────────────────────────────
-- 2. ai_comments（AIコメント。service_roleのみ書ける）
-- ────────────────────────────────────────────
create table if not exists ai_comments (
  year_month       text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  monthly_comment  text,   -- 前月比の変化と注目点（3行）
  ma_watch         text,   -- M&Aウォッチ（100字）
  forecast_note    text,   -- 年内目標への到達ペース（50字）
  generated_at     timestamptz not null default now()
);

alter table ai_comments enable row level security;

-- ────────────────────────────────────────────
-- 3. ai_reports（M&A面談用レポート。service_roleのみ書ける）
-- ────────────────────────────────────────────
create table if not exists ai_reports (
  year_month    text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  report_md     text,   -- マークダウン形式の1枚レポート
  generated_at  timestamptz not null default now()
);

alter table ai_reports enable row level security;

-- ────────────────────────────────────────────
-- RLS ポリシー
-- authenticated: monthly_metrics は select / insert / update 可（delete は無し）
-- authenticated: ai_comments・ai_reports は select のみ（書込はservice_roleだけ）
-- anon: 全テーブル何も許可しない（ポリシー無しのまま）
-- ────────────────────────────────────────────

-- monthly_metrics
create policy "authenticated_select_metrics"
  on monthly_metrics for select
  to authenticated using (true);

create policy "authenticated_insert_metrics"
  on monthly_metrics for insert
  to authenticated with check (true);

create policy "authenticated_update_metrics"
  on monthly_metrics for update
  to authenticated using (true) with check (true);

-- ai_comments（selectのみ）
create policy "authenticated_select_ai_comments"
  on ai_comments for select
  to authenticated using (true);

-- ai_reports（selectのみ）
create policy "authenticated_select_ai_reports"
  on ai_reports for select
  to authenticated using (true);
