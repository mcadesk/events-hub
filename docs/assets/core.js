// Shared helpers for the public pages (app.js) and the account pages (dash.js)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const CFG = window.EVENTS_HUB;
export const db = createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
export const app = document.getElementById('app');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};
export const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} }
};
export const go = (h) => { location.hash = h; };
export const cedi = (n) => 'GH₵ ' + Number(n).toLocaleString('en-GH', { maximumFractionDigits: 0 });
export const UNIT = { per_event: 'per event', per_head: 'per head', per_item: 'per item', per_day: 'per day', per_night: 'per night', per_hour: 'per hour' };
export const priceText = (l) => {
  if (l.price_min == null && l.price_max == null) return 'Price on request';
  const range = l.price_min != null && l.price_max != null && Number(l.price_min) !== Number(l.price_max)
    ? `${cedi(l.price_min)} – ${cedi(l.price_max)}` : `From ${cedi(l.price_min ?? l.price_max)}`;
  return range + (l.price_unit ? ` ${UNIT[l.price_unit]}` : '');
};
// Photos saved since Nov 2026 live in Cloudflare R2 (path starts with "r2/"); older ones in Supabase storage
export const photoUrl = (path) => !path || path.startsWith('sample:') ? null
  : path.startsWith('r2/') ? `${CFG.photoHost}/${path.slice(3)}`
  : `${CFG.supabaseUrl}/storage/v1/object/public/listing-photos/${path}`;
// Small copy of each photo (saved next to it as *_t.jpg) for lists and tiles; falls back to the full photo for older uploads
export const thumbPath = (path) => path ? path.replace(/\.jpg$/, '_t.jpg') : path;
export const thumbImg = (path, alt = '') => {
  const full = photoUrl(path); if (!full) return '';
  return `<img src="${esc(photoUrl(thumbPath(path)))}" data-full="${esc(full)}" crossorigin="anonymous" onerror="this.onerror=null;this.removeAttribute('crossorigin');this.src=this.dataset.full" alt="${esc(alt)}" loading="lazy">`;
};
export const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);

// Ghana phone: accepts 024 123 4567, 0241234567, 233241234567, +233 24 123 4567
export function toGhanaPhone(v) {
  const d = String(v || '').replace(/[^0-9]/g, '');
  if (/^0[0-9]{9}$/.test(d)) return '+233' + d.slice(1);
  if (/^233[0-9]{9}$/.test(d)) return '+' + d;
  if (/^[0-9]{9}$/.test(d)) return '+233' + d;
  return null;
}
export const localPhone = (p) => (p && p.startsWith('+233') ? '0' + p.slice(4) : p || '');

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'listing';

export const ICONS = {
  venues: '🏛️', planners: '📋', rentals: '⛺', 'food-drinks': '🍲', market: '🧺', decorators: '🎀', clothing: '🧵', beauty: '💄',
  accommodation: '🏨', transport: '🚌', 'media-pr': '📻', 'photo-video': '📸', entertainment: '🥁', ushers: '🤝',
  printing: '🖨️', power: '⚡', security: '🛡️', sanitation: '🚻', funeral: '🕊️', finance: '💳', other: '✨'
};

// Free photos from Unsplash (unsplash.com/license), one per category, served from Unsplash's image service
export const CAT_PHOTO = {"venues":"1768851142332-75f3d1b47452","planners":"1768055105012-4c53791b2877","rentals":"1768179123386-a86a85f1c35c","food-drinks":"1665332195309-9d75071138f0","market":"1734255026082-82fdc81991f0","decorators":"1561593367-66c79c2294e6","clothing":"1775688425905-a4539d6160da","beauty":"1657563920440-0ac6d8932f20","accommodation":"1611892440504-42a792e24d32","transport":"1534011056808-50c1c6082fe7","media-pr":"1767474365536-ef81bfa24c8a","photo-video":"1629756048377-09540f52caa1","entertainment":"1523689119443-df96632084a1","ushers":"1713804459707-9c0900119aa7","printing":"1632610992723-82d7c212f6d7","power":"1700318092011-6e4666e94ab5","security":"1760228604788-db8a36d5c1a3","sanitation":"1701637783855-da67ab363cfa","funeral":"1544813545-4827b64fcacb","finance":"1533234944761-2f5337579079","other":"1762237807370-41a599e6ab86","hero":"1660675133902-acd1b057f75d","about":"1549068294-04a001ee0638","list":"1687422808565-929533931584","permits":"1515657241610-a6b33f0f6c5a"};
export const catPhoto = (slug, w = 480, h = 320) => CAT_PHOTO[slug]
  ? `https://images.unsplash.com/photo-${CAT_PHOTO[slug]}?w=${w}&h=${h}&fit=crop&auto=format&q=60` : null;

// Photo banner with a heading, used at the top of pages
export const banner = (key, titleHtml) => catPhoto(key)
  ? `<div class="cat-banner" style="background-image:url('${catPhoto(key, 1200, 360)}')"><h1>${titleHtml}</h1></div>`
  : `<h1>${titleHtml}</h1>`;

export function placeholder(name, seed = 0) {
  const palettes = [['#011B59', '#FDB101'], ['#1d3373', '#FDB101'], ['#011B59', '#ffffff'], ['#2b4590', '#FDB101'], ['#00113d', '#FDB101']];
  const [a, b] = palettes[Math.abs(seed) % palettes.length];
  const initials = String(name).replace(/\(sample\)/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(name)}" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">
    <rect width="120" height="120" fill="${a}"/><rect y="96" width="120" height="8" fill="${b}"/><rect y="106" width="120" height="3" fill="${b}" opacity=".6"/>
    <text x="60" y="70" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="40" font-weight="700" fill="#fff">${esc(initials)}</text></svg>`;
}

/* ---------- reference data (towns, categories) ---------- */
export let REF = null;
export async function ref() {
  if (REF) return REF;
  const [towns, cats] = await Promise.all([
    db.from('towns').select('id,name,slug,lat,lng,district_id,districts(id,name,slug,regions(name))').eq('active', true).order('name'),
    db.from('categories').select('id,parent_id,name,slug,tier,sort').eq('active', true).order('sort')
  ]);
  if (towns.error || cats.error) throw (towns.error || cats.error);
  const top = cats.data.filter((c) => !c.parent_id);
  REF = {
    towns: towns.data,
    townBySlug: Object.fromEntries(towns.data.map((t) => [t.slug, t])),
    townById: Object.fromEntries(towns.data.map((t) => [t.id, t])),
    cats: cats.data,
    top,
    catBySlug: Object.fromEntries(cats.data.map((c) => [c.slug, c])),
    catById: Object.fromEntries(cats.data.map((c) => [c.id, c]))
  };
  return REF;
}
export const regionOf = (t) => t?.districts?.regions?.name || 'my region';
export function resetRef() { REF = null; }

export function townOptions(selected, by = 'slug') {
  const groups = {};
  REF.towns.forEach((t) => { (groups[t.districts.name] ||= []).push(t); });
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([d, ts]) =>
    `<optgroup label="${esc(d)}">${ts.map((t) => `<option value="${esc(t[by])}" ${String(t[by]) === String(selected) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
}
export function catOptions(selected, allLabel = 'All categories') {
  return `<option value="all">${allLabel}</option>` + REF.top.map((c) =>
    `<option value="${esc(c.slug)}" ${c.slug === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
// Subcategory options grouped under their main category (for the listing form)
export function subcatOptions(selectedId, emptyLabel) {
  return `<option value="">${esc(emptyLabel)}</option>` + REF.top.map((t) =>
    `<optgroup label="${esc(t.name)}">${REF.cats.filter((c) => c.parent_id === t.id).map((c) =>
      `<option value="${c.id}" ${String(c.id) === String(selectedId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}

/* ---------- signed-in user ---------- */
let _me;
export async function me(force = false) {
  if (_me !== undefined && !force) return _me;
  const { data: { session: s } } = await db.auth.getSession();
  if (!s) { _me = null; return null; }
  const { data } = await db.from('profiles').select('id,full_name,phone,email,role').eq('id', s.user.id).maybeSingle();
  _me = data ? { ...data, email: data.email || s.user.email } : { id: s.user.id, email: s.user.email, role: 'host' };
  return _me;
}
export function clearMe() { _me = undefined; }

export function toast(msg, isError = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.hidden = true; }, 4000);
}
