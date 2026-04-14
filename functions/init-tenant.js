/**
 * テナント初期データ作成スクリプト（Firestore REST API 使用）
 * 実行: node functions/init-tenant.js
 */
const https = require('https');
const fs    = require('fs');

const TOKEN   = JSON.parse(fs.readFileSync('C:/Users/ysugimoto/.config/configstore/firebase-tools.json')).tokens.access_token;
const PROJECT = 'kouki-e7805';
const BASE    = `projects/${PROJECT}/databases/(default)/documents`;
const HOST    = 'firestore.googleapis.com';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: HOST, path: `/v1/${path}`,
      method, headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function strVal(v)  { return { stringValue:    v }; }
function boolVal(v) { return { booleanValue:   v }; }
function numVal(v)  { return { integerValue:   String(v) }; }
function tsVal(v)   { return { timestampValue: v instanceof Date ? v.toISOString() : v }; }
function nullVal()  { return { nullValue:       'NULL_VALUE' }; }

async function patchDoc(docPath, fields) {
  const result = await request('PATCH', `${BASE}/${docPath}`, { fields });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.name;
}

async function addDoc(colPath, fields) {
  const result = await request('POST', `${BASE}/${colPath}`, { fields });
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.name;
}

async function main() {
  const tenantId    = 'miyama';
  const uid         = 'AET0QHnWYrfc8HrjeiQBmwt0luo1';
  const email       = 'motsu922@icloud.com';
  const now         = new Date();
  const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // ① テナントドキュメント
  await patchDoc(`tenants/${tenantId}`, {
    name:        strVal('ミヤマユニテック'),
    plan:        strVal('trial'),
    trialEndsAt: tsVal(trialEndsAt),
    createdAt:   tsVal(now),
    createdBy:   strVal(uid),
  });
  console.log(`✅ tenants/${tenantId} 作成完了`);

  // ② 管理者ユーザー
  await patchDoc(`tenants/${tenantId}/users/${uid}`, {
    name:      strVal('管理者'),
    email:     strVal(email),
    role:      strVal('admin'),
    enabled:   boolVal(true),
    available: boolVal(true),
    priority:  numVal(50),
    fcmToken:  nullVal(),
    createdAt: tsVal(now),
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
    await addDoc(`tenants/${tenantId}/callTypes`, {
      name:      strVal(ct.name),
      priority:  strVal(ct.priority),
      enabled:   boolVal(true),
      createdAt: tsVal(now),
    });
  }
  console.log(`✅ callTypes（${callTypes.length}件）作成完了`);

  console.log('\n🎉 セットアップ完了！');
  console.log(`👉 https://kouki-e7805.web.app/?tenant=${tenantId}&mode=admin`);
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
