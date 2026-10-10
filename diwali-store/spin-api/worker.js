/**
 * Diwali spin endpoint (Cloudflare Worker).
 *
 * POST /spin  { email?, phone?, page? }  ->  { prize, label, code, exp, already? }
 *
 * - The SERVER picks the prize (weighted), so nobody can mint a better code by editing the page.
 * - Each spin creates a brand-new code with usageLimit 1 + appliesOncePerCustomer, i.e. it works once.
 * - One spin per email/phone (KV), plus a per-IP daily cap.
 *
 * Bindings (wrangler.toml / dashboard):
 *   SPINS                KV namespace
 *   SHOP                 your-store.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN  Admin API token of a custom app with write_discounts   (secret)
 *   ALLOWED_ORIGINS      comma list, e.g. https://www.themancompany.com,https://your-store.myshopify.com
 *   PRIZES               JSON, see wrangler.toml
 *   CODE_PREFIX          e.g. DIWALI
 *   VALID_DAYS           e.g. 15   (or END_DATE ISO, whichever is earlier wins)
 *   END_DATE             optional ISO date the codes stop working, e.g. 2026-11-10T23:59:59+05:30
 *   IP_DAILY_LIMIT       e.g. 5
 *   API_VERSION          e.g. 2026-07
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/spin') return reply({ error: 'Not found' }, 404);
    if (!allowed.includes(origin)) return reply({ error: 'Origin not allowed' }, 403);

    let body;
    try { body = await req.json(); } catch { return reply({ error: 'Bad request' }, 400); }
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && phone.length !== 10) {
      return reply({ error: 'Enter a valid email or 10-digit mobile number' }, 400);
    }

    // one spin per customer: return their earlier result instead of a new code
    const who = await sha256(phone || email);
    const prev = await env.SPINS.get(`c:${who}`, 'json');
    if (prev) return reply({ ...prev, already: true }, 409);

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const day = new Date().toISOString().slice(0, 10);
    const ipKey = `ip:${day}:${ip}`;
    const ipCount = +(await env.SPINS.get(ipKey)) || 0;
    if (ipCount >= (+env.IP_DAILY_LIMIT || 5)) return reply({ error: 'Too many spins from this network today' }, 429);
    await env.SPINS.put(ipKey, String(ipCount + 1), { expirationTtl: 60 * 60 * 26 });

    const prize = pick(JSON.parse(env.PRIZES));
    let code;
    try {
      code = await createCode(env, prize);
    } catch (err) {
      console.error(err);
      return reply({ error: 'Could not create your code. Please try again.' }, 502);
    }
    const result = { prize: prize.id, label: prize.label, code: code.code, exp: code.endsAt };
    await env.SPINS.put(`c:${who}`, JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 60 });
    return reply(result);
  },
};

function pick(prizes) {
  const total = prizes.reduce((s, p) => s + (p.weight || 0), 0);
  let r = Math.random() * total;
  return prizes.find((p) => (r -= p.weight || 0) < 0) || prizes[0];
}

function randomCode(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const BASIC = `mutation SpinBasic($d: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`;
const SHIP = `mutation SpinShip($d: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingCreate(freeShippingCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`;

/**
 * Prize types:
 *   percentage     { value: 10 }                    10% off the order
 *   fixed          { value: 100 }                   ₹100 off the order
 *   free_shipping  {}
 *   free_product   { variant: "gid://shopify/ProductVariant/123" }  100% off that item (customer adds it)
 * Optional on any prize: min_subtotal (₹), combines: { order, product, shipping } booleans.
 */
async function createCode(env, prize) {
  const now = new Date();
  let ends = new Date(now.getTime() + (+env.VALID_DAYS || 15) * 864e5);
  if (env.END_DATE && new Date(env.END_DATE) < ends) ends = new Date(env.END_DATE);
  const c = prize.combines || {};
  const common = {
    title: `Spin the Rangoli · ${prize.label}`,
    startsAt: now.toISOString(),
    endsAt: ends.toISOString(),
    usageLimit: 1,
    appliesOncePerCustomer: true,
    context: { all: 'ALL' },
    combinesWith: { orderDiscounts: !!c.order, productDiscounts: !!c.product, shippingDiscounts: !!c.shipping },
    ...(prize.min_subtotal ? { minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: String(prize.min_subtotal) } } } : {}),
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomCode(env.CODE_PREFIX || 'DIWALI');
    let query = BASIC, d;
    if (prize.type === 'free_shipping') {
      query = SHIP;
      d = { ...common, code, destination: { all: true } };
    } else {
      const value = prize.type === 'percentage' ? { percentage: prize.value / 100 }
        : prize.type === 'fixed' ? { discountAmount: { amount: String(prize.value), appliesOnEachItem: false } }
        : { percentage: 1 };
      const items = prize.type === 'free_product' ? { products: { productVariantsToAdd: [prize.variant] } } : { all: true };
      d = { ...common, code, customerGets: { value, items } };
    }
    const res = await fetch(`https://${env.SHOP}/admin/api/${env.API_VERSION || '2026-07'}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_TOKEN },
      body: JSON.stringify({ query, variables: { d } }),
    });
    const json = await res.json();
    const out = json.data && Object.values(json.data)[0];
    if (out && !out.userErrors.length) return { code, endsAt: common.endsAt };
    // a code collision is the only error worth retrying
    if (!out?.userErrors?.some((e) => /code/i.test(e.field?.join('.') || '') && /taken|unique/i.test(e.message))) {
      throw new Error(`Discount create failed: ${JSON.stringify(json.errors || out?.userErrors)}`);
    }
  }
  throw new Error('Could not create a unique code');
}
