# Andon Cloud — セットアップ手順

## ディレクトリ構成

```
andon-cloud/
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc
├── public/
│   ├── index.html              ← andon_saas.html をリネームして配置
│   └── firebase-messaging-sw.js
└── functions/
    ├── index.js
    └── package.json
```

---

## Step 1｜Firebaseプロジェクト作成

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. 「プロジェクトを追加」→ プロジェクト名を入力（例: `andon-cloud`）
3. Google アナリティクスは任意（OFFでも可）

---

## Step 2｜各サービスを有効化

### Authentication
1. Firebase Console → Authentication → 「始める」
2. ログイン方法 → 「メール/パスワード」を有効化

### Firestore
1. Firebase Console → Firestore Database → 「データベースを作成」
2. **本番環境モード** で作成（ルールは後でデプロイ）
3. リージョン: `asia-northeast1`（東京）を選択

### Cloud Functions
1. Firebase Console → Functions → 「始める」
2. 従量課金プラン（Blaze）へのアップグレードが必要

### Cloud Messaging（Push通知）
1. Firebase Console → プロジェクトの設定 → クラウドメッセージング
2. 「ウェブプッシュ証明書」→「鍵ペアを生成」
3. 生成された **VAPID キー** をメモする

---

## Step 3｜設定値を書き換え

### firebaseConfig の取得
Firebase Console → プロジェクトの設定 → 「アプリを追加」→ ウェブ

以下の3ファイルに設定値を貼り付ける：

**public/index.html** の `FIREBASE_CONFIG` と `VAPID_KEY`
```javascript
const FIREBASE_CONFIG = {
  apiKey:            "取得した値",
  authDomain:        "取得した値",
  projectId:         "取得した値",
  storageBucket:     "取得した値",
  messagingSenderId: "取得した値",
  appId:             "取得した値"
};
const VAPID_KEY = "取得したVAPIDキー";
```

**public/firebase-messaging-sw.js** の `firebase.initializeApp({...})` も同様に書き換え

**.firebaserc** の `YOUR_PROJECT_ID` をプロジェクトIDに変更

---

## Step 4｜Firebase CLI でデプロイ

```bash
# Firebase CLIのインストール（初回のみ）
npm install -g firebase-tools

# ログイン
firebase login

# functionsの依存パッケージをインストール
cd functions && npm install && cd ..

# 全リソースをデプロイ
firebase deploy

# 個別にデプロイする場合
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only hosting
```

---

## Step 5｜最初のテナントと管理者を作成

デプロイ後、ブラウザで以下のURLを開く：

```
https://YOUR_PROJECT.web.app/?tenant=TENANT_ID&mode=admin
```

初回は管理者ユーザーを手動で作成する必要がある：

1. Firebase Console → Authentication → 「ユーザーを追加」
   - メールアドレス・パスワードを入力してユーザー作成
   - 生成された **UID** をメモ

2. Firebase Console → Firestore → 以下のドキュメントを手動作成：

```
tenants/{TENANT_ID}
  name: "会社名"
  plan: "trial"
  trialEndsAt: （30日後の日付）
  createdAt: （現在時刻）

tenants/{TENANT_ID}/users/{UID}
  name: "管理者名"
  email: "メールアドレス"
  role: "admin"
  enabled: true
  available: true
  priority: 50
  fcmToken: null
  createdAt: （現在時刻）
```

3. ログイン画面からサインインして管理画面を確認

---

## Step 6｜ローカル開発（エミュレーター）

```bash
# エミュレーター起動
firebase emulators:start

# ブラウザで確認
# Hosting:   http://localhost:5000
# Firestore: http://localhost:4000/firestore
# Functions: http://localhost:4000/functions
```

---

## 各画面のURL

| 用途 | URL |
|---|---|
| 呼び出し（タブレット設置） | `/?tenant=TENANT_ID&mode=call` |
| モニター（大型ディスプレイ） | `/?tenant=TENANT_ID&mode=monitor` |
| 担当者（スマホ） | `/?tenant=TENANT_ID&mode=mobile` |
| 管理画面 | `/?tenant=TENANT_ID&mode=admin` |

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| Functions がデプロイできない | Blaze プランへのアップグレードを確認 |
| Push通知が届かない | VAPIDキーとSW内のfirebaseConfigを確認 |
| `permission-denied` エラー | firestore.rules がデプロイされているか確認 |
| iOSでPush通知が来ない | ホーム画面に追加（PWAインストール）が必要 |
