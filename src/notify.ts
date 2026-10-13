/**
 * src/notify.ts
 * Telegram Bot notification utility.
 * Non-blocking: failures must never break submission workflow.
 */

export async function sendTelegramNotification(
  botToken?: string,
  chatId?: string,
  message?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken || !chatId || !message) {
    return { ok: false, error: 'TELEGRAM_NOT_CONFIGURED' };
  }

  try {
    const trimmed = botToken.trim();
    const tokenPart = trimmed.startsWith('bot') ? trimmed : `bot${trimmed}`;
    const url = `https://api.telegram.org/${tokenPart}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `HTTP_${res.status}: ${errText}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
