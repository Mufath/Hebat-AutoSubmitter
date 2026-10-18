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
  formFields?: SubmissionFormFields | null;
}

export async function checkAssignmentLock(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  cmid: string
): Promise<LockStatusResult> {
  // Probe editsubmission with maxHops = 0:
  // - If locked, Moodle returns 303 -> /course/view.php (we avoid downloading course/view.php on every poll!)
  // - If unlocked, Moodle returns 200 OK with the submission form already in the body!
  let res = await mfetch(
    jar,
    bud,
    `${baseUrl}/mod/assign/view.php?id=${cmid}&action=editsubmission`,
    {
      headers: { 'cache-control': 'no-cache' },
    },
    0
  );

  if (res.url.includes('/login/')) {
    return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, sessionExpired: true };
  }

  // If redirected back to course view, assignment is locked (F7)
  if (res.url.includes('/course/view.php')) {
    return { isLocked: true, statusCode: res.res.status, finalUrl: res.url };
  }

  // Follow any other intermediate redirect if needed
  if (res.res.status >= 300 && res.res.status < 400) {
    res = await mfetch(jar, bud, res.url, {
      headers: { 'cache-control': 'no-cache' },
    });
    if (res.url.includes('/login/')) {
      return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, sessionExpired: true };
    }
    if (res.url.includes('/course/view.php')) {
      return { isLocked: true, statusCode: res.res.status, finalUrl: res.url };
    }
  }

  const html = await res.res.text();
  const isLocked = html.includes('Available from') || html.includes('Dibuka mulai');
  const formFields = !isLocked ? parseEditSubmissionForm(html) : null;
  return { isLocked, statusCode: res.res.status, finalUrl: res.url, formFields };
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
  tPostMs: number;
  tVerifyMs: number;
  error?: string;
}

/**
 * Pre-builds the static URL-encoded form payload prefix before 07:00:00 unlock
 * so that at unlock time only dynamic tokens (lastmodified, userid, sesskey) are appended.
 */
export function buildStaticSubmissionPrefix(cmid: string, draftItemId: number): string {
  const p = new URLSearchParams();
  p.set('id', cmid);
  p.set('action', 'savesubmission');
  p.set('_qf__mod_assign_submission_form', '1');
  p.set('mform_isexpanded_id_submissionheader', '1');
  p.set('files_filemanager', String(draftItemId));
  p.set('submitbutton', 'Save changes');
  return p.toString();
}

export async function submitAssignment(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  cmid: string,
  formFields: SubmissionFormFields,
  draftItemId: number,
  dryRun = true,
  preBuiltPrefix?: string
): Promise<SubmitResult> {
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      tPostMs: 0,
      tVerifyMs: 0,
      status: {
        isSubmitted: false,
        isDraft: true,
        hasSubmissionStatement: false,
        statusText: 'DRY_RUN_SIMULATION_SUCCESS',
      },
    };
  }

  let bodyStr: string;
  if (preBuiltPrefix && Object.keys(formFields.extraFields).length === 0) {
    bodyStr =
      `${preBuiltPrefix}` +
      `&lastmodified=${encodeURIComponent(formFields.lastmodified)}` +
      `&userid=${encodeURIComponent(formFields.userid)}` +
      `&sesskey=${encodeURIComponent(formFields.sesskey)}`;
  } else {
    const body = new URLSearchParams(preBuiltPrefix || '');
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
    bodyStr = body.toString();
  }

  // 1. POST savesubmission (maxHops = 0 so we measure ONLY the actual POST mutation without double-fetching view.php)
  const tPost0 = Date.now();
  const postRes = await mfetch(
    jar,
    bud,
    `${baseUrl}/mod/assign/view.php`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: bodyStr,
    },
    0
  );
  const tPostMs = Math.max(1, postRes.elapsedMs || (Date.now() - tPost0));

  // 2. Verify submission status (if POST already returned 200 with status HTML, check it first; otherwise GET view.php once)
  const tVerify0 = Date.now();
  let status: SubmissionStatus | null = null;
  if (postRes.res.status === 200) {
    const postHtml = await postRes.res.text();
    const parsedPost = parseSubmissionStatus(postHtml);
    if (parsedPost.isSubmitted) {
      status = parsedPost;
    }
  }

  if (!status) {
    const verifyUrl =
      postRes.res.status >= 300 && postRes.res.status < 400 && postRes.url
        ? postRes.url
        : `${baseUrl}/mod/assign/view.php?id=${cmid}`;
    const viewRes = await mfetch(jar, bud, verifyUrl);
    const viewHtml = await viewRes.res.text();
    status = parseSubmissionStatus(viewHtml);
  }
  const tVerifyMs = Math.max(0, Date.now() - tVerify0);

  return {
    ok: status.isSubmitted,
    dryRun: false,
    status,
    tPostMs,
    tVerifyMs,
  };
}
