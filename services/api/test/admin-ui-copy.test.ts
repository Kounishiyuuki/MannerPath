import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminErrorMessage,adminDecisionSummary,adminEvidenceSummary} from '../scripts/admin/ui-copy.js';

test('operator errors explain next steps in Japanese without reflecting arbitrary server content',()=>{
  assert.match(adminErrorMessage(409,'independentEvidenceRequired'),/公式情報源または現地確認/);
  assert.match(adminErrorMessage(400,'evidenceDateOutOfRange'),/受付日から今日まで/);
  assert.match(adminErrorMessage(410,'reportExpired'),/保持期限/);
  assert.match(adminErrorMessage(403,'csrfDenied'),/再読み込み/);
  assert.match(adminErrorMessage(403,'readOnly'),/読み取り専用/);
  assert.match(adminErrorMessage(429,'loginRateLimited'),/1分/);
  assert.match(adminErrorMessage(409,'unknown'),/状態が変わりました/);
  assert.match(adminErrorMessage(401,'unknown'),/ログイン/);
  for(const code of ['arbitrary-sensitive-server-text','__proto__',null,undefined,{toString:null},[]]){
    const message=adminErrorMessage(503,code);
    assert.match(message,/再読み込み/);
    assert.doesNotMatch(message,/arbitrary|__proto__|undefined|null/);
  }
});
test('confirmation uses Japanese state and reason without changing the publication warning',()=>{
  for(const [state,label]of [['accepted','承認'],['needsInfo','保留'],['rejected','却下'],['duplicate','重複として処理']]){
    const text=adminDecisionSummary({reportId:'rp_fixture',state,reason:'insufficientDetail'});
    assert.match(text,new RegExp(`状態：${label}`));assert.match(text,/理由：情報不足/);
    assert.match(text,/公開データは変更しません/);assert.ok(!text.includes(state));
  }
  assert.match(adminDecisionSummary({reportId:'rp_fixture',photoId:'ph_fixture',state:'approved',reason:'privacyRisk'}),/写真 rp_fixture\n状態：写真を承認\n理由：顔・車両番号/);
});

test('independent-check confirmation names basis, date and source, and says nothing is approved',()=>{
  const summary=adminEvidenceSummary({reportId:'rp_01JABCDEFGHJKMNPQRSTVWXYZ0',basis:'officialSource',checkedOn:'2026-11-02',sourceUrl:'https://www.city.example.jp/smoking'});
  assert.match(summary,/公式情報源を確認/);assert.match(summary,/2026-11-02/);assert.match(summary,/https:\/\/www\.city\.example\.jp\/smoking/);
  assert.match(summary,/承認・公開は行いません/);
  assert.match(adminEvidenceSummary({reportId:'rp_01JABCDEFGHJKMNPQRSTVWXYZ0',basis:'<script>',checkedOn:'2026-11-02'}),/確認方法：不明/);
});
