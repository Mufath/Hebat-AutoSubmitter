/**
 * src/moodle/submit.ts
 * Manages checking lock status, fetching edit form, and submitting assignment.
 */

import { CookieJar, Budget, mfetch } from './http';
import { parseEditSubmissionForm, parseSubmissionStatus } from './parse';
import type { SubmissionFormFields, SubmissionStatus } from './types';

export interface LockStatusResult {
  isLocked: boolean;
  statusCode: number;
  finalUrl: string;
  sessionExpired?: boolean;
}

export async function checkAssignmentLock(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  cmid: string
): Promise<LockStatusResult> {
  const res = await mfetch(jar, bud, `${baseUrl}/mod/assign/view.php?id=${cmid}`, {
    headers: { 'cache-control': 'no-cache' },
  });

  if (res.url.includes('/login/')) {
    return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, sessionExpired: true };
  }

  // If redirected back to course view, assignment is locked (F7)
  if (res.url.includes('/course/view.php')) {
    return { isLocked: true, statusCode: res.res.status, finalUrl: res.url };
  }

  const html = await res.res.text();
  const isLocked = html.includes('Available from') || html.includes('Dibuka mulai');
  return { isLocked, statusCode: res.res.status, finalUrl: res.url };
}

export async function fetchSubmissionForm(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  cmid: string
): Promise<SubmissionFormFields | null> {
  const res = await mfetch(jar, bud, `${baseUrl}/mod/assign/view.php?id=${cmid}&action=editsubmission`);
  const html = await res.res.text();
  return parseEditSubmissionForm(html);
}

export interface SubmitResult {
  ok: boolean;
  dryRun: boolean;
  status: SubmissionStatus;
  error?: string;
}

export async function submitAssignment(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  cmid: string,
  formFields: SubmissionFormFields,
  draftItemId: number,
  dryRun = true
): Promise<SubmitResult> {
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      status: {
        isSubmitted: false,
        isDraft: true,
        hasSubmissionStatement: false,
        statusText: 'DRY_RUN_SIMULATION_SUCCESS',
      },
    };
  }

  const body = new URLSearchParams();
  body.set('lastmodified', formFields.lastmodified);
  body.set('id', cmid);
  body.set('userid', formFields.userid);
  body.set('action', 'savesubmission');
  body.set('sesskey', formFields.sesskey);
  body.set('_qf__mod_assign_submission_form', '1');
  body.set('mform_isexpanded_id_submissionheader', '1');
  body.set('files_filemanager', String(draftItemId));
  body.set('submitbutton', 'Save changes');

  for (const [k, v] of Object.entries(formFields.extraFields)) {
    body.set(k, v);
  }

  // POST savesubmission
  await mfetch(jar, bud, `${baseUrl}/mod/assign/view.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  // Verify submission status
  const viewRes = await mfetch(jar, bud, `${baseUrl}/mod/assign/view.php?id=${cmid}`);
  const viewHtml = await viewRes.res.text();
  const status = parseSubmissionStatus(viewHtml);

  return {
    ok: status.isSubmitted,
    dryRun: false,
    status,
  };
}
