import { createClient } from 'npm:@supabase/supabase-js@2';
import { encryptAccountToken } from '../_shared/account-crypto.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const origins = new Set((Deno.env.get('DASHBOARD_ALLOWED_ORIGINS') ||
  'https://rider-recruitment-hub.g24tgt32.chatgpt.site').split(',').map(v => v.trim()));

function json(body: unknown, status: number, origin: string | null): Response {
  return Response.json(body, { status, headers: {
    ...(origin && origins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary': 'Origin',
  } });
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async req => {
  const origin = req.headers.get('origin');
  if (origin && !origins.has(origin)) return json({ error: 'Origin not allowed' }, 403, null);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': origin || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-region',
    'Vary': 'Origin',
  } });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  const jwt = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!jwt) return json({ error: 'Authentication required' }, 401, origin);
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: 'Invalid session' }, 401, origin);
  const { data: allowed, error: gateError } = await userClient.rpc('is_recruiter');
  if (gateError || allowed !== true) return json({ error: 'Recruiter access required' }, 403, origin);

  let input: Record<string, unknown>;
  try { input = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, origin); }
  try {
    if (input.action === 'list') {
      const { data, error } = await service.from('whatsapp_accounts')
        .select('id,name,phone_number,phone_number_id,business_account_id,status,is_default,token_ciphertext,updated_at')
        .order('created_at');
      if (error) throw error;
      return json({ accounts: (data || []).map(({ token_ciphertext, ...row }) => ({
        ...row, has_token: !!token_ciphertext,
      })) }, 200, origin);
    }
    if (input.action === 'save') {
      if (input.id != null && !uuid(input.id)) return json({ error: 'Invalid account ID' }, 400, origin);
      const name = String(input.name || '').trim();
      const phone = String(input.phone_number || '').trim();
      const numberId = String(input.phone_number_id || '').trim();
      const businessId = String(input.business_account_id || '').trim();
      const token = String(input.token || '').trim();
      if (!name || name.length > 100 || !/^\+?[0-9]{8,18}$/.test(phone) ||
          !/^[0-9]{5,30}$/.test(numberId) || (businessId && !/^[0-9]{5,30}$/.test(businessId)) ||
          token.length > 4096 || (!input.id && !token)) {
        return json({ error: 'Check account name, phone, Meta IDs and token' }, 400, origin);
      }
      const fields: Record<string, unknown> = {
        name, phone_number: phone, phone_number_id: numberId, business_account_id: businessId || null,
      };
      if (token) Object.assign(fields, { ...(await encryptAccountToken(token)), access_token: null });
      const query = input.id ? service.from('whatsapp_accounts').update(fields).eq('id', input.id) :
        service.from('whatsapp_accounts').insert(fields);
      const { data, error } = await query.select('id').single();
      if (error) throw error;
      return json({ id: data.id }, 200, origin);
    }
    if (input.action === 'status') {
      if (!uuid(input.id) || typeof input.active !== 'boolean') return json({ error: 'Invalid status' }, 400, origin);
      const { data: current, error: readError } = await service.from('whatsapp_accounts')
        .select('is_default,token_ciphertext').eq('id', input.id).single();
      if (readError) throw readError;
      if (!input.active && current.is_default) return json({ error: 'Choose another primary number before disabling this one' }, 409, origin);
      if (input.active && !current.token_ciphertext) return json({ error: 'Add a token before activating this number' }, 409, origin);
      const { error } = await service.from('whatsapp_accounts')
        .update({ status: input.active ? 'ACTIVE' : 'INACTIVE' }).eq('id', input.id);
      if (error) throw error;
      return json({ ok: true }, 200, origin);
    }
    if (input.action === 'default') {
      if (!uuid(input.id)) return json({ error: 'Invalid account ID' }, 400, origin);
      const { error } = await userClient.rpc('set_default_whatsapp_account', { p_id: input.id });
      if (error) throw error;
      return json({ ok: true }, 200, origin);
    }
    return json({ error: 'Unknown action' }, 400, origin);
  } catch (error) {
    console.error('Account operation failed', (error as { code?: string }).code || 'unknown');
    return json({ error: (error as { code?: string }).code === '23505' ? 'Phone Number ID already exists' :
      'Could not save account. Check the fields and try again.' }, 500, origin);
  }
});
