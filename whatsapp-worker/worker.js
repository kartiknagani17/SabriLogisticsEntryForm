// Sabri Logistics: sends a GC receipt PDF to the consignor on WhatsApp (Meta Cloud API).
// Runs on Cloudflare Workers (free plan), so the PDFs do not count against Supabase's monthly egress.
// Setup: see SETUP.md next to this file.
// Variables / secrets to add in Cloudflare (Settings -> Variables and Secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY  - same values as in dist/config.js (used to check the user is signed in)
//   WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE - from Meta (WhatsApp -> API Setup); WA_LANG optional, default "en"
//   WA_WABA_ID - WhatsApp Business Account ID (for the balance box in Accounting)
//   WA_HOOK_SECRET - long random string; Meta's webhook calls https://<this worker>/hook/<WA_HOOK_SECRET> (also its verify token).
//     It must equal the value stored in the database table wa_state (supabase-scale/7-wa-funds-alert.sql).
//   ALLOWED_ORIGINS - optional, comma-separated site addresses allowed to call this (default: any)

let CORS = {};
const corsFor = (req, env) => {
  const origin = req.headers.get('Origin') || '', allow = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': !allow.length ? '*' : allow.includes(origin) ? origin : allow[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-session-token',
    Vary: 'Origin',
  };
};
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_PDF_B64 = 4 * 1024 * 1024; // a GC PDF is ~50 KB; refuse anything absurd

// Admin only: money recorded as added (Accounting -> Add funds) minus what Meta reports as spent since the first top-up.
async function usage(env, sess, me) {
  if (me.role !== 'admin') return reply({ error: 'Only the admin can see the WhatsApp balance.' }, 403);
  if (!env.WA_TOKEN || !env.WA_WABA_ID) return reply({ error: 'WhatsApp is not configured on the server yet (WA_TOKEN / WA_WABA_ID).' }, 500);
  const sb = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
  const tr = await fetch(sb + 'wa_topups?select=amount,created_at&order=created_at', { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, 'x-session-token': sess } });
  const tops = tr.ok ? await tr.json() : [];
  const added = tops.reduce((a, t) => a + (Number(t.amount) || 0), 0);
  const auth = { Authorization: `Bearer ${env.WA_TOKEN}` }, now = Math.floor(Date.now() / 1000);
  const ist = new Date(Date.now() + 5.5 * 3600e3), monthStart = Math.floor(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) / 1000 - 5.5 * 3600);
  const info = await (await fetch(`${GRAPH}/${env.WA_WABA_ID}?fields=currency`, { headers: auth })).json();
  if (info.error) return reply({ error: 'Meta: ' + info.error.message }, 502);
  // spend between two times, read 30 days at a time (Meta's limit per request)
  const spend = async (from, to) => {
    let cost = 0, volume = 0;
    for (let a = from; a < to; a += 30 * 86400) {
      const b = Math.min(to, a + 30 * 86400);
      const r = await (await fetch(`${GRAPH}/${env.WA_WABA_ID}?fields=pricing_analytics.start(${a}).end(${b}).granularity(DAILY)`, { headers: auth })).json();
      if (r.error) throw new Error('Meta: ' + r.error.message);
      for (const d of (r.pricing_analytics?.data || [])) for (const p of (d.data_points || [])) { cost += Number(p.cost) || 0; volume += Number(p.volume) || 0; }
    }
    return { cost, volume };
  };
  try {
    const month = await spend(monthStart, now);
    let balance = null;
    if (tops.length) { const since = Math.floor(new Date(tops[0].created_at).getTime() / 1000); balance = added - (since >= monthStart ? (await spend(since, now)).cost : (await spend(since, monthStart)).cost + month.cost); }
    return reply({ currency: info.currency || 'INR', added, balance, spentMonth: month.cost, sentMonth: month.volume });
  } catch (e) { return reply({ error: String(e.message || e) }, 502); }
}

// Meta webhook: when a message fails for a payment reason (error 131042) the dashboard is told, so it can show "out of funds".
const FUNDS_CODES = new Set([131042]);
const same = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
async function hook(req, env, url) {
  const secret = decodeURIComponent(url.pathname.slice('/hook/'.length)), ok = same(secret, env.WA_HOOK_SECRET);
  if (!ok) return new Response('Not found', { status: 404 });
  if (req.method === 'GET') { // Meta's one-time check when the webhook is saved
    return url.searchParams.get('hub.mode') === 'subscribe' && same(url.searchParams.get('hub.verify_token'), env.WA_HOOK_SECRET)
      ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  try {
    const j = await req.json(); let detail = null;
    for (const e of j.entry || []) for (const c of e.changes || []) for (const st of c.value?.statuses || []) for (const er of st.errors || []) if (FUNDS_CODES.has(Number(er.code))) detail = `${er.code}: ${er.title || ''}`;
    if (detail) await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/wa_funds_alert', {
      method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: env.WA_HOOK_SECRET, p_detail: detail }),
    });
  } catch (e) { /* always answer 200 so Meta does not keep retrying */ }
  return new Response('ok', { status: 200 });
}

// base64 -> bytes without building a big intermediate array (keeps CPU time low)
function fromBase64(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default {
  async fetch(req, env) {
    CORS = corsFor(req, env);
    const url = new URL(req.url);
    if (url.pathname.startsWith('/hook/')) return await hook(req, env, url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return reply({ error: 'Not found' }, 404);
    try {
      // 1. the caller must be signed in to the app (same check the database uses)
      const sess = req.headers.get('x-session-token') || '';
      if (!sess) return reply({ error: 'Please sign in again.' }, 401);
      const me = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/auth_me', {
        method: 'POST',
        headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY, 'x-session-token': sess, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!me.ok) return reply({ error: 'Please sign in again.' }, 401);
      const who = await me.json();
      const body = await req.json();
      if (body.action === 'usage') return await usage(env, sess, who);

      // 2. check the input
      const { phone, pdf, gc, consignor, from, to } = body;
      const to10 = String(phone || '').replace(/\D/g, '').slice(-10);
      if (to10.length !== 10) return reply({ error: 'Enter a valid 10-digit consignor phone number.' }, 400);
      if (!pdf || !gc) return reply({ error: 'Missing PDF or GC number.' }, 400);
      if (typeof pdf !== 'string' || pdf.length > MAX_PDF_B64) return reply({ error: 'The PDF is too large.' }, 400);
      if (!env.WA_TOKEN || !env.WA_PHONE_ID || !env.WA_TEMPLATE) return reply({ error: 'WhatsApp is not configured on the server yet.' }, 500);
      const api = `${GRAPH}/${env.WA_PHONE_ID}`, auth = { Authorization: `Bearer ${env.WA_TOKEN}` };

      // 3. upload the PDF to WhatsApp media
      const fd = new FormData();
      fd.append('messaging_product', 'whatsapp');
      fd.append('type', 'application/pdf');
      fd.append('file', new Blob([fromBase64(pdf)], { type: 'application/pdf' }), `GC-${gc}.pdf`);
      const up = await (await fetch(`${api}/media`, { method: 'POST', headers: auth, body: fd })).json();
      if (!up.id) return reply({ error: 'Media upload failed: ' + (up.error?.message || 'unknown') }, 502);

      // 4. send the approved template with the PDF as its header document
      const txt = t => ({ type: 'text', text: String(t || '-').slice(0, 100) });
      const msg = await (await fetch(`${api}/messages`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: '91' + to10,
          type: 'template',
          template: {
            name: env.WA_TEMPLATE,
            language: { code: env.WA_LANG || 'en' },
            components: [
              { type: 'header', parameters: [{ type: 'document', document: { id: up.id, filename: `GC-${gc}.pdf` } }] },
              { type: 'body', parameters: [txt(consignor), txt(gc), txt(from), txt(to)] },
            ],
          },
        }),
      })).json();
      if (!msg.messages) return reply({ error: 'WhatsApp send failed: ' + (msg.error?.message || 'unknown') }, 502);
      return reply({ ok: true });
    } catch (e) {
      return reply({ error: 'Server error: ' + String(e && e.message || e).slice(0, 200) }, 500);
    }
  },
};
