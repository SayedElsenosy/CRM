// WHATSAPP_TOKEN_KEY is a random, base64-encoded 32-byte secret set in Supabase.
function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

function base64FromBytes(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

async function encryptionKey(): Promise<CryptoKey> {
  const encoded = Deno.env.get('WHATSAPP_TOKEN_KEY');
  if (!encoded) throw new Error('WHATSAPP_TOKEN_KEY is not configured');
  const bytes = bytesFromBase64(encoded);
  if (bytes.byteLength !== 32) throw new Error('WHATSAPP_TOKEN_KEY must encode 32 bytes');
  return crypto.subtle.importKey('raw', bytes.buffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptAccountToken(token: string): Promise<{ token_ciphertext: string; token_iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(token));
  return { token_ciphertext: base64FromBytes(new Uint8Array(ciphertext)), token_iv: base64FromBytes(iv) };
}

export async function decryptAccountToken(ciphertext: string, iv: string): Promise<string> {
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromBase64(iv).buffer }, await encryptionKey(), bytesFromBase64(ciphertext).buffer,
  );
  return new TextDecoder().decode(clear);
}
