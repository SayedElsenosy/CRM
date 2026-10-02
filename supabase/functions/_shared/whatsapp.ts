function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export type WhatsAppSender = { phoneNumberId: string; token: string };

function senderCredentials(sender?: WhatsAppSender): WhatsAppSender {
  return sender || { phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'), token: env('WHATSAPP_ACCESS_TOKEN') };
}

export async function sendWhatsAppText(to: string, body: string, sender?: WhatsAppSender): Promise<string | null> {
  return sendWhatsAppPayload(to, { type: 'text', text: { preview_url: false, body } }, sender);
}

export async function sendWhatsAppList(
  to: string, body: string, rows: { id: string; title: string }[], sender?: WhatsAppSender,
): Promise<string | null> {
  return sendWhatsAppPayload(to, {
    type: 'interactive', interactive: { type: 'list', body: { text: body },
      action: { button: 'اختار المنطقة', sections: [{ title: 'المناطق المتاحة', rows }] } },
  }, sender);
}

export async function sendWhatsAppButtons(
  to: string, body: string, buttons: { id: string; title: string }[], sender?: WhatsAppSender,
): Promise<string | null> {
  return sendWhatsAppPayload(to, {
    type: 'interactive', interactive: { type: 'button', body: { text: body },
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: b })) } },
  }, sender);
}

async function sendWhatsAppPayload(to: string, message: Record<string, unknown>, sender?: WhatsAppSender): Promise<string | null> {
  const { token, phoneNumberId } = senderCredentials(sender);
  const version = env('WHATSAPP_GRAPH_VERSION');

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      ...message,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('WhatsApp send failed', res.status, payload);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
  return payload?.messages?.[0]?.id ?? null;
}

export async function downloadWhatsAppMedia(mediaId: string, sender?: WhatsAppSender): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { token } = senderCredentials(sender);
  const version = env('WHATSAPP_GRAPH_VERSION');

  const metaRes = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`Cannot retrieve media URL: ${metaRes.status}`);
  const meta = await metaRes.json();
  const url = meta?.url;
  if (!url) throw new Error('Media URL missing');
  if (new URL(url).protocol !== 'https:') throw new Error('Unexpected media URL protocol');

  const fileRes = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!fileRes.ok) throw new Error(`Cannot download media: ${fileRes.status}`);
  const limit = 10 * 1024 * 1024;
  if (Number(fileRes.headers.get('content-length') ?? '0') > limit) {
    throw new Error('Media exceeds 10 MB');
  }
  const reader = fileRes.body?.getReader();
  if (!reader) throw new Error('Media response has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error('Media exceeds 10 MB');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const mimeType = fileRes.headers.get('content-type') || meta?.mime_type || 'application/octet-stream';
  return { bytes, mimeType };
}
