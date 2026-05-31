// Cloudflare Worker - deljeni store poslatih DonDon alarma za Zabbix SOC Filter
// Setup:
//   1. Kreiraj KV namespace i veži ga kao binding pod imenom: ZSF
//   2. Postavi promenljivu/secret: SHARE_TOKEN (proizvoljan string; mora se poklapati sa config.json)
//   3. Deploy. URL je tipa https://zsf-share.<tvoj-subdomen>.workers.dev
// Endpoints:
//   POST /add   {ids:[...]}   Authorization: Bearer <SHARE_TOKEN>
//   GET  /list                Authorization: Bearer <SHARE_TOKEN>  ->  {ok:true, ids:[...]}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const TOKEN = env.SHARE_TOKEN || '';
    if (TOKEN) {
      const auth = req.headers.get('Authorization') || '';
      if (auth !== 'Bearer ' + TOKEN) {
        return new Response('unauthorized', { status: 401, headers: cors });
      }
    }

    const TTL = 7 * 24 * 3600;

    if (url.pathname.endsWith('/add') && req.method === 'POST') {
      let ids = [];
      try { const b = await req.json(); ids = Array.isArray(b.ids) ? b.ids : []; } catch (e) {}
      const now = String(Date.now());
      const valid = ids.map(String).filter(function (x) { return /^\d+$/.test(x); }).slice(0, 200);
      await Promise.all(valid.map(function (x) {
        return env.ZSF.put('id:' + x, now, { expirationTtl: TTL });
      }));
      return new Response(JSON.stringify({ ok: true, added: valid.length }), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    if (url.pathname.endsWith('/list') && req.method === 'GET') {
      const out = [];
      let cursor = undefined;
      do {
        const list = await env.ZSF.list({ prefix: 'id:', cursor: cursor });
        for (const k of list.keys) out.push(k.name.slice(3));
        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);
      return new Response(JSON.stringify({ ok: true, ids: out }), {
        headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
      });
    }

    return new Response('not found', { status: 404, headers: cors });
  }
};
