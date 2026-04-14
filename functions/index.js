/**
 * Andon Cloud — Cloud Functions
 * ビジネスロジックをすべてサーバー側に集約
 * HTMLを盗まれても、このコードなしでは動作しない設計
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated }  = require("firebase-functions/v2/firestore");
const { initializeApp }      = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging }       = require("firebase-admin/messaging");
const { getAuth }            = require("firebase-admin/auth");

initializeApp();
const db  = getFirestore();
const fcm = getMessaging();

// =============================================
// ヘルパー関数
// =============================================

/** テナントのメンバーであることを検証 */
async function assertMember(auth, tenantId) {
  if (!auth) throw new HttpsError("unauthenticated", "ログインが必要です");
  const snap = await db.doc(`tenants/${tenantId}/users/${auth.uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "このテナントのメンバーではありません");
  return snap.data();
}

/** テナントの管理者であることを検証 */
async function assertAdmin(auth, tenantId) {
  const user = await assertMember(auth, tenantId);
  if (user.role !== "admin") throw new HttpsError("permission-denied", "管理者権限が必要です");
  return user;
}

/** プランの上限チェック */
async function checkPlanLimit(tenantId, resource) {
  const tenantSnap = await db.doc(`tenants/${tenantId}`).get();
  const plan = tenantSnap.data()?.plan || "trial";

  const limits = {
    trial:    { members: 5,  processes: 3,  callTypes: 3  },
    starter:  { members: 20, processes: 10, callTypes: 10 },
    standard: { members: Infinity, processes: Infinity, callTypes: Infinity },
  };

  const limit = limits[plan]?.[resource] ?? 5;
  const col   = resource === "members" ? "users" : resource;
  const snap  = await db.collection(`tenants/${tenantId}/${col}`).count().get();
  const count = snap.data().count;

  if (count >= limit) {
    throw new HttpsError(
      "resource-exhausted",
      `現在のプラン（${plan}）では${resource}を${limit}件までしか登録できません`
    );
  }
}

// =============================================
// 1. 呼び出し作成
//    HTMLで直接Firestoreに書かず、ここを経由することで
//    バリデーション・プラン制限・Push送信をサーバー側で実行
// =============================================
exports.createCase = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, processId, callTypeName, memo, priority } = req.data;

  // 認証・メンバー確認
  const caller = await assertMember(req.auth, tenantId);

  // 工程の存在確認（改ざん防止）
  const processSnap = await db.doc(`tenants/${tenantId}/processes/${processId}`).get();
  if (!processSnap.exists || processSnap.data().enabled === false) {
    throw new HttpsError("invalid-argument", "無効な工程です");
  }
  const process = processSnap.data();

  // 直近30日の同工程×同種別の再発チェック
  const since30 = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const recentSnap = await db.collection(`tenants/${tenantId}/cases`)
    .where("processId",    "==", processId)
    .where("callTypeName", "==", callTypeName || "呼び出し")
    .where("createdAt",    ">=", since30)
    .get();
  const recurrenceCount30 = recentSnap.size;

  // Firestoreに案件を作成
  const ref = await db.collection(`tenants/${tenantId}/cases`).add({
    status:       "pending",
    priority:     priority || "normal",
    processId,
    processName:  process.name,
    processLine:  process.line || "",
    processIcon:  process.icon || "🏭",
    callTypeName: callTypeName || "呼び出し",
    memo:         memo || "",
    callerUid:        req.auth.uid,
    callerName:       caller.name || req.auth.token?.email || "不明",
    createdAt:        FieldValue.serverTimestamp(),
    assignedTo:       null,
    assignedAt:       null,
    respondedBy:      null,
    respondedAt:      null,
    completedBy:      null,
    completedAt:      null,
    rootCause:        null,
    recurrenceCount30,
    declinedBy:       [],
  });

  // Push通知を全担当者に送信（非同期・失敗してもケース作成は成功扱い）
  sendPushToAllMembers(tenantId, ref.id, process.name, callTypeName).catch(console.error);

  return { caseId: ref.id };
});

// =============================================
// 2. 自動担当者割り当て（Firestoreトリガー）
//    cases/{caseId} が作成されたときに自動実行
//    ラウンドロビン + 連続割り当てペナルティロジック
// =============================================
exports.autoAssignCase = onDocumentCreated(
  { document: "tenants/{tenantId}/cases/{caseId}", region: "asia-northeast1" },
  async (event) => {
    const { tenantId, caseId } = event.params;

    // 対応可能なメンバー取得
    const membersSnap = await db.collection(`tenants/${tenantId}/users`)
      .where("enabled", "==", true)
      .where("available", "==", true)
      .get();

    if (membersSnap.empty) return; // 対応可能者なし

    // 状態取得
    const stateRef  = db.doc(`tenants/${tenantId}/system/assignment_state`);
    const stateSnap = await stateRef.get();
    const state     = stateSnap.exists ? stateSnap.data() : { lastUid: null, streak: 0 };

    const now = Date.now();

    // 優先度順・ペナルティ考慮でソート
    const candidates = membersSnap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(m => !m.penaltyUntilMs || m.penaltyUntilMs < now)
      .sort((a, b) => (a.priority || 50) - (b.priority || 50));

    if (candidates.length === 0) return;

    // ラウンドロビン：前回と同じ人が連続3回なら次の人へ
    let assignee = candidates[0];
    if (state.lastUid && state.streak >= 2) {
      const others = candidates.filter(c => c.uid !== state.lastUid);
      if (others.length > 0) assignee = others[0];
    }

    // 割り当て
    await db.doc(`tenants/${tenantId}/cases/${caseId}`).update({
      assignedTo: assignee.name,
      assignedAt: FieldValue.serverTimestamp(),
    });

    // 状態更新
    await stateRef.set({
      lastUid:   assignee.uid,
      streak:    state.lastUid === assignee.uid ? state.streak + 1 : 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
);

// =============================================
// 3. 対応開始
// =============================================
exports.respondCase = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, caseId } = req.data;
  const member = await assertMember(req.auth, tenantId);

  const ref  = db.doc(`tenants/${tenantId}/cases/${caseId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "案件が見つかりません");
  if (snap.data().status !== "pending") throw new HttpsError("failed-precondition", "対応開始できない状態です");

  await ref.update({
    status:      "inprogress",
    respondedBy: member.name,
    respondedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

// =============================================
// 4. 対応完了
// =============================================
exports.completeCase = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, caseId, content, rootCause } = req.data;
  const member = await assertMember(req.auth, tenantId);

  const ref  = db.doc(`tenants/${tenantId}/cases/${caseId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "案件が見つかりません");

  await ref.update({
    status:           "completed",
    completedBy:      member.name,
    completedContent: content || "",
    rootCause:        rootCause || "other",
    completedAt:      FieldValue.serverTimestamp(),
  });

  return { ok: true };
});

// =============================================
// 5. 対応不可（次の担当者へ）
// =============================================
exports.declineCase = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, caseId } = req.data;
  const member = await assertMember(req.auth, tenantId);

  const caseRef  = db.doc(`tenants/${tenantId}/cases/${caseId}`);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) throw new HttpsError("not-found", "案件が見つかりません");

  const declined = caseSnap.data().declinedBy || [];

  // 次の候補者を検索
  const membersSnap = await db.collection(`tenants/${tenantId}/users`)
    .where("enabled", "==", true)
    .where("available", "==", true)
    .get();

  const nextCandidates = membersSnap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(m => m.name !== member.name && !declined.includes(m.name))
    .sort((a, b) => (a.priority || 50) - (b.priority || 50));

  const nextAssignee = nextCandidates[0] || null;

  await caseRef.update({
    declinedBy: FieldValue.arrayUnion(member.name),
    assignedTo: nextAssignee?.name || null,
    assignedAt: nextAssignee ? FieldValue.serverTimestamp() : null,
  });

  // 次の担当者にPush通知
  if (nextAssignee?.fcmToken) {
    sendPushToToken(
      nextAssignee.fcmToken,
      `🔔 呼び出し：${caseSnap.data().processName}`,
      `${caseSnap.data().callTypeName} — あなたに割り当てられました`
    ).catch(console.error);
  }

  return { nextAssignee: nextAssignee?.name || null };
});

// =============================================
// 6. メンバー作成（管理者専用）
//    HTMLから直接Firebase Authにユーザーを作れないため、
//    Admin SDKを持つFunctions側で実行
// =============================================
exports.createMember = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, name, email, password, role } = req.data;

  // 管理者チェック
  await assertAdmin(req.auth, tenantId);

  // プラン上限チェック
  await checkPlanLimit(tenantId, "members");

  // Firebase Auth にユーザーを作成
  const userRecord = await getAuth().createUser({ email, password, displayName: name });

  // Firestoreにユーザードキュメントを作成
  await db.doc(`tenants/${tenantId}/users/${userRecord.uid}`).set({
    name,
    email,
    role:      role || "member",
    enabled:   true,
    available: true,
    priority:  50,
    fcmToken:  null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { uid: userRecord.uid };
});

// =============================================
// 7. メンバー削除（管理者専用）
// =============================================
exports.deleteMember = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, targetUid } = req.data;
  await assertAdmin(req.auth, tenantId);

  // Auth削除
  await getAuth().deleteUser(targetUid).catch(console.warn);

  // Firestore削除
  await db.doc(`tenants/${tenantId}/users/${targetUid}`).delete();

  return { ok: true };
});

// =============================================
// 8. FCMトークン登録
// =============================================
exports.registerFCMToken = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, token } = req.data;
  await assertMember(req.auth, tenantId);

  await db.doc(`tenants/${tenantId}/users/${req.auth.uid}`).update({ fcmToken: token });
  return { ok: true };
});

// =============================================
// 9. テナント初期作成（管理者がサインアップ後に呼ぶ）
// =============================================
exports.initTenant = onCall({ region: "asia-northeast1" }, async (req) => {
  const { tenantId, tenantName } = req.data;
  if (!req.auth) throw new HttpsError("unauthenticated", "ログインが必要です");

  // テナントIDのバリデーション（英数字・ハイフンのみ）
  if (!/^[a-z0-9-]{3,30}$/.test(tenantId)) {
    throw new HttpsError("invalid-argument", "テナントIDは英数字・ハイフン3〜30文字で入力してください");
  }

  // 重複チェック
  const existing = await db.doc(`tenants/${tenantId}`).get();
  if (existing.exists) throw new HttpsError("already-exists", "このテナントIDはすでに使用されています");

  // テナント作成
  await db.doc(`tenants/${tenantId}`).set({
    name:        tenantName,
    plan:        "trial",
    trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30日後
    createdAt:   FieldValue.serverTimestamp(),
    createdBy:   req.auth.uid,
  });

  // 作成者を管理者として登録
  await db.doc(`tenants/${tenantId}/users/${req.auth.uid}`).set({
    name:      req.auth.token?.name || req.auth.token?.email?.split("@")[0] || "管理者",
    email:     req.auth.token?.email || "",
    role:      "admin",
    enabled:   true,
    available: true,
    priority:  50,
    fcmToken:  null,
    createdAt: FieldValue.serverTimestamp(),
  });

  // デフォルトの呼び出し種別を追加
  const defaultCallTypes = [
    { name: "品質確認", priority: "normal" },
    { name: "設備故障", priority: "urgent" },
    { name: "材料補充", priority: "normal" },
    { name: "その他",   priority: "normal" },
  ];
  for (const ct of defaultCallTypes) {
    await db.collection(`tenants/${tenantId}/callTypes`).add({
      ...ct, enabled: true, createdAt: FieldValue.serverTimestamp()
    });
  }

  return { ok: true, tenantId };
});

// =============================================
// Push通知ヘルパー（内部使用）
// =============================================
async function sendPushToAllMembers(tenantId, caseId, processName, callTypeName) {
  const membersSnap = await db.collection(`tenants/${tenantId}/users`)
    .where("enabled", "==", true)
    .where("available", "==", true)
    .get();

  const tokens = membersSnap.docs
    .map(d => d.data().fcmToken)
    .filter(Boolean);

  if (tokens.length === 0) return;

  const message = {
    notification: {
      title: `🔔 呼び出し：${processName}`,
      body:  callTypeName,
    },
    data: { tenantId, caseId },
    tokens,
  };

  const result = await fcm.sendEachForMulticast(message);

  // 無効なトークンを削除
  result.responses.forEach(async (res, i) => {
    if (!res.success && res.error?.code === "messaging/registration-token-not-registered") {
      const memberDoc = membersSnap.docs[i];
      await memberDoc.ref.update({ fcmToken: null });
    }
  });
}

async function sendPushToToken(token, title, body) {
  await fcm.send({ notification: { title, body }, token });
}
