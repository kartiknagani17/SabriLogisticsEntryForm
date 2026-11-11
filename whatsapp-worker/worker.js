// Sabri Logistics: sends a GC receipt PDF to the consignor on WhatsApp (Meta Cloud API).
// Runs on Cloudflare Workers (free plan), so the PDFs do not count against Supabase's monthly egress.
// Setup: see SETUP.md next to this file.
// Variables / secrets to add in Cloudflare (Settings -> Variables and Secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY  - same values as in dist/config.js (used to check the user is signed in)
//   WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE - from Meta (WhatsApp -> API Setup); WA_LANG optional, default "en"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-session-token',
};
const reply = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// base64 -> bytes without building a big intermediate array (keeps CPU time low)
function fromBase64(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default {
  async fetch(req, env) {
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

      // 2. check the input
      const { phone, pdf, gc, consignor, from, to } = await req.json();
      const to10 = String(phone || '').replace(/\D/g, '').slice(-10);
      if (to10.length !== 10) return reply({ error: 'Enter a valid 10-digit consignor phone number.' }, 400);
      if (!pdf || !gc) return reply({ error: 'Missing PDF or GC number.' }, 400);
      if (!env.WA_TOKEN || !env.WA_PHONE_ID || !env.WA_TEMPLATE) return reply({ error: 'WhatsApp is not configured on the server yet.' }, 500);
      const api = `https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}`, auth = { Authorization: `Bearer ${env.WA_TOKEN}` };

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
      return reply({ error: String(e && e.message || e) }, 500);
    }
  },
};
