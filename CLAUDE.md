# Andon Cloud

クラウド型アンドン（呼び出し）管理SaaS。中小製造業向け。

## スタック

- **フロントエンド**: シングルHTML（`public/index.html`）+ Firebase Compat SDK
- **バックエンド**: Cloud Functions v2（Node.js 20）
- **DB**: Firestore（マルチテナント構成）
- **認証**: Firebase Auth（メール/パスワード）
- **Push通知**: FCM（Firebase Cloud Messaging）
- **ホスティング**: Firebase Hosting

## ディレクトリ構成

```
andon-cloud/
├── CLAUDE.md
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── .firebaserc                    ← プロジェクトID（YOUR_PROJECT_IDを書き換え）
├── public/
│   ├── index.html                 ← メインアプリ（全画面）
│   └── firebase-messaging-sw.js  ← Push通知受信用Service Worker
└── functions/
    ├── index.js                   ← ビジネスロジック全体
    └── package.json
```

## アーキテクチャの核心ルール（必ず守ること）

**Lv2セキュリティ設計：クライアントはFirestoreを読むだけ**

| 操作 | クライアント（HTML） | サーバー（Functions） |
|---|---|---|
| cases への書き込み | ❌ 禁止 | ✅ createCase / respondCase / completeCase / declineCase |
| users への書き込み | ❌ 禁止 | ✅ createMember / deleteMember / registerFCMToken |
| system への書き込み | ❌ 禁止 | ✅ autoAssignCase（Firestoreトリガー） |
| processes / callTypes | ✅ 管理者のみ直接可 | — |
| onSnapshot（読み取り） | ✅ 全メンバー可 | — |

→ `firestore.rules` で `cases` と `users` の `write: false` を絶対に変更しないこと

## Firestoreパス構造

```
tenants/{tenantId}/
  ├── cases/{caseId}          呼び出し案件
  ├── users/{uid}             メンバー
  ├── processes/{docId}       工程・ライン
  ├── callTypes/{docId}       呼び出し種別
  └── system/assignment_state 割り当て状態
```

## 画面とURLモード

| 画面 | mode パラメータ | 用途 |
|---|---|---|
| 呼び出し | `?tenant=xxx&mode=call` | タブレット設置 |
| モニター | `?tenant=xxx&mode=monitor` | 大型ディスプレイ |
| 担当者 | `?tenant=xxx&mode=mobile` | スマホ（Push通知） |
| 管理 | `?tenant=xxx&mode=admin` | 管理者のみ |

## よく使うコマンド

```bash
# ローカル開発（エミュレーター）
firebase emulators:start

# デプロイ
firebase deploy
firebase deploy --only functions
firebase deploy --only hosting
firebase deploy --only firestore:rules

# Functionsの依存パッケージ
cd functions && npm install
```

## 設定値の書き換え箇所（新規プロジェクト作成後）

- `public/index.html` → `FIREBASE_CONFIG` と `VAPID_KEY`
- `public/firebase-messaging-sw.js` → `firebase.initializeApp({...})`
- `.firebaserc` → `YOUR_PROJECT_ID`

## Cloud Functions一覧（functions/index.js）

| 関数名 | 種別 | 説明 |
|---|---|---|
| `createCase` | Callable | 呼び出し作成・Push送信 |
| `autoAssignCase` | Firestoreトリガー | 担当者自動割り当て |
| `respondCase` | Callable | 対応開始 |
| `completeCase` | Callable | 対応完了 |
| `declineCase` | Callable | 対応不可・引き継ぎ |
| `createMember` | Callable | メンバー追加（Admin SDK） |
| `deleteMember` | Callable | メンバー削除 |
| `registerFCMToken` | Callable | Push通知トークン登録 |
| `initTenant` | Callable | テナント初期作成 |

## 注意事項

- iOSでPush通知を受け取るにはPWAとしてホーム画面に追加が必要
- Cloud FunctionsはBlazeプラン（従量課金）が必要
- リージョンは `asia-northeast1`（東京）に統一
- テナントIDは英数字・ハイフンのみ（3〜30文字）
