/**
 * DWG / DXF → PDF conversion via CloudConvert.
 *
 * Ported from mmcbuild (lib/plans/dwg-converter.ts) where it's been live
 * for native-CAD ingest. CloudConvert runs the proprietary AutoCAD parser
 * server-side; we upload + poll + download. Pricing roughly $0.005-$0.02
 * per DWG depending on size / complexity.
 *
 * Preflight runs this behind the enableDwgConvert opt-in on extractFile —
 * when on, the dispatcher converts DWG/DXF bytes to a PDF buffer then
 * routes through the existing PDF text-extract path.
 *
 * BYOK: CLOUDCONVERT_API_KEY env var. When absent, callers fall back to
 * the "export to PDF first" warning surfaced by the DWG branch of
 * extract-file.ts.
 */

const CLOUDCONVERT_BASE = 'https://api.cloudconvert.com/v2';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 80; // ~4 minutes
const MAX_DWG_BYTES = 50 * 1024 * 1024;

export type DwgConvertResult =
  | { buffer: Buffer; format: 'pdf' | 'dxf' }
  | { error: string };

interface CCTaskResultForm {
  url: string;
  parameters: Record<string, string>;
}

interface CCTask {
  name: string;
  status?: string;
  result?: {
    form?: CCTaskResultForm;
    files?: { url: string; filename: string }[];
  };
}

interface CCJobResponse {
  data: { id: string; status: string; tasks: CCTask[] };
}

export function isDwgConvertConfigured(): boolean {
  return !!process.env.CLOUDCONVERT_API_KEY;
}

/**
 * Convert a DWG buffer to PDF (default — feeds straight back into the
 * dispatcher) or DXF (if you want layer-aware extraction downstream).
 */
export async function convertDwg(
  dwgBuffer: Buffer,
  fileName: string,
  outputFormat: 'pdf' | 'dxf' = 'pdf',
): Promise<DwgConvertResult> {
  const inputFormat = fileName.toLowerCase().endsWith('.dxf') ? 'dxf' : 'dwg';
  return convertViaCloudConvert(dwgBuffer, fileName, inputFormat, outputFormat, 'application/acad');
}

async function convertViaCloudConvert(
  sourceBuffer: Buffer,
  fileName: string,
  inputFormat: string,
  outputFormat: 'pdf' | 'dxf',
  uploadMimeType: string,
): Promise<DwgConvertResult> {
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) {
    return { error: 'CLOUDCONVERT_API_KEY not configured — native CAD ingest disabled. Export to PDF first or set the key.' };
  }
  if (sourceBuffer.length > MAX_DWG_BYTES) {
    return { error: `DWG exceeds ${MAX_DWG_BYTES / 1024 / 1024} MB limit` };
  }

  const jobResp = await fetch(`${CLOUDCONVERT_BASE}/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tasks: {
        'import-file': { operation: 'import/upload' },
        'convert-file': {
          operation: 'convert',
          input: 'import-file',
          input_format: inputFormat,
          output_format: outputFormat,
        },
        'export-file': { operation: 'export/url', input: 'convert-file' },
      },
    }),
  });
  if (!jobResp.ok) {
    const text = await jobResp.text().catch(() => '');
    return { error: `CloudConvert job creation failed: ${jobResp.status} ${text.slice(0, 200)}` };
  }

  const job = (await jobResp.json()) as CCJobResponse;
  const jobId = job.data.id;
  const importTask = job.data.tasks.find((t) => t.name === 'import-file');
  const uploadForm = importTask?.result?.form;
  if (!uploadForm?.url) return { error: 'CloudConvert did not return an upload URL' };

  const form = new FormData();
  for (const [key, value] of Object.entries(uploadForm.parameters)) form.append(key, value);
  form.append(
    'file',
    new Blob([new Uint8Array(sourceBuffer)], { type: uploadMimeType }),
    fileName,
  );

  const uploadResp = await fetch(uploadForm.url, { method: 'POST', body: form });
  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => '');
    return { error: `Upload to CloudConvert failed: ${uploadResp.status} ${text.slice(0, 200)}` };
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const statusResp = await fetch(`${CLOUDCONVERT_BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusResp.ok) continue;
    const status = (await statusResp.json()) as CCJobResponse;
    if (status.data.status === 'finished') {
      const exportTask = status.data.tasks.find((t) => t.name === 'export-file');
      const fileUrl = exportTask?.result?.files?.[0]?.url;
      if (!fileUrl) return { error: 'CloudConvert finished without an export URL' };
      const fileResp = await fetch(fileUrl);
      if (!fileResp.ok) return { error: `Converted file download failed: ${fileResp.status}` };
      const arrayBuffer = await fileResp.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), format: outputFormat };
    }
    if (status.data.status === 'error') {
      const failed = status.data.tasks.find((t) => t.status === 'error');
      return { error: `CloudConvert task failed: ${failed?.name ?? 'unknown'}` };
    }
  }

  return { error: 'CloudConvert job timed out (~4 min). Retry, or split the DWG.' };
}
