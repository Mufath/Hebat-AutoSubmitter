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

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Samples server clock offset relative to local runtime clock using HTTP Second-Boundary Detection.
 * Because HTTP Date headers truncate milliseconds (1s resolution), adding a blind +500ms causes up to
 * ±500ms (0.5s) skew. Instead, we micro-probe across the second boundary until the Date header ticks
 * to the next second, narrowing the true offset [maxLowerBound, minUpperBound] to within ~20-50ms.
 * offset = serverTime - localTime (in ms)
 */
export async function sampleServerOffset(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string,
  maxProbes = 9,
  probeIntervalMs = 110
): Promise<number> {
  let maxLower = -Infinity;
  let minUpper = Infinity;
  let firstServerSecMs: number | null = null;
  let prevMidMs: number | null = null;
  let sampleCount = 0;

  for (let i = 0; i < maxProbes; i++) {
    if (bud.remaining <= 2) break;

    const t0 = Date.now();
    try {
      const res = await mfetch(
        jar,
        bud,
        `${baseUrl}/login/index.php`,
        {
          method: 'HEAD',
          headers: { 'cache-control': 'no-cache' },
        },
        0
      );
      const t1 = Date.now();
      const dateHeader = res.res.headers.get('date');
      if (dateHeader) {
        const serverMs = Date.parse(dateHeader);
        if (!isNaN(serverMs)) {
          const tMid = (t0 + t1) / 2;
          // Since serverMs is floored to the second: serverMs <= trueServerTime < serverMs + 1000
          const lower = serverMs - tMid;
          const upper = serverMs + 1000 - tMid;

          if (lower > maxLower) maxLower = lower;
          if (upper < minUpper) minUpper = upper;
          sampleCount++;

          if (firstServerSecMs === null) {
            firstServerSecMs = serverMs;
          } else if (serverMs > firstServerSecMs && prevMidMs !== null) {
            // Second boundary crossed! The server clock ticked to `serverMs` between prevMidMs and tMid.
            if (maxLower <= minUpper) {
              return Math.round((maxLower + minUpper) / 2);
            }
            return Math.round(serverMs - (prevMidMs + tMid) / 2);
          }

          prevMidMs = tMid;
        }
      }
    } catch {
      // Ignore single sample network failure
    }

    if (i < maxProbes - 1 && probeIntervalMs > 0) {
      await sleep(probeIntervalMs);
    }
  }

  if (sampleCount === 0) return 0;
  return Math.round((maxLower + minUpper) / 2);
}

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

/**
 * Warms up the TCP + TLS connection to Moodle just before target unlock (e.g. T - 1.5s)
 * so the first unlock poll does not pay TCP/TLS handshake overhead (~80-150ms),
 * and returns the measured Round-Trip Time (RTT) in ms for Pre-Arrival Timing (T - RTT/2).
 */
export async function warmUpConnection(
  jar: CookieJar,
  bud: Budget,
  baseUrl: string
): Promise<number> {
  if (bud.remaining <= 4) return 80;
  const t0 = Date.now();
  try {
    const res = await mfetch(
      jar,
      bud,
      `${baseUrl}/login/index.php`,
      {
        method: 'HEAD',
        headers: { 'cache-control': 'no-cache', connection: 'keep-alive' },
      },
      0
    );
    const rttMs = Math.max(10, res.elapsedMs || (Date.now() - t0));
    return Math.min(400, rttMs);
  } catch {
    return 80;
  }
}

