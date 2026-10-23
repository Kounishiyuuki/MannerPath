import { adminErrorMessage } from './ui-copy.js';
const labels = {pending:"審査待ち",accepted:"承認済み",needsInfo:"保留中",rejected:"却下",duplicate:"重複",awaitingPublication:"公開待ち",published:"公開済み",notApproved:"未承認",approved:"承認済み",uploaded:"送信済み",ready:"閲覧可能",expired:"期限切れ",deleted:"削除済み",uploading:"アップロード中",reserved:"未完了",failed:"失敗"};
Object.assign(labels,{
  artifactExported:"artifact 作成済み・公開未照合",discarded:"公開対象外",
  unknown:"不明",yes:"対応あり",no:"対応なし",public:"一般利用可",customerOnly:"店舗利用者のみ",facilityOnly:"施設利用者のみ",ticketedUsersOnly:"乗車券・入場券の保有者のみ",
  indoor:"屋内",outdoor:"屋外",covered:"屋根あり",designatedOutdoorArea:"指定屋外喫煙所",publicSmokingRoom:"公衆喫煙室",facilitySmokingRoom:"施設内喫煙室",ashtray:"灰皿",smokingPermittedVenue:"喫煙可能な店舗・施設",smokingCorner:"喫煙コーナー",tobaccoShopSmokingSpace:"たばこ店の喫煙スペース",
  municipality:"自治体施設",station:"駅",airport:"空港",commercialBuilding:"商業施設",convenienceStore:"コンビニエンスストア",tobaccoShop:"たばこ店",restaurantOrCafe:"飲食店・カフェ",other:"その他",
  exists:"存在の確認",missing:"新しい地点の提案",moved:"位置の修正",hoursChanged:"利用時間の修正",tobaccoTypeChanged:"対応たばこの修正",accessChanged:"利用条件の修正",prohibited:"喫煙禁止の報告",typeChanged:"種類の修正",removed:"撤去の報告",notFound:"見つからない",wrongType:"種類の相違",deleting:"削除処理中"
});
const reasons = {confirmed:"確認できた",contradictedBySource:"根拠と矛盾",insufficientDetail:"情報不足",duplicateOfExistingReport:"既存投稿と重複",outOfScope:"対象外",abuse:"不適切な投稿",unspecified:"その他（未指定）",usableEvidence:"審査資料として利用可能",privacyRisk:"顔・車両番号などのプライバシーリスク",unrelated:"無関係",unsafeContent:"不適切な写真"};
const statuses = ["pending","accepted","needsInfo","rejected","duplicate","awaitingPublication","published"];
let session, status="pending", selected, detail, cursor, busy=false, requestEpoch=0, queueEpoch=0, photoUrls=[], photoTimers=[], sessionTimer, publicationVerified=false;
const $=id=>document.getElementById(id);
function el(tag, text, cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;}
function human(value){return value===null||value===undefined||value===""?"不明・記載なし":labels[value]||String(value);}
function time(value){if(!value)return "不明";const d=new Date(value);return Number.isNaN(d.valueOf())?"不明":d.toLocaleString("ja-JP");}
function message(value){$("message").textContent=value;}
async function api(path, body){let r;try{r=await fetch(path,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",headers:body?{"Content-Type":"application/json","X-CSRF-Token":session?.csrfToken||""}:{},...(body?{body:JSON.stringify(body)}:{})});}catch{throw new Error("管理画面に接続できません。起動したターミナルと接続先を確認してください。");}let data;try{data=await r.json();}catch{throw new Error("応答を読み取れませんでした。再読み込みして確認してください。");}if(!r.ok){if(r.status===401&&session)expireSession();const error=new Error(adminErrorMessage(r.status,data?.error));error.status=r.status;throw error;}return data;}
function expireSession(){clearTimeout(sessionTimer);session=undefined;detail=undefined;selected=undefined;requestEpoch++;queueEpoch++;releasePhotos();$("queue").replaceChildren();$("statuses").replaceChildren();$("more").hidden=true;if($("confirm").open)$("confirm").close("cancel");showLogin();}
function scheduleSessionExpiry(){
  clearTimeout(sessionTimer);
  if(!session?.expiresAt)return;
  const remaining=Date.parse(session.expiresAt)-Date.now();
  if(!Number.isFinite(remaining)||remaining<=0){expireSession();return;}
  sessionTimer=setTimeout(scheduleSessionExpiry,Math.min(remaining,2147483647));
}
function releasePhotos(){photoUrls.forEach(URL.revokeObjectURL);photoUrls=[];photoTimers.forEach(clearTimeout);photoTimers=[];}
function actionButton(text, handler, cls){const b=el("button",text,cls);b.type="button";b.disabled=busy||session?.readOnly;b.addEventListener("click",handler);return b;}
function setBusy(value){busy=value;document.querySelectorAll("[data-write]").forEach(n=>{n.disabled=value||session?.readOnly||n.dataset.blocked==="true";});refreshApprovalEligibility();refreshNextNavigation();$("reload").disabled=value;$("confirm-save").disabled=value;}
function photoAvailable(photo){return photo.previewAvailable&&Number.isFinite(Date.parse(photo.view_until))&&Date.parse(photo.view_until)>Date.now();}
function requiresApprovedPhoto(){return detail?.report.report_type==="missing"&&!(detail.photos||[]).some(p=>photoAvailable(p)&&p.moderation_status==="approved");}
function refreshApprovalEligibility(){const button=document.querySelector("[data-report-accept]");if(button){button.dataset.blocked=String(requiresApprovedPhoto());button.disabled=busy||session?.readOnly||requiresApprovedPhoto();}const hint=$("approval-photo-hint");if(hint)hint.hidden=!requiresApprovedPhoto();}
function picker(keys,caption="審査理由"){const s=el("select");keys.forEach(key=>{const o=el("option",reasons[key]||key);o.value=key;s.append(o);});s.setAttribute("aria-label",caption);s.dataset.write="true";s.disabled=session.readOnly;return s;}
function drawStatuses(counts={}){$("statuses").replaceChildren();statuses.forEach(key=>{const b=el("button",labels[key]);b.type="button";b.setAttribute("aria-pressed",String(status===key));b.append(el("span",key==="published"&&!publicationVerified?"未照合":counts[key]??"—","count"));b.addEventListener("click",()=>{if(busy)return;status=key;loadQueue();});$("statuses").append(b);});}
async function loadQueue(append=false){
  const epoch=++queueEpoch;
  message("読み込み中…");$("more").disabled=true;
  try{
    const page=await api(`/api/reports?status=${encodeURIComponent(status)}${append&&cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
    if(epoch!==queueEpoch)return;
    publicationVerified=page.publicationVerified===true;
    drawStatuses(page.counts);if(!append)$("queue").replaceChildren();
    for(const report of page.items){
      const b=el("button",undefined,"queue-item");b.type="button";b.dataset.reportId=report.report_id;b.setAttribute("aria-current",String(selected===report.report_id));
      b.append(el("small",time(report.received_at)),el("strong",report.claim_host_name||human(report.claim_spot_type)),el("span",human(report.state),"pill"),el("small",human(report.report_type)));
      b.addEventListener("click",()=>{if(!busy)loadDetail(report.report_id);});$("queue").append(b);
    }
    if(!$("queue").children.length)$("queue").append(el("p",status==="published"&&!publicationVerified?"この接続では公開済みを照合できません。artifact export は公開の証明ではありません。":"該当する投稿はありません。","empty"));
    cursor=page.nextCursor;$("more").hidden=!cursor;refreshNextNavigation();message("");
  }catch(e){if(epoch===queueEpoch)message(e.message);}
  finally{if(epoch===queueEpoch)$("more").disabled=false;}
}
async function loadDetail(id){const epoch=++requestEpoch;selected=id;releasePhotos();$("detail").replaceChildren(el("p","投稿を読み込み中…","empty"));document.querySelectorAll(".queue-item").forEach(n=>n.setAttribute("aria-current",String(n.dataset.reportId===id)));try{const result=await api(`/api/reports/${encodeURIComponent(id)}`);if(epoch!==requestEpoch)return;detail=result;renderDetail();}catch(e){if(epoch===requestEpoch){$("detail").replaceChildren(el("p",e.message,"empty"));message(e.message);}}}
function panel(title,cls=""){const p=el("section",undefined,`panel ${cls}`);p.append(el("h3",title));return p;}
function externalMapControl(container, schematic, lat, lon){
  const label=el("label",undefined,"map-consent");
  const consent=el("input");consent.type="checkbox";
  label.append(consent,document.createTextNode(" 外部地図に提案位置を送信することを確認しました"));
  const button=el("button","地図をこの画面で表示");button.type="button";button.disabled=true;
  consent.addEventListener("change",()=>{button.disabled=!consent.checked;});
  button.addEventListener("click",()=>{
    if(!consent.checked)return;
    const frame=el("iframe");frame.className="map external-map";
    frame.title="提案位置の地図";frame.referrerPolicy="no-referrer";
    frame.setAttribute("sandbox","allow-scripts allow-same-origin");
    const west=Math.max(-180,lon-.006),east=Math.min(180,lon+.006),south=Math.max(-90,lat-.004),north=Math.min(90,lat+.004);
    const query=new URLSearchParams({bbox:[west,south,east,north].join(","),layer:"mapnik",marker:`${lat},${lon}`});
    frame.src=`https://www.openstreetmap.org/export/embed.html?${query}`;
    schematic.replaceWith(frame);button.remove();label.remove();
  });
  container.append(label,button);
}
function mapPanel(report,duplicates){
  const p=panel("提案位置と重複候補");
  const lat=report.proposed_latitude,lon=report.proposed_longitude;
  if(!Number.isFinite(lat)||!Number.isFinite(lon)){p.append(el("p","提案座標はありません。","muted"));return p;}
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 360 240");svg.setAttribute("role","img");svg.setAttribute("aria-label","提案位置を中心とした座標概略図。背景地図ではありません。");svg.classList.add("map");
  const make=(name,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,name);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));if(text)n.textContent=text;svg.append(n);};
  for(let x=30;x<=330;x+=50)make("line",{x1:x,y1:25,x2:x,y2:215,stroke:"#d7e3da"});
  for(let y=40;y<=200;y+=40)make("line",{x1:20,y1:y,x2:340,y2:y,stroke:"#d7e3da"});
  make("text",{x:170,y:17},"北 ↑");
  const valid=duplicates.filter(d=>Number.isFinite(d.latitude??d.proposed_latitude)&&Number.isFinite(d.longitude??d.proposed_longitude));
  const span=Math.max(.004,...valid.map(d=>Math.max(Math.abs((d.latitude??d.proposed_latitude)-lat),Math.abs((d.longitude??d.proposed_longitude)-lon))))*1.2;
  valid.forEach((d,i)=>{const x=180+((d.longitude??d.proposed_longitude)-lon)/span*135,y=120-((d.latitude??d.proposed_latitude)-lat)/span*85;make("circle",{cx:x,cy:y,r:6,fill:"#c58c40"});make("text",{x:x+8,y:y+4},String(i+1));});
  make("circle",{cx:180,cy:120,r:9,fill:"#176b58",stroke:"white","stroke-width":3});make("text",{x:193,y:124},"提案位置");
  p.append(svg,el("p",`緯度 ${lat.toFixed(6)} / 経度 ${lon.toFixed(6)}`,"coords"),el("p","初期表示は座標の概略図です。地図を表示すると位置・IPアドレスが OpenStreetMap に送信されます。","muted"));
  externalMapControl(p,svg,lat,lon);
  if(duplicates.length){const list=el("ol");duplicates.forEach(d=>list.append(el("li",`${d.name||d.claim_host_name||d.report_id||d.spot_id||"名称不明"}${d.distanceMeters!==undefined?`（約 ${Math.round(d.distanceMeters)} m）`:""}`)));p.append(list);}
  else p.append(el("p","重複候補なし、または未照合。重複がないことの証明ではありません。","muted"));
  return p;
}
function nextQueueItem(){const rows=[...document.querySelectorAll(".queue-item")], index=rows.findIndex(n=>n.dataset.reportId===selected);return index<0?undefined:rows[index+1];}
function refreshNextNavigation(){const next=$("next-report");if(next)next.disabled=busy||!nextQueueItem();}
function disclosure(title,...content){const box=el("details",undefined,"panel");box.append(el("summary",title),...content);return box;}
function renderDetail(){
  const r=detail.report, root=$("detail");root.replaceChildren();
  const head=el("div",undefined,"detail-head"), title=el("div");
  const heading=el("h2",r.claim_host_name||"投稿詳細");heading.tabIndex=-1;heading.id="detail-title";
  title.append(el("p",`${human(r.state)} · ${time(r.received_at)}`,"muted"),heading,el("p",`${human(r.report_type)} ／ ${human(r.claim_spot_type)} ／ ${human(r.claim_access_type)}`));
  head.append(title,el("span",human(detail.publicationState),"pill"));root.append(head);
  const navigation=el("div",undefined,"actions detail-navigation");
  const back=el("button","投稿一覧へ");back.type="button";back.addEventListener("click",()=>document.querySelector('.queue-item[aria-current=true]')?.focus());
  const next=el("button","次の投稿へ");next.type="button";
  next.id="next-report";next.disabled=!nextQueueItem();next.addEventListener("click",async()=>{const target=nextQueueItem();if(busy||!target)return;await loadDetail(target.dataset.reportId);$("detail-title")?.focus();});navigation.append(back,next);root.append(navigation);
  const step1=el("section",undefined,"review-step");step1.setAttribute("aria-label","STEP 1 写真の確認");
  step1.append(el("p","STEP 1","step-label"),el("h2","写真の確認"),el("p","写真の内容とプライバシーを確認します。写真の承認だけでは投稿は承認・公開されません。","step-description"),photosPanel());
  const step2=el("section",undefined,"review-step");step2.setAttribute("aria-label","STEP 2 喫煙所情報の確認");
  step2.append(el("p","STEP 2","step-label"),el("h2","喫煙所情報の確認"),el("p","位置・利用条件・投稿内容と重複候補を確認して、投稿の審査結果を保存します。","step-description"));
  const evidence=el("div",undefined,"evidence");
  const facts=panel("利用条件・投稿内容");const dl=el("dl");[["投稿種別",r.report_type],["喫煙所の種類",r.claim_spot_type],["詳細分類",r.claim_spot_subtype],["利用条件",r.claim_access_type],["条件の詳細",r.claim_access_detail],["施設種別",r.claim_host_type],["屋内・屋外",r.claim_environment],["紙巻きたばこ",r.claim_supports_paper],["加熱式たばこ",r.claim_supports_heated],["利用時間",r.claim_hours_note],["観察日",r.observed_on]].forEach(([k,v])=>dl.append(el("dt",k),el("dd",human(v))));facts.append(dl,el("h3","投稿者の説明（非公開）"),el("p",r.note||"記載なし","note"));
  evidence.append(mapPanel(r,detail.duplicates||[]),facts);step2.append(evidence,reviewPanel());root.append(step1,step2);
  root.append(disclosure("投稿ID・技術情報",el("p",r.report_id,"code")),disclosure("審査履歴",historyPanel()),disclosure("承認後の掲載フロー",el("p","承認だけでは一般公開されません。既存CLIでレビュー・sanitized artifact の作成・品質検証を行い、別の明示操作で promotion します。この画面から公開データへの書き込みはできません。")));
  refreshApprovalEligibility();
}
function photosPanel(){
  const p=panel("非公開写真・撮影情報"), photos=detail.photos||[];
  if(!photos.length){p.append(el("p","添付写真は0枚です。未送信・失敗・削除のいずれかは、この記録だけでは判別できません。","muted"));return p;}
  photos.slice(0,3).forEach((photo,i)=>{
    const card=el("div",undefined,"photo"), header=el("header");
    const uploadIncomplete=photo.lifecycle==="uploading"&&Date.parse(photo.upload_expires_at)<=Date.now();
    const lifecycleLabel=photo.lifecycle==="uploading"?(uploadIncomplete?"アップロード未完了（送信期限切れ）":"アップロード中／完了未確認"):human(photo.lifecycle);
    header.append(el("strong",`写真 ${i+1}`),el("span",`${lifecycleLabel} / ${human(photo.moderation_status)}`,"pill"));card.append(header);
    const expired=Number.isFinite(Date.parse(photo.view_until))&&Date.parse(photo.view_until)<=Date.now();
    if(photoAvailable(photo)){const img=el("img");img.alt=`投稿写真 ${i+1}：審査対象`;card.append(img);fetchPhoto(photo.photo_id,img,requestEpoch,photo.view_until);}
    else card.append(el("p",expired?"閲覧・審査期限を過ぎ、削除開始の対象です。写真は表示しません。":photo.moderation_status==="rejected"?"この写真は却下済みで、閲覧・審査の対象外です。":photo.lifecycle==="deleting"||photo.lifecycle==="deleted"?"削除処理中または削除済みのため表示できません。":photo.lifecycle==="uploading"?(uploadIncomplete?"アップロード未完了（送信期限切れ）。保存完了が確認できないため写真を表示できません。":"アップロード中／完了未確認。保存完了後に再読み込みしてください。"):"写真は閲覧対象外です。状態を再読み込みしてください。","muted"));
    card.append(el("p",`閲覧・審査期限（削除開始）：${time(photo.view_until)}`,"muted"),el("p",`保持上限：${time(photo.delete_after)}`,"muted"));
    if(photoAvailable(photo)&&photo.moderation_status==="pending"){
      const reason=picker(["usableEvidence","privacyRisk","unrelated","unsafeContent","insufficientDetail"],`写真 ${i+1} の審査理由`);
      const privacy=el("input");privacy.type="checkbox";privacy.disabled=session.readOnly;
      const label=el("label");label.append(privacy,document.createTextNode(" 顔・車両番号などのプライバシーリスクを確認しました。"));
      const reasonLabel=el("label","写真の審査理由");reasonLabel.append(reason);card.append(reasonLabel,label);
      const actions=el("div",undefined,"actions");
      [["写真を承認","approved"],["写真を却下","rejected"]].forEach(([name,state])=>{
        const b=actionButton(name,()=>{if(state==="approved"&&!privacy.checked){message("写真の承認前にプライバシー確認欄をチェックしてください。");return;}decide(state,reason.value,photo.photo_id,privacy.checked);},state==="rejected"?"danger":"");
        if(state==="approved"){b.dataset.photoApprove="true";b.dataset.blocked="true";b.disabled=true;}b.dataset.write="true";actions.append(b);
      });card.append(actions);
    }p.append(card);
  });return p;
}
async function fetchPhoto(id,img,epoch,viewUntil){
  try{
    const r=await fetch(`/api/photos/${encodeURIComponent(id)}`,{credentials:"same-origin",cache:"no-store"});if(r.status===401&&session)expireSession();if(!r.ok)throw new Error();
    const blob=await r.blob();if(epoch!==requestEpoch)return;
    const remaining=Date.parse(viewUntil)-Date.now();
    if(blob.type!=="image/png"||!Number.isFinite(remaining)||remaining<=0)throw new Error();
    const url=URL.createObjectURL(blob);photoUrls.push(url);
    img.addEventListener("load",()=>{
      if(epoch!==requestEpoch||Date.parse(viewUntil)<=Date.now())return;
      const approve=img.closest(".photo")?.querySelector("[data-photo-approve]");
      if(approve){approve.dataset.blocked="false";approve.disabled=busy||session?.readOnly;}
    },{once:true});
    img.addEventListener("error",()=>{URL.revokeObjectURL(url);},{once:true});
    img.src=url;
    const expire=()=>{
      const left=Date.parse(viewUntil)-Date.now();
      if(left>0){photoTimers.push(setTimeout(expire,Math.min(left,2147483647)));return;}
      URL.revokeObjectURL(url);photoUrls=photoUrls.filter(u=>u!==url);
      img.closest(".photo")?.querySelectorAll("[data-write]").forEach(n=>{n.dataset.blocked="true";n.disabled=true;});
      img.replaceWith(el("p","閲覧・審査期限となり、削除開始の対象のため写真を非表示にしました。","muted"));refreshApprovalEligibility();
    };
    photoTimers.push(setTimeout(expire,Math.min(remaining,2147483647)));
  }catch{if(epoch===requestEpoch)img.replaceWith(el("p","写真を取得できませんでした。期限・削除状態を再確認してください。","muted"));}
}
function reviewPanel(){const p=panel("投稿の審査","review");const reason=picker(["confirmed","insufficientDetail","contradictedBySource","duplicateOfExistingReport","outOfScope","abuse","unspecified"],"投稿の審査理由");const reasonLabel=el("label","投稿の審査理由");reasonLabel.append(reason);p.append(reasonLabel);const label=el("label");const check=el("input");check.type="checkbox";check.id="privacy-check";label.append(check,document.createTextNode(" 写真内の顔・ナンバープレート、利用条件・喫煙許可を確認しました。"));p.append(label,el("p","灰皿の存在だけでは喫煙許可の根拠になりません。写真なしの新規投稿を自動承認しません。","muted"));const actions=el("div",undefined,"actions");[["承認","accepted","primary"],["保留","needsInfo",""],["却下","rejected","danger"],["重複として処理","duplicate",""]].forEach(([name,state,cls])=>{const b=actionButton(name,()=>{if(state==="needsInfo"&&reason.value==="confirmed")reason.value="insufficientDetail";decide(state,state==="duplicate"?"duplicateOfExistingReport":reason.value,undefined,check.checked);},cls);b.dataset.write="true";if(state==="accepted"){b.dataset.reportAccept="true";b.dataset.blocked=String(requiresApprovedPhoto());b.disabled=busy||session.readOnly||requiresApprovedPhoto();}actions.append(b);});const hint=el("p","新規地点の承認には、閲覧・審査期限内の承認済み写真が1枚以上必要です。写真が未審査の場合は先に写真を審査してください。","muted");hint.id="approval-photo-hint";hint.hidden=!requiresApprovedPhoto();p.append(actions,hint);if(session.readOnly)p.append(el("p","現在は読み取り専用です。","muted"));return p;}
function historyPanel(){const p=panel("審査履歴");const list=el("ol",undefined,"history");for(const h of detail.history||[]){list.append(el("li",`${time(h.decided_at||h.created_at||h.at)} · ${h.photo_id?`写真 ${h.photo_id}`:"投稿"} · ${human(h.state||h.to_state||h.moderation_status)} · ${reasons[h.reason||h.decision_reason]||human(h.reason||h.decision_reason)} · ${h.decided_by||h.actor||"操作者不明"}`));}p.append(list.children.length?list:el("p","審査履歴はありません。","muted"));return p;}
async function decide(state,reason,photoId,privacyChecked=false){if(busy)return;if(state==="accepted"&&!privacyChecked){message("承認前にプライバシーと喫煙許可の確認欄をチェックしてください。");return;}const payload={reportId:selected,...(photoId?{photoId}:{}),state,reason,expectedVersion:detail.version,operationId:crypto.randomUUID(),privacyChecked};setBusy(true);try{const prepared=await api("/api/confirm",payload);$("confirm-summary").textContent=typeof prepared.summary==="string"?prepared.summary:JSON.stringify(prepared.summary,null,2);$("confirm-save").disabled=false;const dlg=$("confirm");const result=new Promise(resolve=>dlg.addEventListener("close",()=>resolve(dlg.returnValue),{once:true}));dlg.returnValue="cancel";dlg.showModal();if(await result!=="save")return;$("confirm-save").disabled=true;await api("/api/decide",{...payload,confirmationToken:prepared.confirmationToken});await loadQueue();await loadDetail(selected);message("審査結果を保存しました。公開データは変更していません。");}catch(e){message(e.message);}finally{setBusy(false);}}
async function start(){try{session=await api("/api/session");scheduleSessionExpiry();if(!session)return;$("mode").textContent=`${session.mode} · ${session.readOnly?"読み取り専用":"審査操作可"} · ${session.actor}`;if(session.publicationNotice)$("notice").textContent=session.publicationNotice;await loadQueue();}catch(e){if(e.status===401)showLogin();else message(e.message);}}
function showLogin(){const p=panel("運営者の確認");const form=el("form");const label=el("label","起動時に設定したパスフレーズ ");const input=el("input");input.type="password";input.autocomplete="off";input.required=true;input.setAttribute("aria-label","管理画面のパスフレーズ");label.append(input);const button=el("button","接続する","primary");button.type="submit";form.append(label,button);form.addEventListener("submit",async e=>{e.preventDefault();const token=input.value;input.value="";button.disabled=true;try{await api("/session",{token});p.remove();await start();}catch{message("認証できませんでした。パスフレーズを確認してください。");}finally{button.disabled=false;}});p.append(form,el("p","パスフレーズは保存しません。この画面はローカル端末専用です。","muted"));$("detail").replaceChildren(p);$("mode").textContent="未認証";}
$("reload").addEventListener("click",async()=>{if(busy)return;if(!session){await start();return;}await loadQueue();if(selected)await loadDetail(selected);});$("more").addEventListener("click",()=>loadQueue(true));window.addEventListener("pagehide",releasePhotos);window.addEventListener("focus",scheduleSessionExpiry);document.addEventListener("visibilitychange",()=>{if(!document.hidden)scheduleSessionExpiry();});start();
