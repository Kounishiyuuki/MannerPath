// Strict RFC 4180 reader. Fields are returned verbatim: no trimming, no width folding, and a line
// break inside a quoted field is kept exactly as in the file (Taito record 32 has a bare LF).
// Anything malformed throws instead of guessing, because the output is stored as raw evidence.

export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else field += c;
      continue;
    }
    if (c === ",") { row.push(field); field = ""; afterQuote = false; }
    else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      if (c === "\r") i++;
      row.push(field); rows.push(row); row = []; field = ""; afterQuote = false;
    } else if (afterQuote) {
      throw new Error(`parseCsv: unexpected character after closing quote at offset ${i}`);
    } else if (c === '"') {
      if (field !== "") throw new Error(`parseCsv: quote inside an unquoted field at offset ${i}`);
      quoted = true;
    } else if (c === "\r") {
      throw new Error(`parseCsv: bare CR outside a quoted field at offset ${i}`);
    } else field += c;
  }
  if (quoted) throw new Error("parseCsv: unterminated quoted field at end of input");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) throw new Error("parseCsv: no header row");
  const [header, ...records] = rows;
  records.forEach((r, i) => {
    if (r.length !== header.length) {
      throw new Error(`parseCsv: record ${i + 1} has ${r.length} fields, header has ${header.length}`);
    }
  });
  return { header, rows: records };
}
