# 設計書 v1 — JISOO AI 月次経営ダッシュボード（AIアシスタント「ATLAS」つき）

最終更新: 2026-06-13／状態: フェーズ1（コード実装＋UI）完了・公開リポジトリへpush済み。Supabase等の外部準備は未着手（Codexからの根本AIエージェント設計の引き継ぎを受けてから着手）

## 目的

- 月次の経営数字を1画面で見える化し、社内の経営判断と、月1の加藤さん（M&A）面談に使う
- 7月第1週に6月分を入力し、2026-07-08 13時・天神の対面面談で使う（締切）
- 「AIの会社らしい」体験＝数字を入れるとAIアシスタント「ATLAS」が裏で経営分析を済ませている

## 利用者と権限

| 利用者 | 権限 |
|---|---|
| 仁義さん・経営メンバー | ログインして入力＋閲覧（社内専用） |
| 加藤さん（社外・M&A） | **ログインは渡さない**。「面談レポート作成」ボタンで作るPDF1枚だけを渡す（生データに社外アクセスさせない） |

認証は Supabase Auth（メール＋パスワード）。ログインしていなければ何も見えない（RLSで全拒否）。

## 画面（4つ）

1. **ログイン** — メール＋パスワード
2. **ダッシュボード** — 今月サマリーカード／AIアシスタント「ATLAS」ゾーン（下記3カード）／利益などの複合グラフ（万円表示）／月次一覧表
3. **入力フォーム** — 月を選んで数字を入れて保存1回。スマホ対応。未回収・利益は自動計算なので入力欄に出さない
4. **面談レポート** — ボタンでATLASがM&A面談用1枚レポート（マークダウン）を生成→印刷最適化（@media print）でA4 1枚→「PDFとして保存」（window.print）。加藤さんにはこれを渡す

## AIアシスタント「ATLAS」（v1）

頭脳は **Gemini**（gemini-2.5-flash 主／flash-lite 副。アートメイク事業の実証済みパターンを流用）。すべて保存後に裏で自動実行、**利用者の追加入力ゼロ**。1回のEdge Function呼び出しでまとめて生成。

| カード | 中身 | 失敗時 |
|---|---|---|
| 月次コメント | 前月比の変化と注目点を3行（吹き出しにタイプライター演出） | 「準備中です」＋再生成 |
| M&Aウォッチ | 加藤さんの3条件（ストック売上・属人性・希少性）で強み1つ＋改善点1つを100字 | カードごと非表示 |
| 目標到達予測 | 年内10社・30個への到達ペースをフロントJS計算（線形回帰）＋AIの一言 | AIの一言だけ非表示・数値バッジは残る |

**鉄則: AIが全部落ちてもダッシュボードの数字表示は無傷（AIはおまけ層）。**

## デザイン

- アイアンマンカラー（ホットロッドレッド×ゴールド）。背景は暖かい漆黒、赤×金の光。日本語は明朝（Shippori Mincho）、数字・英語はInterのミックス
- 英語マイクロラベルの下に日本語を必ず併記
- ATLAS＝赤いヘルメット×金フェイスプレート×白青に光る目のSVGアバター（マーベル作品の強いオマージュ。完全複製はしない）。肩書きは「AIアシスタント」
- 数字カウントアップ・カードのフェードアップ・グラフ描画アニメ・プログレスバー。prefers-reduced-motionで全無効
- `?demo=1` でネットワークを一切呼ばず架空データで全ビュー表示（右上「DEMO DATA」バッジ）

## やらないこと

- チャットボット常駐／自動メール・Slack通知／数字の入力自動補完（Notion財務DBが入力面倒で死んだ反省）

## データの持ち方（Supabase）

```
monthly_metrics: year_month(主キー "2026-06") / billing / payment / expense /
  companies_trained / annual_contracts / instructors / ai_products /
  prospects / confirmed_revenue / memo / created_at / updated_at
ai_comments: year_month / monthly_comment / ma_watch / forecast_note / generated_at
ai_reports:  year_month / report_md / generated_at
```
未回収（billing−payment）・利益（payment−expense）は保存せず表示時に計算。
RLS: authenticatedは monthly_metrics をselect/insert/update可。ai_comments・ai_reportsはselectのみ（書込はservice_role＝Edge Functionだけ）。anonは全拒否。

## インフラと分離方針

- **新規GitHubリポジトリ＋新規Supabaseプロジェクト**。アートメイク事業（顧客個人情報あり）とは完全分離
- リポジトリ: https://github.com/jisoo-ai/jisoo-dashboard （公開。中身は画面コードとSQLの型のみ・数字と鍵は入れない）
- 公開予定URL（Pages有効化後）: https://jisoo-ai.github.io/jisoo-dashboard/
- Gemini APIキーは Supabase secrets に保存（HTMLに書かない）。費用はSupabase無料枠＋GitHub無料枠＋Gemini無料枠でほぼ0円

## 実装の進め方

- コード実装はSonnetのサブエージェント中心（トークン節約）、設計判断・レビュー・小工事は上位モデルが直接
- 動作確認（ログイン→入力→保存→ATLAS生成→面談レポートPDF→未ログインで全拒否）まで済ませてからURLを渡す

## 進捗

- ✅ フェーズ1: フロント4ビュー・ai-sanbo Edge Function（Gemini）・001_init.sql・deploy.yml・アイアンマンUI 実装完了。?demo=1 でローカル動作確認済み・コンソールエラーなし
- ✅ GitHub組織 jisoo-ai 作成・公開リポジトリへpush済み（2026-06-13）
- ⏸️ 保留中（Codexの根本AIエージェント設計の引き継ぎ待ち）: GitHub Pages有効化／Supabaseプロジェクト作成／config.js実値／Gemini鍵→secrets／Edge Functionデプロイ／ログイン発行／本番動作確認

## 決定ログ

- 2026-06-13: B案（専用管理画面）採用。チャット月次質問運用は不採用（将来オプション）
- 2026-06-13: AI機能はv1で月次コメント・M&Aウォッチ・目標到達予測＋面談レポート。チャットボット常駐・自動通知・入力補完は不採用
- 2026-06-13: 加藤さんにはログインを渡さず面談レポートPDFのみ（生データ非公開）
- 2026-06-13: AIの頭脳はGemini。GitHub組織jisoo-ai・公開リポジトリ採用。UIはアイアンマンカラー＋ATLAS
- 2026-06-13: フェーズ1完了・push済み。以降はCodexの根本AIエージェント設計を受けてから再開
