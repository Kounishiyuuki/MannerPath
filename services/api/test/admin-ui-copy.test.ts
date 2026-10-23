import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminErrorMessage,adminDecisionSummary} from '../scripts/admin/ui-copy.js';

test('operator errors explain next steps in Japanese without reflecting arbitrary server content',()=>{
  assert.match(adminErrorMessage(409,'approvedPhotoRequired'),/承認済み写真/);
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
