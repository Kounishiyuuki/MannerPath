import {sha256} from './fetch-cache.mjs';
const keyword=/喫煙|灰皿|smoking(?:\s+(?:area|room|place))?/iu;
const category=/category|cate_id|type|class|code|description|カテゴリ|分類|種別|説明/iu;
export function parseDelimited(text,delimiter=',') {
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!quoted&&field!=='')throw Error('Unexpected quote');else{quoted=!quoted;if(!quoted)closed=true;}}else if(c===delimiter&&!quoted){row.push(field);field='';closed=false;}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';closed=false;}else{if(closed)throw Error('Unexpected text after closing quote');field+=c;}}
 if(quoted)throw Error('Unterminated quoted field');if(field||row.length){row.push(field);rows.push(row);}if(!rows.length)return [];
 const header=rows.shift();if(header.some(h=>!h.trim())||new Set(header).size!==header.length)throw Error('Empty or duplicate column header');return rows.map(values=>{if(values.length!==header.length)throw Error('Inconsistent column count');return Object.fromEntries(header.map((h,i)=>[h,values[i]]));});
}
const unescape=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
export function parseKml(text){
 if(!/<(?:\w+:)?kml\b/i.test(text)||!/<\/(?:\w+:)?kml\s*>/i.test(text))throw Error('Malformed KML');
 const opened=[...text.matchAll(/<(?:\w+:)?Placemark\b[^>]*>/gi)].length;const closed=[...text.matchAll(/<\/(?:\w+:)?Placemark\s*>/gi)].length;if(opened!==closed)throw Error('Unclosed KML Placemark');
 return [...text.matchAll(/<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi)].map(([,part])=>{
  const properties={};for(const name of ['name','description']){const value=part.match(new RegExp('<(?:\\w+:)?'+name+'[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?'+name+'>','i'));if(value)properties[name]=unescape(value[1]);}
  for(const [,name,value] of part.matchAll(/<(?:\w+:)?Data\s+name=["']([^"']+)["'][^>]*>\s*<(?:\w+:)?value[^>]*>([\s\S]*?)<\/(?:\w+:)?value>/gi))properties[name]=unescape(value);
  for(const [,name,value] of part.matchAll(/<(?:\w+:)?SimpleData\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:\w+:)?SimpleData>/gi))properties[name]=unescape(value);
  const point=part.match(/<(?:\w+:)?Point\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i);const geometryType=point?'Point':/<(?:\w+:)?Polygon\b/i.test(part)?'Polygon':/<(?:\w+:)?LineString\b/i.test(part)?'LineString':'unknown';
  if(point&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)?$/.test(point[1].trim()))throw Error('Malformed KML Point coordinates');
  return {properties,geometry:point?{type:'Point',coordinates:point[1].trim().split(',').slice(0,2).map(Number)}:{type:geometryType}};
 });
}
function flatten(object,prefix=''){return Object.entries(object).flatMap(([key,value])=>value&&typeof value==='object'&&!Array.isArray(value)?flatten(value,prefix+key+'.'):[[prefix+key,value]]);}
function coordinates(row){const props=row.properties||row.attributes||row;const geom=row.geometry;if(geom?.type==='Point')return geom.coordinates?.slice(0,2);
 const entries=Object.entries(props);const lat=entries.find(([k])=>/^(lat|latitude|緯度)$/iu.test(k));const lng=entries.find(([k])=>/^(lon|lng|longitude|経度)$/iu.test(k));if(!lat||!lng||String(lat[1]).trim()===''||String(lng[1]).trim()==='')return null;return [Number(lng[1]),Number(lat[1])];}
export function inspectPayload(bytes,{url='',format='',contentType='',encoding}={}) {
 const result={sha256:sha256(bytes),format:format.toLowerCase(),rawRowCount:null,matchingRowCount:0,matchingValues:[],categoryInventory:{},coordinateAvailability:'unknown',geometryTypes:[],possibleCrs:null,blockerCodes:[]};
 try{
  const ext=new URL(url||'https://local/payload').pathname.split('.').pop().toLowerCase();const f=result.format||ext;
  if(['zip','kmz','shp','gpkg'].includes(f)||bytes.subarray(0,2).toString()==='PK'||bytes.subarray(0,15).toString()==='SQLite format 3'){result.format=['zip','kmz','shp','gpkg'].includes(f)?f:bytes.subarray(0,2).toString()==='PK'?'zip':'gpkg';result.blockerCodes=['incompatibleFormat'];result.inspectionNote='Binary archive/GIS metadata requires a separate local inspector; no CRS inference';return result;}
  let text;try{text=new TextDecoder(encoding||'utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);result.encoding='shift_jis';}
  text=text.replace(/^\uFEFF/,'');let rows;
  if(f==='kml'||/<(?:\w+:)?kml\b/i.test(text)){rows=parseKml(text);result.format='kml';result.possibleCrs='EPSG:4326 (KML standard)';}
  else if(['json','geojson'].includes(f)||/json/i.test(contentType)||/^[\s]*[\[{]/.test(text)){const data=JSON.parse(text);result.format=data.type==='FeatureCollection'?'geojson':'json';rows=data.type==='FeatureCollection'?data.features:Array.isArray(data)?data:data.features||data.records||data.data||(data.type==='Feature'?[data]:[data]);if(!Array.isArray(rows))throw Error('JSON records are not an array');result.truncated=data.exceededTransferLimit===true;result.possibleCrs=data.crs|| (result.format==='geojson'?'RFC7946 WGS84; publisher semantics unreviewed':null);}
  else if(['csv','tsv'].includes(f)||/csv|tab-separated/.test(contentType)){result.format=f==='tsv'?'tsv':'csv';rows=parseDelimited(text,result.format==='tsv'?'\t':',');}
  else {result.blockerCodes=['incompatibleFormat'];return result;}
  const matches=[];const geometry=new Set();let pointCount=0;
  for(const row of rows){if(!row||typeof row!=='object')throw Error('Record is not an object');const props=row.properties||row.attributes||row;const values=flatten(props).filter(([,v])=>v!==null&&v!==undefined);const matching=values.filter(([,v])=>keyword.test(typeof v==='object'?JSON.stringify(v):String(v)));
   if(matching.length){matches.push(row);for(const [field,value] of matching){const v={field,value};if(result.matchingValues.length<100&&!result.matchingValues.some(x=>JSON.stringify(x)===JSON.stringify(v)))result.matchingValues.push(v);}}
   for(const [key,value] of values)if(category.test(key)){const inventory=result.categoryInventory[key]??={values:[],truncated:false};const label=typeof value==='object'?JSON.stringify(value):String(value);if(!inventory.values.includes(label)){if(inventory.values.length<200)inventory.values.push(label);else inventory.truncated=true;}}
   if(row.geometry?.type)geometry.add(row.geometry.type);const coord=coordinates(row);if(coord&&coord.length===2&&coord.every(Number.isFinite)&&Math.abs(coord[0])<=180&&Math.abs(coord[1])<=90)pointCount++;
  }
  result.rawRowCount=rows.length;result.matchingRowCount=matches.length;result.geometryTypes=[...geometry].sort();result.coordinateAvailability=pointCount===rows.length&&rows.length?'all':pointCount?'partial':'missing';
  if(!matches.length)result.blockerCodes.push('noSmokingEvidence');if(!matches.some(row=>{const c=coordinates(row);return c&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90;}))result.blockerCodes.push('coordinatesMissing');if(geometry.has('Polygon')&&!geometry.has('Point'))result.blockerCodes.push('polygonOnly');
  result.blockerCodes.push('licenseUnknown','currentOperationUnknown');return result;
 }catch(error){return {...result,blockerCodes:['incompatibleFormat'],error:error.message};}
}
