// Sends a GC receipt PDF to the consignor on WhatsApp (Meta Cloud API).
// Secrets (set with `supabase secrets set`): WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE, WA_LANG (optional, default en)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-session-token',
};
const reply = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 1. caller must hold a valid app session (same check the database uses)
    const sess = req.headers.get('x-session-token') || '';
    const me = await fetch(Deno.env.get('SUPABASE_URL')! + '/rest/v1/rpc/auth_me', {
      method: 'POST',
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, 'x-session-token': sess, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!sess || !me.ok) return reply({ error: 'Please sign in again.' }, 401);

    // 2. validate input
    const { phone, pdf, gc, consignor, from, to } = await req.json();
    const digits = String(phone || '').replace(/\D/g, '');
    const to10 = digits.slice(-10);
    if (to10.length !== 10) return reply({ error: 'Enter a valid 10-digit consignor phone number.' }, 400);
    if (!pdf || !gc) return reply({ error: 'Missing PDF or GC number.' }, 400);

    const token = Deno.env.get('WA_TOKEN'), pid = Deno.env.get('WA_PHONE_ID'), tpl = Deno.env.get('WA_TEMPLATE');
    if (!token || !pid || !tpl) return reply({ error: 'WhatsApp is not configured on the server yet.' }, 500);
    const api = `https://graph.facebook.com/v21.0/${pid}`;
    const auth = { Authorization: `Bearer ${token}` };

    // 3. upload the PDF to WhatsApp media
    const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', 'application/pdf');
    fd.append('file', new Blob([bytes], { type: 'application/pdf' }), `GC-${gc}.pdf`);
    const up = await (await fetch(`${api}/media`, { method: 'POST', headers: auth, body: fd })).json();
    if (!up.id) return reply({ error: 'Media upload failed: ' + (up.error?.message || 'unknown') }, 502);

    // 4. send the approved template with the PDF as its header document
    const txt = (t: unknown) => ({ type: 'text', text: String(t || '-').slice(0, 100) });
    const msg = await (await fetch(`${api}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: '91' + to10,
        type: 'template',
        template: {
          name: tpl,
          language: { code: Deno.env.get('WA_LANG') || 'en' },
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
    return reply({ error: String(e) }, 500);
  }
});
