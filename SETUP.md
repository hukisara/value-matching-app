# 価値観マッチングアプリ - セットアップ & デプロイ手順

## 技術スタック

- **Framework**: Next.js 15 (App Router)
- **Backend/DB**: Supabase (PostgreSQL + Realtime + Auth)
- **Styling**: Tailwind CSS
- **Deployment**: Vercel

---

## Step 1: ローカル環境のセットアップ

```bash
# 1. リポジトリをクローン（または新規作成）
git clone https://github.com/YOUR_USERNAME/value-matching-app.git
cd value-matching-app

# 2. 依存パッケージをインストール
npm install

# 3. 環境変数を設定
cp .env.local.example .env.local
# .env.local を編集して Supabase の URL と Anon Key を入力
```

---

## Step 2: Supabase プロジェクトの作成

1. [supabase.com](https://supabase.com) にアクセスしてアカウント作成/ログイン
2. 「New project」でプロジェクトを作成
3. **Project Settings > API** から以下を取得し `.env.local` に貼り付け:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` キー → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Step 3: データベースの初期化

1. Supabase Dashboard > **SQL Editor** を開く
2. `supabase/schema.sql` の内容をコピー&ペーストして実行
3. これで `rooms` と `participants` テーブル、RLS ポリシー、Realtime が設定される

---

## Step 4: 匿名認証を有効化

1. Supabase Dashboard > **Authentication > Providers**
2. **Anonymous Sign-ins** を **Enabled** にする

---

## Step 5: Realtime の確認

1. Supabase Dashboard > **Database > Replication**
2. `rooms` と `participants` テーブルが Publication に含まれていることを確認
   （schema.sql で設定済みだが、念のため）

---

## Step 6: ローカルで動作確認

```bash
npm run dev
# http://localhost:3000 にアクセス
```

---

## Step 7: GitHub にプッシュ

```bash
# 初回の場合
git init
git add .
git commit -m "Initial commit: 価値観マッチングアプリ"

# GitHub でリポジトリを作成してから
git remote add origin https://github.com/YOUR_USERNAME/value-matching-app.git
git branch -M main
git push -u origin main
```

---

## Step 8: Vercel にデプロイ

1. [vercel.com](https://vercel.com) にログイン（GitHub アカウントで連携）
2. **「Add New... > Project」** をクリック
3. 先ほどプッシュした GitHub リポジトリを選択して **Import**
4. **Environment Variables** に以下を追加:
   - `NEXT_PUBLIC_SUPABASE_URL` = (Supabase の Project URL)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (Supabase の anon key)
5. **Deploy** をクリック

以降、`main` ブランチに push するたびに自動デプロイされます。

---

## ファイル構成

```
value-matching-app/
├── app/
│   ├── layout.tsx          # ルートレイアウト
│   ├── globals.css         # Tailwind CSS
│   └── page.tsx            # メインアプリ（全画面遷移を含む）
├── lib/
│   ├── supabaseClient.ts   # Supabase クライアント初期化
│   ├── questions.ts        # 診断の設問データ
│   └── matching.ts         # コサイン類似度の計算ロジック
├── types/
│   └── database.ts         # TypeScript 型定義
├── supabase/
│   └── schema.sql          # DB スキーマ（テーブル + RLS + Realtime）
├── .env.local.example      # 環境変数テンプレート
├── .gitignore
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
└── next.config.ts
```

---

## Firebase → Supabase 移行のポイント

| Firebase                   | Supabase                              |
| -------------------------- | ------------------------------------- |
| `signInAnonymously()`      | `supabase.auth.signInAnonymously()`   |
| `onSnapshot()`             | `supabase.channel().on().subscribe()` |
| `setDoc()` / `updateDoc()` | `supabase.from().insert()` / `.update()` |
| Firestore (NoSQL)          | PostgreSQL (RDB)                      |
| Firebase Auth uid          | Supabase Auth user.id (UUID)          |
