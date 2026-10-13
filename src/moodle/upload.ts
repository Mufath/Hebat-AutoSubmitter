/**
 * src/moodle/upload.ts
 * Uploads assignment file (PDF) to Moodle draft area prior to unlock.
 * Verified working using Candidate K1 (course context + random 9-digit itemid).
 */

import { CookieJar, Budget, mfetch } from './http';
import type { UploadResult } from './types';

export async function uploadDraftFile(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  sesskey: string,
  contextId: string,
  fileName: string,
  fileBytes: Uint8Array,
  customItemId?: number
): Promise<UploadResult> {
  const itemid = customItemId ?? Math.floor(100000000 + Math.random() * 900000000);
  const blob = new Blob([fileBytes], { type: 'application/pdf' });

  const form = new FormData();
  form.append('repo_upload_file', blob, fileName);
  form.append('sesskey', sesskey);
  form.append('repo_id', '5');
  form.append('itemid', String(itemid));
  form.append('author', 'Student');
  form.append('title', fileName);
  form.append('savepath', '/');
  form.append('ctx_id', contextId);
  form.append('client_id', Math.random().toString(36).substring(2, 10));
  form.append('maxbytes', '104857600');
  form.append('areamaxbytes', '-1');
  form.append('env', 'filemanager');
  form.append('license', 'unknown');

  const uploadRes = await mfetch(jar, bud, `${baseUrl}/repository/repository_ajax.php?action=upload`, {
    method: 'POST',
    body: form,
  });

  let json: Record<string, unknown> = {};
  try {
    json = await uploadRes.res.json() as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      itemid,
      fileName,
      error: `JSON_PARSE_ERROR: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (json.error) {
    return {
      ok: false,
      itemid,
      fileName,
      error: String(json.error),
    };
  }

  const fileUrl = typeof json.url === 'string' ? json.url : undefined;
  return {
    ok: true,
    itemid,
    fileName,
    fileUrl,
  };
}
