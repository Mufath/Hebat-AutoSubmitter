/**
 * src/moodle/login.ts
 * Implements Moodle HTTP login flow using pure fetch.
 */

import { CookieJar, Budget, mfetch } from './http';
import { parseLoginToken, parseSesskey, parseUserId } from './parse';
import type { LoginResult } from './types';

export async function loginMoodle(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  user: string,
  pass: string
): Promise<LoginResult> {
  // Step 1: GET login page to obtain logintoken
  const loginPage = await mfetch(jar, bud, `${baseUrl}/login/index.php`);
  const loginHtml = await loginPage.res.text();
  const logintoken = parseLoginToken(loginHtml);

  // Step 2: POST credentials
  const params = new URLSearchParams();
  params.set('username', user);
  params.set('password', pass);
  if (logintoken) params.set('logintoken', logintoken);
  params.set('anchor', '');

  await mfetch(jar, bud, `${baseUrl}/login/index.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!jar.has('MoodleSession')) {
    return { ok: false, sesskey: '', error: 'NO_MOODLE_SESSION_COOKIE' };
  }

  // Step 3: Verify login and extract sesskey
  const myPage = await mfetch(jar, bud, `${baseUrl}/my/`);
  const myHtml = await myPage.res.text();

  if (myPage.url.includes('/login/')) {
    return { ok: false, sesskey: '', error: 'LOGIN_REJECTED' };
  }

  const sesskey = parseSesskey(myHtml);
  if (!sesskey) {
    return { ok: false, sesskey: '', error: 'SESSKEY_NOT_FOUND' };
  }

  const userId = parseUserId(myHtml) || undefined;
  return { ok: true, sesskey, userId };
}
