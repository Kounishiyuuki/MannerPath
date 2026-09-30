import {createRequire} from 'node:module';
import {sha256} from './fetch-cache.mjs';
import {analyzeRows} from './scanner.mjs';
// The parser is a devDependency of services/api, which runs this tooling (npm run discover:sources).
const XLSX=createRequire(new URL('../../api/package.json',import.meta.url))('xlsx');

export const SPREADSHEET_LIMITS={maxBytes:10*1024*1024,maxCells:2_000_000,maxSheets:64,headerScanRows:15};
const CFB_MAGIC=Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
const coordinateHeader=/緯度|経度|^lat|^lon|^lng|latitude|longitude|[XY]座標|座標[XY]/iu;

/** Content sniffing only: file names and Content-Type are frequently wrong on municipal sites. */
export function spreadsheetFormat(bytes){
 const head=Buffer.from(bytes.subarray(0,8));
 if(head.equals(CFB_MAGIC))return 'xls';
 // ZIP central-directory member names are stored uncompressed.
 if(head.subarray(0,2).toString()==='PK'&&Buffer.from(bytes).includes('xl/workbook.xml'))return 'xlsx';
 return null;
}

function headerRow(rows,limit){
 // The first row whose cells are mostly non-empty text: municipal sheets often start with a title row.
 let best=-1,bestCount=0;
 for(let i=0;i<Math.min(rows.length,limit);i++){const cells=rows[i]||[];const text=cells.filter(c=>typeof c==='string'&&c.trim()).length;if(text>bestCount&&text>=cells.filter(c=>c!==''&&c!=null).length*0.8){best=i;bestCount=text;}}
 return best;
}

/** Candidate extraction only. A 喫煙 cell never makes a public smoking place. */
export function inspectSpreadsheet(input,{limits=SPREADSHEET_LIMITS}={}){
 const bytes=Buffer.from(input);const format=spreadsheetFormat(bytes);
 const result={sha256:sha256(bytes),format:format||'unknown',rawRowCount:null,matchingRowCount:0,matchingValues:[],categoryInventory:{},coordinateAvailability:'unknown',coordinateColumns:[],geometryTypes:[],possibleCrs:null,sheets:[],usedSheets:[],blockerCodes:[]};
 if(!format)return {...result,blockerCodes:['incompatibleFormat'],error:'Not an XLS (CFB) or XLSX (OOXML) workbook'};
 if(bytes.length>limits.maxBytes)return {...result,blockerCodes:['payloadTooLarge'],error:`Workbook exceeds ${limits.maxBytes} bytes`};
 let workbook;
 try{workbook=XLSX.read(bytes,{type:'buffer',dense:true,cellFormula:false,cellHTML:false,cellStyles:false,bookVBA:false,sheetStubs:false,WTF:false});}
 catch(error){return {...result,blockerCodes:['incompatibleFormat'],error:'Workbook parse failed: '+error.message};}
 if(workbook.SheetNames.length>limits.maxSheets)return {...result,blockerCodes:['payloadTooLarge'],error:`Workbook has ${workbook.SheetNames.length} sheets`};
 let cells=0;const allRows=[];
 for(const name of workbook.SheetNames){
  const sheet=workbook.Sheets[name];const range=sheet['!ref']?XLSX.utils.decode_range(sheet['!ref']):null;
  if(range){cells+=(range.e.r-range.s.r+1)*(range.e.c-range.s.c+1);if(cells>limits.maxCells)return {...result,sheets:result.sheets,blockerCodes:['payloadTooLarge'],error:`Workbook exceeds ${limits.maxCells} cells`};}
  const matrix=range?XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:false}):[];
  const h=headerRow(matrix,limits.headerScanRows);
  const headers=h<0?[]:matrix[h].map((v,i)=>String(v).trim()||'column'+(i+1));
  // Duplicate headers are kept distinguishable instead of silently overwriting cells.
  const seen={};const unique=headers.map(v=>seen[v]?v+'#'+(++seen[v]):(seen[v]=1,v));
  const rows=h<0?matrix.map(r=>Object.fromEntries(r.map((v,i)=>['column'+(i+1),v]))):matrix.slice(h+1).map(r=>Object.fromEntries(unique.map((k,i)=>[k,r[i]??''])));
  const coordinateColumns=unique.filter(k=>coordinateHeader.test(k));
  result.sheets.push({name,rowCount:rows.length,headerRowIndex:h,headers:unique.slice(0,100),coordinateColumns});
  if(rows.length){result.usedSheets.push(name);for(const row of rows)allRows.push({row,sheet:name});}
  for(const c of coordinateColumns)result.coordinateColumns.push(name+'!'+c);
 }
 const analysis=analyzeRows(allRows.map(({row})=>row));
 Object.assign(result,analysis,{format});
 // Keep sheet provenance of hits so reviewers can open the exact sheet.
 result.matchingSheets=[...new Set(allRows.filter(({row})=>analysis.matchedRows.has(row)).map(({sheet})=>sheet))];delete result.matchedRows;
 if(!allRows.length)result.blockerCodes=['noSmokingEvidence','coordinatesMissing'];
 result.blockerCodes.push('licenseUnknown','currentOperationUnknown');result.blockerCodes=[...new Set(result.blockerCodes)];
 return result;
}
