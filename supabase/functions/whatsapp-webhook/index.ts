import { createClient } from 'npm:@supabase/supabase-js@2';
import { MESSAGES } from '../_shared/config.ts';
import { normalizeAreaName, parseAge, parseArea, parseYesNo } from '../_shared/parsers.ts';
import { extractWithGemini } from '../_shared/gemini.ts';
import { downloadWhatsAppMedia, sendWhatsAppButtons, sendWhatsAppList, sendWhatsAppText, type WhatsAppSender } from '../_shared/whatsapp.ts';
import { decryptAccountToken } from '../_shared/account-crypto.ts';

type Applicant = {
  id: string;
  phone: string;
  whatsapp_name: string | null;
  age: number | null;
  preferred_area: string | null;
  has_motorcycle: boolean | null;
  has_motorcycle_license: boolean | null;
  accepts_nine_hour_shift: boolean | null;
  state: string;
  ai_active: boolean;
  last_whatsapp_phone_number_id: string | null;
  sender?: WhatsAppSender;
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Meta webhook verification
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token && expected && token === expected && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  if (!(await verifyMetaSignature(req.headers.get('x-hub-signature-256'), rawBody))) {
    return new Response('Invalid signature', { status: 401 });
  }
  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!payload) return Response.json({ ok: true });

  // Acknowledge Meta immediately, continue asynchronously.
  EdgeRuntime.waitUntil(processWebhook(payload));
  return Response.json({ ok: true });
});


async function verifyMetaSignature(signatureHeader: string | null, rawBody: string): Promise<boolean> {
  const appSecret = Deno.env.get('META_APP_SECRET');
  // This endpoint has no Supabase JWT gate. Never accept unsigned traffic.
  if (!appSecret) {
    console.error('META_APP_SECRET is missing');
    return false;
  }
  if (!signatureHeader?.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = 'sha256=' + [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signatureHeader.length) return false;

  // Constant-time-ish comparison for equal-length ASCII strings.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

async function processWebhook(payload: any) {
  try {
    const changes = payload?.entry?.flatMap((e: any) => e?.changes ?? []) ?? [];
    for (const change of changes) {
      const value = change?.value;
      const contacts = value?.contacts ?? [];
      const contactNameByWaId = new Map<string, string>();
      for (const c of contacts) {
        if (c?.wa_id) contactNameByWaId.set(c.wa_id, c?.profile?.name ?? '');
      }
      const messages = value?.messages ?? [];
      for (const msg of messages) {
        try {
          await processIncomingMessage(msg, contactNameByWaId.get(msg?.from) || null,
            String(value?.metadata?.phone_number_id || ''));
        } catch (error) {
          console.error('Failed to process WhatsApp message', msg?.id, error);
        }
      }
    }
  } catch (err) {
    console.error('processWebhook failed', err);
  }
}

async function resolveSender(phoneNumberId: string): Promise<WhatsAppSender> {
  if (!phoneNumberId) throw new Error('Inbound WhatsApp number ID is missing');
  const { data, error } = await supabase.from('whatsapp_accounts')
    .select('status,token_ciphertext,token_iv').eq('phone_number_id', phoneNumberId).maybeSingle();
  if (error) throw error;
  if (data) {
    if (data.status !== 'ACTIVE') throw new Error('Inbound WhatsApp account is inactive');
    if (data.token_ciphertext && data.token_iv) {
      return { phoneNumberId, token: await decryptAccountToken(data.token_ciphertext, data.token_iv) };
    }
    // An older 006 row may be metadata-only. Keep the original environment
    // number working until its token is re-entered through the admin panel.
    if (phoneNumberId !== Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')) {
      throw new Error('WhatsApp account token has not been configured');
    }
  } else if (phoneNumberId !== Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')) {
    throw new Error('Unrecognized WhatsApp number ID');
  }
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is missing');
  return { phoneNumberId, token };
}

async function processIncomingMessage(msg: any, whatsappName: string | null, receivedPhoneNumberId: string) {
  const phone = String(msg?.from ?? '');
  const waMessageId = String(msg?.id ?? '');
  const type = String(msg?.type ?? 'unknown');
  if (!phone || !waMessageId) return;
  const sender = await resolveSender(receivedPhoneNumberId);

  // Idempotency: Meta may retry webhooks.
  const { data: already } = await supabase
    .from('messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle();
  if (already) return;

  let applicant = await getOrCreateApplicant(phone, whatsappName);
  applicant.sender = sender;
  if (applicant.last_whatsapp_phone_number_id !== sender.phoneNumberId) {
    applicant = await patchApplicant(applicant, { last_whatsapp_phone_number_id: sender.phoneNumberId });
  }
  applicant = await recordReferral(applicant, msg);

  const textBody = type === 'text' ? String(msg?.text?.body ?? '') :
    type === 'interactive' ? String(msg?.interactive?.list_reply?.id || msg?.interactive?.button_reply?.id || '') : null;
  const inboundBody = type === 'interactive' ?
    String(msg?.interactive?.list_reply?.title || msg?.interactive?.button_reply?.title || '') : textBody;
  const { error: inboundError } = await supabase.from('messages').insert({
    applicant_id: applicant.id,
    wa_message_id: waMessageId,
    direction: 'INBOUND',
    message_type: type,
    body: inboundBody,
    whatsapp_phone_number_id: sender.phoneNumberId,
    raw_payload: msg,
  });
  if (inboundError) {
    if (inboundError.code === '23505') return; // duplicate delivery
    throw inboundError;
  }

  if (!applicant.ai_active || applicant.state === 'HUMAN_HANDOFF' || applicant.state === 'READY_FOR_RECRUITER') {
    return;
  }

  if (applicant.state === 'NEW') {
    await startDynamicFlow(applicant);
    return;
  }

  // Only new applicants use the dynamic flow. Existing in-progress applicants
  // continue the original state machine until they finish.
  if (applicant.state === 'DYNAMIC_FLOW') {
    await handleDynamicFlow(applicant, msg, textBody);
    return;
  }

  switch (applicant.state) {
    case 'WAITING_AGE':
      await handleAge(applicant, textBody);
      return;
    case 'WAITING_AREA':
      await handleArea(applicant, textBody);
      return;
    case 'WAITING_AREA_CONFIRMATION':
      await handleAreaConfirmation(applicant, textBody);
      return;
    case 'WAITING_MOTORCYCLE':
      await handleYesNo(applicant, textBody, 'has_motorcycle', 'WAITING_LICENSE', MESSAGES.askLicense, 'NO_MOTORCYCLE');
      return;
    case 'WAITING_LICENSE':
      await handleYesNo(applicant, textBody, 'has_motorcycle_license', 'WAITING_SHIFT', MESSAGES.askShift, 'NO_MOTORCYCLE_LICENSE');
      return;
    case 'WAITING_SHIFT':
      await handleYesNo(applicant, textBody, 'accepts_nine_hour_shift', 'WAITING_ID_DOC', MESSAGES.askIdDoc, 'SHIFT_NOT_ACCEPTED');
      return;
    case 'WAITING_ID_DOC':
      await handleDocument(applicant, msg, 'ID_IMAGE', 'WAITING_LICENSE_DOC', MESSAGES.askLicenseDoc);
      return;
    case 'WAITING_LICENSE_DOC':
      await handleDocument(applicant, msg, 'MOTORCYCLE_LICENSE_IMAGE', 'READY_FOR_RECRUITER', MESSAGES.handoff, true);
      return;
    default:
      return;
  }
}

async function getOrCreateApplicant(phone: string, whatsappName: string | null): Promise<Applicant> {
  const { data: existing, error: e1 } = await supabase
    .from('applicants')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) {
    if (whatsappName && !existing.whatsapp_name) {
      const { data, error } = await supabase
        .from('applicants')
        .update({ whatsapp_name: whatsappName })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      return data as Applicant;
    }
    return existing as Applicant;
  }

  const { data, error } = await supabase
    .from('applicants')
    .insert({ phone, whatsapp_name: whatsappName, state: 'NEW' })
    .select('*')
    .single();
  if (error) throw error;
  return data as Applicant;
}

async function recordReferral(applicant: Applicant, msg: any): Promise<Applicant> {
  const referral = msg?.referral;
  if (!referral || typeof referral !== 'object') return applicant;
  const patch: Record<string, string> = {};
  // Meta supplies an ad source ID on Click-to-WhatsApp messages. It does not
  // generally supply a campaign ID here, so leave campaign_id unset.
  if (referral.source_type === 'ad' && typeof referral.source_id === 'string') {
    patch.ad_id = referral.source_id.slice(0, 128);
    patch.ad_ref = patch.ad_id;
    patch.source = 'facebook_ad';
  } else if (referral.source_type === 'post' && typeof referral.source_id === 'string') {
    patch.ad_ref = referral.source_id.slice(0, 128);
    patch.source = 'facebook_post';
  }
  if (!Object.keys(patch).length) return applicant;
  // Preserve first-touch attribution if the applicant writes again later.
  const { data: existing, error } = await supabase.from('applicants')
    .select('source,ad_id,ad_ref').eq('id', applicant.id).single();
  if (error) throw error;
  if (existing?.ad_id || existing?.ad_ref) return applicant;
  return patchApplicant(applicant, patch);
}

async function patchApplicant(applicant: Applicant, patch: Record<string, unknown>): Promise<Applicant> {
  const { data, error } = await supabase
    .from('applicants')
    .update(patch)
    .eq('id', applicant.id)
    .select('*')
    .single();
  if (error) throw error;
  return { ...data, sender: applicant.sender } as Applicant;
}

async function reply(applicant: Applicant, text: string) {
  const waId = await sendWhatsAppText(applicant.phone, text, applicant.sender);
  await logOutbound(applicant, waId, 'text', text);
}

async function logOutbound(applicant: Applicant, waId: string | null, messageType: string, body: string) {
  const { error } = await supabase.from('messages').insert({
    applicant_id: applicant.id,
    wa_message_id: waId,
    direction: 'OUTBOUND',
    message_type: messageType,
    body,
    whatsapp_phone_number_id: applicant.sender?.phoneNumberId || null,
  });
  if (error) throw error;
}

async function reject(applicant: Applicant, reason: string) {
  applicant = await patchApplicant(applicant, {
    state: 'NOT_ELIGIBLE',
    rejection_reason: reason,
    ai_active: false,
  });
  await reply(applicant, MESSAGES.notEligible);
}

async function handleAge(applicant: Applicant, text: string | null) {
  if (!text) return reply(applicant, MESSAGES.clarifyAge);
  let age = parseAge(text);
  if (age === null) {
    const ai = await extractWithGemini('WAITING_AGE', text);
    age = ai?.understood && typeof ai.age === 'number' ? ai.age : null;
  }
  if (age === null || !Number.isInteger(age)) return reply(applicant, MESSAGES.clarifyAge);
  if (age < 18 || age > 45) return reject(applicant, 'AGE_OUT_OF_RANGE');
  applicant = await patchApplicant(applicant, { age, state: 'WAITING_AREA' });
  await replyAreaPrompt(applicant, 'تمام. أنهي منطقة مناسبة ليك للعمل؟');
}

type DeliveryZone = { id: string; name: string; details: string; is_active: boolean };

async function activeZones(): Promise<DeliveryZone[]> {
  const { data, error } = await supabase.from('delivery_zones')
    .select('id,name,details,is_active').eq('is_active', true)
    .order('sort_order').order('name');
  if (error) throw error;
  return (data ?? []) as DeliveryZone[];
}

function zoneList(zones: DeliveryZone[], heading: string): string {
  return zones.length ? `${heading}\n${zones.map(z => z.name).join(' - ')}` :
    'اختيار المناطق متوقف مؤقتًا. حاول تاني بعد شوية.';
}

async function replyAreaPrompt(applicant: Applicant, heading: string, page = 0, available?: DeliveryZone[]) {
  const zones = available || await activeZones();
  if (!zones.length) return reply(applicant, zoneList(zones, heading));
  const pageSize = 8;
  const pageCount = Math.ceil(zones.length / pageSize);
  const current = Math.max(0, Math.min(page, pageCount - 1));
  const rows = zones.slice(current * pageSize, (current + 1) * pageSize)
    .map(z => ({ id: `zone:${z.id}`, title: z.name.slice(0, 24) }));
  if (current > 0) rows.push({ id: `zone_page:${current - 1}`, title: 'المناطق السابقة' });
  if (current + 1 < pageCount) rows.push({ id: `zone_page:${current + 1}`, title: 'مناطق أخرى' });
  const body = `${heading.slice(0, 800)}\nاضغط «اختار المنطقة» أو اكتب اسمها.`;
  const waId = await sendWhatsAppList(applicant.phone, body, rows, applicant.sender);
  await logOutbound(applicant, waId, 'interactive', `${body}\n${rows.map(r => r.title).join(' - ')}`);
}

function zonePage(text: string | null): number | null {
  const match = text?.match(/^zone_page:(\d{1,3})$/);
  return match ? Number(match[1]) : null;
}

function findZone(text: string, zones: DeliveryZone[]): DeliveryZone | undefined {
  const normalized = normalizeAreaName(text);
  const direct = zones.find(z => normalizeAreaName(z.name) === normalized);
  if (direct) return direct;
  const alias = parseArea(text);
  return alias ? zones.find(z => z.name === alias) : undefined;
}

async function chooseZone(text: string | null, zones: DeliveryZone[]): Promise<DeliveryZone | undefined> {
  if (!text || !zones.length) return undefined;
  if (text.startsWith('zone:')) return zones.find(z => `zone:${z.id}` === text);
  const direct = findZone(text, zones);
  if (direct) return direct;
  const ai = await extractWithGemini('WAITING_AREA', text, zones.map(z => z.name));
  return ai?.understood && ai.area ? findZone(String(ai.area), zones) : undefined;
}

function zoneDetails(zone: DeliveryZone): string {
  return `المنطقة المختارة: ${zone.name}\n${zone.details.trim() || 'تفاصيل إضافية للمنطقة غير متاحة حاليًا.'}`;
}

async function replyZoneDetails(applicant: Applicant, zone: DeliveryZone) {
  await reply(applicant, zoneDetails(zone));
  const prompt = 'هل المنطقة مناسبة ليك؟';
  const waId = await sendWhatsAppButtons(applicant.phone, prompt, [
    { id: 'zone_confirm', title: 'نعم مناسبة' },
    { id: 'zone_change', title: 'تغيير المنطقة' },
  ], applicant.sender);
  await logOutbound(applicant, waId, 'interactive', prompt);
}

function zoneDecision(text: string | null): 'confirm' | 'change' | null {
  if (!text) return null;
  if (text === 'zone_confirm') return 'confirm';
  if (text === 'zone_change') return 'change';
  const normalized = normalizeAreaName(text);
  if (['تغيير', 'تغيير المنطقه', 'اختيار منطقه اخري', 'غير', 'منطقه تانيه', 'اختار غيرها'].includes(normalized)) return 'change';
  const yes = parseYesNo(text);
  return yes === true ? 'confirm' : yes === false ? 'change' : null;
}

async function setPendingZone(applicantId: string, zoneId: string | null) {
  const { error } = await supabase.from('applicant_sessions').upsert({
    applicant_id: applicantId, pending_zone_id: zoneId, updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id' });
  if (error) throw error;
}

async function handleArea(applicant: Applicant, text: string | null) {
  const zones = await activeZones();
  const page = zonePage(text);
  if (page !== null) return replyAreaPrompt(applicant, 'اختار منطقة مناسبة ليك:', page, zones);
  const zone = await chooseZone(text, zones);
  if (!zone) return replyAreaPrompt(applicant, 'اختار منطقة مناسبة ليك:', 0, zones);
  await setPendingZone(applicant.id, zone.id);
  applicant = await patchApplicant(applicant, { state: 'WAITING_AREA_CONFIRMATION' });
  await replyZoneDetails(applicant, zone);
}

async function handleAreaConfirmation(applicant: Applicant, text: string | null) {
  const { data: session, error } = await supabase.from('applicant_sessions')
    .select('pending_zone_id').eq('applicant_id', applicant.id).maybeSingle();
  if (error) throw error;
  const zones = await activeZones();
  const zone = zones.find(z => z.id === session?.pending_zone_id);
  if (!zone || zoneDecision(text) === 'change') {
    await setPendingZone(applicant.id, null);
    applicant = await patchApplicant(applicant, { state: 'WAITING_AREA' });
    return replyAreaPrompt(applicant, 'اختار منطقة تانية مناسبة ليك:', 0, zones);
  }
  if (zoneDecision(text) !== 'confirm') {
    return reply(applicant, 'اكتب نعم لتأكيد المنطقة أو تغيير لاختيار منطقة تانية.');
  }
  applicant = await patchApplicant(applicant, { preferred_area: zone.name, state: 'WAITING_MOTORCYCLE' });
  await setPendingZone(applicant.id, null);
  await reply(applicant, MESSAGES.askMotorcycle);
}

async function handleYesNo(
  applicant: Applicant,
  text: string | null,
  field: 'has_motorcycle' | 'has_motorcycle_license' | 'accepts_nine_hour_shift',
  nextState: string,
  nextMessage: string,
  rejectionReason: string,
) {
  if (!text) return reply(applicant, MESSAGES.clarifyYesNo);
  let answer = parseYesNo(text);
  if (answer === null) {
    const stateMap: Record<string, 'WAITING_MOTORCYCLE'|'WAITING_LICENSE'|'WAITING_SHIFT'> = {
      has_motorcycle: 'WAITING_MOTORCYCLE',
      has_motorcycle_license: 'WAITING_LICENSE',
      accepts_nine_hour_shift: 'WAITING_SHIFT',
    };
    const ai = await extractWithGemini(stateMap[field], text);
    answer = ai?.understood && typeof ai.yes_no === 'boolean' ? ai.yes_no : null;
  }
  if (answer === null) return reply(applicant, MESSAGES.clarifyYesNo);
  if (!answer) return reject(applicant, rejectionReason);
  applicant = await patchApplicant(applicant, { [field]: true, state: nextState });
  await reply(applicant, nextMessage);
}

async function handleDocument(
  applicant: Applicant,
  msg: any,
  kind: 'ID_IMAGE' | 'MOTORCYCLE_LICENSE_IMAGE',
  nextState: string,
  nextMessage: string,
  handoff = false,
) {
  if (!(await storeDocument(applicant, msg, kind))) return;
  const patch: Record<string, unknown> = { state: nextState };
  if (handoff) {
    patch.ai_active = false;
    patch.handoff_at = new Date().toISOString();
  }
  applicant = await patchApplicant(applicant, patch);
  await reply(applicant, nextMessage);
}

async function storeDocument(
  applicant: Applicant,
  msg: any,
  kind: 'ID_IMAGE' | 'MOTORCYCLE_LICENSE_IMAGE',
): Promise<boolean> {
  if (msg?.type !== 'image' || !msg?.image?.id) {
    await reply(applicant, MESSAGES.needImage);
    return false;
  }
  const mediaId = String(msg.image.id);
  const declaredMime = String(msg.image.mime_type ?? 'image/jpeg');
  const { bytes, mimeType } = await downloadWhatsAppMedia(mediaId, applicant.sender);

  // Basic safety limits for the MVP: image only, <= 10MB.
  const effectiveMime = mimeType.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(effectiveMime) ||
      (declaredMime && !['image/jpeg', 'image/png', 'image/webp'].includes(declaredMime.toLowerCase()))) {
    await reply(applicant, 'الصورة المرسلة غير مدعومة. ابعت صورة JPG أو PNG من فضلك.');
    return false;
  }
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.slice(0, 8).every((v, i) => v === [137,80,78,71,13,10,26,10][i]);
  const isWebp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!((effectiveMime === 'image/jpeg' && isJpeg) ||
        (effectiveMime === 'image/png' && isPng) ||
        (effectiveMime === 'image/webp' && isWebp))) {
    await reply(applicant, 'الملف لا يبدو صورة صالحة. ابعت صورة JPG أو PNG من فضلك.');
    return false;
  }
  if (bytes.byteLength > 10 * 1024 * 1024) {
    await reply(applicant, 'حجم الصورة كبير جدًا. ابعت صورة أقل من 10 ميجا من فضلك.');
    return false;
  }

  const ext = effectiveMime.includes('png') ? 'png' : effectiveMime.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `${applicant.id}/${kind.toLowerCase()}-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('recruitment-documents')
    .upload(storagePath, bytes, { contentType: effectiveMime, upsert: false });
  if (uploadError) throw uploadError;

  const { error: docError } = await supabase
    .from('documents')
    .upsert({
      applicant_id: applicant.id,
      kind,
      wa_media_id: mediaId,
      mime_type: effectiveMime,
      storage_path: storagePath,
      received_at: new Date().toISOString(),
    }, { onConflict: 'applicant_id,kind' });
  if (docError) throw docError;
  return true;
}


type BotQuestion = {
  id: string;
  question_key: string | null;
  question_text: string;
  question_type: string;
  step_order: number;
};
const CORE_KEYS = ['age', 'area', 'motorcycle', 'license', 'shift', 'id_document', 'license_document'];

async function activeQuestions(): Promise<BotQuestion[]> {
  const { data, error } = await supabase.from('bot_questions')
    .select('id,question_key,question_text,question_type,step_order')
    .eq('is_active', true).order('step_order').order('id');
  if (error) throw error;
  const questions = (data ?? []) as BotQuestion[];
  const keys = questions.map(q => q.question_key);
  if (CORE_KEYS.some(key => keys.filter(k => k === key).length !== 1)) {
    throw new Error('Required bot questions must all be active exactly once.');
  }
  if (new Set(questions.map(q => q.step_order)).size !== questions.length) {
    throw new Error('Active bot questions must have unique step_order values.');
  }
  const position = (key: string) => questions.findIndex(q => q.question_key === key);
  if (position('age') !== 0 ||
      Math.max(...CORE_KEYS.slice(0, 5).map(position)) >= position('id_document') ||
      position('id_document') >= position('license_document') ||
      position('license_document') !== questions.length - 1) {
    throw new Error('Age must be first and required documents must follow screening, with license document last.');
  }
  for (const q of questions) {
    if (!q.question_text?.trim()) throw new Error('Active question has empty text.');
    const expected: Record<string, string> = {
      age: 'number', area: 'select', motorcycle: 'yes_no',
      license: 'yes_no', shift: 'yes_no',
      id_document: 'image', license_document: 'image',
    };
    if (q.question_key && (!expected[q.question_key] || q.question_type !== expected[q.question_key])) {
      throw new Error('Invalid core question key or type: ' + q.question_key);
    }
    if (!q.question_key && !['text', 'number', 'select', 'yes_no'].includes(q.question_type)) {
      throw new Error('Optional questions must use a supported text input type.');
    }
  }
  return questions;
}

async function replyQuestion(applicant: Applicant, question: BotQuestion): Promise<void> {
  if (question.question_key === 'area') await replyAreaPrompt(applicant, question.question_text);
  else await reply(applicant, question.question_text);
}

async function startDynamicFlow(applicant: Applicant) {
  let questions: BotQuestion[];
  try { questions = await activeQuestions(); }
  catch (error) {
    console.error('Bot question configuration error', error);
    await reply(applicant, 'التقديم متوقف مؤقتًا. حاول تاني بعد شوية.');
    return;
  }
  const first = questions[0];
  const { error } = await supabase.from('applicant_sessions').upsert({
    applicant_id: applicant.id,
    current_question_id: first.id,
    pending_zone_id: null,
    completion_percentage: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id' });
  if (error) throw error;
  applicant = await patchApplicant(applicant, { state: 'DYNAMIC_FLOW' });
  await reply(applicant, 'أهلًا بك في التقديم لوظيفة طيار دليفري. ' + first.question_text);
}

async function saveAnswer(applicantId: string, questionId: string, answerValue: string) {
  const { error } = await supabase.from('bot_answers').upsert({
    applicant_id: applicantId, question_id: questionId, answer_value: answerValue,
  }, { onConflict: 'applicant_id,question_id' });
  if (error) throw error;
}

async function setCurrentQuestion(applicantId: string, questionId: string | null, percentage: number) {
  const { data, error } = await supabase.from('applicant_sessions').update({
    current_question_id: questionId,
    pending_zone_id: null,
    completion_percentage: percentage,
    updated_at: new Date().toISOString(),
  }).eq('applicant_id', applicantId).select('id').single();
  if (error || !data) throw error || new Error('Applicant session missing');
}

async function handleDynamicFlow(applicant: Applicant, msg: any, textBody: string | null): Promise<void> {
  let questions: BotQuestion[];
  try { questions = await activeQuestions(); }
  catch (error) {
    console.error('Bot question configuration error', error);
    await reply(applicant, 'التقديم متوقف مؤقتًا. حاول تاني بعد شوية.');
    return;
  }
  const { data: session, error: sessionError } = await supabase.from('applicant_sessions')
    .select('current_question_id,pending_zone_id').eq('applicant_id', applicant.id).single();
  if (sessionError || !session?.current_question_id) {
    throw sessionError || new Error('Dynamic applicant has no current question');
  }
  let index = questions.findIndex(q => q.id === session.current_question_id);
  if (index < 0) {
    // Optional question was disabled while this applicant was answering it.
    const { data: previous, error } = await supabase.from('bot_questions')
      .select('step_order').eq('id', session.current_question_id).single();
    if (error || !previous) throw error || new Error('Current question missing');
    index = questions.findIndex(q => q.step_order > previous.step_order);
    if (index < 0) throw new Error('No active question after disabled question');
    await setCurrentQuestion(applicant.id, questions[index].id, Math.round(100 * index / questions.length));
    await replyQuestion(applicant, questions[index]);
    return;
  }
  const question = questions[index];
  const key = question.question_key;
  const text = textBody?.trim() || '';
  let answer = text;
  let patch: Record<string, unknown> = {};
  let rejectionReason: string | null = null;

  if (key === 'age') {
    let age = text ? parseAge(text) : null;
    if (age === null && text) {
      const ai = await extractWithGemini('WAITING_AGE', text);
      age = ai?.understood && typeof ai.age === 'number' ? ai.age : null;
    }
    if (age === null || !Number.isInteger(age)) return reply(applicant, MESSAGES.clarifyAge);
    answer = String(age);
    if (age < 18 || age > 45) rejectionReason = 'AGE_OUT_OF_RANGE';
    else patch.age = age;
  } else if (key === 'area') {
    const zones = await activeZones();
    if (session.pending_zone_id) {
      const zone = zones.find(z => z.id === session.pending_zone_id);
      if (!zone || zoneDecision(text) === 'change') {
        await setPendingZone(applicant.id, null);
        return replyAreaPrompt(applicant, 'اختار منطقة تانية مناسبة ليك:', 0, zones);
      }
      if (zoneDecision(text) !== 'confirm') {
        return reply(applicant, 'اكتب نعم لتأكيد المنطقة أو تغيير لاختيار منطقة تانية.');
      }
      answer = zone.name;
      patch.preferred_area = zone.name;
    } else {
      const page = zonePage(text);
      if (page !== null) return replyAreaPrompt(applicant, question.question_text, page, zones);
      const zone = await chooseZone(text, zones);
      if (!zone) return replyAreaPrompt(applicant, question.question_text, 0, zones);
      await setPendingZone(applicant.id, zone.id);
      return replyZoneDetails(applicant, zone);
    }
  } else if (key === 'motorcycle' || key === 'license' || key === 'shift') {
    let yes = text ? parseYesNo(text) : null;
    if (yes === null && text) {
      const state = key === 'motorcycle' ? 'WAITING_MOTORCYCLE' :
        key === 'license' ? 'WAITING_LICENSE' : 'WAITING_SHIFT';
      const ai = await extractWithGemini(state, text);
      yes = ai?.understood && typeof ai.yes_no === 'boolean' ? ai.yes_no : null;
    }
    if (yes === null) return reply(applicant, MESSAGES.clarifyYesNo);
    answer = yes ? 'yes' : 'no';
    if (!yes) rejectionReason = key === 'motorcycle' ? 'NO_MOTORCYCLE' :
      key === 'license' ? 'NO_MOTORCYCLE_LICENSE' : 'SHIFT_NOT_ACCEPTED';
    else patch[key === 'motorcycle' ? 'has_motorcycle' :
      key === 'license' ? 'has_motorcycle_license' : 'accepts_nine_hour_shift'] = true;
  } else if (key === 'id_document' || key === 'license_document') {
    const kind = key === 'id_document' ? 'ID_IMAGE' : 'MOTORCYCLE_LICENSE_IMAGE';
    if (!(await storeDocument(applicant, msg, kind))) return;
    answer = '[IMAGE]';
  } else {
    if (!text || text.length > 1000) {
      return reply(applicant, 'اكتب إجابة نصية لا تزيد عن ١٠٠٠ حرف من فضلك.');
    }
    if (question.question_type === 'yes_no' && parseYesNo(text) === null) {
      return reply(applicant, MESSAGES.clarifyYesNo);
    }
    if (question.question_type === 'number' && !/^\d+$/.test(text)) {
      return reply(applicant, 'اكتب رقمًا من فضلك.');
    }
  }

  await saveAnswer(applicant.id, question.id, answer);
  if (rejectionReason) {
    await setCurrentQuestion(applicant.id, null, Math.round(100 * (index + 1) / questions.length));
    await reject(applicant, rejectionReason);
    return;
  }
  if (Object.keys(patch).length) applicant = await patchApplicant(applicant, patch);
  const next = questions[index + 1];
  if (next) {
    await setCurrentQuestion(applicant.id, next.id, Math.round(100 * (index + 1) / questions.length));
    await replyQuestion(applicant, next);
    return;
  }
  const { data: docs, error: docsError } = await supabase.from('documents')
    .select('kind').eq('applicant_id', applicant.id);
  if (docsError) throw docsError;
  if (!docs?.some((d: { kind: string }) => d.kind === 'ID_IMAGE') ||
      !docs?.some((d: { kind: string }) => d.kind === 'MOTORCYCLE_LICENSE_IMAGE')) {
    throw new Error('Cannot hand off before both documents are stored');
  }
  await setCurrentQuestion(applicant.id, null, 100);
  applicant = await patchApplicant(applicant, {
    state: 'READY_FOR_RECRUITER', ai_active: false,
    handoff_at: new Date().toISOString(),
  });
  await reply(applicant, MESSAGES.handoff);
}
