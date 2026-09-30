#!/usr/bin/env python3
"""Rebuild the nationwide target inventory and bounded historical research seed.
No network, approval decisions or canonical-data writes occur here.
"""
import hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
PREFS='北海道:Hokkaido:札幌:sapporo 青森県:Aomori:青森:aomori 岩手県:Iwate:盛岡:morioka 宮城県:Miyagi:仙台:sendai 秋田県:Akita:秋田:akita 山形県:Yamagata:山形:yamagata 福島県:Fukushima:福島:fukushima 茨城県:Ibaraki:水戸:mito 栃木県:Tochigi:宇都宮:utsunomiya 群馬県:Gunma:前橋:maebashi 埼玉県:Saitama:さいたま:saitama 千葉県:Chiba:千葉:chiba 東京都:Tokyo:新宿:shinjuku 神奈川県:Kanagawa:横浜:yokohama 新潟県:Niigata:新潟:niigata 富山県:Toyama:富山:toyama 石川県:Ishikawa:金沢:kanazawa 福井県:Fukui:福井:fukui 山梨県:Yamanashi:甲府:kofu 長野県:Nagano:長野:nagano 岐阜県:Gifu:岐阜:gifu 静岡県:Shizuoka:静岡:shizuoka 愛知県:Aichi:名古屋:nagoya 三重県:Mie:津:tsu 滋賀県:Shiga:大津:otsu 京都府:Kyoto:京都:kyoto 大阪府:Osaka:大阪:osaka 兵庫県:Hyogo:神戸:kobe 奈良県:Nara:奈良:nara 和歌山県:Wakayama:和歌山:wakayama 鳥取県:Tottori:鳥取:tottori 島根県:Shimane:松江:matsue 岡山県:Okayama:岡山:okayama 広島県:Hiroshima:広島:hiroshima 山口県:Yamaguchi:山口:yamaguchi 徳島県:Tokushima:徳島:tokushima 香川県:Kagawa:高松:takamatsu 愛媛県:Ehime:松山:matsuyama 高知県:Kochi:高知:kochi 福岡県:Fukuoka:福岡:fukuoka 佐賀県:Saga:佐賀:saga 長崎県:Nagasaki:長崎:nagasaki 熊本県:Kumamoto:熊本:kumamoto 大分県:Oita:大分:oita 宮崎県:Miyazaki:宮崎:miyazaki 鹿児島県:Kagoshima:鹿児島:kagoshima 沖縄県:Okinawa:那覇:naha'.split()
CITY_HOSTS={'sapporo':'www.city.sapporo.jp','aomori':'www.city.aomori.aomori.jp','morioka':'www.city.morioka.iwate.jp','fukushima':'www.city.fukushima.fukushima.jp','utsunomiya':'www.city.utsunomiya.lg.jp','yokohama':'www.city.yokohama.lg.jp','toyama':'www.city.toyama.lg.jp','kanazawa':'www4.city.kanazawa.lg.jp','nagano':'www.city.nagano.nagano.jp','shizuoka':'www.city.shizuoka.lg.jp','nagoya':'www.city.nagoya.jp','tsu':'www.info.city.tsu.mie.jp','otsu':'www.city.otsu.lg.jp','kyoto':'www.city.kyoto.lg.jp','osaka':'www.city.osaka.lg.jp','kobe':'www.city.kobe.lg.jp','nara':'www.city.nara.lg.jp','wakayama':'www.city.wakayama.wakayama.jp','tottori':'www.city.tottori.lg.jp','matsue':'www.city.matsue.lg.jp','yamaguchi':'www.city.yamaguchi.lg.jp','tokushima':'www.city.tokushima.tokushima.jp','takamatsu':'www.city.takamatsu.kagawa.jp','matsuyama':'www.city.matsuyama.ehime.jp','kochi':'www.city.kochi.kochi.jp','fukuoka':'www.city.fukuoka.lg.jp','saga':'www.city.saga.lg.jp','nagasaki':'www.city.nagasaki.lg.jp','kumamoto':'www.city.kumamoto.jp','oita':'www.city.oita.oita.jp','miyazaki':'www.city.miyazaki.miyazaki.jp','kagoshima':'www.city.kagoshima.lg.jp','naha':'www.city.naha.okinawa.jp','mito':'www.city.mito.lg.jp','maebashi':'www.city.maebashi.gunma.jp','saitama':'www.city.saitama.lg.jp','chiba':'www.city.chiba.jp','sendai':'www.city.sendai.jp','akita':'www.city.akita.lg.jp','yamagata':'www.city.yamagata-yamagata.lg.jp','niigata':'www.city.niigata.lg.jp','fukui':'www.city.fukui.lg.jp','kofu':'www.city.kofu.yamanashi.jp','gifu':'www.city.gifu.lg.jp','okayama':'www.city.okayama.jp','hiroshima':'www.city.hiroshima.lg.jp'}
targets=[]
def add(id,name,pref,kind,url,roles=()):
 t={'id':id,'name':name,'prefecture':pref,'publisher':name,'kind':kind,'roles':list(roles),'urls':[url],'homepageUrl':url,'catalogs':[],'rawResources':[],'priorResearch':[],'seedStatus':'unscanned','blockerCodes':[]};targets.append(t);return t
# Hosts verified against the official Miyagi prefectural directory (2026-09-30).
PREF_HOSTS={k:'www.pref.'+k+'.jp' for k in 'iwate miyagi yamagata ibaraki gunma kanagawa toyama yamanashi shizuoka aichi kyoto nara okayama ehime nagasaki kumamoto oita kagoshima okinawa'.split()}
PREF_HOSTS['hyogo']='web.pref.hyogo.lg.jp'
for p in PREFS:
 jp,en,cap,slug=p.split(':'); host=PREF_HOSTS.get(en.lower(),'www.pref.'+en.lower()+'.lg.jp')
 if en=='Hokkaido':host='www.pref.hokkaido.lg.jp'
 if en=='Tokyo':host='www.metro.tokyo.lg.jp'
 add('pref-'+en.lower(),jp,jp,'prefecture','https://'+host+'/',['prefecture'])
 if slug!='shinjuku':add('city-'+slug,cap+'市',jp,'municipality','https://'+CITY_HOSTS[slug]+'/', ['prefecturalCapital'])
ordinance={'sapporo':'北海道','sendai':'宮城県','saitama':'埼玉県','chiba':'千葉県','yokohama':'神奈川県','kawasaki':'神奈川県','sagamihara':'神奈川県','niigata':'新潟県','shizuoka':'静岡県','hamamatsu':'静岡県','nagoya':'愛知県','kyoto':'京都府','osaka':'大阪府','sakai':'大阪府','kobe':'兵庫県','okayama':'岡山県','hiroshima':'広島県','kitakyushu':'福岡県','fukuoka':'福岡県','kumamoto':'熊本県'}
extra={'kawasaki':('川崎','www.city.kawasaki.jp'),'sagamihara':('相模原','www.city.sagamihara.kanagawa.jp'),'hamamatsu':('浜松','www.city.hamamatsu.shizuoka.jp'),'sakai':('堺','www.city.sakai.lg.jp'),'kitakyushu':('北九州','www.city.kitakyushu.lg.jp')}
for slug,pref in ordinance.items():
 t=next((t for t in targets if t['id']=='city-'+slug),None)
 if not t:name,host=extra[slug];t=add('city-'+slug,name+'市',pref,'municipality','https://'+host+'/')
 t['roles'].append('ordinanceDesignatedCity')
wards='千代田:chiyoda 中央:chuo 港:minato 新宿:shinjuku 文京:bunkyo 台東:taito 墨田:sumida 江東:koto 品川:shinagawa 目黒:meguro 大田:ota 世田谷:setagaya 渋谷:shibuya 中野:nakano 杉並:suginami 豊島:toshima 北:kita 荒川:arakawa 板橋:itabashi 練馬:nerima 足立:adachi 葛飾:katsushika 江戸川:edogawa'.split()
for w in wards:
 name,slug=w.split(':');host='www.city.'+slug+'.'+('tokyo.jp' if slug in ['minato','shinagawa','meguro','shibuya','arakawa','adachi','katsushika','edogawa','setagaya','ota','nerima'] else 'lg.jp')
 if slug=='nakano':host='www.city.tokyo-nakano.lg.jp'
 add('ward-'+slug,name+'区','東京都','municipality','https://'+host+'/', ['tokyoWard']+(['prefecturalCapital'] if slug=='shinjuku' else []))
operators=[('jr-hokkaido','JR北海道','北海道','railway','www.jrhokkaido.co.jp'),('jr-east','JR東日本',None,'railway','www.jreast.co.jp'),('jr-central','JR東海',None,'railway','jr-central.co.jp'),('jr-west','JR西日本',None,'railway','www.westjr.co.jp'),('jr-shikoku','JR四国',None,'railway','www.jr-shikoku.co.jp'),('jr-kyushu','JR九州',None,'railway','www.jrkyushu.co.jp'),('tobu','東武鉄道',None,'railway','www.tobu.co.jp'),('seibu','西武鉄道',None,'railway','www.seiburailway.jp'),('keisei','京成電鉄',None,'railway','www.keisei.co.jp'),('keio','京王電鉄',None,'railway','www.keio.co.jp'),('odakyu','小田急電鉄',None,'railway','www.odakyu.jp'),('tokyu','東急電鉄',None,'railway','www.tokyu.co.jp'),('keikyu','京急電鉄',None,'railway','www.keikyu.co.jp'),('sotetsu','相模鉄道','神奈川県','railway','www.sotetsu.co.jp'),('meitetsu','名古屋鉄道',None,'railway','www.meitetsu.co.jp'),('kintetsu','近畿日本鉄道',None,'railway','www.kintetsu.co.jp'),('nankai','南海電鉄',None,'railway','www.nankai.co.jp'),('keihan','京阪電気鉄道',None,'railway','www.keihan.co.jp'),('hankyu','阪急電鉄',None,'railway','www.hankyu.co.jp'),('hanshin','阪神電気鉄道',None,'railway','www.hanshin.co.jp'),('nishitetsu','西日本鉄道','福岡県','railway','www.nishitetsu.jp'),('tokyo-metro','東京メトロ','東京都','subway','www.tokyometro.jp'),('toei','東京都交通局','東京都','subway','www.kotsu.metro.tokyo.jp'),('sapporo-subway','札幌市交通局','北海道','subway','www.city.sapporo.jp/st'),('sendai-subway','仙台市交通局','宮城県','subway','www.kotsu.city.sendai.jp'),('yokohama-subway','横浜市交通局','神奈川県','subway','www.city.yokohama.lg.jp/kotsu'),('nagoya-subway','名古屋市交通局','愛知県','subway','www.kotsu.city.nagoya.jp'),('kyoto-subway','京都市交通局','京都府','subway','www.city.kyoto.lg.jp/kotsu'),('osaka-metro','大阪メトロ','大阪府','subway','www.osakametro.co.jp'),('kobe-subway','神戸市交通局','兵庫県','subway','www.city.kobe.lg.jp/a80062'),('fukuoka-subway','福岡市交通局','福岡県','subway','subway.city.fukuoka.lg.jp'),('haneda','日本空港ビルデング（羽田空港）','東京都','airportTerminal','tokyo-haneda.com'),('narita','成田国際空港株式会社','千葉県','airport','www.narita-airport.jp'),('kansai-airports','関西エアポート',None,'airport','www.kansai-airports.co.jp'),('centrair','中部国際空港株式会社','愛知県','airport','www.centrair.jp'),('hokkaido-airports','北海道エアポート','北海道','airport','www.hokkaido-airports.com'),('sendai-airport','仙台国際空港株式会社','宮城県','airport','www.sendai-airport.co.jp'),('fukuoka-airport','福岡国際空港株式会社','福岡県','airport','www.fukuoka-airport.jp'),('naha-airport','那覇空港ビルディング','沖縄県','airportTerminal','www.naha-airport.co.jp'),('jr-east-building','JR東日本ビルディング',None,'stationFacility','www.jebl.co.jp'),('jr-central-building','JR東海ビルディング',None,'stationFacility','www.jrtb.co.jp'),('jr-west-station-city','大阪ステーションシティ','大阪府','stationFacility','osakastationcity.com'),('atre','アトレ',None,'stationFacility','www.atre.co.jp'),('lumine','ルミネ',None,'stationFacility','www.lumine.ne.jp')]
for id,name,pref,lane,host in operators:add('operator-'+id,name,pref,'operator','https://'+host+'/',[lane])
for id,name,pref,host in [('niigata-airport','新潟空港','新潟県','www.niigata-airport.gr.jp'),('shizuoka-airport','富士山静岡空港','静岡県','www.mtfuji-shizuokaairport.jp'),('aomori-airport','青森空港','青森県','www.aomori-airport.co.jp'),('tokyo-big-sight','東京ビッグサイト','東京都','www.bigsight.jp'),('makuhari-messe','幕張メッセ','千葉県','www.m-messe.co.jp'),('pacifico-yokohama','パシフィコ横浜','神奈川県','www.pacifico.co.jp')]:add('operator-'+id,name,pref,'operator','https://'+host+'/', ['airport' if 'airport' in id else 'facilityOperator'])
add('national-mlit-indoor','国土交通省 屋内地理空間情報',None,'national','https://www.geospatial.jp/ckan/dataset/mlit-indoor-shinjuku-r2')
add('city-musashino','武蔵野市','東京都','municipality','https://www.city.musashino.lg.jp/')
# Publisher-delegated portals established in prior research; no approval inferred.
portals={'city-sapporo':('ckan','https://ckan.pf-sapporo.jp/api/3/action/package_search'),'city-utsunomiya':('ckan','https://catalog.city.utsunomiya.tochigi.jp/api/3/action/package_search'),'city-toyama':('ckan','https://opdt.city.toyama.lg.jp/api/3/action/package_search'),'city-kofu':('ckan','https://catalog.dataplatform-yamanashi.jp/api/3/action/package_search'),'pref-gifu':('ckan','https://gifu-opendata.pref.gifu.lg.jp/api/3/action/package_search'),'city-gifu':('ckan','https://gifu-opendata.pref.gifu.lg.jp/api/3/action/package_search'),'pref-tokyo':('ckan','https://catalog.data.metro.tokyo.lg.jp/api/3/action/package_search'),'ward-minato':('ckan','https://opendata.city.minato.tokyo.jp/api/3/action/package_search'),'city-kyoto':('static','https://data.city.kyoto.lg.jp/dataset/00003/'),'ward-shibuya':('json','https://www.arcgis.com/sharing/rest/search?f=json&q=orgid%3AUtdeFTavkHfI94t2&num=100'),'city-niigata':('static','https://www.city.niigata.lg.jp/shisei/seisaku/it/open-data/opendata-gis/index.html'),'city-yokohama':('static','https://wwwm.city.yokohama.lg.jp/yokohamap/OpenData'),'city-mito':('static','https://www.city.mito.lg.jp/site/open-data/3945.html'),'city-sendai':('static','https://www.city.sendai.jp/joho-kikaku/shise/security/kokai/opendata_example.html'),'city-nagano':('static','https://www.city.nagano.nagano.jp/n023500/contents/p006172.html'),'ward-suginami':('csvIndex','https://www.city.suginami.tokyo.jp/documents/8444/open-data-list.csv'),'ward-shinjuku':('csvIndex','https://www.city.shinjuku.lg.jp/content/000428573.csv'),'city-maebashi':('ckan','https://data.bodik.jp/api/3/action/package_search'),'city-kagoshima':('static','https://data.bodik.jp/dataset/462012_haizara'),'city-shizuoka':('static','https://data.bodik.jp/dataset/221007_1590018309')}
# Discovery anchors from public catalog directories; live connector checks establish availability.
# These links carry no license, delegation or approval conclusion.
pref_catalogs={
'hokkaido':'https://www.harp.lg.jp/opendata/','aomori':'https://opendata.pref.aomori.lg.jp/','iwate':'https://www.pref.iwate.jp/opendata/','miyagi':'https://miyagi.dataeye.jp/','akita':'https://opendata.pref.akita.lg.jp/','yamagata':'https://www.pref.yamagata.jp/020051/kensei/shoukai/toukeijouhou/tokeijoho-opendate/opendata/index.html','fukushima':'https://www.pref.fukushima.lg.jp/sec/11045a/open-data-top.html','ibaraki':'https://www.pref.ibaraki.jp/kikaku/joho/it/opendata/od-00.html','tochigi':'https://odcs.bodik.jp/090000/','gunma':'https://www.pref.gunma.jp/page/16089.html','saitama':'https://opendata.pref.saitama.lg.jp/','chiba':'https://www.pref.chiba.lg.jp/gyoukaku/opendata/index.html','kanagawa':'https://www.pref.kanagawa.jp/dst/index.html','niigata':'https://www.pref.niigata.lg.jp/site/opendata/','toyama':'https://opendata.pref.toyama.jp/','ishikawa':'https://www.pref.ishikawa.lg.jp/opendata/index.html','fukui':'https://www.pref.fukui.lg.jp/doc/dx-suishin/opendata/index.html','yamanashi':'https://www.pref.yamanashi.jp/opendata/catalog/','nagano':'https://www.pref.nagano.lg.jp/dx-promo/kensei/tokei/johoka/opendata/index.html','shizuoka':'https://opendata.pref.shizuoka.jp/','aichi':'https://www.pref.aichi.jp/opendata/','mie':'https://www.pref.mie.lg.jp/it/hp/87579000001.htm','shiga':'https://odcs.bodik.jp/shiga-pref/','kyoto':'https://odcs.bodik.jp/260002/','osaka':'https://odcs.bodik.jp/270008/','hyogo':'https://odcs.bodik.jp/280003/','nara':'https://www.pref.nara.jp/44954.htm','wakayama':'https://odcs.bodik.jp/300004/','tottori':'https://odp-pref-tottori.tori-info.co.jp/','shimane':'https://shimane-opendata.jp/','okayama':'https://www.okayama-opendata.jp/','hiroshima':'https://ckan-hiroshima-opendata.dataeye.jp/','yamaguchi':'https://yamaguchi-opendata.jp/www/','tokushima':'https://opendata.pref.tokushima.lg.jp/','kagawa':'https://opendata.pref.kagawa.lg.jp/','ehime':'https://www.pref.ehime.jp/opendata-catalog/','kochi':'https://www.pref.kochi.lg.jp/opendata/'}
for slug,url in pref_catalogs.items():portals['pref-'+slug]=('static',url)
for t in targets:
 if t['id'] in portals:typ,url=portals[t['id']];t['catalogs'].append({'type':typ,'url':url})
# Extract historical rows rather than reinterpreting license/current operation gates.
research=sorted((ROOT/'docs/research').glob('*.md'))
url_re=re.compile(r'https?://[^\s<>|)]+')
raw_re=re.compile(r'\.(?:csv|tsv|json|geojson|kml|kmz|zip|xlsx?|gpkg)(?:[?#]|$)',re.I)
seeds=[]
for t in targets:
 for doc in research:
  lines=[]
  for line in doc.read_text().splitlines():
   if not line.startswith('|'):continue
   first=line.split('|')[1]
   # Restrict matching to publisher column, avoiding incidental links to neighbors.
   names=[t['name']]
   aliases={'operator-jr-east':'JR East','operator-jr-hokkaido':'JR Hokkaido','operator-tokyo-metro':'Tokyo Metro','operator-toei':'Toei','operator-haneda':'Haneda','operator-narita':'Narita operator','operator-hokkaido-airports':'New Chitose','operator-sendai-airport':'Sendai airport','operator-centrair':'Centrair','operator-niigata-airport':'Niigata airport','operator-shizuoka-airport':'Shizuoka airport','operator-aomori-airport':'Aomori airport','operator-tokyo-big-sight':'Tokyo Big Sight','operator-makuhari-messe':'Makuhari Messe','operator-pacifico-yokohama':'Pacifico Yokohama','national-mlit-indoor':'MLIT'}
   if t['id'] in aliases:names.append(aliases[t['id']])
   if 'tokyoWard' in t['roles']:names.append(t['name'][:-1])
   if not any(re.search(r'(?<![一-龯ぁ-んァ-ヶA-Za-z])'+re.escape(name)+r'(?![一-龯ぁ-んァ-ヶA-Za-z])',first) for name in names):continue
   urls=list(dict.fromkeys(x.rstrip('.,;') for x in url_re.findall(line)))
   raws=[u for u in urls if raw_re.search(u)]
   reference=str(doc.relative_to(ROOT))
   codes=['coordinatesMissing','licenseUnknown']
   if '403' in line:codes=['accessBlocked']
   elif 'host' in line or '施設座標' in line:codes=['hostPointOnly']
   elif any(s in line for s in ['prohibits secondary','commercial use prohibited','requires approval','Redistribution/modification permission absent','Reuse restrictions']):codes=['redistributionBlocked','coordinatesMissing']
   elif 'Zero rows' in line or 'no smoking' in line or 'no exact smoking' in line:codes=['noSmokingEvidence']
   status='metadataScanned'
   if any(s in line for s in [' data rows',' rows,',' rows;',' rows (','downloaded and decoded','fully parsed','no smoking text','416 rows','Zero rows contain']):status='rawScanned' if raws else 'metadataScanned'
   if any(s in line for s in ['check incomplete','inspection incomplete','not inspected','download requires','registration/login']):status='metadataScanned'
   entry={'reference':reference,'status':status,'blockerCodes':codes,'rawUrls':raws,'evidence':line}
   t['priorResearch'].append(entry)
   for u in urls:
    if not raw_re.search(u) and u not in t['urls']:t['urls'].append(u)
   # Ordinary HTML is metadata only. Raw remains blocked until individual review.
   for u in raws:
    if not any(r['url']==u for r in t['rawResources']):t['rawResources'].append({'url':u,'datasetUrl':next((x for x in urls if not raw_re.search(x)),None),'title':t['name']+' prior research resource'})
# Structured raw audit imports exact inspection evidence and hashes without redistributing bytes.
auditfile=ROOT/'docs/research/2026-09-30-east-north-operator-mega-batch.raw-audit.json'
audit=json.loads(auditfile.read_text())
for p in audit['payloads']:
 pub=p['publisher'];slug=pub.removesuffix('-csv')
 t=next((t for t in targets if re.search(r'(?<![一-龯ぁ-んァ-ヶA-Za-z])'+re.escape(t['name'])+r'(?![一-龯ぁ-んァ-ヶA-Za-z])',pub) or t['id']=='city-'+slug),None)
 if not t and pub=='静岡県':t=next(t for t in targets if t['id']=='pref-shizuoka')
 if not t:
  jp=re.search(r'【(.+?)】',pub)
  if jp:
   name=jp.group(1);t=add('historical-'+p['id'].split('-')[0],name,'岐阜県','municipality',p['datasetUrl'])
 if not t:continue
 code='hostPointOnly' if p.get('smokingTextRows',0)>0 else 'noSmokingEvidence'
 entry={'reference':str(auditfile.relative_to(ROOT)),'status':'rawScanned','blockerCodes':[code],'rawUrls':[p['rawUrl']],'sha256':p['sha256'],'rawRowCount':p.get('dataRows',p.get('parsedRowsIncludingHeader',1)-1),'matchingRowCount':p.get('smokingTextRows',0),'categoryInventory':p.get('poiCodes',{}),'fetchedAt':p.get('fetchedAt',p.get('fetchedOn'))}
 t['priorResearch'].append(entry)
 t['rawResources']=[r for r in t['rawResources'] if r['url']!=p['rawUrl']]
 t['rawResources'].append({'url':p['rawUrl'],'datasetUrl':p['datasetUrl'],'title':p['publisher'],'sha256':p['sha256'],'format':p['rawUrl'].split('.')[-1].split('?')[0]})
 seeds.append({'targetId':t['id'],**entry})
# BODIK access history is a discovery blocker, never permission to bypass.
for t in targets:
 if any('bodik.jp' in c['url'] for c in t['catalogs']):
  t['priorResearch'].append({'reference':'Issue #118','status':'blocked','blockerCodes':['accessBlocked'],'rawUrls':[]})
# Approved registry fixtures are historical implemented evidence, never automatic approval.
reviewed={'ward-taito':'taito-public-smoking-areas','city-osaka':'osaka-designated-smoking-areas','ward-koto':'koto-station-smoking-areas','city-musashino':'musashino-public-smoking-areas','ward-minato':'minato-designated-smoking-areas','city-kyoto':'kyoto-public-smoking-places'}
reviewed_resources=[]
for t in targets:
 if t['id'] in reviewed:
  source=reviewed[t['id']];t['seedStatus']='implemented';t['reviewedSourceIds']=[source]
  folder=ROOT/'services/data-pipeline/fixtures'/source
  fetch_path=folder/'fetch.json'
  metadata=json.loads(fetch_path.read_text()) if fetch_path.exists() else {}
  adapter_path=ROOT/'services/api/src/pipeline'/('taito.ts' if source.startswith('taito-') else 'osaka-adapter.ts')
  if metadata:
   url=metadata['sourceUrl'];sha=metadata.get('archiveSha256',metadata.get('contentSha256'));scope='rawArchiveBytes' if metadata.get('archiveSha256') else 'rawResponseBytes'
  else:
   code=adapter_path.read_text();url=re.search(r'https://[^"\s]+\.csv',code).group();sha=re.search(r'FIXTURE_SHA256 = "([a-f0-9]{64})"',code).group(1);scope='rawResponseBytes'
  entry={'reference':str((folder/'PROVENANCE.md').relative_to(ROOT)),'status':'implemented','sourceId':source,'blockerCodes':[],'rawUrls':[url],'sha256':sha,'reviewedHashScope':scope}
  if source.startswith('musashino-'):
   entry['extractedMemberSha256']=metadata['contentSha256'];entry['extractedMember']='doc.kml';entry['archiveMemberSha256']=metadata['memberSha256'];entry['archiveMember']=metadata['member']
  if source.startswith('kyoto-'):entry['retrievalMethod']='POST';entry['retrievalDescription']=metadata['retrieval'];entry['reviewedHashScope']='POSTDownloadedCsvBytesNotResourcePageHtml'
  if metadata.get('httpLastModified'):entry['lastModified']=metadata['httpLastModified']
  if metadata.get('fetchedAt'):entry['fetchedAt']=metadata['fetchedAt']
  t['priorResearch'].append(entry);reviewed_resources.append({'targetId':t['id'],**entry})
  if not any(r['url']==url for r in t['rawResources']):t['rawResources'].append({'url':url,'title':source,'sha256':sha,'reviewedHashScope':entry['reviewedHashScope']})
 elif t['priorResearch']:
  t['seedStatus']='blocked';t['blockerCodes']=sorted({c for p in t['priorResearch'] for c in p['blockerCodes']})
# Other survey references required by the batch are explicitly retained.
manifest={'version':1,'generatedBy':'generate-manifest.py','scope':'local-only discovery; candidate != approved source','prefectures':[p.split(':')[0] for p in PREFS],'directoryReference':'https://www.pref.miyagi.jp/soshiki/kohou/link03.html','researchReferences':['PR #106','PR #112','PR #115','PR #119','PR #121','PR #125','PR #129','Issue #118','PR #122','docs/SOURCES.md'], 'targets':targets}
seed={'version':1,'note':'Imported prior raw inspections only; hashes do not replace raw bytes or grant reuse rights. URL skip applies to inspected unchanged releases only.','resources':seeds,'reviewedResources':reviewed_resources,'researchReferences':manifest['researchReferences']}
# Jurisdiction boundaries prevent 津市 inheriting 大津市/草津市 or 港 inheriting 港区.
assert not any('大津市' in p.get('evidence','') or '草津市' in p.get('evidence','') for t in targets if t['id']=='city-tsu' for p in t['priorResearch'])
assert len(reviewed_resources)==6
assert all(r['rawUrls'] and len(r['sha256'])==64 for r in reviewed_resources)
assert len({t['id'] for t in targets})==len(targets)
assert sum('prefecturalCapital' in t['roles'] for t in targets)==47
assert sum('ordinanceDesignatedCity' in t['roles'] for t in targets)==20
for name,value in [('manifest.json',manifest),('research-seed.json',seed)]:
 (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'targets':len(targets),'prefectures':sum(t['kind']=='prefecture' for t in targets),'capitals':sum('prefecturalCapital' in t['roles'] for t in targets),'ordinanceCities':sum('ordinanceDesignatedCity' in t['roles'] for t in targets),'wards':sum('tokyoWard' in t['roles'] for t in targets),'operators':sum(t['kind']=='operator' for t in targets),'rawSeedResources':len(seeds)}))
