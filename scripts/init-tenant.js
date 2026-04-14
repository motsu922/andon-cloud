/**
 * テナント初期データ作成スクリプト
 * 実行: node scripts/init-tenant.js
 */

const admin = require('../functions/node_modules/firebase-admin');
const { getFirestore, FieldValue } = require('../functions/node_modules/firebase-admin/firestore');

// Application Default Credentials（firebase CLI のログイン情報を使用）
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'kouki-e7805' });
}

const db = getFirestore();

async function main() {
  const tenantId = 'miyama';
  const uid      = 'AET0QHnWYrfc8HrjeiQBmwt0luo1';
  const email    = 'motsu922@icloud.com';

  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // ① テナントドキュメント
  await db.doc(`tenants/${tenantId}`).set({
    name:        'ミヤマユニテック',
    plan:        'trial',
    trialEndsAt,
    createdAt:   FieldValue.serverTimestamp(),
    createdBy:   uid,
  });
  console.log(`✅ tenants/${tenantId} 作成完了`);

  // ② 管理者ユーザードキュメント
  await db.doc(`tenants/${tenantId}/users/${uid}`).set({
    name:      '管理者',
    email,
    role:      'admin',
    enabled:   true,
    available: true,
    priority:  50,
    fcmToken:  null,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`✅ tenants/${tenantId}/users/${uid} 作成完了`);

  // ③ デフォルト呼び出し種別
  const callTypes = [
    { name: '品質確認', priority: 'normal' },
    { name: '設備故障', priority: 'urgent' },
    { name: '材料補充', priority: 'normal' },
    { name: 'その他',   priority: 'normal' },
  ];
  for (const ct of callTypes) {
    await db.collection(`tenants/${tenantId}/callTypes`).add({
      ...ct, enabled: true, createdAt: FieldValue.serverTimestamp()
    });
  }
  console.log(`✅ callTypes（${callTypes.length}件）作成完了`);

  console.log('\n🎉 セットアップ完了！');
  console.log(`👉 https://kouki-e7805.web.app/?tenant=${tenantId}&mode=admin`);
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
