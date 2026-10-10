# Diwali Gifting Store

Theme sections for the **Diwali-theme-TC** theme, built from `TMC_Diwali_Gifting_Store_final.html`.
Live on the dev store at `/pages/diwali-gifting` (page template `page.diwali-gifting`).

## Files

| File | What it is |
|---|---|
| `theme/assets/diwali-store.css` | All styles, scoped under `.dw` |
| `theme/assets/diwali-store.js` | One ES module (no jQuery). Each section is a custom element, so it re-initialises in the theme editor |
| `theme/sections/dw-announcement.liquid` | Rotating announcement messages |
| `theme/sections/dw-hero-builder.liquid` | Hero + **Build your Diwali box** (box sizes, product grid, filters, message card) |
| `theme/sections/dw-jump-nav.liquid` | Sticky section tabs |
| `theme/sections/dw-usp.liquid` | Promise strip |
| `theme/sections/dw-deals.liquid` | Patakha deals: countdowns, stock bars, optional free gift line |
| `theme/sections/dw-gift-sets.liquid` | Tabbed gift sets; uses the home page `card-product-modern` card (or a Diwali card) |
| `theme/sections/dw-cashback.liquid` | Cashback bundle |
| `theme/sections/dw-spin.liquid` | Spin the Rangoli wheel + floating "Spin & Win" tab |
| `theme/sections/dw-corporate.liquid` | Corporate gifting card + enquiry form (Shopify contact form) |
| `theme/templates/page.diwali-gifting.json` | The page, all sections wired up |
| `spin-api/` | Cloudflare Worker that issues unique single-use spin codes |

## Box builder → order properties

Each **Box size** block points at a bundle parent product (e.g. "Buy 5 Perfumes at 699").
"Add box" adds **one line** of that variant with exactly the flexibox properties:

```
custom_flag   flexibox
byob          true
sub_item_N    "<title>[ - <variant>] x <qty> :: <featured_media filename>"
uniware_items {"items":[parent {"_product":"parent"}, child {"_product":"child"} ...]}
```

Child `id` = `shop.id` + `1` + collection position, child `price` = pro-rated share of the
parent variant price, picks listed in collection order — the same rules as
`flexi-box-multi-steps.js`. `_gk_line_key` is added by GoKwik at checkout, not by the theme.
The optional message card is a separate line (`To`, `From`, `Message`, `_box`).

## Spin the wheel: single-use codes

- **Fixed mode** (current setting): each slice shows its code. Codes `DIWALI10`, `FREESHIP`,
  `PATAKHA100`, `DIWALI15`, `RANGOLI150`, `DIWALI20` exist on the dev store, once per customer.
- **Unique mode** (recommended for production): deploy `spin-api/`, then set the section's
  *Code mode* to "Unique" and *Spin endpoint URL* to the worker. The worker picks the prize
  server-side and creates a fresh code with `usageLimit: 1` + `appliesOncePerCustomer`,
  one spin per phone/email, plus a per-IP daily cap.

```
cd spin-api
wrangler kv namespace create SPINS        # paste id into wrangler.toml
wrangler secret put SHOPIFY_ADMIN_TOKEN   # custom app token with write_discounts
# set SHOP / ALLOWED_ORIGINS / PRIZES in wrangler.toml, then
wrangler deploy
```

Slice **Prize ID**s in the theme must match the `id`s in `PRIZES`.
