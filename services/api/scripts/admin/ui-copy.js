// Shared, bounded Japanese copy only; never render arbitrary server error text.
const errors = {
  approvedPhotoRequired: '閲覧・審査期限内の承認済み写真が必要です。写真を確認してから投稿を承認してください。',
  privacyCheckRequired: '承認前にプライバシーと喫煙許可の確認欄をチェックしてください。',
  photoUnavailable: '写真は期限切れ・削除中、または審査対象外です。再読み込みして確認してください。',
  reportExpired: '投稿の保持期限を過ぎたため審査できません。',
  reportNotFound: '投稿が見つかりません。一覧を再読み込みしてください。',
  readOnly: '現在は読み取り専用です。審査結果は保存できません。',
  reconciliationLocked: 'この投稿は掲載準備に進んでいるため変更できません。既存の審査手順で確認してください。',
  confirmationRequired: '操作確認の有効期限が切れたか、確認内容が一致しません。再読み込みして操作をやり直してください。',
  csrfDenied: '安全確認に失敗しました。画面を再読み込みし、必要ならログインし直してください。',
  originDenied: 'この接続元からは操作できません。起動時に表示されたローカルURLを開いてください。',
  originRequired: '接続元を確認できません。起動時に表示されたローカルURLを開いてください。',
  localOnly: 'この管理画面には同じMacのローカルURLから接続してください。',
  loginRateLimited: '認証の試行回数が多すぎます。1分ほど待ってから再度お試しください。',
  confirmationLimit: '確認待ちの操作が多すぎます。2分ほど待ってから操作をやり直してください。',
  invalidDecision: '審査内容を確認できません。再読み込みして操作をやり直してください。',
  operationUnavailable: '処理を完了できませんでした。接続状態を確認して再読み込みしてください。',
};
export function adminErrorMessage(status, code) {
  if (typeof code === 'string' && Object.hasOwn(errors, code)) return errors[code];
  if (status === 401) return '認証が必要です。再読み込みしてログインしてください。';
  if (status === 409) return '別の操作で状態が変わりました。再読み込みして確認してください。';
  if (status === 429) return '操作が集中しています。しばらく待ってから再度お試しください。';
  return '操作を完了できませんでした。画面を再読み込みして確認してください。';
}
const states = {accepted:'承認',needsInfo:'保留',rejected:'却下',duplicate:'重複として処理',approved:'写真を承認'};
const reasons = {confirmed:'確認できた',contradictedBySource:'根拠と矛盾',insufficientDetail:'情報不足',duplicateOfExistingReport:'既存投稿と重複',outOfScope:'対象外',abuse:'不適切な投稿',unspecified:'その他（未指定）',usableEvidence:'審査資料として利用可能',privacyRisk:'顔・車両番号などのプライバシーリスク',unrelated:'無関係',unsafeContent:'不適切な写真'};
export function adminDecisionSummary(payload) {
  return `${payload.photoId ? '写真' : '投稿'} ${payload.reportId}\n状態：${Object.hasOwn(states,payload.state) ? states[payload.state] : '不明'}\n理由：${Object.hasOwn(reasons,payload.reason) ? reasons[payload.reason] : '不明'}\n公開データは変更しません。`;
}
