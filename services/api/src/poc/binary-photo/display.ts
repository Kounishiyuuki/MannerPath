// PoC — what the operator's local Admin would do before a stored JPEG reaches a browser. The Worker never decoded the
// upload (route.ts), so the first decode happens here, on the operator's machine, with no CPU limit: re-check the
// container, then decode with the bounded JS decoder and re-encode to a fresh PNG (the existing sanitizer). The browser
// only ever receives server-made PNG bytes, never the uploaded file.
import { validateJpegStructure } from "../../reports/jpeg-structure.ts";
import { sanitizeEvidencePhoto } from "../../reports/photo-sanitizer.ts";

export async function renderForOperator(storedJpeg: Uint8Array): Promise<{ bytes: Uint8Array; mediaType: "image/png" }> {
  validateJpegStructure(storedJpeg);
  const png = await sanitizeEvidencePhoto(storedJpeg, "image/jpeg");
  return { bytes: png.bytes, mediaType: "image/png" };
}
