/* Diwali Gifting Store — one module shared by every dw-* section.
   Loaded with type="module", so the browser runs it once per page no matter how many
   sections include it. Each section is a custom element, which means it also re-initialises
   cleanly when the theme editor re-renders a section. No jQuery, no dependencies. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const readJSON = (el) => { try { return JSON.parse(el?.textContent || 'null'); } catch { return null; } };
const root = window.Shopify?.routes?.root || '/';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const currency = window.Shopify?.currency?.active || 'INR';
const nf = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : document.documentElement.lang || 'en', {
  style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2,
});
const money = (cents) => nf.format(cents / 100);

/* ---------- toast ---------- */
let toastEl, toastTimer;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.body.appendChild(document.createElement('div'));
    toastEl.className = 'dw-toast';
    toastEl.setAttribute('role', 'status');
  }
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2400);
}

/* ---------- cart ---------- */
const CART_SECTIONS = ['cart-drawer', 'cart-icon-bubble'];

function refreshCart(data) {
  const drawer = $('cart-drawer');
  if (drawer?.renderContents && data.sections?.['cart-drawer']) {
    try {
      drawer.classList.remove('is-empty');
      drawer.renderContents(data);
      return;
    } catch { /* fall through to bubble-only update */ }
  }
  const bubble = document.getElementById('cart-icon-bubble');
  const html = data.sections?.['cart-icon-bubble'];
  if (bubble && html) bubble.innerHTML = new DOMParser().parseFromString(html, 'text/html').querySelector('.shopify-section')?.innerHTML || html;
}

/** Adds items to the cart. With buyNow it hands off to GoKwik (same call the flexibox section makes) or falls back to /checkout. */
export async function addItems(items, { buyNow = false, event } = {}) {
  if (buyNow && typeof window.onBuyNowClick === 'function') {
    window.onBuyNowClick(event, false, items);
    return;
  }
  const res = await fetch(`${root}cart/add.js`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items, sections: CART_SECTIONS, sections_url: location.pathname }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.description || data.message || 'Could not add to cart');
  if (buyNow) { location.href = `${root}checkout`; return; }
  refreshCart(data);
  document.dispatchEvent(new CustomEvent('dw:cart-added', { detail: data }));
}

const busy = (btn, on) => { btn.setAttribute('aria-busy', on); btn.disabled = on; };

/* ---------- global delegated actions ----------
   [data-dw-add]   JSON array of cart items, optional data-dw-buy="true", data-dw-toast
   [data-dw-open]  selector of a <dialog> to open
   [data-dw-close] closes the parent <dialog> */
document.addEventListener('click', async (e) => {
  const add = e.target.closest('[data-dw-add]');
  if (add) {
    e.preventDefault();
    if (add.getAttribute('aria-busy') === 'true') return;
    busy(add, true);
    try {
      await addItems(JSON.parse(add.dataset.dwAdd), { buyNow: add.dataset.dwBuy === 'true', event: e });
      toast(add.dataset.dwToast || 'Added to cart');
    } catch (err) { toast(err.message); }
    busy(add, false);
    return;
  }
  const open = e.target.closest('[data-dw-open]');
  if (open) { e.preventDefault(); $(open.dataset.dwOpen)?.showModal(); return; }
  if (e.target.closest('[data-dw-close]')) { e.target.closest('dialog')?.close(); return; }
  if (e.target.matches('dialog.dw-dlg')) e.target.close(); // backdrop click
});

/* ---------- <dw-countdown data-end="ISO"> : one shared 1s ticker for every timer ---------- */
const timers = new Set();
let ticker;
const pad = (n) => String(n).padStart(2, '0');
class DwCountdown extends HTMLElement {
  connectedCallback() {
    this.end = Date.parse(this.dataset.end);
    if (Number.isNaN(this.end)) return;
    timers.add(this);
    this.render(Date.now());
    ticker ??= setInterval(() => { const now = Date.now(); timers.forEach((t) => t.render(now)); }, 1000);
  }
  disconnectedCallback() {
    timers.delete(this);
    if (!timers.size) { clearInterval(ticker); ticker = null; }
  }
  render(now) {
    let s = Math.max(0, Math.floor((this.end - now) / 1000));
    if (!s && !this.done) {
      this.done = true;
      timers.delete(this);
      this.dispatchEvent(new CustomEvent('dw:ended', { bubbles: true }));
    }
    const d = Math.floor(s / 86400); s %= 86400;
    this.textContent = `${d ? `${d}d ` : ''}${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
}

/* ---------- <dw-rotator> : announcement messages ---------- */
class DwRotator extends HTMLElement {
  connectedCallback() {
    const items = $$('p', this);
    if (items.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let i = 0;
    this.timer = setInterval(() => {
      const a = items[i];
      a.classList.replace('is-on', 'is-out');
      i = (i + 1) % items.length;
      items[i].classList.remove('is-out');
      items[i].classList.add('is-on');
    }, (+this.dataset.interval || 3.2) * 1000);
  }
  disconnectedCallback() { clearInterval(this.timer); }
}

/* ---------- <dw-tabs> : gift set tabs ---------- */
class DwTabs extends HTMLElement {
  connectedCallback() {
    this.addEventListener('click', (e) => {
      const tab = e.target.closest('[role=tab]');
      if (!tab) return;
      $$('[role=tab]', this).forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    });
  }
}

/* ---------- <dw-jump-nav> : sticky section tabs ---------- */
class DwJumpNav extends HTMLElement {
  connectedCallback() {
    this.links = $$('a[href^="#"]', this);
    this.nav = $('nav', this);
    const targets = this.links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
    this.io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && this.activate(en.target.id)),
      { rootMargin: '-40% 0px -50% 0px' });
    targets.forEach((t) => this.io.observe(t));
  }
  disconnectedCallback() { this.io?.disconnect(); }
  activate(id) {
    this.links.forEach((a) => {
      const on = a.hash === `#${id}`;
      a.classList.toggle('is-on', on);
      if (on) this.nav.scrollTo({ left: a.offsetLeft - (this.nav.clientWidth - a.offsetWidth) / 2, behavior: 'smooth' });
    });
  }
}

/* ---------- <dw-deals> : end-of-deal state ---------- */
class DwDeals extends HTMLElement {
  connectedCallback() {
    this.addEventListener('dw:ended', (e) => {
      const card = e.target.closest('.dw-dl');
      if (!card) return;
      if (card.classList.contains('is-next')) { e.target.textContent = card.dataset.liveText || 'Live now'; return; }
      card.classList.add('is-ended');
      const btn = $('[data-dw-add]', card);
      if (btn) { btn.disabled = true; btn.removeAttribute('data-dw-add'); btn.textContent = card.dataset.endedText || 'Deal ended'; }
    });
  }
}

/* ---------- <dw-builder> : Build your Diwali box ----------
   Sends exactly what the flexibox bundle sends: one parent line (the tier's bundle variant)
   with custom_flag, byob, sub_item_N and uniware_items properties. */

// jQuery's .data() turns numeric-looking strings into numbers; the original flexibox payload
// went through it, so we mirror that conversion to keep uniware_items byte-identical.
const jq = (v) => {
  v = v == null ? '' : String(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  return v !== '' && v === `${+v}` ? +v : v;
};
const uniwareLine = (f) => ({
  id: f.id, quantity: f.quantity, varint_title: f.varint_title, origin_location: '', fulfillment_status: '',
  total_discount: '', gift_card: '', requires_shipping: '', total_discount_set: '', title: f.title,
  variant_id: f.variant_id, tax_lines: '', mrp: '', price: f.price, grams: '', sku: f.sku, vendor: f.vendor,
  product_id: f.product_id, currency_code: f.currency_code, fulfillable_quantity: '', fulfillment_service: '',
  taxable: '', discount_allocations: '', name: f.name, price_set: '', properties: f.properties, duties: '',
});

class DwBuilder extends HTMLElement {
  connectedCallback() {
    const c = (this.cfg = readJSON($('[data-dw-config]', this)));
    if (!c?.tiers?.length) return;
    this.P = c.products;
    this.tier = Math.max(0, c.tiers.findIndex((t) => t.def));
    this.picks = [];
    this.msg = null;
    this.el = {
      sizes: $('[data-sizes]', this), slots: $('[data-slots]', this), picked: $('[data-picked]', this),
      grid: $('[data-grid]', this), more: $('[data-more]', this), total: $('[data-total]', this),
      totLbl: $('[data-total-label]', this), save: $('[data-save]', this), add: $('[data-add-box]', this),
      chips: $('[data-chips]', this), msgChk: $('[data-msg-chk]', this), msgSub: $('[data-msg-sub]', this),
      msgEdit: $('[data-msg-edit]', this), dlg: $('dialog', this),
    };
    this.tiles = new Map($$('.dw-pt', this.el.grid).map((li) => [+li.dataset.k, li]));
    this.bind();
    this.render();
  }

  bind() {
    const { el } = this;
    el.sizes.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) this.setTier(+b.dataset.i, true);
    });
    el.grid.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-add]');
      if (b) this.pick(+b.closest('.dw-pt').dataset.k);
    });
    el.slots.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-slot]');
      if (b) { this.picks.splice(+b.dataset.slot, 1); this.render(); }
    });
    el.more?.addEventListener('click', () => {
      const open = el.grid.classList.toggle('is-open');
      el.more.setAttribute('aria-expanded', open);
      $('span', el.more).textContent = open ? el.more.dataset.less : el.more.dataset.label;
      if (!open) this.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    el.chips?.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      $$('button', el.chips).forEach((x) => x.setAttribute('aria-pressed', x === b));
      const cat = b.dataset.cat;
      this.tiles.forEach((li) => li.classList.toggle('is-hidden', !!cat && li.dataset.cat !== cat));
      el.grid.classList.toggle('is-open', !!cat || el.more?.getAttribute('aria-expanded') === 'true');
      if (el.more) el.more.hidden = !!cat;
    });
    el.add.addEventListener('click', (e) => this.submit(e));
    if (el.dlg) this.bindMessage();
  }

  get t() { return this.cfg.tiers[this.tier]; }

  setTier(i, manual) {
    this.tier = i;
    if (this.picks.length > this.t.n) {
      this.picks.length = this.t.n;
      if (manual) toast(this.cfg.l.trimmed.replace('{n}', this.t.n));
    }
    this.render();
  }

  pick(k) {
    const { cfg } = this;
    if (this.picks.filter((x) => x === k).length >= cfg.maxPer) return toast(cfg.l.maxPer);
    if (this.picks.length >= this.t.n) {
      const next = cfg.autoUpgrade ? cfg.tiers.findIndex((t) => t.n > this.picks.length) : -1;
      if (next < 0) return toast(cfg.l.full.replace('{n}', this.t.n));
      this.tier = next;
      toast(cfg.l.upgraded.replace('{n}', this.t.n).replace('{price}', money(this.t.price)));
    }
    this.picks.push(k);
    this.render();
  }

  render() {
    const { el, cfg, P, t } = this;
    $$('button', el.sizes).forEach((b, i) => b.setAttribute('aria-pressed', i === this.tier));

    let slots = '';
    for (let i = 0; i < t.n; i++) {
      const p = P[this.picks[i]];
      slots += p
        ? `<div class="dw-slot is-full"><img src="${p.img}" alt="" width="84" height="84"><button type="button" data-slot="${i}" aria-label="Remove ${p.n.replace(/"/g, '&quot;')}">✕</button></div>`
        : `<div class="dw-slot dw-num">${i + 1}</div>`;
    }
    el.slots.innerHTML = slots;
    el.picked.textContent = cfg.l.picked.replace('{x}', this.picks.length).replace('{n}', t.n);

    const counts = this.counts();
    this.tiles.forEach((li, k) => {
      const c = counts.get(k) || 0;
      li.classList.toggle('is-in', c > 0);
      const badge = $('.dw-cnt', li);
      badge.hidden = !c;
      badge.textContent = `×${c}`;
      $('button[data-add]', li).disabled = c >= cfg.maxPer;
    });

    const full = this.picks.length === t.n;
    const mrp = this.picks.reduce((s, k) => s + Math.max(P[k].c, P[k].pc), 0);
    el.total.textContent = money(t.price + (this.msg ? cfg.msg.price : 0));
    el.totLbl.textContent = this.msg ? cfg.l.totalMsg : cfg.l.total;
    el.save.textContent = cfg.showSave && full && mrp > t.price ? cfg.l.save.replace('{amount}', money(mrp - t.price)) : '';
    el.add.disabled = !full || !t.avail;
    el.add.textContent = !t.avail ? cfg.l.soldOut : full ? cfg.l.add : cfg.l.pick.replace('{n}', t.n - this.picks.length);
  }

  counts() {
    const m = new Map();
    this.picks.forEach((k) => m.set(k, (m.get(k) || 0) + 1));
    return m;
  }

  /** Builds the cart payload in the flexibox format (see the bundle order JSON this mirrors). */
  payload() {
    const { cfg, P, t } = this;
    // flexibox lists picks in collection order, not click order
    const lines = [...this.counts()].sort((a, b) => a[0] - b[0]);
    const total = lines.reduce((s, [k, q]) => s + P[k].p * q, 0);
    const props = { custom_flag: 'flexibox', byob: true };
    const items = [uniwareLine({
      id: jq(t.sid), quantity: 1, varint_title: jq(t.vt), title: jq(t.title), variant_id: jq(t.v), price: 0,
      sku: jq(t.sku), vendor: jq(cfg.vendor), product_id: jq(t.pid), currency_code: cfg.currency,
      name: jq(t.title), properties: '{"_product":"parent"}',
    })];
    lines.forEach(([k, q], i) => {
      const p = P[k];
      props[`sub_item_${i + 1}`] = `${p.t} x ${q} :: ${p.f}`;
      items.push(uniwareLine({
        id: jq(p.sid), quantity: q, varint_title: jq(p.vt), title: p.t, variant_id: jq(p.v),
        price: (total ? ((p.p * q) / total) * t.bp : 0).toFixed(2), sku: jq(p.sku), vendor: jq(cfg.vendor),
        product_id: jq(p.pid), currency_code: cfg.currency, name: jq(p.n), properties: '{"_product":"child"}',
      }));
    });
    props.uniware_items = JSON.stringify({ items });

    const out = [{ id: t.v, quantity: 1, properties: props }];
    if (this.msg && cfg.msg) {
      out.push({ id: cfg.msg.v, quantity: 1, properties: { To: this.msg.to, From: this.msg.from, Message: this.msg.text, _box: t.title } });
    }
    return out;
  }

  async submit(e) {
    const { el, cfg } = this;
    if (this.picks.length !== this.t.n) return;
    busy(el.add, true);
    try {
      await addItems(this.payload(), { buyNow: cfg.buyNow, event: e });
      toast(cfg.l.added.replace('{n}', this.t.n));
      this.picks = [];
      this.msg = null;
      this.syncMsg();
    } catch (err) { toast(err.message); }
    busy(el.add, false);
    this.render();
  }

  /* --- personalised message card --- */
  bindMessage() {
    const { el, cfg } = this;
    const d = el.dlg;
    const f = { to: $('[name=to]', d), from: $('[name=from]', d), text: $('[name=text]', d) };
    const pv = () => {
      const to = f.to.value.trim() || cfg.l.someone;
      const fr = f.from.value.trim();
      $('[data-pv-to]', d).textContent = cfg.l.dear.replace('{to}', to);
      $('[data-pv-msg]', d).textContent = f.text.value || cfg.l.msgPh;
      $('[data-pv-for]', d).textContent = `for ${to}${fr ? ` — ${fr}` : ''}`;
      $('[data-pv-count]', d).textContent = `${f.text.value.length}/${f.text.maxLength}`;
    };
    const open = () => {
      if (this.msg) { f.to.value = this.msg.to; f.from.value = this.msg.from; f.text.value = this.msg.text; }
      pv();
      d.showModal();
    };
    d.addEventListener('input', pv);
    d.addEventListener('close', () => { el.msgChk.checked = !!this.msg; });
    $('[data-quick]', d)?.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { f.text.value = b.dataset.text; pv(); }
    });
    $('[data-msg-save]', d).addEventListener('click', () => {
      const text = f.text.value.trim();
      if (!text) { f.text.focus(); return toast(cfg.l.msgEmpty); }
      this.msg = { to: f.to.value.trim() || cfg.l.someone, from: f.from.value.trim(), text };
      d.close();
      this.syncMsg();
      this.render();
      toast(cfg.l.msgAdded);
    });
    el.msgChk.addEventListener('change', () => {
      if (el.msgChk.checked) return open();
      this.msg = null;
      this.syncMsg();
      this.render();
      toast(cfg.l.msgRemoved);
    });
    el.msgEdit.addEventListener('click', open);
  }

  syncMsg() {
    const { el } = this;
    if (!el.msgChk) return;
    el.msgChk.checked = !!this.msg;
    el.msgEdit.hidden = !this.msg;
    el.msgSub.textContent = this.msg
      ? `For ${this.msg.to}: “${this.msg.text.split('\n')[0].slice(0, 40)}${this.msg.text.length > 40 ? '…' : ''}”`
      : el.msgSub.dataset.default;
  }
}

/* ---------- <dw-spin> : spin the rangoli ----------
   mode "api": the prize and a unique single-use code come from the spin endpoint (spin-api/worker.js).
   mode "static": the prize is picked here by weight and the slice's fixed code is shown. */
class DwSpin extends HTMLElement {
  connectedCallback() {
    const c = (this.cfg = readJSON($('[data-dw-config]', this)));
    if (!c?.slices?.length) return;
    this.rot = $('.dw-rot', this);
    this.hub = $('.dw-hub', this);
    this.drawWheel();
    this.hub.addEventListener('click', () => this.spin());
    $('[data-apply]', this)?.addEventListener('click', (e) => this.apply(e.currentTarget));
    $('.dw-prize code', this)?.addEventListener('click', (e) => {
      navigator.clipboard?.writeText(e.currentTarget.textContent).then(() => toast(c.l.copied));
    });
    const prev = store.get(c.key);
    if (prev && (!prev.exp || Date.parse(prev.exp) > Date.now())) this.show(prev, false);
    this.floatingTab();
  }

  disconnectedCallback() { this.io?.disconnect(); removeEventListener('scroll', this.onScroll); }

  drawWheel() {
    const { slices } = this.cfg;
    const n = slices.length, seg = 360 / n, R = 178;
    const pt = (a, r) => [200 + r * Math.sin((a * Math.PI) / 180), 200 - r * Math.cos((a * Math.PI) / 180)];
    let sh = '', dots = '';
    slices.forEach((s, i) => {
      const a0 = i * seg - seg / 2, [x0, y0] = pt(a0, R), [x1, y1] = pt(a0 + seg, R);
      const long = s.label.length > 10, label = s.label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      sh += `<path d="M200 200L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z" fill="${s.fill}" stroke="#c9a24b" stroke-width="1"/>`
        + `<text transform="rotate(${i * seg} 200 200)" x="200" y="${long ? 78 : 84}" text-anchor="middle" font-weight="600" font-size="${Math.min(long ? 17 : 21, 120 / n * 1.4)}" fill="${s.color}">${label}</text>`;
      const [dx, dy] = pt(a0, 184), [mx, my] = pt(i * seg, 184);
      dots += `<circle cx="${dx}" cy="${dy}" r="5" fill="#f5d27a"/><circle cx="${mx}" cy="${my}" r="3" fill="#f5d27a" opacity=".7"/>`;
    });
    $('[data-slices]', this).innerHTML = sh;
    $('[data-dots]', this).innerHTML = dots;
  }

  lead() {
    const mode = this.cfg.lead;
    if (mode === 'none') return {};
    const email = $('[name=email]', this)?.value.trim() || '';
    const phone = ($('[name=phone]', this)?.value || '').replace(/\D/g, '');
    const okE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), okP = phone.length >= 10;
    const ok = mode === 'email' ? okE : mode === 'phone' ? okP : okE || okP;
    if (!ok) return null;
    const consent = $('[name=consent]', this);
    if (consent && !consent.checked) return null;
    return { email: okE ? email : '', phone: okP ? phone : '' };
  }

  async spin() {
    const { cfg } = this;
    if (this.done) return toast(cfg.l.once);
    const who = this.lead();
    if (!who) { $('.dw-lead input', this)?.focus(); return toast(cfg.l.lead); }
    this.hub.disabled = true;
    let res;
    try {
      res = cfg.mode === 'api' ? await this.fromApi(who) : this.fromWeights();
    } catch (err) {
      this.hub.disabled = false;
      return toast(err.message || cfg.l.error);
    }
    const n = cfg.slices.length, seg = 360 / n;
    const i = Math.max(0, cfg.slices.findIndex((s) => s.prize === res.prize));
    const turn = 360 * 6 + (360 - i * seg) + (Math.random() - 0.5) * seg * 0.6;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.rot.style.transform = `rotate(${turn}deg)`;
    setTimeout(() => this.show(res, true), reduce ? 0 : 4700);
  }

  async fromApi(who) {
    const r = await fetch(this.cfg.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...who, shop: window.Shopify?.shop, page: location.pathname }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && !data.code) throw new Error(data.error || this.cfg.l.error);
    return data; // { prize, label, code, exp, already? }
  }

  fromWeights() {
    const s = this.cfg.slices, sum = s.reduce((a, x) => a + x.weight, 0);
    let r = Math.random() * sum;
    const hit = s.find((x) => (r -= x.weight) < 0) || s[0];
    return { prize: hit.prize, label: hit.label, code: hit.code };
  }

  show(res, fresh) {
    const { cfg } = this;
    this.done = true;
    this.hub.disabled = true;
    this.hub.textContent = cfg.l.won;
    const box = $('.dw-prize', this);
    $('b', box).textContent = res.label;
    $('code', box).textContent = res.code || '';
    $('code', box).hidden = !res.code;
    $('[data-apply]', this).hidden = !res.code;
    box.hidden = false;
    $('.dw-lead', this)?.setAttribute('hidden', '');
    if (fresh) {
      store.set(cfg.key, { prize: res.prize, label: res.label, code: res.code, exp: res.exp });
      toast(cfg.l.youWon.replace('{prize}', res.label));
      if (cfg.autoApply && res.code) this.apply($('[data-apply]', this));
    }
  }

  async apply(btn) {
    const code = $('.dw-prize code', this).textContent;
    if (!code) return;
    busy(btn, true);
    try {
      await fetch(`${root}discount/${encodeURIComponent(code)}`, { credentials: 'same-origin' });
      btn.textContent = this.cfg.l.applied;
      toast(this.cfg.l.appliedToast.replace('{code}', code));
    } catch { toast(this.cfg.l.error); busy(btn, false); }
  }

  /* side "Spin & Win" tab: hidden while scrolling and while the wheel is on screen */
  floatingTab() {
    const tab = $('.dw-spinb', this);
    if (!tab) return;
    document.body.appendChild(tab); // escape any transformed/overflow-hidden ancestor
    let inView = false, moving = false, idle;
    const sync = () => tab.classList.toggle('is-hidden', inView || moving);
    this.io = new IntersectionObserver(([en]) => { inView = en.isIntersecting; sync(); }, { threshold: 0.25 });
    this.io.observe(this);
    this.onScroll = () => {
      if (!moving) { moving = true; sync(); }
      clearTimeout(idle);
      idle = setTimeout(() => { moving = false; sync(); }, 300);
    };
    addEventListener('scroll', this.onScroll, { passive: true });
    tab.addEventListener('click', () => this.scrollIntoView({ behavior: 'smooth' }));
    this.tab = tab;
  }
}

const define = (name, cls) => customElements.get(name) || customElements.define(name, cls);
define('dw-countdown', DwCountdown);
define('dw-rotator', DwRotator);
define('dw-tabs', DwTabs);
define('dw-jump-nav', DwJumpNav);
define('dw-deals', DwDeals);
define('dw-builder', DwBuilder);
define('dw-spin', DwSpin);

// theme editor: a moved-to-body floating tab must go away with its section
document.addEventListener('shopify:section:unload', (e) => {
  $$(`.dw-spinb[data-section="${e.detail.sectionId}"]`).forEach((t) => t.remove());
});
