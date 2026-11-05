import { CFG, db, app, esc, store, session, go, cedi, priceText, photoUrl, hash, ICONS, placeholder, catPhoto, banner,
  ref, townOptions, catOptions, me, clearMe, toast } from './core.js?v=14';
import { SAMPLE_LISTINGS } from './sample.js?v=14';

let REF = null;
const waNumber = (n) => String(n || '').replace(/[^0-9]/g, '');
const waLink = (l) => `https://wa.me/${waNumber(l.whatsapp)}?text=${encodeURIComponent(`Hello ${l.business_name}, I found you on NHYIAMU. I'd like to ask about your services for an event.`)}`;
const isDemo = () => session.get('eh-demo') === '1';
const setDemo = (on) => { session.set('eh-demo', on ? '1' : null); document.getElementById('demo-banner').hidden = !on; };

async function updateAccountLink() {
  const u = await me();
  const a = document.getElementById('account-link');
  if (!a) return;
  a.textContent = u ? 'My account' : 'Sign in';
  a.href = u ? '#/me' : '#/signin';
}
db.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') { clearMe(); updateAccountLink(); }
  if (event === 'PASSWORD_RECOVERY') go('/reset');
});

/* ---------- router ---------- */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
}

async function render() {
  const { parts, params } = parseHash();
  document.body.classList.remove('has-cta');
  document.querySelector('.sticky-cta')?.remove();
  document.getElementById('demo-banner').hidden = !isDemo();
  try {
    REF = await ref();
    if (parts.length === 0) return home();
    if (['signin', 'me', 'reset'].includes(parts[0])) {
      const dash = await import('./dash.js?v=14');
      return dash.route(parts, params);
    }
    if (parts[0] === 't' && parts[1] && !parts[2]) return townPage(parts[1]);
    if (parts[0] === 't' && parts[1] && parts[2]) return results(parts[1], parts[2], params);
    if (parts[0] === 'l' && parts[1]) return listingPage(parts[1]);
    if (parts[0] === 'finance') return financePage();
    if (parts[0] === 'permits') return permitsPage();
    if (parts[0] === 'about') return aboutPage();
    if (parts[0] === 'list') return listPage();
    return notFound();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="wrap section"><div class="notice error">Sorry, something went wrong loading this page. Check your internet connection and try again.</div></div>`;
  } finally {
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', render);
document.getElementById('demo-off').addEventListener('click', () => { setDemo(false); render(); });

/* ---------- pages ---------- */
function home() {
  const town = store.get('eh-town', CFG.defaultTown);
  document.title = 'NHYIAMU — find everything for your event';
  app.innerHTML = `
  <section class="hero" style="--hero-img:url('${catPhoto('hero', 1400, 800)}')"><div class="wrap">
    <h1>Everything for your event, in one place</h1>
    <p>Find venues, canopies, caterers, decorators, tailors, photographers and more near you — then talk to them directly on WhatsApp.</p>
    <form class="finder" id="finder">
      <div class="finder-row">
        <div class="field"><label for="f-town">Town</label><select id="f-town">${townOptions(town)}</select></div>
        <div class="field"><label for="f-cat">I need</label><select id="f-cat">${catOptions('all', 'Everything')}</select></div>
        <button class="btn btn-gold" type="submit">Find suppliers</button>
      </div>
    </form>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="section-head"><h2>Browse by category</h2><a href="#/t/${esc(town)}" id="town-link">See all in your town</a></div>
    <div class="cat-grid">${REF.top.map((c) => `
      <a class="cat cat-photo" href="#/t/${esc(town)}/${esc(c.slug)}" data-cat="${esc(c.slug)}">
        ${catPhoto(c.slug) ? `<img src="${catPhoto(c.slug)}" alt="" loading="lazy" width="480" height="320">` : `<span class="cat-icon" aria-hidden="true">${ICONS[c.slug] || '•'}</span>`}
        <span class="cat-name">${esc(c.name)}</span>
      </a>`).join('')}</div>
  </div></section>

  <section class="section"><div class="wrap">
    <h2>How it works</h2>
    <div class="how">
      <div class="panel"><b>1. Pick your town</b>See suppliers based there, plus those who travel to you.</div>
      <div class="panel"><b>2. Compare</b>Photos, price ranges, reviews and verified badges.</div>
      <div class="panel"><b>3. WhatsApp or call</b>Agree everything directly with the supplier. NHYIAMU is free.</div>
    </div>
  </div></section>

  <section class="section"><div class="wrap">
    <div class="cta-band">
      <div><h3>Do you supply events?</h3><span class="muted">Canopies, food, decor, sewing, sound, transport — list your business free. The first 10 in each town get 3 months featured free.</span></div>
      <a class="btn" href="#/list">List your business</a>
    </div>
  </div></section>`;

  const townSel = document.getElementById('f-town');
  townSel.addEventListener('change', () => {
    store.set('eh-town', townSel.value);
    document.getElementById('town-link').href = `#/t/${townSel.value}`;
    document.querySelectorAll('[data-cat]').forEach((a) => { a.href = `#/t/${townSel.value}/${a.dataset.cat}`; });
  });
  document.getElementById('finder').addEventListener('submit', (e) => {
    e.preventDefault();
    store.set('eh-town', townSel.value);
    go(`/t/${townSel.value}/${document.getElementById('f-cat').value}`);
  });
}

async function townPage(townSlug) {
  const town = REF.townBySlug[townSlug];
  if (!town) return notFound();
  store.set('eh-town', town.slug);
  document.title = `Event suppliers in ${town.name} — NHYIAMU`;
  app.innerHTML = `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> › ${esc(town.name)}</div>
    <h1>Event suppliers in ${esc(town.name)}</h1>
    <p class="muted">${esc(town.districts.name)} · Suppliers based here and those who travel to ${esc(town.name)}.</p>
    <div class="field" style="max-width:320px;margin:12px 0 18px"><label class="muted" for="t-town">Change town</label><select id="t-town">${townOptions(town.slug)}</select></div>
    <div class="cat-grid" id="t-cats">${REF.top.map(() => '<div class="skeleton"></div>').join('')}</div>
    <div class="section"><div class="cta-band"><div><h3>Planning an event here?</h3><span class="muted">Check which permits you need from the police, assembly and fire service.</span></div><a class="btn btn-ghost" href="#/permits">Permits guide</a></div></div>
  </div>`;
  document.getElementById('t-town').addEventListener('change', (e) => go(`/t/${e.target.value}`));

  let counts = {};
  if (isDemo()) {
    sampleFor(town).forEach((l) => l.cats.forEach((s) => { const c = REF.catBySlug[s]; const top = c?.parent_id ? REF.catById[c.parent_id].slug : s; counts[top] = (counts[top] || 0) + 1; }));
  } else {
    const { data } = await db.rpc('town_category_counts', { p_town: town.id });
    (data || []).forEach((r) => { counts[REF.catById[r.category_id]?.slug] = r.n; });
  }
  document.getElementById('t-cats').innerHTML = REF.top.map((c) => `
    <a class="cat cat-photo" href="#/t/${esc(town.slug)}/${esc(c.slug)}">
      ${catPhoto(c.slug) ? `<img src="${catPhoto(c.slug)}" alt="" loading="lazy" width="480" height="320">` : `<span class="cat-icon" aria-hidden="true">${ICONS[c.slug] || '•'}</span>`}
      <span class="cat-name">${esc(c.name)}</span>
      <span class="cat-count">${counts[c.slug] ? `${counts[c.slug]} supplier${counts[c.slug] > 1 ? 's' : ''}` : 'None yet'}</span>
    </a>`).join('');
}

const PAGE = 20;
async function results(townSlug, catSlug, params) {
  const town = REF.townBySlug[townSlug];
  const cat = catSlug === 'all' ? null : REF.catBySlug[catSlug];
  if (!town || (catSlug !== 'all' && !cat)) return notFound();
  store.set('eh-town', town.slug);
  const scope = params.get('scope') || store.get('eh-scope', 'area');
  const verified = params.get('v') === '1';
  const q = params.get('q') || '';
  const sub = params.get('sub') || '';
  const subs = cat ? REF.cats.filter((c) => c.parent_id === cat.id) : [];
  const title = cat ? cat.name : 'All suppliers';
  document.title = `${title} in ${town.name} — NHYIAMU`;

  const qs = (over = {}) => {
    const p = new URLSearchParams({ scope, ...(verified ? { v: '1' } : {}), ...(q ? { q } : {}), ...(sub ? { sub } : {}) });
    Object.entries(over).forEach(([k, v]) => (v === null || v === '' ? p.delete(k) : p.set(k, v)));
    return p.toString();
  };
  const scopeBtn = (val, label) => `<button type="button" data-scope="${val}" aria-pressed="${scope === val}">${label}</button>`;

  app.innerHTML = `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/t/${esc(town.slug)}">${esc(town.name)}</a> › ${esc(title)}</div>
    ${banner(cat ? cat.slug : 'hero', `${esc(title)} <span>in ${esc(town.name)}</span>`)}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Which suppliers to show">
        ${scopeBtn('area', 'This area')}${scopeBtn('region', 'Ashanti')}${scopeBtn('all', 'All suppliers')}
      </div>
      <form class="filters" id="filters">
        <select id="r-town" aria-label="Town">${townOptions(town.slug)}</select>
        <select id="r-cat" aria-label="Category">${catOptions(catSlug)}</select>
        ${subs.length ? `<select id="r-sub" aria-label="Type"><option value="">All types</option>${subs.map((s) => `<option value="${esc(s.slug)}" ${s.slug === sub ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        <input type="search" id="r-q" placeholder="Search by name" value="${esc(q)}" aria-label="Search by name">
        <label class="check"><input type="checkbox" id="r-v" ${verified ? 'checked' : ''}> Verified only</label>
      </form>
    </div>
    <p class="muted" id="r-note" style="margin:0 0 12px;font-size:.9rem"></p>
    <div class="results" id="r-list">${'<div class="skeleton"></div>'.repeat(4)}</div>
    <div class="more" id="r-more"></div>
  </div>`;

  document.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { store.set('eh-scope', b.dataset.scope); go(`/t/${town.slug}/${catSlug}?${qs({ scope: b.dataset.scope })}`); }));
  document.getElementById('r-town').addEventListener('change', (e) => go(`/t/${e.target.value}/${catSlug}?${qs()}`));
  document.getElementById('r-cat').addEventListener('change', (e) => go(`/t/${town.slug}/${e.target.value}?${qs({ sub: null })}`));
  document.getElementById('r-sub')?.addEventListener('change', (e) => go(`/t/${town.slug}/${catSlug}?${qs({ sub: e.target.value })}`));
  document.getElementById('r-v').addEventListener('change', (e) => go(`/t/${town.slug}/${catSlug}?${qs({ v: e.target.checked ? '1' : null })}`));
  document.getElementById('filters').addEventListener('submit', (e) => { e.preventDefault(); go(`/t/${town.slug}/${catSlug}?${qs({ q: document.getElementById('r-q').value.trim() })}`); });

  document.getElementById('r-note').textContent = {
    area: `Suppliers based in ${town.name}, plus those who travel here.`,
    region: 'Suppliers across the Ashanti Region, nearest first.',
    all: 'Every supplier on NHYIAMU, nearest first.'
  }[scope] || '';

  const filterCat = sub ? REF.catBySlug[sub] : cat;
  let offset = 0;
  const list = document.getElementById('r-list');
  const more = document.getElementById('r-more');

  async function load(first) {
    let rows;
    if (isDemo()) {
      rows = sampleSearch(town, scope, filterCat, q, verified);
      more.innerHTML = '';
    } else {
      const { data, error } = await db.rpc('search_listings', {
        p_town: town.id, p_scope: scope, p_category: filterCat?.id ?? null,
        p_q: q || null, p_verified: verified, p_limit: PAGE, p_offset: offset
      });
      if (error) throw error;
      rows = data;
      if (first && rows.length === 0) db.from('search_misses').insert({ town_id: town.id, category_id: filterCat?.id ?? null, term: q || null }).then(() => {});
      more.innerHTML = rows.length === PAGE ? '<button class="btn btn-ghost" id="r-load">Show more</button>' : '';
      document.getElementById('r-load')?.addEventListener('click', () => { offset += PAGE; load(false); });
    }
    if (first) list.innerHTML = '';
    if (first && rows.length === 0) {
      list.outerHTML = `<div class="empty" id="r-list"><h3>No ${esc(title.toLowerCase())} listed here yet</h3>
        <p class="muted">${scope === 'area' ? 'Try <b>Ashanti</b> or <b>All suppliers</b> above to see suppliers further away.' : 'NHYIAMU is new — suppliers are being added every week.'}</p>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <a class="btn" href="#/list">Know a supplier? Tell them to list free</a>
          ${isDemo() ? '' : '<button class="btn btn-ghost" id="demo-on">Preview with sample listings</button>'}
        </div></div>`;
      document.getElementById('demo-on')?.addEventListener('click', () => { setDemo(true); render(); });
      return;
    }
    list.insertAdjacentHTML('beforeend', rows.map(card).join(''));
    bindTaps(list);
  }
  await load(true);
}

function card(l) {
  const img = photoUrl(l.photo);
  return `<article class="card ${l.featured ? 'is-featured' : ''}">
    <a class="card-photo" href="#/l/${esc(l.slug)}" aria-hidden="true" tabindex="-1">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : placeholder(l.business_name, hash(l.slug))}</a>
    <div class="card-body">
      <a class="card-title" href="#/l/${esc(l.slug)}">${esc(l.business_name)}</a>
      <div class="card-meta">${esc(l.town_name)}${l.rating ? ` · <span class="stars">★</span> ${l.rating} (${l.review_count})` : ''}${l.distance_km != null && l.travels ? ` · ${Math.round(l.distance_km)} km away` : ''}</div>
      <div class="price">${esc(priceText(l))}</div>
      <div class="badges">
        ${l.featured ? '<span class="badge badge-featured">Featured</span>' : ''}
        ${l.verified ? '<span class="badge badge-verified">✓ Verified</span>' : ''}
        ${l.founding ? '<span class="badge badge-founding">Founding supplier</span>' : ''}
        ${l.travels ? '<span class="badge badge-travel">Travels to your area</span>' : ''}
        ${l.negotiable ? '<span class="badge">Open to discussion</span>' : ''}
        ${l.discounts ? '<span class="badge">Discounts</span>' : ''}
      </div>
      <div class="card-actions">
        <a class="btn btn-wa" href="${esc(waLink(l))}" target="_blank" rel="noopener" data-tap="whatsapp" data-id="${esc(l.id)}">WhatsApp</a>
        <a class="btn btn-ghost" href="tel:${esc(l.phone)}" data-tap="call" data-id="${esc(l.id)}">Call</a>
      </div>
    </div>
  </article>`;
}

function bindTaps(root) {
  root.querySelectorAll('[data-tap]').forEach((a) => {
    if (a.dataset.bound) return;
    a.dataset.bound = '1';
    a.addEventListener('click', () => logTap(a.dataset.id, a.dataset.tap));
  });
}
function logTap(id, kind) {
  if (!id || String(id).startsWith('sample-')) return;
  db.from('listing_taps').insert({ listing_id: id, kind }).then(() => {});
}

async function listingPage(slug) {
  let l;
  if (slug.startsWith('sample-')) {
    l = SAMPLE_LISTINGS.find((s) => s.slug === slug);
    if (l) l = { ...l, town: REF.townBySlug[l.town_slug], categories: l.cats.map((s) => REF.catBySlug[s]).filter(Boolean), photos: [], reviews: l.reviews || [] };
  } else {
    const { data, error } = await db.from('listings')
      .select('*, towns(name,slug,districts(name)), listing_categories(categories(name,slug,parent_id)), listing_photos(path,sort), reviews(id,author_id,rating,comment,event_type,event_month,reply,created_at)')
      .eq('slug', slug).maybeSingle();
    if (error) throw error;
    if (data) l = { ...data, town: data.towns, categories: data.listing_categories.map((x) => x.categories), photos: data.listing_photos.sort((a, b) => a.sort - b.sort), reviews: data.reviews };
  }
  if (!l) return notFound('This listing could not be found. It may have been removed.');
  document.title = `${l.business_name} — NHYIAMU`;
  logTap(l.id, 'view');

  const ratings = l.reviews.map((r) => r.rating);
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
  const extra = l.extra || {};
  const extraRows = Object.entries(extra).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))}</dt><dd>${esc(typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v)}</dd>`).join('');
  const photos = l.photos.length ? l.photos.map((p) => `<div><img src="${esc(photoUrl(p.path))}" alt="${esc(l.business_name)} photo" loading="lazy"></div>`).join('')
    : `<div>${placeholder(l.business_name, hash(l.slug))}</div>`;
  const coverage = { town: `${l.town.name} only`, district: `All of ${l.town.districts.name}`, region: 'Anywhere in Ashanti', nationwide: 'Anywhere in Ghana' }[l.coverage];
  const user = slug.startsWith('sample-') ? null : await me();
  const isOwner = user && user.id === l.owner_id;
  const myReview = user ? l.reviews.find((r) => r.author_id === user.id) : null;
  const outdated = l.last_confirmed_at && (Date.now() - new Date(l.last_confirmed_at)) > 210 * 864e5;
  const statusNote = l.status && l.status !== 'live'
    ? `<div class="notice" style="margin:12px 0">This listing is <b>${esc(l.status)}</b> and not visible to the public yet.${l.reject_reason ? ' Reason: ' + esc(l.reject_reason) : ''}</div>` : '';

  app.innerHTML = `<div class="wrap">
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/t/${esc(l.town.slug)}">${esc(l.town.name)}</a> › ${esc(l.business_name)}</div>
    ${statusNote}
    ${outdated ? '<div class="notice" style="margin:12px 0;background:var(--gold-soft)">These details may be outdated. Confirm with the supplier before you book.</div>' : ''}
    <div class="gallery">${photos}</div>
    <div class="detail">
      <div>
        <h1 style="margin-top:6px">${esc(l.business_name)}</h1>
        <div class="badges" style="margin-bottom:10px">
          ${l.verified ? '<span class="badge badge-verified">✓ Verified by NHYIAMU</span>' : ''}
          ${l.founding ? '<span class="badge badge-founding">Founding supplier</span>' : ''}
          ${l.categories.map((c) => `<span class="badge">${esc(c.name)}</span>`).join('')}
        </div>
        <p class="muted" style="margin:0 0 12px">${esc(l.town.name)}, ${esc(l.town.districts.name)}${avg ? ` · <span class="stars">★</span> ${avg} from ${ratings.length} review${ratings.length > 1 ? 's' : ''}` : ''}</p>
        <div class="panel"><h3>About</h3><p style="margin:0;white-space:pre-line">${esc(l.description)}</p></div>
        <div class="panel" style="margin-top:12px"><h3>Details</h3><dl class="kv">
          <dt>Price</dt><dd><b>${esc(priceText(l))}</b>${l.negotiable ? '<br><span class="muted">Open to discussion</span>' : ''}${l.discounts ? `<br><span class="muted">Discounts available${l.discount_note ? ': ' + esc(l.discount_note) : ''}</span>` : ''}</dd>
          <dt>Serves</dt><dd>${esc(coverage)}</dd>
          <dt>Find them</dt><dd>${esc(l.landmark)}, ${esc(l.town.name)}</dd>
          ${l.working_days ? `<dt>Open</dt><dd>${esc(l.working_days)}</dd>` : ''}
          ${l.years_in_business ? `<dt>In business</dt><dd>${esc(l.years_in_business)} years</dd>` : ''}
          ${extraRows}
        </dl></div>
        <div class="panel" style="margin-top:12px"><h3>Reviews</h3>
          ${l.reviews.length ? l.reviews.map((r) => `<div class="review"><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
            ${r.event_type ? `<span class="muted"> · ${esc(r.event_type)}</span>` : ''}<p style="margin:4px 0 0">${esc(r.comment || '')}</p>
            ${r.reply ? `<p class="muted" style="margin:6px 0 0;padding-left:10px;border-left:3px solid var(--line)"><b>Reply:</b> ${esc(r.reply)}</p>` : ''}</div>`).join('')
            : '<p class="muted" style="margin:0">No reviews yet.</p>'}
          ${slug.startsWith('sample-') || isOwner ? '' : user ? `
            <form id="review-form" class="form" style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
              <b>${myReview ? 'Edit your review' : 'Used this supplier? Leave a review'}</b>
              <div class="field"><label for="rv-rating">Rating</label><select id="rv-rating" required>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${myReview?.rating === n ? 'selected' : ''}>${'★'.repeat(n)} (${n})</option>`).join('')}</select></div>
              <div class="field"><label for="rv-type">Your event</label><input type="text" id="rv-type" maxlength="60" placeholder="Wedding, funeral, birthday…" value="${esc(myReview?.event_type || '')}"></div>
              <div class="field"><label for="rv-comment">Your review</label><textarea id="rv-comment" maxlength="500" rows="3" required>${esc(myReview?.comment || '')}</textarea></div>
              <button class="btn" type="submit">${myReview ? 'Update review' : 'Post review'}</button>
            </form>`
          : `<p style="margin:14px 0 0"><a href="#/signin" data-return>Sign in to leave a review</a></p>`}
        </div>
        ${slug.startsWith('sample-') ? '' : `<p style="margin:14px 0 0;font-size:.9rem"><a href="#" id="report-link" class="muted">Report this listing</a></p>
        <form id="report-form" class="form panel" hidden style="margin-top:8px">
          <b>What's wrong?</b>
          <select id="rp-reason" required><option value="wrong_number">Wrong phone number</option><option value="closed">Business has closed</option><option value="fake">Fake business</option><option value="scam">Scam or fraud</option><option value="offensive">Offensive content</option><option value="other">Something else</option></select>
          <textarea id="rp-note" rows="2" maxlength="300" placeholder="Tell us more (optional)"></textarea>
          <button class="btn" type="submit">Send report</button>
        </form>`}
      </div>
      <aside class="panel contact-panel">
        <h3>Contact ${esc(l.contact_name || l.business_name)}</h3>
        <a class="btn btn-wa btn-block" href="${esc(waLink(l))}" target="_blank" rel="noopener" data-tap="whatsapp" data-id="${esc(l.id)}">Chat on WhatsApp</a>
        <a class="btn btn-ghost btn-block" href="tel:${esc(l.phone)}" data-tap="call" data-id="${esc(l.id)}">Call ${esc(l.phone)}</a>
        <button class="btn btn-ghost btn-block" type="button" id="share">Share</button>
        <div class="safety">Agree prices in writing and avoid paying the full amount before your event.</div>
        <a href="#/finance" class="muted" style="font-size:.9rem">Need money for your event? See event loans →</a>
      </aside>
    </div>
  </div>`;
  document.body.classList.add('has-cta');
  document.body.insertAdjacentHTML('beforeend', `<div class="sticky-cta">
    <a class="btn btn-wa" href="${esc(waLink(l))}" target="_blank" rel="noopener" data-tap="whatsapp" data-id="${esc(l.id)}">WhatsApp</a>
    <a class="btn btn-ghost" href="tel:${esc(l.phone)}" data-tap="call" data-id="${esc(l.id)}">Call</a></div>`);
  bindTaps(document.body);
  document.querySelectorAll('[data-return]').forEach((a) => a.addEventListener('click', () => session.set('eh-return', location.hash)));
  document.getElementById('review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const row = { listing_id: l.id, author_id: user.id, rating: Number(document.getElementById('rv-rating').value),
      event_type: document.getElementById('rv-type').value.trim() || null, comment: document.getElementById('rv-comment').value.trim() };
    const { error } = myReview ? await db.from('reviews').update(row).eq('id', myReview.id) : await db.from('reviews').insert(row);
    if (error) return toast('Sorry, your review could not be saved.', true);
    toast('Thank you — your review is posted.');
    render();
  });
  document.getElementById('report-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!(await me())) { session.set('eh-return', location.hash); return go('/signin'); }
    document.getElementById('report-form').hidden = false;
  });
  document.getElementById('report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = await me();
    const { error } = await db.from('reports').insert({ listing_id: l.id, reporter_id: u.id,
      reason: document.getElementById('rp-reason').value, note: document.getElementById('rp-note').value.trim() || null });
    if (error) return toast('Sorry, the report could not be sent.', true);
    e.target.hidden = true;
    toast('Thank you. A moderator will check this listing.');
  });
  document.getElementById('share').addEventListener('click', async (e) => {
    logTap(l.id, 'share');
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: l.business_name, text: `${l.business_name} on NHYIAMU`, url });
      else { await navigator.clipboard.writeText(url); e.target.textContent = 'Link copied ✓'; }
    } catch {}
  });
}

async function financePage() {
  document.title = 'Finance your event — NHYIAMU';
  const { data: partners } = await db.from('loan_partners').select('id,name,phone,email,towns,products').eq('active', true).order('name');
  const town = store.get('eh-town', CFG.defaultTown);
  app.innerHTML = `<div class="wrap section">
    ${banner('finance', 'Finance your event')}
    <p class="muted prose">Need help paying for a wedding, funeral or celebration? Our partner credit unions, banks and savings &amp; loans offer event loans. Send one enquiry and the partner will contact you.</p>
    <div class="notice" style="margin:14px 0">Loans are offered and approved by the partner institution alone. NHYIAMU is not a lender and never handles your money.</div>
    ${partners && partners.length ? `
      <div class="results" style="margin-bottom:24px">${partners.map((p) => `<div class="panel partner"><h3>${esc(p.name)}</h3>
        ${p.towns ? `<span class="muted">Branches: ${esc(p.towns)}</span>` : ''}
        ${(p.products || []).map((pr) => `<div><b>${esc(pr.name)}</b><br><span class="muted">${pr.min ? cedi(pr.min) : ''}${pr.max ? ' – ' + cedi(pr.max) : ''}${pr.months ? ` · up to ${esc(pr.months)} months` : ''}</span>${pr.requirements ? `<br><span style="font-size:.9rem">${esc(pr.requirements)}</span>` : ''}</div>`).join('')}
      </div>`).join('')}</div>
      <h2>Send an enquiry</h2>
      <form class="form panel" id="loan-form">
        <div class="field"><label for="lp">Partner</label><select id="lp" required>${partners.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ln">Your name</label><input type="text" id="ln" required></div>
        <div class="field"><label for="lph">Phone</label><input type="tel" id="lph" required placeholder="024 123 4567"></div>
        <div class="field"><label for="lt">Town</label><select id="lt">${townOptions(town)}</select></div>
        <div class="field"><label for="le">Type of event</label><input type="text" id="le" placeholder="Wedding, funeral, outdooring…"></div>
        <div class="field"><label for="ld">Event date</label><input type="date" id="ld"></div>
        <div class="field"><label for="la">Amount needed (GH₵)</label><input type="number" id="la" min="0" step="50"></div>
        <label class="check"><input type="checkbox" id="lc" required> I agree to share these details with the partner I chose</label>
        <button class="btn" type="submit">Send enquiry</button>
        <div id="loan-msg"></div>
      </form>`
    : `<div class="empty"><h3>Loan partners are joining soon</h3><p class="muted">We are speaking with credit unions, banks and savings &amp; loans in Ejisu and Juaben.</p>
        <p class="muted">Are you a financial institution? We'd love to list your event loan products.</p></div>`}
  </div>`;
  document.getElementById('loan-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('loan-msg');
    const t = REF.townBySlug[document.getElementById('lt').value];
    const { error } = await db.from('loan_enquiries').insert({
      partner_id: document.getElementById('lp').value, name: document.getElementById('ln').value.trim(),
      phone: document.getElementById('lph').value.trim(), town_id: t?.id ?? null,
      event_type: document.getElementById('le').value.trim() || null, event_date: document.getElementById('ld').value || null,
      amount: document.getElementById('la').value || null, consent: document.getElementById('lc').checked
    });
    const name = document.getElementById('lp').selectedOptions[0].text;
    msg.innerHTML = error ? '<div class="notice error">Sorry, the enquiry could not be sent. Please try again.</div>'
      : `<div class="notice">Sent. ${esc(name)} will contact you.</div>`;
    if (!error) e.target.reset();
  });
}

function permitsPage() {
  document.title = 'Event permits guide — NHYIAMU';
  app.innerHTML = `<div class="wrap section prose">
    ${banner('permits', 'Event permits guide')}
    <p class="muted">For public events in Ejisu and Juaben Municipalities. Small private events at home or in a hall usually need fewer of these — ask the venue.</p>
    <ol class="steps">
      <li><b>Notify the Ghana Police Service</b><br>Public events must be notified to the police under the Public Order Act, 1994 (Act 491). Visit the police station nearest your venue well before the event. They can also arrange security and traffic control.</li>
      <li><b>Get a permit from the Municipal Assembly</b><br>Ejisu Municipal Assembly or Juaben Municipal Assembly — for use of public space, road closures, banners and signage.</li>
      <li><b>Check fire safety with the Ghana National Fire Service</b><br>Large gatherings and venues may need a fire safety inspection or a standby crew.</li>
      <li><b>Inform the traditional authority</b><br>For funerals, festivals and community events, inform the chief and elders and observe any customary rites.</li>
      <li><b>Music licensing</b><br>Playing recorded music in public may need a licence from GHAMRO (Ghana Music Rights Organisation).</li>
    </ol>
    <p class="muted">Office addresses and phone numbers for each office will be added here soon. Always confirm requirements with the office itself.</p>
  </div>`;
}

function aboutPage() {
  document.title = 'About NHYIAMU';
  app.innerHTML = `<div class="wrap section prose">
    ${banner('about', 'About NHYIAMU')}
    <p>NHYIAMU is a free directory that helps families, churches, schools and businesses in Ejisu and Juaben find everything they need for an event — and helps local suppliers get found.</p>
    <p>NHYIAMU is a project of <b>MEYE CATHOLIC ASOREBA</b>. Listing is free for every supplier. Optional featured listings pay the local team who visit and verify suppliers, and support our foundation.</p>
    <h2>Our foundation: OBREMPON</h2>
    <p>Every child is a gift. OBREMPON, our foundation (launching soon), stands with mothers and fathers who faced a difficult pregnancy and, with encouragement and support, chose to welcome their child.</p>
    <p>We help these families with what their children need to thrive — care, schooling and a good start in life. Money left after running NHYIAMU goes to OBREMPON.</p>
    <p class="muted">A yearly report of what came in and where it went will be published here.</p>
  </div>`;
}

function listPage() {
  document.title = 'List your business free — NHYIAMU';
  app.innerHTML = `<div class="wrap section prose">
    ${banner('list', 'List your business free')}
    <p>If you supply anything for events — venues, canopies and chairs, food and drinks, decor, cloth and sewing, makeup, sound, photos, transport and more — NHYIAMU helps people near you find you and contact you on WhatsApp.</p>
    <ul>
      <li><b>Free forever</b> for a basic listing with photos, prices and your WhatsApp.</li>
      <li><b>First 10 suppliers in each town</b> get 3 months featured free and a Founding supplier badge.</li>
      <li><b>Get verified:</b> an NHYIAMU field agent visits you and adds the Verified badge.</li>
    </ul>
    <div class="cta-band" style="margin-top:8px"><div><b>Ready? It takes about 5 minutes.</b><br><span class="muted">Create a free account, add your photos and prices, and a moderator will check and publish your listing.</span></div><a class="btn" href="#/me/new" id="list-start">Create my listing</a></div>
    <p class="muted">Prefer help? Our field agents are visiting suppliers in Ejisu and Juaben to register them in person.</p>
    <h2 style="margin-top:24px">Featured listing prices</h2>
    <p class="muted">Optional. Featured suppliers appear at the top of their town and category (3 spots, shared in rotation).</p>
    <div id="prices" class="panel">Loading…</div>
  </div>`;
  db.from('featured_prices').select('tier,months,amount').order('months').then(({ data }) => {
    if (!data) return;
    const row = (t) => data.filter((p) => p.tier === t).map((p) => `<td>${cedi(p.amount)}</td>`).join('');
    document.getElementById('prices').innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.95rem">
      <thead><tr><th style="text-align:left">Plan</th>${[...new Set(data.map((p) => p.months))].map((m) => `<th style="text-align:left">${m} month${m > 1 ? 's' : ''}</th>`).join('')}</tr></thead>
      <tbody><tr><td><b>Standard</b></td>${row('standard')}</tr><tr><td><b>Premium</b><br><span class="muted" style="font-size:.8rem">Venues, hotels, planners</span></td>${row('premium')}</tr></tbody></table></div>`;
  });
}

function notFound(msg = 'This page could not be found.') {
  app.innerHTML = `<div class="wrap section"><div class="empty"><h3>Not found</h3><p class="muted">${esc(msg)}</p><a class="btn" href="#/">Go to home page</a></div></div>`;
}

/* ---------- sample data for preview ---------- */
function sampleFor(town) {
  return SAMPLE_LISTINGS.filter((l) => {
    const base = REF.townBySlug[l.town_slug];
    if (!base) return false;
    return base.id === town.id || l.coverage === 'region' || l.coverage === 'nationwide' || (l.coverage === 'district' && base.district_id === town.district_id);
  });
}
function sampleSearch(town, scope, cat, q, verified) {
  const pool = scope === 'area' ? sampleFor(town) : SAMPLE_LISTINGS;
  const catIds = cat ? new Set([cat.id, ...REF.cats.filter((c) => c.parent_id === cat.id).map((c) => c.id)]) : null;
  return pool.filter((l) => (!catIds || l.cats.some((s) => catIds.has(REF.catBySlug[s]?.id)))
      && (!verified || l.verified) && (!q || l.business_name.toLowerCase().includes(q.toLowerCase())))
    .map((l) => {
      const base = REF.townBySlug[l.town_slug];
      const r = l.reviews || [];
      return { ...l, town_name: base?.name, travels: base?.id !== town.id, photo: null,
        rating: r.length ? (r.reduce((a, x) => a + x.rating, 0) / r.length).toFixed(1) : null, review_count: r.length, distance_km: null };
    })
    .sort((a, b) => (b.featured - a.featured) || (b.verified - a.verified) || (a.travels - b.travels));
}

/* ---------- start ---------- */
// If the first load is very slow (weak network), offer a retry instead of an endless "Loading…"
setTimeout(() => {
  if (app.querySelector('.loading')) app.innerHTML = `<div class="wrap section"><div class="empty"><h3>Still loading…</h3><p class="muted">Your connection seems slow.</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
}, 20000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
updateAccountLink();
render();
