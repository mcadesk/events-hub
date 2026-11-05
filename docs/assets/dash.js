// Account pages: sign-in, supplier dashboard, listing editor, field agent, moderator and admin screens.
import { db, app, esc, session, go, cedi, photoUrl, placeholder, hash, ref, townOptions, catPhoto,
  me, clearMe, toast, toGhanaPhone, localPhone, slugify, resetRef } from './core.js?v=15';

let REF;
const BASE = location.origin + location.pathname;
const STAFF = ['moderator', 'admin'];
const ROLE_LABEL = { host: 'Member', supplier: 'Supplier', agent: 'Field agent', moderator: 'Moderator', partner: 'Loan partner', admin: 'Admin' };

export async function route(parts, params) {
  REF = await ref();
  if (parts[0] === 'signin') return signIn();
  if (parts[0] === 'reset') return resetPassword();
  const u = await me(true);
  if (!u) { session.set('eh-return', location.hash); return signIn(); }
  const sub = parts[1] || 'home';
  const routes = {
    home: () => home(u),
    new: () => editor(u, null, false),
    edit: () => editor(u, parts[2], false),
    register: () => need(u, ['agent', ...STAFF]) && editor(u, null, true),
    agent: () => need(u, ['agent', ...STAFF]) && agentHome(u),
    review: () => need(u, STAFF) && reviewQueue(u),
    reports: () => need(u, STAFF) && reportsQueue(u),
    all: () => need(u, STAFF) && allListings(u, params),
    people: () => need(u, ['admin']) && people(u, params),
    towns: () => need(u, ['admin']) && townsAdmin(u),
    featured: () => need(u, ['admin']) && featuredAdmin(u),
    tally: () => need(u, ['agent', 'admin']) && tally(u, params),
    partners: () => need(u, ['admin']) && partnersAdmin(u),
    enquiries: () => need(u, ['partner', 'admin']) && enquiries(u),
    profile: () => profile(u)
  };
  return (routes[sub] || routes.home)();
}

function need(u, roles) {
  if (roles.includes(u.role)) return true;
  app.innerHTML = `<div class="wrap section"><div class="empty"><h3>Not available</h3><p class="muted">Your account doesn't have access to this page.</p><a class="btn" href="#/me">Back to my account</a></div></div>`;
  return false;
}

/* ---------- layout ---------- */
function shell(u, active, title, body) {
  const t = (id, label, roles) => (!roles || roles.includes(u.role)) ? `<a href="#/me/${id}" class="${active === id ? 'on' : ''}">${label}</a>` : '';
  app.innerHTML = `<div class="wrap">
    <div class="dash-head">
      <div><h1 style="margin:0">${esc(title)}</h1><span class="muted">${esc(u.full_name || u.email)} · ${ROLE_LABEL[u.role] || u.role}</span></div>
      <button class="btn btn-ghost btn-small" id="signout">Sign out</button>
    </div>
    <nav class="tabs" aria-label="Account sections">
      ${t('home', 'My listings')}
      ${t('agent', 'My towns', ['agent', 'admin'])}
      ${t('register', 'Register a supplier', ['agent', 'moderator', 'admin'])}
      ${t('review', 'Pending review', STAFF)}
      ${t('reports', 'Reports', STAFF)}
      ${t('all', 'All listings', STAFF)}
      ${t('people', 'People', ['admin'])}
      ${t('towns', 'Towns', ['admin'])}
      ${t('featured', 'Featured', ['admin'])}
      ${t('tally', u.role === 'agent' ? 'My tally' : 'Agent tally', ['agent', 'admin'])}
      ${t('partners', 'Loan partners', ['admin'])}
      ${t('enquiries', 'Loan enquiries', ['partner', 'admin'])}
      ${t('profile', 'My details')}
    </nav>
    <div id="dash">${body}</div>
  </div>`;
  document.getElementById('signout').addEventListener('click', async () => {
    await db.auth.signOut(); clearMe(); toast('Signed out.'); go('/');
  });
  window.scrollTo(0, 0);
}
const statusBadge = (s) => `<span class="status status-${esc(s)}">${esc(s)}</span>`;
const fail = (error, what = 'That') => { console.error(error); toast(`${what} didn't work: ${error?.message || 'please try again'}`, true); };


// Adds a "Show / Hide" button next to every password box on the page
function passwordToggles() {
  document.querySelectorAll('input[type=password]').forEach((inp) => {
    if (inp.dataset.toggle) return;
    inp.dataset.toggle = '1';
    const wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-toggle'; b.textContent = 'Show';
    b.setAttribute('aria-label', 'Show password');
    b.addEventListener('click', () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      inp.focus();
    });
    wrap.appendChild(b);
  });
}

/* ---------- sign in / create account ---------- */
function signIn(mode = 'signin') {
  document.title = 'Sign in — NHYIAMU';
  const isUp = mode === 'signup';
  app.innerHTML = `<div class="wrap"><div class="panel auth-card">
    <h1 style="font-size:1.8rem">${isUp ? 'Create your free account' : 'Sign in'}</h1>
    <p class="muted" style="margin-top:0">${isUp ? 'For suppliers listing their business, field agents and anyone leaving reviews.' : 'Welcome back to NHYIAMU.'}</p>
    <form class="form" id="auth-form">
      ${isUp ? `<div class="field"><label for="a-name">Your name</label><input type="text" id="a-name" required autocomplete="name"></div>
      <div class="field"><label for="a-phone">Phone (WhatsApp)</label><input type="tel" id="a-phone" required placeholder="024 123 4567" autocomplete="tel"></div>` : ''}
      <div class="field"><label for="a-email">Email</label><input type="text" inputmode="email" id="a-email" required autocomplete="email"></div>
      <div class="field"><label for="a-pass">Password</label><input type="password" id="a-pass" required minlength="8" autocomplete="${isUp ? 'new-password' : 'current-password'}" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:11px 12px;min-height:44px">
        ${isUp ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
      <button class="btn btn-block" type="submit">${isUp ? 'Create account' : 'Sign in'}</button>
      <div id="auth-msg"></div>
    </form>
    <p style="margin:16px 0 0">${isUp ? 'Already have an account? <button class="linkish" id="to-in">Sign in</button>'
      : 'New here? <button class="linkish" id="to-up">Create a free account</button><br><button class="linkish" id="forgot" style="margin-top:8px">Forgot your password?</button>'}</p>
  </div></div>`;
  passwordToggles();
  document.getElementById('to-in')?.addEventListener('click', () => signIn('signin'));
  document.getElementById('to-up')?.addEventListener('click', () => signIn('signup'));
  document.getElementById('forgot')?.addEventListener('click', forgot);
  const msg = document.getElementById('auth-msg');
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('a-email').value.trim();
    const password = document.getElementById('a-pass').value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (isUp) {
        const phone = toGhanaPhone(document.getElementById('a-phone').value);
        if (!phone) { msg.innerHTML = '<div class="notice error">Please enter a valid Ghana phone number, e.g. 024 123 4567.</div>'; return; }
        const { data, error } = await db.auth.signUp({ email, password,
          options: { data: { full_name: document.getElementById('a-name').value.trim(), phone }, emailRedirectTo: BASE } });
        if (error) throw error;
        if (!data.session) { msg.innerHTML = '<div class="notice">Almost done — check your email and tap the link to confirm your account, then sign in.</div>'; return; }
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      clearMe();
      const back = session.get('eh-return'); session.set('eh-return', null);
      go(back && !back.includes('signin') ? back.replace(/^#/, '') : '/me');
    } catch (err) {
      msg.innerHTML = `<div class="notice error">${esc(/invalid login/i.test(err.message) ? 'Wrong email or password.' : err.message)}</div>`;
    } finally { btn.disabled = false; }
  });
}

function forgot() {
  app.innerHTML = `<div class="wrap"><div class="panel auth-card"><h1 style="font-size:1.8rem">Reset your password</h1>
    <form class="form" id="f-form"><div class="field"><label for="f-email">Your email</label><input type="text" inputmode="email" id="f-email" required></div>
    <button class="btn btn-block" type="submit">Send reset link</button><div id="f-msg"></div></form>
    <p><button class="linkish" id="back">Back to sign in</button></p></div></div>`;
  document.getElementById('back').addEventListener('click', () => signIn());
  document.getElementById('f-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.auth.resetPasswordForEmail(document.getElementById('f-email').value.trim(), { redirectTo: BASE + '?mode=reset' });
    document.getElementById('f-msg').innerHTML = error ? `<div class="notice error">${esc(error.message)}</div>`
      : '<div class="notice">If that email has an account, a reset link is on its way. Open it on this phone.</div>';
  });
}

async function resetPassword() {
  const { data: { session: s } } = await db.auth.getSession();
  if (!s) return signIn();
  app.innerHTML = `<div class="wrap"><div class="panel auth-card"><h1 style="font-size:1.8rem">Choose a new password</h1>
    <form class="form" id="r-form"><div class="field"><label for="r-pass">New password</label><input type="password" id="r-pass" required minlength="8" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:11px 12px;min-height:44px"></div>
    <button class="btn btn-block" type="submit">Save password</button><div id="r-msg"></div></form></div></div>`;
  passwordToggles();
  document.getElementById('r-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.auth.updateUser({ password: document.getElementById('r-pass').value });
    if (error) return (document.getElementById('r-msg').innerHTML = `<div class="notice error">${esc(error.message)}</div>`);
    history.replaceState(null, '', location.pathname + '#/me');
    toast('Password saved.'); go('/me');
  });
}

/* ---------- supplier home ---------- */
async function home(u) {
  shell(u, 'home', 'My account', '<div class="skeleton"></div>');
  const { data: listings, error } = await db.from('listings')
    .select('id,slug,business_name,status,reject_reason,verified,founding,last_confirmed_at,updated_at,towns(name),listing_photos(path,sort)')
    .eq('owner_id', u.id).order('updated_at', { ascending: false });
  if (error) return fail(error, 'Loading your listings');
  const ids = listings.map((l) => l.id);
  let taps = [], reviews = [];
  if (ids.length) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    [{ data: taps }, { data: reviews }] = await Promise.all([
      db.from('listing_taps').select('listing_id,kind').in('listing_id', ids).gte('created_at', since),
      db.from('reviews').select('id,listing_id,rating,comment,event_type,reply,created_at').in('listing_id', ids).order('created_at', { ascending: false })
    ]);
  }
  const count = (id, kind) => (taps || []).filter((t) => t.listing_id === id && t.kind === kind).length;
  const stale = (l) => (Date.now() - new Date(l.last_confirmed_at)) > 180 * 864e5;
  const intro = u.role === 'host' && !listings.length
    ? `<div class="cta-band"><div><h3>List your business free</h3><span class="muted">Add your photos, prices and WhatsApp number. A moderator checks it, then people near you can find you.</span></div><a class="btn" href="#/me/new">Create my listing</a></div>` : '';
  document.getElementById('dash').innerHTML = `${intro}
    ${listings.length ? `<div class="section-head"><h2>My listings</h2><a class="btn btn-small" href="#/me/new">+ Add a listing</a></div>
    <div class="row-list">${listings.map((l) => {
      const ph = (l.listing_photos || []).sort((a, b) => a.sort - b.sort)[0];
      return `<div class="row">
        <div class="row-top"><div style="display:flex;gap:10px;align-items:center">
          <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;flex:none">${ph ? `<img src="${esc(photoUrl(ph.path))}" alt="" style="width:100%;height:100%;object-fit:cover">` : placeholder(l.business_name, hash(l.slug))}</div>
          <div><b>${esc(l.business_name)}</b><br><span class="muted" style="font-size:.88rem">${esc(l.towns?.name || '')}</span></div></div>
          <div class="badges">${statusBadge(l.status)}${l.verified ? '<span class="badge badge-verified">✓ Verified</span>' : ''}${l.founding ? '<span class="badge badge-founding">Founding</span>' : ''}</div></div>
        ${l.status === 'rejected' && l.reject_reason ? `<div class="notice error">Not approved: ${esc(l.reject_reason)}. Please fix and submit again.</div>` : ''}
        ${l.status === 'draft' ? '<div class="notice">Draft — not visible yet. Submit it when you are ready.</div>' : ''}
        ${l.status === 'pending' ? '<div class="notice" style="background:var(--gold-soft)">Waiting for a moderator to check it (usually within 48 hours).</div>' : ''}
        ${l.status === 'live' ? `<span class="muted" style="font-size:.88rem">Last 30 days: ${count(l.id, 'view')} views · ${count(l.id, 'whatsapp')} WhatsApp taps · ${count(l.id, 'call')} call taps</span>` : ''}
        ${l.status === 'live' && stale(l) ? '<div class="notice" style="background:var(--gold-soft)">Are your details still correct? Please confirm so visitors know your listing is up to date.</div>' : ''}
        <div class="row-actions">
          <a class="btn btn-ghost" href="#/me/edit/${l.id}">Edit</a>
          <a class="btn btn-ghost" href="#/l/${esc(l.slug)}">View</a>
          ${['draft', 'rejected'].includes(l.status) ? `<button class="btn" data-submit="${l.id}">Submit for review</button>` : ''}
          ${l.status === 'live' && stale(l) ? `<button class="btn btn-gold" data-confirm="${l.id}">Details are correct</button>` : ''}
        </div></div>`; }).join('')}</div>` : ''}
    ${(reviews || []).length ? `<h2 style="margin-top:24px">Reviews of my business</h2><div class="row-list">${reviews.map((r) => `<div class="row">
      <div><span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <span class="muted">· ${esc(listings.find((l) => l.id === r.listing_id)?.business_name || '')}${r.event_type ? ' · ' + esc(r.event_type) : ''}</span></div>
      <div>${esc(r.comment || '')}</div>
      <form class="filters" data-reply="${r.id}"><input type="text" maxlength="500" placeholder="Write a public reply" value="${esc(r.reply || '')}"><button class="btn btn-small" type="submit">${r.reply ? 'Update reply' : 'Reply'}</button></form>
    </div>`).join('')}</div>` : ''}
    ${!listings.length && u.role !== 'host' ? '<div class="empty"><p class="muted">You have no listings of your own.</p><a class="btn" href="#/me/new">Add a listing</a></div>' : ''}`;

  document.querySelectorAll('[data-submit]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('listings').update({ status: 'pending' }).eq('id', b.dataset.submit);
    if (error) return fail(error, 'Submitting');
    toast('Submitted. A moderator will check it soon.'); home(u);
  }));
  document.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('listings').update({ last_confirmed_at: new Date().toISOString() }).eq('id', b.dataset.confirm);
    if (error) return fail(error, 'Confirming');
    toast('Thank you — your listing is marked up to date.'); home(u);
  }));
  document.querySelectorAll('[data-reply]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.from('reviews').update({ reply: f.querySelector('input').value.trim() || null }).eq('id', f.dataset.reply);
    if (error) return fail(error, 'Saving the reply');
    toast('Reply saved.');
  }));
}

/* ---------- my details ---------- */
function profile(u) {
  shell(u, 'profile', 'My details', `<form class="form" id="p-form" style="max-width:480px">
    <div class="field"><label for="p-name">Name</label><input type="text" id="p-name" value="${esc(u.full_name || '')}" required></div>
    <div class="field"><label for="p-phone">Phone</label><input type="tel" id="p-phone" value="${esc(localPhone(u.phone))}"></div>
    <div class="field"><label>Email</label><input type="text" value="${esc(u.email || '')}" disabled></div>
    <button class="btn" type="submit">Save</button></form>`);
  document.getElementById('p-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneRaw = document.getElementById('p-phone').value.trim();
    const phone = phoneRaw ? toGhanaPhone(phoneRaw) : null;
    if (phoneRaw && !phone) return toast('Please enter a valid Ghana phone number.', true);
    const { error } = await db.from('profiles').update({ full_name: document.getElementById('p-name').value.trim(), phone }).eq('id', u.id);
    if (error) return fail(error, 'Saving');
    clearMe(); toast('Saved.');
  });
}

/* ---------- listing editor ---------- */
const EXTRA = {
  venues: [['seated_capacity', 'Seated capacity', 'number'], ['indoor_outdoor', 'Indoor or outdoor', ['Indoor', 'Outdoor', 'Both']], ['parking', 'Parking', 'bool'], ['generator', 'Backup generator', 'bool'], ['air_conditioning', 'Air conditioning', 'bool'], ['washrooms', 'Washrooms', 'bool']],
  rentals: [['items', 'What you rent out, with rough quantities and prices', 'textarea', 'e.g. 300 chairs at GH₵ 2 each, 10 canopies at GH₵ 150']],
  'food-drinks': [['cuisine', 'Type of food', ['Local', 'Continental', 'Local and continental']], ['minimum_guests', 'Minimum number of guests', 'number'], ['drinks_supplied', 'Drinks supplied', 'bool']],
  clothing: [['styles', 'Styles you make or sell', 'text', 'e.g. Kente, kaba and slit, suits'], ['group_orders', 'Group / uniform orders', 'bool'], ['turnaround_days', 'Usual turnaround (days)', 'number']],
  accommodation: [['rooms', 'Number of rooms', 'number'], ['conference_hall', 'Conference hall', 'bool']],
  transport: [['vehicle_types', 'Vehicle types', 'text', 'e.g. Sprinter, Coaster, saloon cars'], ['seats', 'Seats per vehicle', 'text']],
  'photo-video': [['packages', 'Packages', 'textarea'], ['drone', 'Drone shots', 'bool'], ['live_streaming', 'Live-streaming', 'bool'], ['same_day_edits', 'Same-day edits', 'bool']],
  entertainment: [['type_of_act', 'Type of act', 'text'], ['languages', 'Languages', 'text', 'e.g. Twi, English']]
};
function extraFields(topSlugs, extra = {}) {
  const fields = [...new Set(topSlugs)].flatMap((s) => EXTRA[s] || []);
  if (!fields.length) return '';
  return `<fieldset><legend>More details</legend><div class="form-grid two">${fields.map(([k, label, type, ph]) => {
    const v = extra[k];
    if (type === 'bool') return `<label class="check"><input type="checkbox" data-extra="${k}" data-type="bool" ${v ? 'checked' : ''}> ${esc(label)}</label>`;
    if (Array.isArray(type)) return `<div class="field"><label>${esc(label)}</label><select data-extra="${k}"><option value=""></option>${type.map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    if (type === 'textarea') return `<div class="field" style="grid-column:1/-1"><label>${esc(label)}</label><textarea data-extra="${k}" rows="2" placeholder="${esc(ph || '')}">${esc(v || '')}</textarea></div>`;
    return `<div class="field"><label>${esc(label)}</label><input type="${type === 'number' ? 'number' : 'text'}" data-extra="${k}" data-type="${type}" value="${esc(v ?? '')}" placeholder="${esc(ph || '')}"></div>`;
  }).join('')}</div></fieldset>`;
}

async function editor(u, id, asAgent) {
  let l = null, cats = [], photos = [];
  if (id) {
    const { data, error } = await db.from('listings').select('*, listing_categories(category_id), listing_photos(id,path,sort)').eq('id', id).maybeSingle();
    if (error || !data) return shell(u, 'home', 'Edit listing', '<div class="notice error">Listing not found, or you can\'t edit it.</div>');
    l = data; cats = data.listing_categories.map((c) => c.category_id); photos = data.listing_photos.sort((a, b) => a.sort - b.sort);
  }
  const isNew = !l;
  const agentMode = isNew ? (asAgent && u.role === 'agent') : !!l.registered_by && l.registered_by === u.id;
  const title = isNew ? (asAgent ? 'Register a supplier' : 'New listing') : `Edit: ${l.business_name}`;
  const v = (k, d = '') => esc(l?.[k] ?? d);
  const topOf = (cid) => { const c = REF.catById[cid]; return c ? (c.parent_id ? REF.catById[c.parent_id].slug : c.slug) : null; };

  shell(u, asAgent ? 'register' : 'home', title, `
  ${agentMode && isNew ? '<div class="notice" style="margin-bottom:12px">Fill this in <b>with the supplier present</b>, using their details. The listing will be credited to you.</div>' : ''}
  ${l?.status === 'rejected' && l.reject_reason ? `<div class="notice error" style="margin-bottom:12px">Not approved: ${esc(l.reject_reason)}</div>` : ''}
  <form class="form" id="ed" style="max-width:760px">
    <fieldset><legend>The business</legend>
      <div class="field"><label for="e-name">Business name</label><input type="text" id="e-name" required maxlength="80" value="${v('business_name')}"></div>
      <div class="field"><label for="e-desc">Describe what you offer</label><textarea id="e-desc" rows="4" maxlength="500" required>${v('description')}</textarea><span class="hint">Up to 500 characters. Mention what makes you good.</span></div>
    </fieldset>
    <fieldset><legend>What you offer</legend>
      <span class="hint">Tick everything you offer — as many as you like. Open a group to see its options.</span>
      <div id="offer">${REF.top.map((t) => {
        const subs = REF.cats.filter((c) => c.parent_id === t.id);
        const n = subs.filter((c) => cats.includes(c.id)).length;
        return `<details class="offer-group" ${n ? 'open' : ''}><summary>${catPhoto(t.slug) ? `<img class="offer-thumb" src="${catPhoto(t.slug, 96, 96)}" alt="" loading="lazy" width="40" height="40">` : ''}<span>${esc(t.name)}</span><span class="offer-count" data-count="${t.id}">${n ? `${n} ticked` : ''}</span></summary>
          <div class="checks">${subs.map((c) => `<label class="check"><input type="checkbox" name="offer" value="${c.id}" data-top="${t.id}" ${cats.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></details>`;
      }).join('')}</div>
      <span class="hint" id="offer-total">${cats.length ? `${cats.length} ticked` : 'Nothing ticked yet'}</span>
    </fieldset>
    <fieldset><legend>Contact</legend>
      <div class="form-grid two">
        <div class="field"><label for="e-contact">Contact person</label><input type="text" id="e-contact" required value="${v('contact_name', isNew && !asAgent ? u.full_name || '' : '')}"></div>
        <div class="field"><label for="e-phone">Phone for calls</label><input type="tel" id="e-phone" required placeholder="024 123 4567" value="${esc(localPhone(l?.phone || (isNew && !asAgent ? u.phone : '')))}"></div>
        <div class="field"><label for="e-wa">WhatsApp number</label><input type="tel" id="e-wa" required placeholder="024 123 4567" value="${esc(localPhone(l?.whatsapp || (isNew && !asAgent ? u.phone : '')))}"></div>
      </div>
    </fieldset>
    <fieldset><legend>Where</legend>
      <div class="form-grid two">
        <div class="field"><label for="e-town">Town you are based in</label><select id="e-town" required>${townOptions(l?.base_town_id ?? REF.townBySlug['ejisu-besease']?.id, 'id')}</select><span class="hint">Your town isn't listed? Choose the nearest and tell your agent or moderator.</span></div>
        <div class="field"><label for="e-cov">Where you serve</label><select id="e-cov">
          ${[['town', 'My town only'], ['district', 'My whole municipality'], ['region', 'Anywhere in Ashanti'], ['nationwide', 'Anywhere in Ghana']].map(([k, t]) => `<option value="${k}" ${l?.coverage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="e-land">Landmark directions</label><input type="text" id="e-land" required maxlength="120" placeholder="e.g. Opposite the Methodist church" value="${v('landmark')}"></div>
    </fieldset>
    <fieldset><legend>Prices</legend>
      <div class="form-grid two">
        <div class="field"><label for="e-pmin">From (GH₵)</label><input type="number" id="e-pmin" min="0" step="1" value="${v('price_min')}"></div>
        <div class="field"><label for="e-pmax">Up to (GH₵)</label><input type="number" id="e-pmax" min="0" step="1" value="${v('price_max')}"></div>
        <div class="field"><label for="e-unit">Price is</label><select id="e-unit">${[['per_event', 'per event'], ['per_head', 'per head'], ['per_item', 'per item'], ['per_day', 'per day'], ['per_night', 'per night'], ['per_hour', 'per hour']].map(([k, t]) => `<option value="${k}" ${l?.price_unit === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <label class="check"><input type="checkbox" id="e-neg" ${l?.negotiable ? 'checked' : ''}> Open to discussion</label>
      <label class="check"><input type="checkbox" id="e-disc" ${l?.discounts ? 'checked' : ''}> Discounts available</label>
      <div class="field"><label for="e-discnote">Discount details (optional)</label><input type="text" id="e-discnote" maxlength="120" value="${v('discount_note')}"></div>
    </fieldset>
    <div id="extra-wrap">${extraFields(cats.map(topOf).filter(Boolean), l?.extra || {})}</div>
    <fieldset><legend>Extras (optional)</legend>
      <div class="form-grid two">
        <div class="field"><label for="e-days">Working days</label><input type="text" id="e-days" placeholder="e.g. Mon–Sat" value="${v('working_days')}"></div>
        <div class="field"><label for="e-years">Years in business</label><input type="number" id="e-years" min="0" max="80" value="${v('years_in_business')}"></div>
        <div class="field"><label for="e-fb">Facebook link</label><input type="text" id="e-fb" value="${esc(l?.socials?.facebook || '')}"></div>
        <div class="field"><label for="e-ig">Instagram</label><input type="text" id="e-ig" value="${esc(l?.socials?.instagram || '')}"></div>
        <div class="field"><label for="e-tt">TikTok</label><input type="text" id="e-tt" value="${esc(l?.socials?.tiktok || '')}"></div>
      </div>
    </fieldset>
    ${agentMode && isNew ? '<label class="check" style="white-space:normal"><input type="checkbox" id="e-consent" required> The supplier agrees to be listed on NHYIAMU with these details</label>' : ''}
    <fieldset><legend>Photos</legend>
      ${isNew ? '<p class="muted" style="margin:0">Save first, then you can add up to 10 photos of your work.</p>' : `
      <div class="photos" id="photos">${photos.map((p) => `<div class="photo"><img src="${esc(photoUrl(p.path))}" alt=""><button type="button" data-del="${p.id}" data-path="${esc(p.path)}" aria-label="Remove photo">×</button></div>`).join('')}</div>
      <label class="btn btn-ghost" style="width:max-content">+ Add photos<input type="file" id="e-files" accept="image/*" multiple hidden></label>
      <span class="hint">Photos are made smaller automatically to save data. Up to 10.</span><div id="up-msg"></div>`}
    </fieldset>
    <div class="row-actions">
      <button class="btn btn-ghost" type="submit" data-action="draft">${isNew ? 'Save and add photos' : 'Save changes'}</button>
      ${!l || ['draft', 'rejected'].includes(l.status) ? '<button class="btn" type="submit" data-action="submit">Save and submit for review</button>' : ''}
    </div>
    <div id="ed-msg"></div>
  </form>`);

  // Update counts and category-specific fields when offerings are ticked
  const ticked = () => [...document.querySelectorAll('input[name=offer]:checked')].map((c) => Number(c.value));
  document.getElementById('offer').addEventListener('change', () => {
    const ids = ticked();
    REF.top.forEach((t) => {
      const n = ids.filter((id) => REF.catById[id]?.parent_id === t.id).length;
      const el = document.querySelector(`[data-count="${t.id}"]`); if (el) el.textContent = n ? `${n} ticked` : '';
    });
    document.getElementById('offer-total').textContent = ids.length ? `${ids.length} ticked` : 'Nothing ticked yet';
    const current = collectExtra();
    document.getElementById('extra-wrap').innerHTML = extraFields(ids.map(topOf).filter(Boolean), { ...(l?.extra || {}), ...current });
  });

  let action = 'draft';
  document.querySelectorAll('#ed [type=submit]').forEach((b) => b.addEventListener('click', () => { action = b.dataset.action; }));
  document.getElementById('ed').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('ed-msg');
    const phone = toGhanaPhone(document.getElementById('e-phone').value);
    const whatsapp = toGhanaPhone(document.getElementById('e-wa').value);
    if (!phone || !whatsapp) return (msg.innerHTML = '<div class="notice error">Please enter valid Ghana phone numbers, e.g. 024 123 4567.</div>');
    const catIds = [...new Set(ticked())];
    if (!catIds.length) return (msg.innerHTML = '<div class="notice error">Please tick at least one thing you offer.</div>');
    const num = (x) => (document.getElementById(x).value === '' ? null : Number(document.getElementById(x).value));
    const pmin = num('e-pmin'), pmax = num('e-pmax');
    if (pmin != null && pmax != null && pmin > pmax) return (msg.innerHTML = '<div class="notice error">"From" price should not be more than "Up to" price.</div>');
    const row = {
      business_name: document.getElementById('e-name').value.trim(), contact_name: document.getElementById('e-contact').value.trim(),
      phone, whatsapp, base_town_id: Number(document.getElementById('e-town').value), landmark: document.getElementById('e-land').value.trim(),
      coverage: document.getElementById('e-cov').value, description: document.getElementById('e-desc').value.trim(),
      price_min: pmin, price_max: pmax, price_unit: document.getElementById('e-unit').value,
      negotiable: document.getElementById('e-neg').checked, discounts: document.getElementById('e-disc').checked,
      discount_note: document.getElementById('e-discnote').value.trim() || null,
      working_days: document.getElementById('e-days').value.trim() || null, years_in_business: num('e-years'),
      socials: Object.fromEntries([['facebook', 'e-fb'], ['instagram', 'e-ig'], ['tiktok', 'e-tt']].map(([k, x]) => [k, document.getElementById(x).value.trim()]).filter(([, val]) => val)),
      extra: collectExtra()
    };
    const btns = document.querySelectorAll('#ed [type=submit]'); btns.forEach((b) => (b.disabled = true));
    try {
      let listingId = l?.id;
      if (isNew) {
        const ins = { ...row, owner_id: u.id, slug: `${slugify(row.business_name)}-${Math.random().toString(36).slice(2, 6)}`,
          status: action === 'submit' ? 'pending' : 'draft' };
        if (agentMode) { ins.registered_by = u.id; ins.consent_given = document.getElementById('e-consent').checked; }
        const { data, error } = await db.from('listings').insert(ins).select('id').single();
        if (error) throw error;
        listingId = data.id;
      } else {
        const upd = { ...row };
        if (action === 'submit') upd.status = 'pending';
        const { error } = await db.from('listings').update(upd).eq('id', listingId);
        if (error) throw error;
        await db.from('listing_categories').delete().eq('listing_id', listingId);
      }
      if (catIds.length) {
        const { error } = await db.from('listing_categories').insert(catIds.map((c) => ({ listing_id: listingId, category_id: c })));
        if (error) throw error;
      }
      clearMe();
      toast(action === 'submit' ? 'Saved and submitted for review.' : 'Saved.');
      if (isNew) go(`/me/edit/${listingId}`); else editor(u, listingId, asAgent);
    } catch (err) {
      msg.innerHTML = `<div class="notice error">Could not save: ${esc(err.message)}</div>`;
    } finally { btns.forEach((b) => (b.disabled = false)); }
  });

  // Photos
  document.getElementById('e-files')?.addEventListener('change', async (e) => {
    const files = [...e.target.files].slice(0, Math.max(0, 10 - photos.length));
    const out = document.getElementById('up-msg');
    if (!files.length) return (out.innerHTML = '<div class="notice error">You already have 10 photos.</div>');
    let done = 0;
    for (const f of files) {
      out.innerHTML = `<div class="notice">Uploading ${done + 1} of ${files.length}…</div>`;
      try {
        const blob = await shrink(f);
        const path = `${u.id}/${l.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const up = await db.storage.from('listing-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
        const { error } = await db.from('listing_photos').insert({ listing_id: l.id, path, sort: photos.length + done });
        if (error) throw error;
        done++;
      } catch (err) { out.innerHTML = `<div class="notice error">A photo could not be uploaded: ${esc(err.message)}</div>`; return; }
    }
    toast(`${done} photo${done > 1 ? 's' : ''} added.`);
    editor(u, l.id, asAgent);
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await db.storage.from('listing-photos').remove([b.dataset.path]);
    const { error } = await db.from('listing_photos').delete().eq('id', b.dataset.del);
    if (error) return fail(error, 'Removing the photo');
    b.parentElement.remove(); photos = photos.filter((p) => p.id !== b.dataset.del);
  }));
}
function collectExtra() {
  const o = {};
  document.querySelectorAll('[data-extra]').forEach((el) => {
    const k = el.dataset.extra;
    if (el.dataset.type === 'bool') { if (el.checked) o[k] = true; return; }
    const val = el.value.trim();
    if (val !== '') o[k] = el.dataset.type === 'number' ? Number(val) : val;
  });
  return o;
}
// Resize to max 1280px and compress to JPEG (keeps uploads around 150–300 KB)
async function shrink(file, max = 1280, quality = 0.75) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}

/* ---------- field agent ---------- */
async function agentHome(u) {
  shell(u, 'agent', 'My towns', '<div class="skeleton"></div>');
  const { data: mine } = await db.from('agent_towns').select('town_id').eq('agent_id', u.id);
  const townIds = (mine || []).map((t) => t.town_id);
  if (!townIds.length && u.role === 'agent') {
    document.getElementById('dash').innerHTML = '<div class="empty"><h3>No towns assigned yet</h3><p class="muted">Ask the admin to assign you to your towns.</p><a class="btn" href="#/me/register">Register a supplier anyway</a></div>';
    return;
  }
  let q = db.from('listings').select('id,slug,business_name,status,verified,base_town_id,registered_by,towns(name)').in('status', ['pending', 'live']).eq('verified', false).order('created_at');
  if (townIds.length) q = q.in('base_town_id', townIds);
  const { data: todo } = await q;
  document.getElementById('dash').innerHTML = `
    <p>${townIds.length ? `Your towns: <b>${townIds.map((id) => esc(REF.townById[id]?.name)).join(', ')}</b>` : 'You see all towns.'}</p>
    <div class="row-actions" style="margin-bottom:16px"><a class="btn" href="#/me/register">+ Register a supplier</a><a class="btn btn-ghost" href="#/me/tally">My tally</a></div>
    <h2>Waiting for a visit</h2><p class="muted">Visit these suppliers, check the business is real, then mark them verified.</p>
    <div class="row-list">${(todo || []).length ? todo.map((l) => `<div class="row"><div class="row-top"><div><b>${esc(l.business_name)}</b><br><span class="muted">${esc(l.towns?.name)}</span></div>${statusBadge(l.status)}</div>
      <div class="row-actions"><a class="btn btn-ghost" href="#/l/${esc(l.slug)}">View</a><button class="btn" data-verify="${l.id}">Mark verified (I visited)</button></div></div>`).join('')
      : '<div class="empty"><p class="muted" style="margin:0">Nothing waiting. Well done!</p></div>'}</div>`;
  document.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.rpc('agent_verify', { p_listing: b.dataset.verify });
    if (error) return fail(error, 'Verifying');
    toast('Marked as verified.'); agentHome(u);
  }));
}

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`; const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [from, to];
}
async function tally(u, params) {
  const ym = params.get('m') || new Date().toISOString().slice(0, 7);
  shell(u, 'tally', u.role === 'agent' ? 'My tally' : 'Agent tally', '<div class="skeleton"></div>');
  const [from, to] = monthRange(ym);
  const { data, error } = await db.rpc('agent_stats', { p_from: from, p_to: to });
  if (error) return fail(error, 'Loading the tally');
  document.getElementById('dash').innerHTML = `
    <div class="field" style="max-width:220px;margin-bottom:12px"><label for="t-m">Month</label><input type="month" id="t-m" value="${ym}" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px;min-height:44px"></div>
    <div style="overflow-x:auto"><table class="table"><thead><tr><th>Agent</th><th>Registered this month</th><th>Verified this month</th><th>Live listings (all time)</th></tr></thead>
    <tbody>${(data || []).map((r) => `<tr><td><b>${esc(r.agent_name || '—')}</b><br><span class="muted">${esc(r.agent_email || '')}</span></td><td>${r.registered}</td><td>${r.verified}</td><td>${r.live}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No agents yet.</td></tr>'}</tbody></table></div>
    <p class="hint">Commission is paid on featured fees from suppliers an agent registered: 50% of the first month's value, then 20% of later payments.</p>`;
  document.getElementById('t-m').addEventListener('change', (e) => go(`/me/tally?m=${e.target.value}`));
}

/* ---------- moderator ---------- */
async function reviewQueue(u) {
  shell(u, 'review', 'Pending review', '<div class="skeleton"></div>');
  const { data, error } = await db.from('listings')
    .select('id,slug,business_name,description,phone,whatsapp,landmark,created_at,registered_by,consent_given,towns(name),listing_photos(path,sort),listing_categories(categories(name)),profiles!listings_owner_id_fkey(full_name,email)')
    .eq('status', 'pending').order('created_at');
  if (error) return fail(error, 'Loading the queue');
  document.getElementById('dash').innerHTML = `<p class="muted">Check each listing looks real: sensible name, photos of real work, a working phone number. Oldest first.</p>
    <div class="row-list">${data.length ? data.map((l) => {
      const ph = (l.listing_photos || []).sort((a, b) => a.sort - b.sort);
      return `<div class="row" data-row="${l.id}">
      <div class="row-top"><div><b>${esc(l.business_name)}</b> <span class="muted">· ${esc(l.towns?.name)}</span><br>
        <span class="muted" style="font-size:.88rem">${(l.listing_categories || []).map((c) => esc(c.categories?.name)).join(', ')} · by ${esc(l.profiles?.full_name || l.profiles?.email || '')}${l.registered_by ? ' (agent registration' + (l.consent_given ? ', consent given)' : ')') : ''}</span></div>
        <span class="muted" style="font-size:.85rem">${new Date(l.created_at).toLocaleDateString('en-GB')}</span></div>
      <div style="font-size:.92rem">${esc(l.description)}</div>
      <div class="muted" style="font-size:.88rem">📞 ${esc(localPhone(l.phone))} · WhatsApp ${esc(localPhone(l.whatsapp))} · ${esc(l.landmark)}</div>
      ${ph.length ? `<div class="photos">${ph.slice(0, 5).map((p) => `<div class="photo"><img src="${esc(photoUrl(p.path))}" alt="" loading="lazy"></div>`).join('')}</div>` : '<span class="hint">No photos yet.</span>'}
      <div class="row-actions">
        <button class="btn" data-approve="${l.id}">Approve</button>
        <a class="btn btn-ghost" href="#/me/edit/${l.id}">Edit</a>
        <a class="btn btn-ghost" href="#/l/${esc(l.slug)}">Preview</a>
      </div>
      <form class="filters" data-reject="${l.id}"><input type="text" required placeholder="Reason, e.g. please add photos of your work"><button class="btn btn-ghost btn-small" type="submit">Send back</button></form>
    </div>`; }).join('') : '<div class="empty"><p class="muted" style="margin:0">Nothing waiting for review.</p></div>'}</div>`;
  document.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const { data: note, error } = await db.rpc('approve_listing', { p_id: b.dataset.approve });
    if (error) { b.disabled = false; return fail(error, 'Approving'); }
    toast(note || 'Approved.'); document.querySelector(`[data-row="${b.dataset.approve}"]`)?.remove();
  }));
  document.querySelectorAll('[data-reject]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.rpc('reject_listing', { p_id: f.dataset.reject, p_reason: f.querySelector('input').value.trim() });
    if (error) return fail(error, 'Sending back');
    toast('Sent back to the supplier with your reason.'); document.querySelector(`[data-row="${f.dataset.reject}"]`)?.remove();
  }));
}

async function reportsQueue(u) {
  shell(u, 'reports', 'Reports', '<div class="skeleton"></div>');
  const { data, error } = await db.from('reports')
    .select('id,reason,note,created_at,listing_id,review_id,listings(id,slug,business_name,status),reviews(id,comment,rating,hidden)')
    .eq('status', 'open').order('created_at');
  if (error) return fail(error, 'Loading reports');
  const reason = { fake: 'Fake business', wrong_number: 'Wrong number', closed: 'Closed', offensive: 'Offensive', scam: 'Scam', other: 'Other' };
  document.getElementById('dash').innerHTML = `<div class="row-list">${data.length ? data.map((r) => `<div class="row" data-row="${r.id}">
    <div class="row-top"><div><b>${esc(reason[r.reason] || r.reason)}</b> · ${r.listings ? `<a href="#/l/${esc(r.listings.slug)}">${esc(r.listings.business_name)}</a> ${statusBadge(r.listings.status)}` : 'Review'}</div>
    <span class="muted" style="font-size:.85rem">${new Date(r.created_at).toLocaleDateString('en-GB')}</span></div>
    ${r.note ? `<div>${esc(r.note)}</div>` : ''}
    ${r.reviews ? `<div class="muted">Review: "${esc(r.reviews.comment || '')}"</div>` : ''}
    <div class="row-actions">
      ${r.listings ? (r.listings.status === 'suspended' ? `<button class="btn btn-ghost" data-status="live" data-listing="${r.listings.id}">Restore listing</button>` : `<button class="btn btn-ghost" data-status="suspended" data-listing="${r.listings.id}">Suspend listing</button>`) : ''}
      ${r.reviews ? `<button class="btn btn-ghost" data-hide="${r.reviews.id}">Hide review</button>` : ''}
      <button class="btn" data-resolve="${r.id}" data-s="resolved">Resolved</button>
      <button class="btn btn-ghost" data-resolve="${r.id}" data-s="dismissed">Dismiss</button>
    </div></div>`).join('') : '<div class="empty"><p class="muted" style="margin:0">No open reports.</p></div>'}</div>`;
  document.querySelectorAll('[data-listing]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('listings').update({ status: b.dataset.status }).eq('id', b.dataset.listing);
    if (error) return fail(error, 'Updating the listing');
    toast(b.dataset.status === 'live' ? 'Listing restored.' : 'Listing suspended.'); reportsQueue(u);
  }));
  document.querySelectorAll('[data-hide]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('reviews').update({ hidden: true }).eq('id', b.dataset.hide);
    if (error) return fail(error, 'Hiding'); toast('Review hidden.');
  }));
  document.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('reports').update({ status: b.dataset.s, resolved_by: u.id }).eq('id', b.dataset.resolve);
    if (error) return fail(error, 'Updating the report');
    document.querySelector(`[data-row="${b.dataset.resolve}"]`)?.remove();
  }));
}

async function allListings(u, params) {
  const status = params.get('s') || 'all', q = params.get('q') || '';
  shell(u, 'all', 'All listings', '<div class="skeleton"></div>');
  let query = db.from('listings').select('id,slug,business_name,status,verified,founding,towns(name)').order('created_at', { ascending: false }).limit(100);
  if (status !== 'all') query = query.eq('status', status);
  if (q) query = query.ilike('business_name', `%${q}%`);
  const { data, error } = await query;
  if (error) return fail(error, 'Loading listings');
  document.getElementById('dash').innerHTML = `
    <form class="filters" id="al-f" style="margin-bottom:12px"><input type="search" id="al-q" placeholder="Search by name" value="${esc(q)}">
      <select id="al-s">${['all', 'live', 'pending', 'draft', 'rejected', 'suspended'].map((s) => `<option ${s === status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <button class="btn btn-small" type="submit">Search</button></form>
    <div class="row-list">${data.map((l) => `<div class="row"><div class="row-top"><div><b>${esc(l.business_name)}</b><br><span class="muted">${esc(l.towns?.name)}</span></div>
      <div class="badges">${statusBadge(l.status)}${l.verified ? '<span class="badge badge-verified">✓ Verified</span>' : ''}${l.founding ? '<span class="badge badge-founding">Founding</span>' : ''}</div></div>
      <div class="row-actions"><a class="btn btn-ghost" href="#/l/${esc(l.slug)}">View</a><a class="btn btn-ghost" href="#/me/edit/${l.id}">Edit</a>
        ${l.status === 'live' ? `<button class="btn btn-ghost" data-st="suspended" data-id="${l.id}">Suspend</button>` : ''}
        ${l.status === 'suspended' ? `<button class="btn btn-ghost" data-st="live" data-id="${l.id}">Restore</button>` : ''}
        ${!l.verified ? `<button class="btn btn-ghost" data-ver="${l.id}">Mark verified</button>` : ''}</div></div>`).join('') || '<div class="empty"><p class="muted" style="margin:0">No listings found.</p></div>'}</div>`;
  document.getElementById('al-f').addEventListener('submit', (e) => { e.preventDefault(); go(`/me/all?s=${document.getElementById('al-s').value}&q=${encodeURIComponent(document.getElementById('al-q').value.trim())}`); });
  document.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('listings').update({ status: b.dataset.st }).eq('id', b.dataset.id);
    if (error) return fail(error, 'Updating'); allListings(u, params);
  }));
  document.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.rpc('agent_verify', { p_listing: b.dataset.ver });
    if (error) return fail(error, 'Verifying'); allListings(u, params);
  }));
}

/* ---------- admin ---------- */
async function people(u, params) {
  const q = params.get('q') || '';
  shell(u, 'people', 'People', '<div class="skeleton"></div>');
  const [{ data: overview }, peopleRes] = await Promise.all([
    db.rpc('admin_overview'),
    (q ? db.from('profiles').select('id,full_name,email,phone,role').or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
       : db.from('profiles').select('id,full_name,email,phone,role').neq('role', 'host')).order('created_at', { ascending: false }).limit(50)
  ]);
  const list = peopleRes.data || [];
  const { data: at } = await db.from('agent_towns').select('agent_id,town_id').in('agent_id', list.filter((p) => p.role === 'agent').map((p) => p.id).concat(['00000000-0000-0000-0000-000000000000']));
  const townsOf = (id) => (at || []).filter((a) => a.agent_id === id).map((a) => a.town_id);
  const o = overview || {};
  document.getElementById('dash').innerHTML = `
    <div class="stat-grid" style="margin-bottom:18px">
      <div class="stat"><b>${o.live ?? 0}</b>Live listings</div><div class="stat"><b>${o.pending ?? 0}</b>Waiting for review</div>
      <div class="stat"><b>${o.verified ?? 0}</b>Verified</div><div class="stat"><b>${o.reports ?? 0}</b>Open reports</div>
      <div class="stat"><b>${o.taps30 ?? 0}</b>WhatsApp + call taps (30 days)</div><div class="stat"><b>${o.enquiries ?? 0}</b>Loan enquiries</div>
    </div>
    ${(o.misses || []).length ? `<div class="panel" style="margin-bottom:18px"><h3>Searches with no results (30 days)</h3><p class="hint" style="margin-top:0">Recruit these suppliers next.</p>
      <table class="table"><tbody>${o.misses.map((m) => `<tr><td>${esc(m.town || '—')}</td><td>${esc(m.category || 'Any')}</td><td>${m.n}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <h2>Team and members</h2>
    <p class="muted">Ask a helper to create a free account first, then find them here by email and give them a role.</p>
    <form class="filters" id="pp-f" style="margin-bottom:12px"><input type="search" id="pp-q" placeholder="Search by email or name" value="${esc(q)}"><button class="btn btn-small" type="submit">Find</button></form>
    <div class="row-list">${list.map((p) => `<div class="row" data-person="${p.id}">
      <div class="row-top"><div><b>${esc(p.full_name || '—')}</b><br><span class="muted">${esc(p.email || '')} · ${esc(localPhone(p.phone))}</span></div>
        <div class="filters"><select data-role>${Object.entries(ROLE_LABEL).map(([k, t]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <button class="btn btn-small" data-save-role>Save role</button></div></div>
      ${p.role === 'agent' ? `<details><summary>Assigned towns (${townsOf(p.id).length})</summary><div class="checks" style="margin-top:8px">${REF.towns.map((t) => `<label class="check"><input type="checkbox" value="${t.id}" ${townsOf(p.id).includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('')}</div>
        <button class="btn btn-small" data-save-towns style="margin-top:8px">Save towns</button></details>` : ''}
    </div>`).join('') || '<p class="muted">No one found.</p>'}</div>`;
  document.getElementById('pp-f').addEventListener('submit', (e) => { e.preventDefault(); go(`/me/people?q=${encodeURIComponent(document.getElementById('pp-q').value.trim())}`); });
  document.querySelectorAll('[data-person]').forEach((row) => {
    const id = row.dataset.person;
    row.querySelector('[data-save-role]').addEventListener('click', async () => {
      if (id === u.id && row.querySelector('[data-role]').value !== 'admin') return toast("You can't remove your own admin role here.", true);
      const { error } = await db.from('profiles').update({ role: row.querySelector('[data-role]').value }).eq('id', id);
      if (error) return fail(error, 'Saving the role');
      toast('Role saved.'); people(u, params);
    });
    row.querySelector('[data-save-towns]')?.addEventListener('click', async () => {
      const ids = [...row.querySelectorAll('.checks input:checked')].map((c) => Number(c.value));
      await db.from('agent_towns').delete().eq('agent_id', id);
      if (ids.length) {
        const { error } = await db.from('agent_towns').insert(ids.map((t) => ({ agent_id: id, town_id: t })));
        if (error) return fail(error, 'Saving towns');
      }
      toast('Towns saved.');
    });
  });
}

async function townsAdmin(u) {
  shell(u, 'towns', 'Towns', '<div class="skeleton"></div>');
  const [{ data: towns }, { data: districts }] = await Promise.all([
    db.from('towns').select('id,name,slug,lat,lng,active,districts(name)').order('name'),
    db.from('districts').select('id,name').order('name')
  ]);
  document.getElementById('dash').innerHTML = `
    <form class="form panel" id="tw-f" style="max-width:560px;margin-bottom:18px"><h3 style="margin:0">Add a town</h3>
      <div class="form-grid two">
        <div class="field"><label for="tw-d">Municipality</label><select id="tw-d">${districts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="tw-n">Town name</label><input type="text" id="tw-n" required></div>
        <div class="field"><label for="tw-lat">Latitude (optional)</label><input type="number" step="any" id="tw-lat" placeholder="6.70"></div>
        <div class="field"><label for="tw-lng">Longitude (optional)</label><input type="number" step="any" id="tw-lng" placeholder="-1.47"></div>
      </div><span class="hint">Latitude and longitude let the site show "km away". You can copy them from Google Maps (press and hold on the town).</span>
      <button class="btn" type="submit">Add town</button></form>
    <table class="table"><thead><tr><th>Town</th><th>Municipality</th><th>Location</th><th></th></tr></thead><tbody>
      ${towns.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.districts?.name)}</td><td>${t.lat != null ? `${t.lat}, ${t.lng}` : '<span class="muted">—</span>'}</td>
      <td><button class="linkish" data-loc="${t.id}">Set location</button> · <button class="linkish" data-act="${t.id}" data-v="${!t.active}">${t.active ? 'Hide' : 'Show'}</button></td></tr>`).join('')}</tbody></table>`;
  document.getElementById('tw-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tw-n').value.trim();
    const lat = document.getElementById('tw-lat').value, lng = document.getElementById('tw-lng').value;
    const { error } = await db.from('towns').insert({ district_id: Number(document.getElementById('tw-d').value), name, slug: slugify(name),
      lat: lat === '' ? null : Number(lat), lng: lng === '' ? null : Number(lng) });
    if (error) return fail(error, 'Adding the town');
    resetRef(); toast(`${name} added.`); townsAdmin(u);
  });
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('towns').update({ active: b.dataset.v === 'true' }).eq('id', b.dataset.act);
    if (error) return fail(error, 'Updating'); resetRef(); townsAdmin(u);
  }));
  document.querySelectorAll('[data-loc]').forEach((b) => b.addEventListener('click', () => {
    const td = b.closest('tr').children[2];
    td.innerHTML = `<form class="filters"><input type="text" placeholder="6.70, -1.47" style="max-width:160px"><button class="btn btn-small">Save</button></form>`;
    td.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const [lat, lng] = td.querySelector('input').value.split(',').map((x) => Number(x.trim()));
      if (!isFinite(lat) || !isFinite(lng)) return toast('Type it like: 6.70, -1.47', true);
      const { error } = await db.from('towns').update({ lat, lng }).eq('id', b.dataset.loc);
      if (error) return fail(error, 'Saving'); resetRef(); townsAdmin(u);
    });
  }));
}

async function featuredAdmin(u) {
  shell(u, 'featured', 'Featured listings', '<div class="skeleton"></div>');
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: slots }, { data: prices }] = await Promise.all([
    db.from('featured_slots').select('id,months,amount,is_free,starts_on,ends_on,payment_ref,category_id,town_id,listings(business_name,slug)').gte('ends_on', today).order('ends_on'),
    db.from('featured_prices').select('tier,months,amount')
  ]);
  document.getElementById('dash').innerHTML = `
    <form class="form panel" id="fe-f" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Record a featured payment</h3>
      <div class="field"><label for="fe-q">Listing</label><input type="search" id="fe-q" placeholder="Type the business name"><select id="fe-l" required><option value="">Search above…</option></select></div>
      <div class="form-grid two">
        <div class="field"><label for="fe-c">Category</label><select id="fe-c">${REF.top.map((c) => `<option value="${c.id}" data-tier="${c.tier}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="fe-t">Town</label><select id="fe-t">${townOptions(null, 'id')}</select></div>
        <div class="field"><label for="fe-m">Plan</label><select id="fe-m">${[1, 3, 6, 12].map((m) => `<option value="${m}">${m} month${m > 1 ? 's' : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="fe-a">Amount paid (GH₵)</label><input type="number" id="fe-a" min="0" required></div>
      </div>
      <div class="field"><label for="fe-r">MoMo / receipt reference</label><input type="text" id="fe-r" required></div>
      <button class="btn" type="submit">Make featured</button><div id="fe-msg"></div></form>
    <h2>Active featured spots</h2>
    <table class="table"><thead><tr><th>Listing</th><th>Where</th><th>Until</th><th>Paid</th><th></th></tr></thead><tbody>
      ${(slots || []).map((s) => `<tr><td><a href="#/l/${esc(s.listings?.slug)}">${esc(s.listings?.business_name)}</a></td><td>${esc(REF.catById[s.category_id]?.name)}, ${esc(REF.townById[s.town_id]?.name)}</td>
        <td>${new Date(s.ends_on).toLocaleDateString('en-GB')}</td><td>${s.is_free ? 'Free (founding)' : cedi(s.amount)}${s.payment_ref ? `<br><span class="muted">${esc(s.payment_ref)}</span>` : ''}</td>
        <td><button class="linkish" data-end="${s.id}">End now</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}</tbody></table>`;
  const priceFor = () => {
    const tier = document.getElementById('fe-c').selectedOptions[0].dataset.tier;
    const p = (prices || []).find((x) => x.tier === tier && x.months === Number(document.getElementById('fe-m').value));
    if (p) document.getElementById('fe-a').value = p.amount;
  };
  ['fe-c', 'fe-m'].forEach((id) => document.getElementById(id).addEventListener('change', priceFor)); priceFor();
  let found = [];
  document.getElementById('fe-q').addEventListener('input', async (e) => {
    const q = e.target.value.trim(); if (q.length < 2) return;
    const { data } = await db.from('listings').select('id,business_name,base_town_id,listing_categories(category_id)').eq('status', 'live').ilike('business_name', `%${q}%`).limit(10);
    found = data || [];
    document.getElementById('fe-l').innerHTML = found.map((l) => `<option value="${l.id}">${esc(l.business_name)} — ${esc(REF.townById[l.base_town_id]?.name)}</option>`).join('') || '<option value="">No live listing found</option>';
    document.getElementById('fe-l').dispatchEvent(new Event('change'));
  });
  document.getElementById('fe-l').addEventListener('change', (e) => {
    const l = found.find((x) => x.id === e.target.value); if (!l) return;
    document.getElementById('fe-t').value = l.base_town_id;
    const c = REF.catById[l.listing_categories?.[0]?.category_id];
    if (c) document.getElementById('fe-c').value = c.parent_id || c.id;
    priceFor();
  });
  document.getElementById('fe-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cat = Number(document.getElementById('fe-c').value), town = Number(document.getElementById('fe-t').value), months = Number(document.getElementById('fe-m').value);
    const active = (slots || []).filter((s) => s.category_id === cat && s.town_id === town).length;
    if (active >= 3) return (document.getElementById('fe-msg').innerHTML = '<div class="notice error">This category already has 3 featured spots in this town. Put the supplier on the waiting list.</div>');
    const end = new Date(); end.setMonth(end.getMonth() + months);
    const { error } = await db.from('featured_slots').insert({ listing_id: document.getElementById('fe-l').value, category_id: cat, town_id: town, months,
      amount: Number(document.getElementById('fe-a').value), payment_ref: document.getElementById('fe-r').value.trim(), starts_on: today, ends_on: end.toISOString().slice(0, 10), created_by: u.id });
    if (error) return fail(error, 'Saving');
    toast('Listing is now featured.'); featuredAdmin(u);
  });
  document.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const { error } = await db.from('featured_slots').update({ ends_on: y }).eq('id', b.dataset.end);
    if (error) return fail(error, 'Ending'); featuredAdmin(u);
  }));
}

async function partnersAdmin(u) {
  shell(u, 'partners', 'Loan partners', '<div class="skeleton"></div>');
  const { data } = await db.from('loan_partners').select('id,name,phone,email,towns,products,active,owner_id').order('name');
  document.getElementById('dash').innerHTML = `
    <form class="form panel" id="lp-f" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Add a loan partner</h3>
      <div class="form-grid two">
        <div class="field"><label>Institution name</label><input type="text" id="lp-n" required></div>
        <div class="field"><label>Branch towns</label><input type="text" id="lp-t" placeholder="e.g. Ejisu, Juaben"></div>
        <div class="field"><label>Phone</label><input type="tel" id="lp-p"></div>
        <div class="field"><label>Email</label><input type="text" id="lp-e"></div>
        <div class="field"><label>Loan product name</label><input type="text" id="lp-pn" placeholder="Event loan"></div>
        <div class="field"><label>Up to how many months</label><input type="number" id="lp-pm"></div>
        <div class="field"><label>Minimum (GH₵)</label><input type="number" id="lp-min"></div>
        <div class="field"><label>Maximum (GH₵)</label><input type="number" id="lp-max"></div>
      </div>
      <div class="field"><label>Requirements</label><input type="text" id="lp-req" placeholder="e.g. Member for 3 months, Ghana Card"></div>
      <div class="field"><label>Partner's account email (optional)</label><input type="text" id="lp-owner" placeholder="Their NHYIAMU account, so they can see enquiries"></div>
      <button class="btn" type="submit">Add partner</button></form>
    <div class="row-list">${(data || []).map((p) => `<div class="row"><div class="row-top"><b>${esc(p.name)}</b><span class="status ${p.active ? 'status-live' : ''}">${p.active ? 'shown' : 'hidden'}</span></div>
      <span class="muted">${esc(p.towns || '')} ${p.phone ? '· ' + esc(p.phone) : ''}</span>
      <div class="row-actions"><button class="btn btn-ghost" data-tog="${p.id}" data-v="${!p.active}">${p.active ? 'Hide' : 'Show'}</button></div></div>`).join('') || '<p class="muted">No partners yet.</p>'}</div>`;
  document.getElementById('lp-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (id) => document.getElementById(id).value.trim();
    let owner_id = null;
    if (g('lp-owner')) {
      const { data: p } = await db.from('profiles').select('id').ilike('email', g('lp-owner')).maybeSingle();
      if (!p) return toast('No account found with that email. Ask them to create one first.', true);
      owner_id = p.id;
      await db.from('profiles').update({ role: 'partner' }).eq('id', p.id);
    }
    const product = g('lp-pn') ? [{ name: g('lp-pn'), min: Number(g('lp-min')) || null, max: Number(g('lp-max')) || null, months: Number(g('lp-pm')) || null, requirements: g('lp-req') || null }] : [];
    const { error } = await db.from('loan_partners').insert({ name: g('lp-n'), towns: g('lp-t') || null, phone: g('lp-p') || null, email: g('lp-e') || null, products: product, owner_id });
    if (error) return fail(error, 'Adding the partner');
    toast('Partner added.'); partnersAdmin(u);
  });
  document.querySelectorAll('[data-tog]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('loan_partners').update({ active: b.dataset.v === 'true' }).eq('id', b.dataset.tog);
    if (error) return fail(error, 'Updating'); partnersAdmin(u);
  }));
}

async function enquiries(u) {
  shell(u, 'enquiries', 'Loan enquiries', '<div class="skeleton"></div>');
  const { data, error } = await db.from('loan_enquiries').select('id,name,phone,event_type,event_date,amount,status,created_at,town_id,loan_partners(name)').order('created_at', { ascending: false });
  if (error) return fail(error, 'Loading enquiries');
  document.getElementById('dash').innerHTML = `<div class="row-list">${data.map((q) => `<div class="row">
    <div class="row-top"><div><b>${esc(q.name)}</b> · <a href="tel:${esc(q.phone)}">${esc(q.phone)}</a><br>
      <span class="muted">${esc(q.loan_partners?.name)} · ${esc(REF.townById[q.town_id]?.name || '')} · ${esc(q.event_type || '')}${q.event_date ? ' on ' + new Date(q.event_date).toLocaleDateString('en-GB') : ''}</span></div>
      <div><b>${q.amount ? cedi(q.amount) : ''}</b></div></div>
    <div class="filters"><select data-enq="${q.id}">${['new', 'contacted', 'closed'].map((s) => `<option ${q.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <span class="muted" style="font-size:.85rem">Received ${new Date(q.created_at).toLocaleDateString('en-GB')}</span></div></div>`).join('') || '<div class="empty"><p class="muted" style="margin:0">No enquiries yet.</p></div>'}</div>`;
  document.querySelectorAll('[data-enq]').forEach((s) => s.addEventListener('change', async () => {
    const { error } = await db.from('loan_enquiries').update({ status: s.value }).eq('id', s.dataset.enq);
    if (error) return fail(error, 'Updating'); toast('Updated.');
  }));
}
