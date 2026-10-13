/**
 * src/time.ts
 * Time utilities for WIB (UTC+7), Cloudflare alarm scheduling,
 * and server clock synchronization.
 */

import { CookieJar, Budget, mfetch } from './moodle/http';

export const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Calculates the next Wednesday 07:00:00 WIB unlock time in UTC epoch ms.
 * Wednesday 07:00:00 WIB equals Wednesday 00:00:00 UTC.
 */
export function getNextWednesdayUnlockUtc(fromMs = Date.now()): number {
  const d = new Date(fromMs);
  // Get current UTC day (0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, ...)
  const day = d.getUTCDay();
  const diffDays = (3 - day + 7) % 7;

  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffDays, 0, 0, 0, 0));

  // If today is Wednesday and 00:00:00 UTC has already passed, schedule for next Wednesday
  if (target.getTime() <= fromMs) {
    target.setUTCDate(target.getUTCDate() + 7);
  }

  return target.getTime();
}

/**
 * Samples server clock offset relative to local runtime clock using Date header.
 * Takes 5 samples and returns the median offset in ms.
 * offset = serverTime - localTime
 */
export async function sampleServerOffset(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string
): Promise<number> {
  const offsets: number[] = [];

  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      const res = await mfetch(jar, bud, `${baseUrl}/login/index.php`, {
        method: 'HEAD',
        headers: { 'cache-control': 'no-cache' },
      });
      const t1 = Date.now();
      const dateHeader = res.res.headers.get('date');
      if (dateHeader) {
        const serverMs = Date.parse(dateHeader);
        if (!isNaN(serverMs)) {
          // Add 500ms because HTTP Date resolution is 1s
          const offset = serverMs + 500 - (t0 + t1) / 2;
          offsets.push(offset);
        }
      }
    } catch {
      // Ignore single sample network failure
    }
  }

  if (offsets.length === 0) return 0;
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Non-busy-waiting sleep until target server time is reached.
 * Mitigates Spectre timer freeze on Cloudflare Workers (H6).
 */
export async function sleepUntil(targetServerMs: number, serverOffsetMs: number): Promise<void> {
  for (;;) {
    const nowServer = Date.now() + serverOffsetMs;
    const remaining = targetServerMs - nowServer;
    if (remaining <= 0) return;
    await sleep(Math.min(remaining, 1000));
  }
}
