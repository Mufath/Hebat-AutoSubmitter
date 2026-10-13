/**
 * src/log.ts
 * Structured logger with automated secret redaction.
 */

export interface LogEntry {
  t: number;
  lvl: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  ev: string;
  data?: unknown;
}

export class Logger {
  private secrets: string[] = [];

  constructor(secrets: (string | undefined)[] = []) {
    for (const s of secrets) {
      if (s && s.length >= 4) {
        this.secrets.push(s);
      }
    }
  }

  addSecret(s?: string): void {
    if (s && s.length >= 4 && !this.secrets.includes(s)) {
      this.secrets.push(s);
    }
  }

  redact(str: string): string {
    let out = str;
    for (const secret of this.secrets) {
      out = out.replaceAll(secret, '[REDACTED_SECRET]');
    }
    out = out.replace(/MoodleSession=[^;\s&]+/g, 'MoodleSession=[REDACTED]');
    out = out.replace(/["']?sesskey["']?\s*:\s*["'][^"']+["']/gi, '"sesskey":"[REDACTED]"');
    out = out.replace(/sesskey=[a-zA-Z0-9]+/gi, 'sesskey=[REDACTED]');
    out = out.replace(/logintoken=[a-zA-Z0-9]+/gi, 'logintoken=[REDACTED]');
    out = out.replace(/bot[0-9]+:[a-zA-Z0-9_-]+/gi, 'bot[REDACTED_TELEGRAM_TOKEN]');
    return out;
  }

  formatEntry(lvl: LogEntry['lvl'], ev: string, data?: unknown): LogEntry {
    const rawStr = data !== undefined ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : undefined;
    const redactedData = rawStr ? JSON.parse(this.redact(rawStr)) : undefined;

    return {
      t: Date.now(),
      lvl,
      ev: this.redact(ev),
      data: redactedData,
    };
  }

  log(lvl: LogEntry['lvl'], ev: string, data?: unknown): LogEntry {
    const entry = this.formatEntry(lvl, ev, data);
    console.log(`[${entry.lvl}] [${entry.ev}]`, entry.data !== undefined ? JSON.stringify(entry.data) : '');
    return entry;
  }
}
