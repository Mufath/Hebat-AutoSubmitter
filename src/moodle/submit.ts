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
  probesUsed?: number;
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
      headers: { 'cache-control': 'no-cache', connection: 'keep-alive' },
    },
    0
  );

  if (res.url.includes('/login/')) {
    return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, sessionExpired: true, probesUsed: 1 };
  }

  // If redirected back to course view, assignment is locked (F7)
  if (res.url.includes('/course/view.php')) {
    return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, probesUsed: 1 };
  }

  // Follow any other intermediate redirect if needed
  if (res.res.status >= 300 && res.res.status < 400) {
    res = await mfetch(jar, bud, res.url, {
      headers: { 'cache-control': 'no-cache', connection: 'keep-alive' },
    });
    if (res.url.includes('/login/')) {
      return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, sessionExpired: true, probesUsed: 1 };
    }
    if (res.url.includes('/course/view.php')) {
      return { isLocked: true, statusCode: res.res.status, finalUrl: res.url, probesUsed: 1 };
    }
  }

  const html = await res.res.text();
  const isLocked = html.includes('Available from') || html.includes('Dibuka mulai');
  const formFields = !isLocked ? parseEditSubmissionForm(html) : null;
  return { isLocked, statusCode: res.res.status, finalUrl: res.url, formFields, probesUsed: 1 };
}

/**
 * Staggered Hedged Wave Polling across the 07:00:00.000 boundary.
 * Eliminates the "Early-Poll Penalty" where a single Poll #1 arriving 10ms early (06:59:59.990)
 * blocks the bot for a full 250-300ms round-trip before Poll #2 can even be sent.
 * Fires up to `staggerDelaysMs.length` probes staggered by a few milliseconds; resolves the
 * instant the FIRST unlocked response (or sessionExpired) arrives without waiting for slower probes.
 */
export async function checkAssignmentLockWave(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  cmid: string,
  staggerDelaysMs: number[] = [0, 35, 75]
): Promise<LockStatusResult> {
  if (staggerDelaysMs.length <= 1 || bud.remaining <= 20) {
    return checkAssignmentLock(jar, bud, baseUrl, cmid);
  }

  return new Promise<LockStatusResult>((resolve, reject) => {
    let settled = false;
    let launched = 0;
    let completed = 0;
    let timersDone = false;
    let lastResult: LockStatusResult | null = null;
    let lastError: unknown = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const clearAllTimers = () => {
      timersDone = true;
      for (const t of timers) clearTimeout(t);
    };

    const checkAllDone = () => {
      if (!settled && timersDone && completed >= launched) {
        settled = true;
        if (lastResult) {
          resolve({ ...lastResult, probesUsed: launched });
        } else {
          reject(lastError || new Error('LOCK_WAVE_FAILED'));
        }
      }
    };

    const launchProbe = () => {
      if (settled) return;
      if (bud.remaining <= 12 && launched > 0) {
        checkAllDone();
        return;
      }
      launched++;
      checkAssignmentLock(jar, bud, baseUrl, cmid)
        .then(res => {
          completed++;
          lastResult = res;
          if (!settled && (!res.isLocked || res.sessionExpired)) {
            settled = true;
            clearAllTimers();
            resolve({ ...res, probesUsed: launched });
            return;
          }
          checkAllDone();
        })
        .catch(err => {
          completed++;
          lastError = err;
          checkAllDone();
        });
    };

    for (let i = 0; i < staggerDelaysMs.length; i++) {
      const delay = staggerDelaysMs[i];
      const isLast = i === staggerDelaysMs.length - 1;
      if (delay <= 0) {
        if (isLast) timersDone = true;
        launchProbe();
      } else {
        const t = setTimeout(() => {
          if (isLast) timersDone = true;
          launchProbe();
        }, delay);
        timers.push(t);
      }
    }
  });
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
  tPostDoneAt?: number;
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
      tPostDoneAt: Date.now(),
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
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        connection: 'keep-alive',
      },
      body: bodyStr,
    },
    0
  );
  const tPostDoneAt = Date.now();
  const tPostMs = Math.max(1, postRes.elapsedMs || (tPostDoneAt - tPost0));

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
    tPostDoneAt,
  };
}
