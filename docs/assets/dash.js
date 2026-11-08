// Account pages: sign-in, supplier dashboard, listing editor, field agent, moderator and admin screens.
import { CFG, db, app, esc, session, go, cedi, photoUrl, placeholder, hash, ref, townOptions, catPhoto,
  me, clearMe, toast, toGhanaPhone, localPhone, slugify, resetRef, regionOf, thumbImg, thumbPath } from './core.js?v=43';

let REF;
const BASE = location.origin + location.pathname;
const STAFF = ['moderator', 'admin'];
const ROLE_LABEL = { host: 'Member', supplier: 'Supplier', agent: 'Field agent', coordinator: 'Regional coordinator', moderator: 'Moderator', partner: 'Loan partner', admin: 'Admin' };

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
    register: () => need(u, ['agent', 'coordinator', ...STAFF]) && editor(u, null, true),
    agent: () => need(u, ['agent', 'coordinator', ...STAFF]) && agentHome(u),
    region: () => need(u, ['coordinator']) && regionHome(u, params),
    review: () => need(u, [...STAFF, 'coordinator']) && reviewQueue(u),
    reports: () => need(u, [...STAFF, 'coordinator']) && reportsQueue(u),
    all: () => need(u, STAFF) && allListings(u, params),
    people: () => need(u, ['admin']) && people(u, params),
    towns: () => need(u, ['admin', 'coordinator']) && townsAdmin(u),
    featured: () => need(u, ['admin']) && featuredAdmin(u),
    donations: () => need(u, ['admin']) && donationsAdmin(u),
    tally: () => need(u, ['agent', 'admin', 'coordinator', 'moderator']) && tally(u, params),
    partners: () => need(u, ['admin']) && partnersAdmin(u),
    enquiries: () => need(u, ['partner', 'admin']) && enquiries(u),
    profile: () => profile(u),
    flyer: () => flyerForm(u, parts[2]),
    join: () => joinForm(u),
    pay: () => need(u, ['admin', 'agent', 'coordinator']) && payPage(u, params),
    promote: () => promotePage(u, parts[2]),
    apps: () => need(u, ['admin', 'coordinator']) && applications(u, params)
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
  const prevScroll = document.querySelector('.tabs')?.scrollLeft || 0;
  const t = (id, label, roles) => (!roles || roles.includes(u.role)) ? `<a href="#/me/${id}" class="${active === id ? 'on' : ''}">${label}</a>` : '';
  app.innerHTML = `<div class="wrap">
    <div class="dash-head">
      <div><h1 style="margin:0">${esc(title)}</h1><span class="muted">${esc(u.full_name || u.email)} · ${ROLE_LABEL[u.role] || u.role}</span></div>
      <button class="btn btn-ghost btn-small" id="signout">Sign out</button>
    </div>
    <nav class="tabs" aria-label="Account sections">
      ${t('home', 'My listings')}
      ${t('flyer', 'Post a flyer')}
      ${t('region', 'My region', ['coordinator'])}
      ${t('agent', u.role === 'coordinator' ? 'Waiting for a visit' : 'My towns', ['agent', 'coordinator', 'admin'])}
      ${t('register', 'Register a supplier', ['agent', 'moderator', 'admin'])}
      ${t('review', 'Pending review', [...STAFF, 'coordinator'])}
      ${t('reports', 'Reports', [...STAFF, 'coordinator'])}
      ${t('all', 'All listings', STAFF)}
      ${t('people', 'People', ['admin'])}
      ${t('pay', u.role === 'admin' ? 'Payouts' : 'My pay', ['admin', 'agent', 'coordinator'])}
      ${t('apps', 'Applications', ['admin', 'coordinator'])}
      ${t('towns', 'Towns', ['admin', 'coordinator'])}
      ${t('featured', 'Featured', ['admin'])}
      ${t('donations', 'Donations', ['admin'])}
      ${t('tally', u.role === 'agent' ? 'My tally' : u.role === 'moderator' ? 'My pay' : 'Agent tally', ['agent', 'admin', 'coordinator', 'moderator'])}
      ${t('partners', 'Loan partners', ['admin'])}
      ${t('enquiries', 'Loan enquiries', ['partner', 'admin'])}
      ${t('profile', 'My details')}
    </nav>
    <div id="dash">${body}</div>
  </div>`;
  // Keep the tab bar where it was, and make sure the selected tab is visible
  const bar = document.querySelector('.tabs');
  if (bar) {
    bar.scrollLeft = prevScroll;
    const on = bar.querySelector('a.on');
    if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) {
      bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
    }
  }
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
  recheckMyPayments(u).catch(() => {});
  const { data: listings, error } = await db.from('listings')
    .select('id,slug,business_name,status,reject_reason,verified,founding,last_confirmed_at,updated_at,pending_contact,towns(name),listing_photos(path,sort)')
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
    ? `<div class="cta-band"><div><h3>List your business free</h3><span class="muted">Add your photos, prices and WhatsApp number. Our team checks it, then people near you can find you.</span></div><a class="btn" href="#/me/new">Create my listing</a></div>` : '';
  let donor = null;
  try { const { data: ds } = await db.rpc('my_donor_status'); donor = ds?.[0] || null; } catch {}
  const fmt = (x) => new Date(x + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const donorPanel = !donor ? '' : donor.supporter_until
    ? `<div class="panel donor-panel" style="margin-bottom:16px"><b>♥ Thank you — you are a NHYIAMU Supporter</b> until ${fmt(donor.supporter_until)}.
        <span class="muted">Your business shows with a Supporter badge, just after the paid places, and is recommended on town pages.</span>
        ${donor.free_flyers_until ? `<br><b>Free event flyers</b> until ${fmt(donor.free_flyers_until)}.` : `<br><span class="muted">Give GH₵ ${Math.max(0, Number(donor.flyer_min) - Number(donor.total_12m))} more within the year to also post event flyers free.</span>`}</div>`
    : listings.length ? `<div class="panel donor-panel" style="margin-bottom:16px"><b>♥ Become a NHYIAMU Supporter</b><br><span class="muted">Donate GH₵ ${Number(donor.supporter_min)} or more to the projects of MEYE CATHOLIC ASOREBA and your business is recommended to visitors for a year. GH₵ ${Number(donor.flyer_min)} or more also gives you free event flyers.${Number(donor.total_12m) > 0 ? ` You have given GH₵ ${Number(donor.total_12m)} this year — thank you!` : ''}</span> <a href="#/donate">How to donate</a></div>` : '';
  const { data: myApp } = await db.from('team_applications').select('role_wanted,status').eq('user_id', u.id).maybeSingle();
  const APP_MSG = { new: 'received. The regional coordinator will call you soon.', checking: 'being checked. The coordinator is speaking with your pastor or guarantor.', accepted: 'accepted. Welcome to the team!', declined: 'not successful this time. Thank you for applying.' };
  const appPanel = myApp ? `<div class="panel" style="margin-bottom:16px"><b>Your application to join the team</b> (${esc(ROLE_WANT_ALL[myApp.role_wanted])}) has been ${APP_MSG[myApp.status]} ${['new', 'checking'].includes(myApp.status) ? '<a href="#/me/join">View or edit</a>' : ''}</div>` : '';
  document.getElementById('dash').innerHTML = `${intro}${appPanel}${donorPanel}
    ${listings.length ? `<div class="section-head"><h2>My listings</h2><a class="btn btn-small" href="#/me/new">+ Add a listing</a></div>
    <div class="row-list">${listings.map((l) => {
      const ph = (l.listing_photos || []).sort((a, b) => a.sort - b.sort)[0];
      return `<div class="row">
        <div class="row-top"><div style="display:flex;gap:10px;align-items:center">
          <div style="width:52px;height:52px;border-radius:10px;overflow:hidden;flex:none">${ph ? thumbImg(ph.path).replace('<img ', '<img style="width:100%;height:100%;object-fit:cover" ') : placeholder(l.business_name, hash(l.slug))}</div>
          <div><b>${esc(l.business_name)}</b><br><span class="muted" style="font-size:.88rem">${esc(l.towns?.name || '')}</span></div></div>
          <div class="badges">${statusBadge(l.status)}${l.verified ? '<span class="badge badge-verified">✓ Verified</span>' : ''}${l.founding ? '<span class="badge badge-founding">Founding</span>' : ''}</div></div>
        ${l.status === 'rejected' && l.reject_reason ? `<div class="notice error">Not approved: ${esc(l.reject_reason)}. Please fix and submit again.</div>` : ''}
        ${l.status === 'draft' ? '<div class="notice">Draft — not visible yet. Submit it when you are ready.</div>' : ''}
        ${l.pending_contact ? `<div class="notice" style="background:var(--gold-soft)">New number ${esc(localPhone(l.pending_contact.phone))} is waiting for our team to check it.</div>` : ''}
        ${l.status === 'pending' ? '<div class="notice" style="background:var(--gold-soft)">Waiting for our team to check it (usually within 48 hours).</div>' : ''}
        ${l.status === 'live' ? `<span class="muted" style="font-size:.88rem">Last 30 days: ${count(l.id, 'view')} views · ${count(l.id, 'whatsapp')} WhatsApp taps · ${count(l.id, 'call')} call taps</span>` : ''}
        ${l.status === 'live' && stale(l) ? '<div class="notice" style="background:var(--gold-soft)">Are your details still correct? Please confirm so visitors know your listing is up to date.</div>' : ''}
        <div class="row-actions">
          <a class="btn btn-ghost" href="#/me/edit/${l.id}">Edit</a>
          <a class="btn btn-ghost" href="#/l/${esc(l.slug)}">View</a>
          ${['draft', 'rejected'].includes(l.status) ? `<button class="btn" data-submit="${l.id}">Submit for review</button>` : ''}
          ${l.status === 'live' && stale(l) ? `<button class="btn btn-gold" data-confirm="${l.id}">Details are correct</button>` : ''}
          ${l.status === 'live' && CFG.paystackKey ? `<a class="btn btn-ghost" href="#/me/promote/${l.id}">★ Get a Top spot or Featured place</a>` : ''}
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
    toast('Submitted. Our team will check it soon.'); home(u);
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
  market: [['market_name', 'Market name', 'text', 'e.g. Ejisu market, Kejetia'], ['stall_location', 'Where your stall is', 'text', 'e.g. Tomato section, near the main gate'], ['sells', 'What you sell', 'textarea', 'e.g. Fresh tomatoes, pepper, onions, garden eggs'], ['market_days', 'Days you are at the market', 'text', 'e.g. Every day except Sunday'], ['delivery', 'Can deliver to customers', 'bool'], ['bulk_orders', 'Takes big orders for events', 'bool']],
  clothing: [['styles', 'Styles you make or sell', 'text', 'e.g. Kente, kaba and slit, suits'], ['group_orders', 'Group / uniform orders', 'bool'], ['turnaround_days', 'Usual turnaround (days)', 'number']],
  accommodation: [['rooms', 'Number of rooms', 'number'], ['conference_hall', 'Conference hall', 'bool']],
  transport: [['vehicle_types', 'Vehicle types', 'text', 'e.g. Sprinter, Coaster, motorbike, aboboyaa'], ['seats', 'Seats per vehicle (for passengers)', 'text'], ['delivery_areas', 'Areas you deliver to', 'text', 'e.g. Ejisu, Besease, Kumasi'], ['delivery_fee', 'Delivery fee from (GH₵)', 'text', 'e.g. 15 within Ejisu'], ['same_day', 'Same-day delivery', 'bool']],
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
  const agentMode = isNew ? (asAgent && ['agent', 'coordinator'].includes(u.role)) : !!l.registered_by && l.registered_by === u.id;
  const title = isNew ? (asAgent ? 'Register a supplier' : 'New listing') : `Edit: ${l.business_name}`;
  const v = (k, d = '') => esc(l?.[k] ?? d);
  const topOf = (cid) => { const c = REF.catById[cid]; return c ? (c.parent_id ? REF.catById[c.parent_id].slug : c.slug) : null; };

  shell(u, asAgent ? 'register' : 'home', title, `
  ${agentMode && isNew ? '<div class="notice" style="margin-bottom:12px">Fill this in <b>with the supplier present</b>, using their details. The listing will be credited to you.</div>' : ''}
  ${l?.status === 'rejected' && l.reject_reason ? `<div class="notice error" style="margin-bottom:12px">Not approved: ${esc(l.reject_reason)}</div>` : ''}
  ${l?.pending_contact ? `<div class="notice" style="margin-bottom:12px;background:var(--gold-soft)">Your new number (${esc(localPhone(l.pending_contact.phone))}${l.pending_contact.whatsapp !== l.pending_contact.phone ? `, WhatsApp ${esc(localPhone(l.pending_contact.whatsapp))}` : ''}) is waiting for our team to check it. Until then visitors still see ${esc(localPhone(l.phone))}.</div>` : ''}
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
        <div class="field"><label for="e-phone">Phone for calls</label><input type="tel" id="e-phone" required placeholder="024 123 4567" value="${esc(localPhone(l?.pending_contact?.phone || l?.phone || (isNew && !asAgent ? u.phone : '')))}"></div>
        <div class="field"><label for="e-wa">WhatsApp number</label><input type="tel" id="e-wa" required placeholder="024 123 4567" value="${esc(localPhone(l?.pending_contact?.whatsapp || l?.whatsapp || (isNew && !asAgent ? u.phone : '')))}"></div>
      </div>
    </fieldset>
    <fieldset><legend>Where</legend>
      <div class="form-grid two">
        <div class="field"><label for="e-town">Town you are based in</label><select id="e-town" required>${townOptions(l?.base_town_id ?? REF.townBySlug['ejisu-besease']?.id, 'id')}</select><span class="hint">Your town isn't listed? Choose the nearest and tell your agent or moderator.</span></div>
        <div class="field"><label for="e-cov">Where you serve</label><select id="e-cov">
          ${[['town', 'My town only'], ['district', 'My whole municipality'], ['region', 'Anywhere in my region'], ['nationwide', 'Anywhere in Ghana']].map(([k, t]) => `<option value="${k}" ${l?.coverage === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
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
      const numberChanged = !isNew && ['live', 'suspended'].includes(l.status) && (phone !== l.phone || whatsapp !== l.whatsapp) && (phone !== l.pending_contact?.phone || whatsapp !== l.pending_contact?.whatsapp);
      toast(action === 'submit' ? 'Saved and submitted for review.' : numberChanged ? 'Saved. Your new number will show once our team checks it.' : 'Saved.');
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
        const path = await uploadWithThumb(`${u.id}/${l.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`, f, 1080, 420);
        const { error } = await db.from('listing_photos').insert({ listing_id: l.id, path, sort: photos.length + done });
        if (error) throw error;
        done++;
      } catch (err) { out.innerHTML = `<div class="notice error">A photo could not be uploaded: ${esc(err.message)}</div>`; return; }
    }
    toast(`${done} photo${done > 1 ? 's' : ''} added.`);
    editor(u, l.id, asAgent);
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await removePhoto(b.dataset.path);
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
// Saves the photo (max px on the long side) plus a small copy for lists, in Cloudflare R2 through the
// NHYIAMU upload service. Returns the path to store ("r2/<user id>/..."). Photos never change once saved.
async function uploadWithThumb(key, file, max, thumbMax) {
  const [big, small] = await Promise.all([shrink(file, max, 0.72), shrink(file, thumbMax, 0.68)]);
  const { data: { session: s } } = await db.auth.getSession();
  if (!s) throw new Error('Please sign in again');
  const send = async (k, blob) => {
    const r = await fetch(`${CFG.uploadApi}/upload?key=${encodeURIComponent(k)}`, { method: 'POST', headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'image/jpeg' }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Upload failed');
    return j.path;
  };
  const path = await send(key, big);
  await send(thumbPath(key), small);
  return path;
}
async function removePhoto(path) {
  if (!path) return;
  if (!path.startsWith('r2/')) return db.storage.from('listing-photos').remove([path, thumbPath(path)]);
  const { data: { session: s } } = await db.auth.getSession();
  await Promise.all([path, thumbPath(path)].map((p) => fetch(`${CFG.uploadApi}/upload?key=${encodeURIComponent(p.slice(3))}`, { method: 'DELETE', headers: { Authorization: `Bearer ${s?.access_token}` } }).catch(() => {})));
}

async function shrink(file, max = 1280, quality = 0.75) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = URL.createObjectURL(file); });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
}


/* ---------- event flyers ---------- */
async function getSettings() {
  const { data } = await db.from('app_settings').select('key,value');
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}
function payNote(st) {
  const price = st.flyer_price ? `GH₵ ${esc(st.flyer_price)}` : 'the weekly fee';
  if (CFG.paystackKey) return `The fee is <b>${price}</b> for the week. After you send the flyer, pay online here with MoMo or card. Our team checks the flyer, then it goes live for 7 days. NHYIAMU staff never collect cash for flyers.`;
  return st.momo_number
    ? `To publish, pay <b>${price}</b> by Mobile Money to <b>${esc(st.momo_number)}</b>${st.momo_name ? ` (${esc(st.momo_name)})` : ''}, using your phone number as the reference. Our team checks the payment and the flyer, then it goes live for 7 days.`
    : `The fee is <b>${price}</b> per week. Our team will contact you on WhatsApp to arrange payment, then your flyer goes live for 7 days.`;
}

async function flyerForm(u, id) {
  const [st, { data: paidPlan }] = await Promise.all([getSettings(), db.rpc('has_paid_plan', { p_user: u.id })]);
  let f = null;
  if (id) {
    const { data } = await db.from('flyers').select('*').eq('id', id).maybeSingle();
    f = data;
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: mine } = await db.from('flyers').select('id,title,status,event_date,starts_on,ends_on,reject_reason,payment_ref,created_at,towns(name)').eq('owner_id', u.id).order('created_at', { ascending: false });
  // Limit: apart from event hosts (event centres / planners), paid-place holders, donors and staff,
  // everyone may post 3 flyers every 2 months (rolling)
  const LIMIT = Number(st.flyer_limit_count || 3), DAYS = Number(st.flyer_limit_days || 60);
  let limitHit = null;
  if (!f && !paidPlan && !['admin', 'moderator'].includes(u.role)) {
    const { data: own } = await db.from('listings').select('listing_categories(category_id)').eq('owner_id', u.id).eq('status', 'live');
    const host = (own || []).some((l) => (l.listing_categories || []).some((lc) => {
      const c = REF.catById[lc.category_id]; const top = c?.parent_id ? REF.catById[c.parent_id] : c;
      return ['venues', 'planners'].includes(top?.slug);
    }));
    const since = Date.now() - DAYS * 864e5;
    const recent = (mine || []).filter((m) => new Date(m.created_at).getTime() >= since).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!host && recent.length >= LIMIT) {
      limitHit = new Date(new Date(recent[recent.length - LIMIT].created_at).getTime() + DAYS * 864e5);
    }
  }
  const needsPay = (m) => CFG.paystackKey && !paidPlan && m.status !== 'approved' && !m.payment_ref;
  shell(u, 'flyer', f ? 'Edit flyer' : 'Post an event flyer', `
    <div class="notice" style="margin-bottom:14px;max-width:760px">Your flyer shows for <b>7 days</b> to people browsing your town and the other towns in the same municipality. ${paidPlan ? '<b>Free for you</b> — you have an active Top spot, Featured or Founding supplier place, or you are a donor of GH₵ ' + esc(st.donor_flyer_min || '100') + '+ this year. Thank you! Our team just checks the flyer, then it goes live for 7 days.' : payNote(st) + ` <a href="#/donate">Donors of GH₵ ${esc(st.donor_flyer_min || '100')} or more</a> post flyers free for a year.`}</div>
    ${f?.status === 'rejected' ? `<div class="notice error" style="margin-bottom:12px;max-width:760px">Not approved: ${esc(f.reject_reason || '')}. Fix it and save to send it again.</div>` : ''}
    ${limitHit ? `<div class="notice" style="margin-bottom:14px;max-width:760px;background:var(--gold-soft)"><b>You have posted ${LIMIT} flyers in the last ${Math.round(DAYS / 30)} months</b>, which is the limit for personal accounts. You can post your next flyer from <b>${limitHit.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b>.<br><span class="muted">Event centres and event planners listed on NHYIAMU, suppliers with a Top spot, Featured or Founding place, and donors of GH₵ ${esc(st.donor_flyer_min || '100')}+ have no limit.</span></div>` : ''}
    <form class="form" id="fl" style="max-width:760px"${limitHit ? ' hidden' : ''}>
      <fieldset><legend>The programme</legend>
        <div class="field"><label for="fl-title">Name of the programme</label><input type="text" id="fl-title" required maxlength="90" value="${esc(f?.title || '')}" placeholder="e.g. Harvest Thanksgiving Service"></div>
        <div class="form-grid two">
          <div class="field"><label for="fl-date">Date</label><input type="date" id="fl-date" required min="${today}" value="${esc(f?.event_date || '')}"></div>
          <div class="field"><label for="fl-time">Time (optional)</label><input type="text" id="fl-time" maxlength="40" value="${esc(f?.event_time || '')}" placeholder="e.g. 9:00 am"></div>
        </div>
        <div class="field"><label for="fl-desc">Short description (optional)</label><textarea id="fl-desc" rows="3" maxlength="400">${esc(f?.description || '')}</textarea></div>
      </fieldset>
      <fieldset><legend>Where it will be held</legend>
        <div class="form-grid two">
          <div class="field"><label for="fl-town">Town</label><select id="fl-town" required>${townOptions(f?.town_id ?? REF.townBySlug['ejisu-besease']?.id, 'id')}</select></div>
          <div class="field"><label for="fl-venue">Venue name</label><input type="text" id="fl-venue" required maxlength="80" value="${esc(f?.venue_name || '')}" placeholder="e.g. Royal Gardens Event Centre"></div>
        </div>
        <div class="field"><label for="fl-land">Directions / landmark</label><input type="text" id="fl-land" required maxlength="160" value="${esc(f?.landmark || '')}" placeholder="e.g. Behind the Methodist school, first left after the filling station"></div>
        <div class="field"><label for="fl-map">Google Maps link (optional)</label><input type="text" id="fl-map" value="${esc(f?.map_link || '')}" placeholder="Open Google Maps, find the venue, tap Share, copy link"><span class="hint">Without a link, the "Get directions" button searches Google Maps for the venue name and town.</span></div>
      </fieldset>
      <fieldset><legend>Flyer and contact</legend>
        <div class="field"><label for="fl-phone">Contact phone (WhatsApp)</label><input type="tel" id="fl-phone" required placeholder="024 123 4567" value="${esc(localPhone(f?.contact_phone || u.phone))}"></div>
        <div class="field"><label for="fl-img">Flyer image</label><input type="file" id="fl-img" accept="image/*" ${f?.image_path ? '' : 'required'}>
          ${f?.image_path ? `<img src="${esc(photoUrl(f.image_path))}" alt="" style="max-width:180px;border-radius:10px;margin-top:8px">` : ''}
          <span class="hint">A photo or design of your flyer. It is made smaller automatically to save data.</span></div>
      </fieldset>
      <button class="btn" type="submit">${f ? 'Save and send for checking' : 'Send flyer for checking'}</button>
      <div id="fl-msg"></div>
    </form>
    ${(mine || []).length ? `<h2 style="margin-top:28px">My flyers</h2><div class="row-list" style="max-width:760px">${mine.map((m) => `<div class="row">
      <div class="row-top"><div><b>${esc(m.title)}</b><br><span class="muted">${esc(m.towns?.name || '')} · event ${new Date(m.event_date + 'T12:00:00').toLocaleDateString('en-GB')}</span></div>${statusBadge(m.status === 'approved' ? 'live' : m.status)}</div>
      ${m.status === 'approved' && m.ends_on ? `<span class="muted">Showing until ${new Date(m.ends_on + 'T12:00:00').toLocaleDateString('en-GB')}</span>` : ''}
      ${m.status === 'rejected' && m.reject_reason ? `<div class="notice error">${esc(m.reject_reason)}</div>` : ''}
      ${needsPay(m) ? '<span class="muted">Not paid yet — pay to send it for checking.</span>' : m.status === 'pending' && m.payment_ref ? '<span class="muted">Paid ✓ — waiting for our team.</span>' : ''}
      <div class="row-actions">${needsPay(m) ? `<button class="btn btn-gold" data-payfly="${m.id}">Pay ${esc(st.flyer_price ? 'GH₵ ' + st.flyer_price : '')} now</button>` : ''}<a class="btn btn-ghost" href="#/f/${m.id}">View</a>${m.status !== 'approved' ? `<a class="btn btn-ghost" href="#/me/flyer/${m.id}">Edit</a>` : ''}</div></div>`).join('')}</div>` : ''}`);
  document.querySelectorAll('[data-payfly]').forEach((b) => b.addEventListener('click', () => payOnline({ p_kind: 'flyer', p_flyer: b.dataset.payfly }, () => flyerForm(u))));

  document.getElementById('fl').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('fl-msg');
    const phone = toGhanaPhone(document.getElementById('fl-phone').value);
    if (!phone) return (msg.innerHTML = '<div class="notice error">Please enter a valid Ghana phone number.</div>');
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      let image_path = f?.image_path || null;
      const file = document.getElementById('fl-img').files[0];
      if (file) {
        msg.innerHTML = '<div class="notice">Uploading the flyer…</div>';
        image_path = await uploadWithThumb(`${u.id}/flyers/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`, file, 1400, 520);
      }
      const row = {
        town_id: Number(document.getElementById('fl-town').value), title: document.getElementById('fl-title').value.trim(),
        event_date: document.getElementById('fl-date').value, event_time: document.getElementById('fl-time').value.trim() || null,
        venue_name: document.getElementById('fl-venue').value.trim(), landmark: document.getElementById('fl-land').value.trim(),
        map_link: document.getElementById('fl-map').value.trim() || null, description: document.getElementById('fl-desc').value.trim() || null,
        contact_phone: phone, image_path
      };
      const { data: saved, error } = f ? await db.from('flyers').update(row).eq('id', f.id).select('id,payment_ref').single() : await db.from('flyers').insert({ ...row, owner_id: u.id }).select('id,payment_ref').single();
      if (error) throw error;
      if (CFG.paystackKey && !paidPlan && !saved.payment_ref) {
        toast('Flyer saved. Now pay to send it for checking.');
        if (location.hash !== '#/me/flyer') go('/me/flyer'); else flyerForm(u);
        return payOnline({ p_kind: 'flyer', p_flyer: saved.id }, () => flyerForm(u));
      }
      toast('Flyer sent. Our team will check it soon.');
      if (location.hash === '#/me/flyer') flyerForm(u); else go('/me/flyer');
    } catch (err) {
      msg.innerHTML = `<div class="notice error">Could not send: ${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
  });
}

async function flyerQueue(container, u) {
  const [{ data }, st] = await Promise.all([
    db.from('flyers').select('id,owner_id,title,event_date,event_time,venue_name,landmark,contact_phone,image_path,created_at,payment_ref,amount,towns(name),profiles!flyers_owner_id_fkey(full_name,email)').eq('status', 'pending').order('created_at'),
    getSettings()
  ]);
  if (!(data || []).length) { container.innerHTML = '<h2 style="margin-top:26px">Flyers waiting</h2><div class="empty"><p class="muted" style="margin:0">No flyers waiting.</p></div>'; return; }
  const free = {};
  await Promise.all([...new Set(data.map((f) => f.owner_id))].map(async (id) => { const { data: p } = await db.rpc('has_paid_plan', { p_user: id }); free[id] = !!p; }));
  const isAdmin = u.role === 'admin';
  container.innerHTML = `<h2 style="margin-top:26px">Flyers waiting</h2><p class="muted">Check the flyer is a real, decent programme. Only flyers that are <b>paid online</b> or <b>free</b> can be approved — never accept cash. Approving starts its 7 days today.</p>
    <div class="row-list">${data.map((f) => `<div class="row" data-frow="${f.id}">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${f.image_path ? `<a href="${esc(photoUrl(f.image_path))}" target="_blank" rel="noopener"><img src="${esc(photoUrl(f.image_path))}" alt="" style="width:110px;border-radius:10px"></a>` : ''}
        <div style="flex:1;min-width:200px"><b>${esc(f.title)}</b><br><span class="muted">${new Date(f.event_date + 'T12:00:00').toLocaleDateString('en-GB')}${f.event_time ? ' · ' + esc(f.event_time) : ''} · ${esc(f.venue_name)}, ${esc(f.towns?.name)}</span><br>
        <span class="muted" style="font-size:.88rem">${esc(f.landmark)}<br>By ${esc(f.profiles?.full_name || f.profiles?.email || '')} · <a href="https://wa.me/${String(f.contact_phone).replace(/[^0-9]/g, '')}" target="_blank" rel="noopener">${esc(localPhone(f.contact_phone))}</a></span></div>
      </div>
      ${f.payment_ref ? `<span class="badge badge-verified" style="width:max-content">✓ Paid online ${cedi(f.amount)} · ${esc(f.payment_ref)}</span>`
        : free[f.owner_id] ? '<span class="badge badge-verified" style="width:max-content">Free — paid place, Founding place or donor</span>'
        : '<span class="badge" style="width:max-content">Not paid yet — waiting for the poster to pay online</span>'}
      ${f.payment_ref || free[f.owner_id] ? `<form class="filters" data-fapprove="${f.id}"><button class="btn btn-small" type="submit">Approve (7 days)</button></form>`
        : isAdmin ? `<form class="filters" data-fapprove="${f.id}" data-manual="1"><input type="number" min="0" step="1" required value="${esc(st.flyer_price || '')}" aria-label="Amount paid" style="max-width:110px"><input type="text" required placeholder="Admin only: how it was paid"><button class="btn btn-small btn-ghost" type="submit">Approve with manual payment</button></form>` : ''}
      <form class="filters" data-freject="${f.id}"><input type="text" required placeholder="Reason, e.g. flyer is not readable"><button class="btn btn-ghost btn-small" type="submit">Send back</button></form>
    </div>`).join('')}</div>`;
  container.querySelectorAll('[data-fapprove]').forEach((fm) => fm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [amt, ref] = fm.querySelectorAll('input');
    const { error } = await db.rpc('approve_flyer', { p_id: fm.dataset.fapprove, p_amount: amt ? Number(amt.value) : 0, p_ref: ref ? ref.value.trim() : '' });
    if (error) return fail(error, 'Approving the flyer');
    toast('Flyer is live for 7 days.'); container.querySelector(`[data-frow="${fm.dataset.fapprove}"]`)?.remove();
  }));
  container.querySelectorAll('[data-freject]').forEach((fm) => fm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.rpc('reject_flyer', { p_id: fm.dataset.freject, p_reason: fm.querySelector('input').value.trim() });
    if (error) return fail(error, 'Sending back');
    toast('Sent back with your reason.'); container.querySelector(`[data-frow="${fm.dataset.freject}"]`)?.remove();
  }));
}


/* ---------- regional coordinator ---------- */
async function myRegionTowns(u) {
  const { data: regs } = await db.from('coordinator_regions').select('region_id,regions(name)').eq('coordinator_id', u.id);
  const ids = (regs || []).map((r) => r.region_id);
  if (!ids.length) return { regions: [], towns: [] };
  const { data: towns } = await db.from('towns').select('id,name,slug,active,lat,lng,district_id,districts!inner(id,name,region_id)').in('districts.region_id', ids).order('name');
  return { regions: regs.map((r) => r.regions?.name), towns: towns || [] };
}

async function regionHome(u, params) {
  const q = params.get('q') || '';
  shell(u, 'region', 'My region', '<div class="skeleton"></div>');
  const { regions, towns } = await myRegionTowns(u);
  if (!regions.length) {
    document.getElementById('dash').innerHTML = '<div class="empty"><h3>No region assigned yet</h3><p class="muted">Ask the admin to assign you a region.</p></div>';
    return;
  }
  const ym = new Date().toISOString().slice(0, 7);
  const [from, to] = monthRange(ym);
  const [{ data: stats }, found] = await Promise.all([
    db.rpc('agent_stats', { p_from: from, p_to: to }),
    q ? db.from('profiles').select('id,full_name,email,phone,role').or(`email.ilike.%${q}%,full_name.ilike.%${q}%`).limit(20) : Promise.resolve({ data: [] })
  ]);
  const agentIds = (stats || []).map((s) => s.agent_id).concat((found.data || []).filter((p) => p.role === 'agent').map((p) => p.id));
  const { data: at } = agentIds.length ? await db.from('agent_towns').select('agent_id,town_id').in('agent_id', [...new Set(agentIds)]) : { data: [] };
  const townsOf = (id) => (at || []).filter((a) => a.agent_id === id).map((a) => a.town_id);
  const townName = (id) => towns.find((t) => t.id === id)?.name || '';
  const byDistrict = {};
  towns.forEach((t) => { (byDistrict[t.districts.name] ||= []).push(t); });
  const townChecks = (agentId) => Object.entries(byDistrict).sort(([a], [b]) => a.localeCompare(b)).map(([d, ts]) => `<details><summary>${esc(d)}</summary><div class="checks" style="margin:6px 0 8px">${ts.map((t) =>
    `<label class="check"><input type="checkbox" value="${t.id}" ${townsOf(agentId).includes(t.id) ? 'checked' : ''}> ${esc(t.name)}${t.active ? '' : ' <span class="muted">(hidden)</span>'}</label>`).join('')}</div></details>`).join('');
  const agentRow = (p, s) => `<div class="row" data-agent="${p.id}">
    <div class="row-top"><div><b>${esc(p.name || '—')}</b><br><span class="muted">${esc(p.email || '')}</span></div>
      ${s ? `<span class="muted" style="font-size:.88rem">This month: ${s.registered} registered · ${s.verified} verified · ${s.live} live in total</span>` : ''}</div>
    <span class="muted" style="font-size:.9rem">Towns: ${townsOf(p.id).map(townName).filter(Boolean).join(', ') || 'none yet'}</span>
    <details><summary>Assign towns</summary>${townChecks(p.id)}<button class="btn btn-small" data-save-towns>Save towns</button></details>
    <div class="row-actions"><button class="btn btn-ghost" data-unagent>Remove as agent</button></div></div>`;
  document.getElementById('dash').innerHTML = `
    <p>You coordinate: <b>${regions.map(esc).join(', ')}</b> · ${towns.filter((t) => t.active).length} towns open, ${towns.filter((t) => !t.active).length} hidden.</p>
    <div class="row-actions" style="margin-bottom:16px"><a class="btn btn-ghost" href="#/me/agent">Waiting for a visit</a><a class="btn btn-ghost" href="#/me/reports">Reports</a><a class="btn btn-ghost" href="#/me/towns">Towns</a><a class="btn btn-ghost" href="#/me/tally">Tally</a></div>
    <h2>Recruit an agent</h2>
    <p class="muted">Ask the person to create a free NHYIAMU account first, then find them here.</p>
    <form class="filters" id="rc-f" style="margin-bottom:12px"><input type="search" id="rc-q" placeholder="Search by email or name" value="${esc(q)}"><button class="btn btn-small" type="submit">Find</button></form>
    ${q ? `<div class="row-list" style="margin-bottom:20px">${(found.data || []).map((p) => p.role === 'agent'
        ? agentRow({ id: p.id, name: p.full_name, email: p.email }, (stats || []).find((s) => s.agent_id === p.id))
        : `<div class="row"><div class="row-top"><div><b>${esc(p.full_name || '—')}</b><br><span class="muted">${esc(p.email || '')} · ${esc(localPhone(p.phone))}</span></div>
           <button class="btn btn-small" data-make="${p.id}">Make agent</button></div></div>`).join('') || '<p class="muted">No one found. They may need to create an account first.</p>'}</div>` : ''}
    <h2>Agents in my region</h2>
    <div class="row-list">${(stats || []).map((s) => agentRow({ id: s.agent_id, name: s.agent_name, email: s.agent_email }, s)).join('') || '<div class="empty"><p class="muted" style="margin:0">No agents yet. Recruit one above, then assign their towns.</p></div>'}</div>`;
  document.getElementById('rc-f').addEventListener('submit', (e) => { e.preventDefault(); go(`/me/region?q=${encodeURIComponent(document.getElementById('rc-q').value.trim())}`); });
  document.querySelectorAll('[data-make]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.rpc('coordinator_set_agent', { p_user: b.dataset.make, p_agent: true });
    if (error) return fail(error, 'Making agent');
    toast('Now an agent. Assign their towns below.'); regionHome(u, params);
  }));
  document.querySelectorAll('[data-agent]').forEach((row) => {
    const id = row.dataset.agent;
    row.querySelector('[data-save-towns]').addEventListener('click', async () => {
      const ids = [...row.querySelectorAll('.checks input:checked')].map((c) => Number(c.value));
      const mineInRegion = townsOf(id).filter((t) => towns.some((x) => x.id === t));
      if (mineInRegion.length) await db.from('agent_towns').delete().eq('agent_id', id).in('town_id', mineInRegion);
      if (ids.length) {
        const { error } = await db.from('agent_towns').insert(ids.map((t) => ({ agent_id: id, town_id: t })));
        if (error) return fail(error, 'Saving towns');
      }
      toast('Towns saved.'); regionHome(u, params);
    });
    row.querySelector('[data-unagent]').addEventListener('click', async () => {
      const { error } = await db.rpc('coordinator_set_agent', { p_user: id, p_agent: false });
      if (error) return fail(error, 'Removing agent');
      toast('No longer an agent.'); regionHome(u, params);
    });
  });
}

/* ---------- field agent ---------- */
async function agentHome(u) {
  shell(u, 'agent', 'My towns', '<div class="skeleton"></div>');
  let townIds;
  if (u.role === 'coordinator') townIds = (await myRegionTowns(u)).towns.map((t) => t.id);
  else { const { data: mine } = await db.from('agent_towns').select('town_id').eq('agent_id', u.id); townIds = (mine || []).map((t) => t.town_id); }
  if (u.role === 'coordinator' && !townIds.length) { document.getElementById('dash').innerHTML = '<div class="empty"><p class="muted" style="margin:0">No region assigned yet.</p></div>'; return; }
  if (!townIds.length && u.role === 'agent') {
    document.getElementById('dash').innerHTML = '<div class="empty"><h3>No towns assigned yet</h3><p class="muted">Ask the admin to assign you to your towns.</p><a class="btn" href="#/me/register">Register a supplier anyway</a></div>';
    return;
  }
  let q = db.from('listings').select('id,slug,business_name,status,verified,base_town_id,registered_by,towns(name)').in('status', ['pending', 'live']).eq('verified', false).order('created_at');
  if (townIds.length) q = q.in('base_town_id', townIds);
  const { data: todo } = await q;
  document.getElementById('dash').innerHTML = `
    <p>${u.role === 'coordinator' ? 'Listings in your region that no one has verified yet.' : townIds.length ? `Your towns: <b>${townIds.map((id) => esc(REF.townById[id]?.name)).join(', ')}</b>` : 'You see all towns.'}</p>
    <div class="row-actions" style="margin-bottom:16px"><a class="btn" href="#/me/register">+ Register a supplier</a><a class="btn btn-ghost" href="#/me/tally">${u.role === 'coordinator' ? 'Tally and pay' : 'My tally'}</a></div>
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
  shell(u, 'tally', u.role === 'agent' ? 'My tally' : u.role === 'moderator' ? 'My pay' : 'Agent tally', '<div class="skeleton"></div>');
  const [from, to] = monthRange(ym);
  const isMod = u.role === 'moderator';
  const { data, error } = isMod ? { data: [] } : await db.rpc('agent_stats', { p_from: from, p_to: to });
  if (error) return fail(error, 'Loading the tally');
  document.getElementById('dash').innerHTML = `
    <div class="field" style="max-width:220px;margin-bottom:12px"><label for="t-m">Month</label><input type="month" id="t-m" value="${ym}" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px;min-height:44px"></div>
    ${isMod ? '' : `<div style="overflow-x:auto"><table class="table"><thead><tr><th>Agent</th><th>Registered this month</th><th>Verified this month</th><th>Live listings (all time)</th></tr></thead>
    <tbody>${(data || []).map((r) => `<tr><td><b>${esc(r.agent_name || '—')}</b>${r.is_coordinator ? ' <span class="badge" style="font-size:.75rem">Coordinator</span>' : ''}<br><span class="muted">${esc(r.agent_email || '')}</span></td><td>${r.registered}</td><td>${r.verified}</td><td>${r.live}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No agents yet.</td></tr>'}</tbody></table></div>
    <p class="hint">Commission is paid on paid places bought by suppliers an agent registered: 50% of the first month's value, then 20% of later payments. The same applies to suppliers a coordinator registers personally.</p>`}
    <div id="mod-earn"></div>
    <div id="coord-earn"></div>`;
  if (['admin', 'moderator'].includes(u.role)) {
    const { data: me } = await db.rpc('moderator_earnings', { p_from: from, p_to: to });
    const rows = me || [];
    const pool = rows[0]?.pool ?? 0, income = rows[0]?.month_income ?? 0;
    document.getElementById('mod-earn').innerHTML = `<h2 style="margin-top:${isMod ? 0 : 26}px">${isMod ? 'My pay as moderator' : 'Moderator pay'}</h2>
      <p class="muted" style="margin-top:-4px">Moderators share 10% of the month's income (Top spot, Featured and flyer payments; donations are not counted), split by work done: listings and flyers approved or rejected, phone number changes checked, and reports closed. This month: income ${cedi(income)}, moderators' share ${cedi(pool)}.</p>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Moderator</th><th>Listings</th><th>Flyers</th><th>Reports</th><th>Total work</th><th>Pay</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.moderator_name || '—')}</b><br><span class="muted">${esc(r.moderator_email || '')}</span></td><td>${r.listings}</td><td>${r.flyers}</td><td>${r.reports}</td><td>${r.work}</td><td><b>${cedi(r.earnings)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No moderators yet.</td></tr>'}
      </tbody></table></div>${isMod ? '<p class="hint">Your pay grows with the work you do and with the site\'s income.</p>' : '<p class="hint">Work you do yourself as admin is not paid and does not reduce the moderators\' shares. Work is counted from 6 November 2026, when this record started.</p>'}`;
  }
  document.getElementById('t-m').addEventListener('change', (e) => go(`/me/tally?m=${e.target.value}`));
  if (['admin', 'coordinator'].includes(u.role)) {
    const { data: ce } = await db.rpc('coordinator_earnings', { p_from: from, p_to: to });
    const rows = ce || [];
    const total = rows.reduce((s, r) => s + Number(r.earnings), 0);
    document.getElementById('coord-earn').innerHTML = `<h2 style="margin-top:26px">${u.role === 'admin' ? 'Regional coordinator pay' : 'My pay as coordinator'}</h2>
      <p class="muted" style="margin-top:-4px">15% of the region's income this month: paid places bought in its towns and flyer fees for events held there. Payments from suppliers the coordinator registered personally are left out here, because the coordinator earns agent commission on those instead. Donations are not counted. Deals a coordinator brought in are added by hand.</p>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Region</th><th>Coordinator</th><th>Places</th><th>Flyers</th><th>Region income</th><th>Pay (15%)</th><th>Live suppliers registered by</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.region_name)}</td><td>${r.coordinator_id ? `<b>${esc(r.coordinator_name || '—')}</b><br><span class="muted">${esc(r.coordinator_email || '')}</span>` : '<span class="muted">No coordinator</span>'}</td>
        <td>${cedi(r.place_income)}</td><td>${cedi(r.flyer_income)}</td><td>${cedi(r.total_income)}</td><td><b>${r.coordinator_id ? cedi(r.earnings) : '—'}</b></td>
        <td>${r.coordinator_id ? `Coordinator: <b>${r.self_registered}</b><br>Agents: <b>${r.agents_registered}</b>${Number(r.self_registered) > Number(r.agents_registered) && Number(r.self_registered) >= 5 ? '<br><span class="badge" style="background:#f6e4e2;color:var(--red)">Check: coordinator keeps most</span>' : ''}` : '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No regional income or coordinators this month.</td></tr>'}
      </tbody>${rows.length && u.role === 'admin' ? `<tfoot><tr><td colspan="5"><b>Total to pay coordinators</b></td><td><b>${cedi(total)}</b></td><td></td></tr></tfoot>` : ''}</table></div>`;
  }
}

/* ---------- moderator ---------- */
async function reviewQueue(u) {
  shell(u, 'review', 'Pending review', '<div class="skeleton"></div>');
  const { data, error } = await db.from('listings')
    .select('id,slug,business_name,description,phone,whatsapp,landmark,created_at,registered_by,owner_id,consent_given,towns(name),listing_photos(path,sort),listing_categories(categories(name)),profiles!listings_owner_id_fkey(full_name,email)')
    .eq('status', 'pending').order('created_at');
  if (error) return fail(error, 'Loading the queue');
  document.getElementById('dash').innerHTML = `<h2>Listings waiting</h2><p class="muted">Check each listing looks real: sensible name, photos of real work, a working phone number. Oldest first.</p>
    <div class="row-list">${data.length ? data.map((l) => {
      const ph = (l.listing_photos || []).sort((a, b) => a.sort - b.sort);
      return `<div class="row" data-row="${l.id}">
      <div class="row-top"><div><b>${esc(l.business_name)}</b> <span class="muted">· ${esc(l.towns?.name)}</span><br>
        <span class="muted" style="font-size:.88rem">${(l.listing_categories || []).map((c) => esc(c.categories?.name)).join(', ')} · by ${esc(l.profiles?.full_name || l.profiles?.email || '')}${l.registered_by ? ' (agent registration' + (l.consent_given ? ', consent given)' : ')') : ''}</span></div>
        <span class="muted" style="font-size:.85rem">${new Date(l.created_at).toLocaleDateString('en-GB')}</span></div>
      <div style="font-size:.92rem">${esc(l.description)}</div>
      <div class="muted" style="font-size:.88rem">📞 ${esc(localPhone(l.phone))} · WhatsApp ${esc(localPhone(l.whatsapp))} · ${esc(l.landmark)}</div>
      ${ph.length ? `<div class="photos">${ph.slice(0, 5).map((p) => `<div class="photo"><img src="${esc(photoUrl(p.path))}" alt="" loading="lazy"></div>`).join('')}</div>` : '<span class="hint">No photos yet.</span>'}
      ${u.role === 'coordinator' && (l.registered_by === u.id || l.owner_id === u.id) ? '<div class="notice">You registered this listing, so the admin checks and approves it.</div>' : `<div class="row-actions">
        <button class="btn" data-approve="${l.id}">Approve</button>
        <a class="btn btn-ghost" href="#/me/edit/${l.id}">Edit</a>
        <a class="btn btn-ghost" href="#/l/${esc(l.slug)}">Preview</a>
      </div>
      <form class="filters" data-reject="${l.id}"><input type="text" required placeholder="Reason, e.g. please add photos of your work"><button class="btn btn-ghost btn-small" type="submit">Send back</button></form>`}
    </div>`; }).join('') : '<div class="empty"><p class="muted" style="margin:0">No listings waiting for review.</p></div>'}</div><div id="contact-queue"></div><div id="flyer-queue"></div>`;
  contactQueue(document.getElementById('contact-queue'), u);
  flyerQueue(document.getElementById('flyer-queue'), u);
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

// Live listings whose owner changed the phone / WhatsApp number: approve before visitors see it
async function contactQueue(container, u) {
  const { data } = await db.from('listings').select('id,slug,business_name,phone,whatsapp,pending_contact,towns(name)').not('pending_contact', 'is', null).order('updated_at');
  if (!(data || []).length) { container.innerHTML = ''; return; }
  container.innerHTML = `<h2 style="margin-top:26px">New phone numbers to check</h2><p class="muted">These suppliers changed their number on a live listing. Visitors still see the old number. Call or WhatsApp the new number to confirm it belongs to the same business.</p>
    <div class="row-list">${data.map((l) => `<div class="row" data-crow="${l.id}">
      <div class="row-top"><div><b><a href="#/l/${esc(l.slug)}">${esc(l.business_name)}</a></b> <span class="muted">· ${esc(l.towns?.name || '')}</span></div>
        <span class="muted" style="font-size:.85rem">${new Date(l.pending_contact.at).toLocaleDateString('en-GB')}</span></div>
      <dl class="kv"><dt>Now</dt><dd>📞 ${esc(localPhone(l.phone))} · WhatsApp ${esc(localPhone(l.whatsapp))}</dd>
        <dt>New</dt><dd><b>📞 ${esc(localPhone(l.pending_contact.phone))} · WhatsApp ${esc(localPhone(l.pending_contact.whatsapp))}</b></dd></dl>
      <div class="row-actions">
        <a class="btn btn-ghost" href="tel:${esc(l.pending_contact.phone)}">Call new number</a>
        <button class="btn" data-capprove="${l.id}">Approve new number</button>
        <button class="btn btn-ghost" data-creject="${l.id}">Keep old number</button>
      </div></div>`).join('')}</div>`;
  container.querySelectorAll('[data-capprove]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.rpc('approve_contact_change', { p_id: b.dataset.capprove });
    if (error) return fail(error, 'Approving the number');
    toast('New number approved.'); container.querySelector(`[data-crow="${b.dataset.capprove}"]`)?.remove();
  }));
  container.querySelectorAll('[data-creject]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.rpc('reject_contact_change', { p_id: b.dataset.creject });
    if (error) return fail(error, 'Keeping the old number');
    toast('Old number kept.'); container.querySelector(`[data-crow="${b.dataset.creject}"]`)?.remove();
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
      ${r.reviews && [...STAFF, 'coordinator'].includes(u.role) ? `<button class="btn btn-ghost" data-hide="${r.reviews.id}">Hide review</button>` : ''}
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
  const [{ data: allRegions }, { data: cr }] = await Promise.all([
    db.from('regions').select('id,name').order('name'),
    db.from('coordinator_regions').select('coordinator_id,region_id')
  ]);
  const regionsOf = (id) => (cr || []).filter((c) => c.coordinator_id === id).map((c) => c.region_id);
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
      ${p.role === 'coordinator' ? `<details open><summary>Regions they coordinate (${regionsOf(p.id).length})</summary><div class="checks" data-regions style="margin-top:8px">${(allRegions || []).map((r) => `<label class="check"><input type="checkbox" value="${r.id}" ${regionsOf(p.id).includes(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('')}</div>
        <button class="btn btn-small" data-save-regions style="margin-top:8px">Save regions</button></details>` : ''}
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
    row.querySelector('[data-save-regions]')?.addEventListener('click', async () => {
      const ids = [...row.querySelectorAll('[data-regions] input:checked')].map((c) => Number(c.value));
      await db.from('coordinator_regions').delete().eq('coordinator_id', id);
      if (ids.length) {
        const { error } = await db.from('coordinator_regions').insert(ids.map((r) => ({ coordinator_id: id, region_id: r })));
        if (error) return fail(error, 'Saving regions');
      }
      toast('Regions saved.');
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
  let towns, districts;
  if (u.role === 'coordinator') {
    const r = await myRegionTowns(u);
    towns = r.towns;
    const regionIds = (await db.from('coordinator_regions').select('region_id').eq('coordinator_id', u.id)).data.map((x) => x.region_id);
    districts = (await db.from('districts').select('id,name').in('region_id', regionIds).order('name')).data || [];
  } else {
    [{ data: towns }, { data: districts }] = await Promise.all([
      db.from('towns').select('id,name,slug,lat,lng,active,size,districts(name)').order('name'),
      db.from('districts').select('id,name').order('name')
    ]);
  }
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
      <td><button class="linkish" data-loc="${t.id}">Set location</button> · <button class="linkish" data-act="${t.id}" data-v="${!t.active}">${t.active ? 'Hide' : 'Show'}</button>${u.role === 'admin' ? ` · <button class="linkish" data-size="${t.id}" data-v="${t.size === 'big' ? 'normal' : 'big'}">${t.size === 'big' ? 'Big town ✓ (make normal)' : 'Mark as big town'}</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('tw-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tw-n').value.trim();
    const lat = document.getElementById('tw-lat').value, lng = document.getElementById('tw-lng').value;
    const { error } = await db.from('towns').insert({ district_id: Number(document.getElementById('tw-d').value), name, slug: slugify(name),
      lat: lat === '' ? null : Number(lat), lng: lng === '' ? null : Number(lng) });
    if (error) return fail(error, 'Adding the town');
    resetRef(); toast(`${name} added.`); townsAdmin(u);
  });
  document.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.from('towns').update({ size: b.dataset.v }).eq('id', b.dataset.size);
    if (error) return fail(error, 'Saving'); toast(b.dataset.v === 'big' ? 'Marked as a big town: more town places, +20% town prices.' : 'Back to a normal town.'); b.dataset.v = b.dataset.v === 'big' ? 'normal' : 'big'; b.textContent = b.dataset.v === 'normal' ? 'Big town ✓ (make normal)' : 'Mark as big town';
  }));
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
    db.from('featured_slots').select('id,months,amount,is_free,starts_on,ends_on,payment_ref,category_id,town_id,position,level,listings(business_name,slug)').gte('ends_on', today).order('ends_on'),
    db.from('featured_prices').select('tier,months,amount')
  ]);
  const st = await getSettings();
  document.getElementById('dash').innerHTML = `
    <form class="form panel" id="st-f" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Payment and donation settings</h3>
      <div class="form-grid two">
        <div class="field"><label for="st-price">Flyer price per week (GH₵)</label><input type="number" id="st-price" min="0" value="${esc(st.flyer_price || '')}"></div>
        <div class="field"><label for="st-momo">MoMo number for flyer payments</label><input type="tel" id="st-momo" value="${esc(st.momo_number || '')}" placeholder="024 123 4567"></div>
        <div class="field"><label for="st-name">MoMo account name</label><input type="text" id="st-name" value="${esc(st.momo_name || '')}"></div>
        <div class="field"><label for="st-dnum">MoMo number for donations</label><input type="tel" id="st-dnum" value="${esc(st.donate_number || '')}" placeholder="024 123 4567"></div>
        <div class="field"><label for="st-dname">Donation account name</label><input type="text" id="st-dname" value="${esc(st.donate_name || '')}" placeholder="e.g. MEYE CATHOLIC ASOREBA"></div>
      </div><span class="hint">Shown on the site. Leave a MoMo number empty to hide it (people are then asked to get in touch).</span>
      <button class="btn btn-small" type="submit">Save settings</button></form>
    <form class="form panel" id="fe-f" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Record a payment made another way (admin only)</h3><span class="hint">Suppliers normally pay online from their own account. Use this only for exceptions, never for cash handed to a helper.</span>
      <div class="field"><label for="fe-q">Listing</label><input type="search" id="fe-q" placeholder="Type the business name"><select id="fe-l" required><option value="">Search above…</option></select></div>
      <div class="form-grid two">
        <div class="field"><label for="fe-p">Position</label><select id="fe-p"><option value="top">★ Top spot (2 per category per town)</option><option value="featured" selected>Featured (3 per category per town)</option></select></div>
        <div class="field"><label for="fe-c">Category</label><select id="fe-c">${REF.top.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="fe-t">Town</label><select id="fe-t">${townOptions(null, 'id')}</select></div>
        <div class="field"><label for="fe-m">Plan</label><select id="fe-m">${[1, 3, 6, 12].map((m) => `<option value="${m}">${m} month${m > 1 ? 's' : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="fe-a">Amount paid (GH₵)</label><input type="number" id="fe-a" min="0" required></div>
      </div>
      <div class="field"><label for="fe-r">MoMo / receipt reference</label><input type="text" id="fe-r" required></div>
      <button class="btn" type="submit">Make featured</button><div id="fe-msg"></div></form>
    <form class="form panel" id="pp-f" style="max-width:720px;margin-bottom:18px"><h3 style="margin:0">Prices and number of places (per category)</h3>
      <span class="hint">Monthly price in GH₵ and how many places each level has. 3/6/12-month plans are 2.7×, 4.8× and 8.4× the monthly price.</span>
      <div style="overflow-x:auto"><table class="table"><thead><tr><th>Level</th><th>★ Top: price / places</th><th>Featured: price / places</th></tr></thead><tbody id="pp-body"><tr><td colspan="3" class="muted">Loading…</td></tr></tbody></table></div>
      <button class="btn btn-small" type="submit">Save prices</button></form>
    <div id="pay-list"></div>
    <h2>Active paid places</h2>
    <table class="table"><thead><tr><th>Listing</th><th>Where</th><th>Until</th><th>Paid</th><th></th></tr></thead><tbody>
      ${(slots || []).map((s) => `<tr><td><a href="#/l/${esc(s.listings?.slug)}">${esc(s.listings?.business_name)}</a><br><span class="badge ${s.position === 'top' ? 'badge-top' : 'badge-featured'}">${s.position === 'top' ? '★ Top spot' : 'Featured'}${{ national: ' · Ghana-wide', region: ' · Region', district: ' · District' }[s.level] || ''}</span></td><td>${esc(REF.catById[s.category_id]?.name)}, ${esc(REF.townById[s.town_id]?.name)}</td>
        <td>${new Date(s.ends_on).toLocaleDateString('en-GB')}</td><td>${s.is_free ? 'Free (founding)' : cedi(s.amount)}${s.payment_ref ? `<br><span class="muted">${esc(s.payment_ref)}</span>` : ''}</td>
        <td><button class="linkish" data-end="${s.id}">End now</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">None yet.</td></tr>'}</tbody></table>`;
  const PPL = { national: 'National (all Ghana)', region: 'Regional', district: 'District', town: 'Town', town_big: 'Big town (e.g. Kumasi)' };
  db.from('place_prices').select('level,position,monthly,slots').then(({ data: pp }) => {
    const g = (lv, pos) => (pp || []).find((p) => p.level === lv && p.position === pos) || { monthly: '', slots: '' };
    document.getElementById('pp-body').innerHTML = Object.keys(PPL).map((lv) => `<tr><td>${PPL[lv]}</td>${['top', 'featured'].map((pos) => `<td><input type="number" min="1" step="1" data-pp="${lv}|${pos}|monthly" value="${esc(g(lv, pos).monthly)}" style="width:90px"> / <input type="number" min="0" step="1" data-pp="${lv}|${pos}|slots" value="${esc(g(lv, pos).slots)}" style="width:60px"></td>`).join('')}</tr>`).join('');
  });
  document.getElementById('pp-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = {};
    document.querySelectorAll('[data-pp]').forEach((i) => { const [lv, pos, f] = i.dataset.pp.split('|'); (rows[lv + '|' + pos] ||= { level: lv, position: pos })[f] = Number(i.value); });
    const { error } = await db.from('place_prices').upsert(Object.values(rows));
    if (error) return fail(error, 'Saving prices'); toast('Prices saved.');
  });
  db.from('payments').select('reference,kind,amount,status,channel,note,created_at,paid_at,profiles(full_name,email)').neq('status', 'pending').order('created_at', { ascending: false }).limit(50).then(({ data: pays }) => {
    const box = document.getElementById('pay-list'); if (!box) return;
    const attention = (pays || []).filter((p) => p.status === 'needs_attention');
    box.innerHTML = `<h2>Online payments</h2>
      ${attention.length ? `<div class="notice error" style="margin-bottom:10px"><b>${attention.length} payment${attention.length > 1 ? 's need' : ' needs'} your attention</b> — paid but could not be switched on (e.g. wrong amount, or places filled up). Contact the client: offer the next free place or refund it from your Paystack dashboard.</div>` : ''}
      <table class="table"><thead><tr><th>When</th><th>Who</th><th>For</th><th>Amount</th><th>Status</th></tr></thead><tbody>
      ${(pays || []).map((p) => `<tr><td>${new Date(p.paid_at || p.created_at).toLocaleDateString('en-GB')}</td><td>${esc(p.profiles?.full_name || p.profiles?.email || '')}</td><td>${p.kind === 'place' ? 'Top spot / Featured' : 'Flyer'}<br><span class="muted">${esc(p.reference)}</span></td><td>${cedi(p.amount)}${p.channel ? `<br><span class="muted">${esc(p.channel.replace('_', ' '))}</span>` : ''}</td><td>${esc(p.status.replace('_', ' '))}${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No online payments yet.</td></tr>'}
      </tbody></table>`;
  });
  document.getElementById('st-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rows = [['flyer_price', 'st-price'], ['momo_number', 'st-momo'], ['momo_name', 'st-name'], ['donate_number', 'st-dnum'], ['donate_name', 'st-dname']]
      .map(([key, el]) => ({ key, value: document.getElementById(el).value.trim() }));
    const { error } = await db.from('app_settings').upsert(rows);
    if (error) return fail(error, 'Saving settings');
    toast('Settings saved.');
  });
  const priceFor = () => {
    const tier = document.getElementById('fe-p').value === 'top' ? 'premium' : 'standard';
    const p = (prices || []).find((x) => x.tier === tier && x.months === Number(document.getElementById('fe-m').value));
    if (p) document.getElementById('fe-a').value = p.amount;
  };
  ['fe-p', 'fe-m'].forEach((id) => document.getElementById(id).addEventListener('change', priceFor)); priceFor();
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
    const position = document.getElementById('fe-p').value, limit = position === 'top' ? 2 : 3;
    const active = (slots || []).filter((s) => s.category_id === cat && s.town_id === town && (s.position || 'featured') === position).length;
    if (active >= limit) return (document.getElementById('fe-msg').innerHTML = `<div class="notice error">This category already has ${limit} ${position === 'top' ? 'Top spots' : 'Featured places'} taken in this town. Offer the other position, or put the supplier on the waiting list.</div>`);
    const end = new Date(); end.setMonth(end.getMonth() + months);
    const { error } = await db.from('featured_slots').insert({ listing_id: document.getElementById('fe-l').value, category_id: cat, town_id: town, months,
      position, amount: Number(document.getElementById('fe-a').value), payment_ref: document.getElementById('fe-r').value.trim(), starts_on: today, ends_on: end.toISOString().slice(0, 10), created_by: u.id });
    if (error) return fail(error, 'Saving');
    toast('Listing is now featured.'); featuredAdmin(u);
  });
  document.querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const { error } = await db.from('featured_slots').update({ ends_on: y }).eq('id', b.dataset.end);
    if (error) return fail(error, 'Ending'); featuredAdmin(u);
  }));
}

async function donationsAdmin(u) {
  shell(u, 'donations', 'Donations', '<div class="skeleton"></div>');
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const [st, { data: rows, error }] = await Promise.all([getSettings(),
    db.from('donations').select('id,user_id,amount,donated_on,payment_ref,note,profiles!donations_user_id_fkey(full_name,email,phone)').gte('donated_on', since).order('donated_on', { ascending: false })]);
  if (error) return fail(error, 'Loading donations');
  const sMin = Number(st.supporter_min || 50), fMin = Number(st.donor_flyer_min || 100);
  const people = {};
  (rows || []).forEach((r) => { (people[r.user_id] ||= { p: r.profiles, total: 0 }).total += Number(r.amount); });
  const ids = Object.keys(people);
  await Promise.all(ids.map(async (id) => { const { data } = await db.rpc('my_donor_status', { p_user: id }); people[id].s = data?.[0] || {}; }));
  const fmt = (x) => x ? new Date(x + 'T12:00:00').toLocaleDateString('en-GB') : '';
  document.getElementById('dash').innerHTML = `
    <form class="form panel" id="dn-st" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Donor rewards</h3>
      <div class="form-grid two">
        <div class="field"><label for="dn-smin">Supporter from (GH₵ in 12 months)</label><input type="number" id="dn-smin" min="1" value="${sMin}"></div>
        <div class="field"><label for="dn-fmin">Free flyers from (GH₵ in 12 months)</label><input type="number" id="dn-fmin" min="1" value="${fMin}"></div>
      </div><button class="btn btn-small" type="submit">Save</button></form>
    <form class="form panel" id="dn-f" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Record a donation</h3>
      <span class="hint">Record it once the MoMo payment has arrived. Only the Supporter badge is public — amounts stay private.</span>
      <div class="field"><label for="dn-q">Donor's account</label><input type="search" id="dn-q" placeholder="Business name, email, phone or name"><select id="dn-u" required><option value="">Search above…</option></select></div>
      <div class="form-grid two">
        <div class="field"><label for="dn-a">Amount (GH₵)</label><input type="number" id="dn-a" min="1" step="0.01" required></div>
        <div class="field"><label for="dn-d">Date received</label><input type="date" id="dn-d" max="${today}" value="${today}" required></div>
      </div>
      <div class="field"><label for="dn-r">MoMo reference</label><input type="text" id="dn-r" required></div>
      <button class="btn" type="submit">Record donation</button></form>
    <h2>Donors in the last 12 months</h2>
    <table class="table"><thead><tr><th>Donor</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${ids.sort((a, b) => people[b].total - people[a].total).map((id) => { const x = people[id]; return `<tr><td>${esc(x.p?.full_name || x.p?.email || '')}<br><span class="muted">${esc(x.p?.email || '')} ${esc(x.p?.phone || '')}</span></td><td>${cedi(x.total)}</td>
        <td>${x.s.free_flyers_until ? `<span class="badge badge-supporter">♥ Supporter + free flyers</span><br><span class="muted">until ${fmt(x.s.supporter_until)} / flyers ${fmt(x.s.free_flyers_until)}</span>` : x.s.supporter_until ? `<span class="badge badge-supporter">♥ Supporter</span><br><span class="muted">until ${fmt(x.s.supporter_until)}</span>` : `<span class="muted">GH₵ ${sMin - x.total} more to be a Supporter</span>`}</td></tr>`; }).join('') || '<tr><td colspan="3" class="muted">No donations recorded yet.</td></tr>'}</tbody></table>
    ${(rows || []).length ? `<h2 style="margin-top:22px">All donations (12 months)</h2><table class="table"><thead><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Reference</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${fmt(r.donated_on)}</td><td>${esc(r.profiles?.full_name || r.profiles?.email || '')}</td><td>${cedi(r.amount)}</td><td>${esc(r.payment_ref || '')}</td><td><button class="linkish" data-del="${r.id}">Remove</button></td></tr>`).join('')}</tbody></table>` : ''}`;

  document.getElementById('dn-st').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.from('app_settings').upsert([{ key: 'supporter_min', value: document.getElementById('dn-smin').value }, { key: 'donor_flyer_min', value: document.getElementById('dn-fmin').value }]);
    if (error) return fail(error, 'Saving'); toast('Saved.'); donationsAdmin(u);
  });
  let timer;
  document.getElementById('dn-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = e.target.value.trim().replace(/[%,()]/g, ''); if (q.length < 2) return;
      const [{ data: ps }, { data: ls }] = await Promise.all([
        db.from('profiles').select('id,full_name,email,phone').or(`email.ilike.%${q}%,full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(10),
        db.from('listings').select('owner_id,business_name,profiles!listings_owner_id_fkey(full_name,email)').ilike('business_name', `%${q}%`).limit(10)]);
      const opts = [...(ls || []).map((l) => [l.owner_id, `${l.business_name} — ${l.profiles?.full_name || l.profiles?.email || ''}`]),
        ...(ps || []).map((p) => [p.id, `${p.full_name || ''} ${p.email ? '· ' + p.email : ''} ${p.phone ? '· ' + p.phone : ''}`])];
      document.getElementById('dn-u').innerHTML = opts.length ? opts.map(([id, t]) => `<option value="${id}">${esc(t)}</option>`).join('') : '<option value="">No match</option>';
    }, 300);
  });
  document.getElementById('dn-f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user_id = document.getElementById('dn-u').value;
    if (!user_id) return toast('Pick the donor first.', true);
    const { error } = await db.from('donations').insert({ user_id, amount: Number(document.getElementById('dn-a').value), donated_on: document.getElementById('dn-d').value, payment_ref: document.getElementById('dn-r').value.trim(), recorded_by: u.id });
    if (error) return fail(error, 'Recording the donation');
    toast('Donation recorded. Thank you to them!'); donationsAdmin(u);
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this donation record?')) return;
    const { error } = await db.from('donations').delete().eq('id', b.dataset.del);
    if (error) return fail(error, 'Removing'); donationsAdmin(u);
  }));
}

/* ---------- online payments (Paystack) ---------- */
let paystackLoading;
function loadPaystack() {
  if (window.PaystackPop) return Promise.resolve();
  paystackLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://js.paystack.co/v2/inline.js';
    s.onload = res; s.onerror = () => { paystackLoading = null; rej(new Error('Could not open the payment window. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  return paystackLoading;
}
// Asks Paystack (through our database) whether a payment went through; MoMo can take a little while
async function confirmPayment(reference, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const { data, error } = await db.rpc('confirm_payment', { p_ref: reference });
    if (error) throw error;
    if (!/^(Payment not found|Not paid yet)/.test(data)) return data;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return 'We have not received the payment yet. If money left your account, open My listings in a few minutes; it is checked again automatically.';
}
// Starts a payment: the price is set by the database, the client pays NHYIAMU directly in the Paystack window
async function payOnline(args, onDone) {
  const { data, error } = await db.rpc('start_payment', args);
  if (error) return fail(error, 'Starting the payment');
  const p = data?.[0];
  try { await loadPaystack(); } catch (e) { return toast(e.message, true); }
  new window.PaystackPop().newTransaction({
    key: CFG.paystackKey, email: p.email, amount: p.amount_pesewas, currency: 'GHS', reference: p.reference,
    channels: ['mobile_money', 'card'],
    onSuccess: async () => {
      toast('Checking your payment…');
      try { const msg = await confirmPayment(p.reference); toast(msg); } catch (e) { fail(e, 'Checking the payment'); }
      onDone?.();
    },
    onCancel: () => toast('Payment cancelled. Nothing was charged.')
  });
}
// Re-checks this user's recent unfinished payments (e.g. they closed the window after paying)
async function recheckMyPayments(u) {
  const since = new Date(Date.now() - 2 * 864e5).toISOString();
  const { data } = await db.from('payments').select('reference').eq('user_id', u.id).eq('status', 'pending').gte('created_at', since);
  let changed = false;
  for (const p of data || []) {
    const { data: msg } = await db.rpc('confirm_payment', { p_ref: p.reference });
    if (msg && !/^(Payment not found|Not paid yet)/.test(msg)) { toast(msg); changed = true; }
  }
  return changed;
}
const NO_CASH = '<div class="notice" style="background:var(--gold-soft)"><b>Pay only on this page.</b> NHYIAMU staff and field agents never collect cash or MoMo for you. If anyone asks you to pay them, please report it.</div>';

async function promotePage(u, listingId) {
  const { data: l } = await db.from('listings').select('id,slug,business_name,status,owner_id,base_town_id,coverage,towns(name,size,districts(name,regions(name))),listing_categories(categories(id,parent_id))').eq('id', listingId).maybeSingle();
  if (!l || l.owner_id !== u.id) return shell(u, 'home', 'Promote my listing', '<div class="notice error">Listing not found.</div>');
  if (l.status !== 'live') return shell(u, 'home', 'Promote my listing', '<div class="notice">Your listing must be approved and live before you can buy a Top spot or Featured place.</div>');
  const tops = [...new Set((l.listing_categories || []).map((x) => x.categories?.parent_id || x.categories?.id).filter(Boolean))].map((id) => REF.catById[id]).filter(Boolean);
  const { data: mine } = await db.from('featured_slots').select('category_id,position,level,ends_on').eq('listing_id', l.id).gte('ends_on', new Date().toISOString().slice(0, 10));
  const reach = { town: 0, district: 1, region: 2, nationwide: 3 }[l.coverage] ?? 0;
  const LV = [
    ['town', `Town — ${l.towns?.name || 'your town'}`, 0],
    ['district', `District — ${l.towns?.districts?.name || 'your district'}`, 1],
    ['region', `Region — ${l.towns?.districts?.regions?.name || 'your region'}`, 2],
    ['national', 'National — all of Ghana', 3]
  ];
  const LVL = { national: 'across Ghana', region: 'in your region', district: 'in your district', town: 'in your town' };
  shell(u, 'home', `Promote: ${l.business_name}`, `
    <div style="max-width:760px">
      <p class="muted">Show <b>${esc(l.business_name)}</b> above other suppliers in its category. Wider places show above town places and reach more people. Places rotate daily within each group.</p>
      ${(mine || []).length ? `<div class="notice" style="margin-bottom:12px">You already have: ${mine.map((s) => `${s.position === 'top' ? '★ Top spot' : 'Featured'} ${LVL[s.level || 'town']} in ${esc(REF.catById[s.category_id]?.name || '')} until ${new Date(s.ends_on + 'T12:00:00').toLocaleDateString('en-GB')}`).join('; ')}. Paying again for the same place adds the time on.</div>` : ''}
      <form class="form panel" id="pr">
        <div class="field"><label for="pr-cat">Category</label><select id="pr-cat">${tops.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="pr-lv">Where people will see you</label><select id="pr-lv">${LV.map(([v, t, n]) => `<option value="${v}" ${n > reach ? 'disabled' : ''}>${esc(t)}${n > reach ? ' (you don’t serve this whole area)' : ''}</option>`).join('')}</select>
          ${reach < 3 ? '<span class="hint">To buy a wider place, first change “Areas you serve” in your listing to cover that area — only if you really travel there.</span>' : ''}</div>
        <div class="field"><label>Place</label>
          <label class="check" style="white-space:normal"><input type="radio" name="pr-pos" value="top"> <span><b>★ Top spot</b> — the very top of this level <span class="muted" id="left-top"></span></span></label>
          <label class="check" style="white-space:normal"><input type="radio" name="pr-pos" value="featured" checked> <span><b>Featured</b> — just below <span class="muted" id="left-featured"></span></span></label>
        </div>
        <div class="field"><label for="pr-m">How long</label><select id="pr-m">${[1, 3, 6, 12].map((m) => `<option value="${m}">${m} month${m > 1 ? 's' : ''}</option>`).join('')}</select></div>
        <p style="font-size:1.25rem;margin:4px 0"><b id="pr-total"></b></p>
        <button class="btn btn-gold" type="submit" id="pr-pay">Pay with MoMo or card</button>
        <span class="hint">Your place switches on as soon as the payment is confirmed. Paid securely through Paystack.</span>
      </form>
      <div style="margin-top:12px">${NO_CASH}</div>
    </div>`);
  const pos = () => document.querySelector('input[name=pr-pos]:checked').value;
  const update = async () => {
    const cat = Number(document.getElementById('pr-cat').value), lv = document.getElementById('pr-lv').value, m = Number(document.getElementById('pr-m').value);
    const { data: price } = await db.rpc('place_price', { p_level: lv, p_position: pos(), p_months: m, p_town: l.base_town_id });
    document.getElementById('pr-total').textContent = `Total: ${cedi(price || 0)}`;
    let full = false;
    for (const p of ['top', 'featured']) {
      const { data: left } = await db.rpc('places_left_at', { p_category: cat, p_level: lv, p_position: p, p_town: l.base_town_id });
      const own = (mine || []).some((s) => s.category_id === cat && s.position === p && (s.level || 'town') === lv);
      document.getElementById(`left-${p}`).textContent = own ? '· you have this — pay to add time' : left > 0 ? `· ${left} left` : '· all taken right now';
      if (p === pos() && !own && !(left > 0)) full = true;
    }
    document.getElementById('pr-pay').disabled = full;
  };
  ['pr-cat', 'pr-lv', 'pr-m'].forEach((id) => document.getElementById(id).addEventListener('change', update));
  document.querySelectorAll('input[name=pr-pos]').forEach((r) => r.addEventListener('change', update));
  update();
  document.getElementById('pr').addEventListener('submit', (e) => {
    e.preventDefault();
    payOnline({ p_kind: 'place', p_listing: l.id, p_category: Number(document.getElementById('pr-cat').value), p_position: pos(),
      p_months: Number(document.getElementById('pr-m').value), p_level: document.getElementById('pr-lv').value }, () => go('/me'));
  });
}

/* ---------- helper pay ---------- */
async function payPage(u, params) {
  const isAdmin = u.role === 'admin';
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ym = params.get('m') || `${(isAdmin ? prev : now).getFullYear()}-${String((isAdmin ? prev : now).getMonth() + 1).padStart(2, '0')}`;
  const month = `${ym}-01`;
  const [y, mo] = ym.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  shell(u, 'pay', isAdmin ? 'Payouts' : 'My pay', '<div class="skeleton"></div>');
  const [{ data: rows, error }, { data: lines }, { data: history }] = await Promise.all([
    db.rpc('month_earnings', { p_month: month }),
    db.rpc('commission_lines', { p_from: month, p_to: `${ym}-${last}` }),
    isAdmin ? Promise.resolve({ data: [] }) : db.from('payouts').select('month,amount,momo_ref,paid_at').eq('person_id', u.id).order('month', { ascending: false })
  ]);
  if (error) return fail(error, 'Loading pay');
  const monthName = new Date(month + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const linesFor = (id) => (lines || []).filter((l) => l.person_id === id);
  const lineTable = (ls) => ls.length ? `<table class="table" style="font-size:.88rem"><thead><tr><th>Date</th><th>Supplier</th><th>Paid</th><th>Your share</th></tr></thead><tbody>${ls.map((l) => `<tr><td>${new Date(l.paid_on + 'T12:00:00').toLocaleDateString('en-GB')}</td><td>${esc(l.listing_name)}${l.first_payment ? ' <span class="muted">(first payment)</span>' : ''}</td><td>${cedi(l.amount)}</td><td><b>${cedi(l.commission)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No commission this month.</p>';
  const status = (r) => r.paid_at ? `<span class="badge badge-verified">✓ Paid ${cedi(r.paid_amount)}</span><br><span class="muted" style="font-size:.85rem">${esc(r.momo_ref)} · ${new Date(r.paid_at).toLocaleDateString('en-GB')}</span>` : '<span class="badge">Not paid yet</span>';
  const picker = `<div class="field" style="max-width:220px;margin-bottom:12px"><label for="p-m">Month</label><input type="month" id="p-m" value="${ym}" style="width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px;min-height:44px"></div>`;
  const rules = '<p class="hint">Agent commission: on a supplier\'s first paid place, 50% of one month\'s value plus 20% of the rest; on every later payment, 20%. Coordinators: 15% of their region\'s income (leaving out suppliers they registered themselves, which earn agent commission instead). Only payments actually received count — free places and donations never do.</p>';

  if (isAdmin) {
    const owed = (rows || []).filter((r) => !r.paid_at).reduce((s, r) => s + Number(r.total), 0);
    const paid = (rows || []).filter((r) => r.paid_at).reduce((s, r) => s + Number(r.paid_amount), 0);
    document.getElementById('dash').innerHTML = `${picker}
      <p>Pay for <b>${esc(monthName)}</b>: <b>${cedi(owed)}</b> still to pay · ${cedi(paid)} already paid. Send each person's pay by MoMo, then record it here with the MoMo reference.</p>
      <div class="row-list">${(rows || []).map((r) => `<div class="row">
        <div class="row-top"><div><b>${esc(r.full_name || r.email || '—')}</b> <span class="muted">· ${esc(ROLE_LABEL[r.role] || r.role)}</span><br><span class="muted">MoMo: ${esc(localPhone(r.phone || '')) || 'no phone on file'}</span></div><div style="text-align:right">${status(r)}</div></div>
        <dl class="kv"><dt>Agent commission</dt><dd>${cedi(r.commission)}</dd>${Number(r.coordinator_pay) ? `<dt>Coordinator 15%</dt><dd>${cedi(r.coordinator_pay)}</dd>` : ''}<dt>Total earned</dt><dd><b>${cedi(r.total)}</b></dd></dl>
        ${linesFor(r.person_id).length ? `<details><summary>See the payments behind this</summary>${lineTable(linesFor(r.person_id))}</details>` : ''}
        ${r.paid_at ? `<button class="linkish" data-undo="${r.person_id}">Undo this record</button>` : `<form class="filters" data-pay="${r.person_id}"><input type="number" min="0" step="0.01" required value="${Number(r.total).toFixed(2)}" aria-label="Amount sent" style="max-width:120px"><input type="text" required placeholder="MoMo reference / transaction ID" style="flex:1;min-width:180px"><button class="btn btn-small" type="submit">Mark as paid</button></form>`}
      </div>`).join('') || '<div class="empty"><p class="muted">Nobody earned anything this month.</p></div>'}</div>${rules}`;
    document.querySelectorAll('[data-pay]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const [amt, ref] = f.querySelectorAll('input');
      const { error: er } = await db.from('payouts').insert({ person_id: f.dataset.pay, month, amount: Number(amt.value), momo_ref: ref.value.trim(), paid_by: u.id });
      if (er) return fail(er, 'Recording the payment');
      toast('Payment recorded.'); payPage(u, params);
    }));
    document.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this payment record? Only do this if it was recorded by mistake.')) return;
      const { error: er } = await db.from('payouts').delete().eq('person_id', b.dataset.undo).eq('month', month);
      if (er) return fail(er, 'Removing'); payPage(u, params);
    }));
  } else {
    const r = (rows || [])[0] || { commission: 0, coordinator_pay: 0, total: 0 };
    document.getElementById('dash').innerHTML = `${picker}
      <div class="panel" style="max-width:760px;margin-bottom:16px"><h3 style="margin-top:0">${esc(monthName)}</h3>
        <dl class="kv"><dt>Agent commission</dt><dd>${cedi(r.commission)}</dd>${u.role === 'coordinator' ? `<dt>Coordinator 15%</dt><dd>${cedi(r.coordinator_pay)}</dd>` : ''}<dt>Total earned</dt><dd><b>${cedi(r.total)}</b></dd><dt>Status</dt><dd>${status(r)}</dd></dl>
        <p class="muted" style="font-size:.88rem;margin:6px 0 0">Pay for each month is sent by MoMo to your phone number after the month ends. This month's figure can still grow until the month is over.</p></div>
      <h2>Payments behind your commission</h2>${lineTable(linesFor(u.id))}
      <h2 style="margin-top:22px">Payments you have received</h2>
      ${(history || []).length ? `<table class="table"><thead><tr><th>For</th><th>Amount</th><th>MoMo reference</th><th>Sent on</th></tr></thead><tbody>${history.map((h) => `<tr><td>${new Date(h.month + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</td><td>${cedi(h.amount)}</td><td>${esc(h.momo_ref)}</td><td>${new Date(h.paid_at).toLocaleDateString('en-GB')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No payments yet.</p>'}
      ${rules}`;
  }
  document.getElementById('p-m').addEventListener('change', (e) => go(`/me/pay?m=${e.target.value}`));
}

const ROLE_WANT = { agent: 'Field agent', coordinator: 'Regional coordinator' };
const ROLE_WANT_ALL = { ...ROLE_WANT, moderator: 'Moderator' };
const WORK = { unemployed: 'Unemployed', student: 'Student / just finished school', part_time: 'Part-time work', employed: 'Employed' };

async function joinForm(u) {
  const { data: a } = await db.from('team_applications').select('*').eq('user_id', u.id).maybeSingle();
  const locked = a && ['accepted', 'declined'].includes(a.status);
  const sel = (obj, v) => Object.entries(obj).map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const et = a?.endorsement_type || 'pastor';
  shell(u, 'join', 'Join the NHYIAMU team', `
    ${a ? `<div class="notice" style="margin-bottom:14px;max-width:760px">Your application is <span class="status status-${esc(a.status)}">${esc(a.status)}</span>.${locked ? '' : ' You can still update it below.'}</div>` : `<p class="muted" style="max-width:760px">Read about the roles and pay on the <a href="#/join">Join our team</a> page first. We give priority to people who are unemployed.</p>`}
    ${locked ? '' : `<form class="form" id="ja" style="max-width:760px">
      <fieldset><legend>About you</legend>
        <div class="form-grid two">
          <div class="field"><label for="ja-name">Full name</label><input type="text" id="ja-name" required maxlength="80" value="${esc(a?.full_name || u.full_name || '')}"></div>
          <div class="field"><label for="ja-phone">Phone (WhatsApp)</label><input type="tel" id="ja-phone" required placeholder="024 123 4567" value="${esc(localPhone(a?.phone || u.phone || ''))}"></div>
          <div class="field"><label for="ja-town">Town where you live</label><select id="ja-town" required>${townOptions(a?.town_id ?? REF.townBySlug['ejisu-besease']?.id, 'id')}</select></div>
          <div class="field"><label for="ja-role">Role you want</label><select id="ja-role">${sel(ROLE_WANT, a?.role_wanted || 'agent')}</select></div>
          <div class="field"><label for="ja-work">Work right now</label><select id="ja-work">${sel(WORK, a?.work_status || 'unemployed')}</select></div>
          <div class="field"><label for="ja-edu">Highest education</label><input type="text" id="ja-edu" maxlength="80" value="${esc(a?.education || '')}" placeholder="e.g. SHS, HND, degree"></div>
          <div class="field"><label for="ja-lang">Languages you speak</label><input type="text" id="ja-lang" maxlength="80" value="${esc(a?.languages || '')}" placeholder="e.g. Twi, English"></div>
        </div>
        <label class="check"><input type="checkbox" id="ja-phone-ok" ${a?.has_smartphone === false ? '' : 'checked'}> I have a smartphone with WhatsApp</label>
        <div class="field"><label for="ja-why">Why do you want to join? (optional)</label><textarea id="ja-why" rows="3" maxlength="600">${esc(a?.motivation || '')}</textarea></div>
      </fieldset>
      <fieldset><legend>Who recommends you</legend>
        <div class="field"><label for="ja-et">Choose one</label><select id="ja-et"><option value="pastor" ${et === 'pastor' ? 'selected' : ''}>My pastor recommends me</option><option value="guarantor" ${et === 'guarantor' ? 'selected' : ''}>My parent or guardian is my guarantor</option></select></div>
        <div class="form-grid two">
          <div class="field"><label for="ja-en" id="ja-en-l">Name</label><input type="text" id="ja-en" required maxlength="80" value="${esc(a?.endorser_name || '')}"></div>
          <div class="field"><label for="ja-ep">Their phone</label><input type="tel" id="ja-ep" required placeholder="020 123 4567" value="${esc(localPhone(a?.endorser_phone || ''))}"></div>
          <div class="field" data-for="pastor"><label for="ja-church">Church and town</label><input type="text" id="ja-church" maxlength="100" value="${esc(a?.endorser_church || '')}" placeholder="e.g. St. Peter's Catholic Church, Ejisu"></div>
          <div class="field" data-for="guarantor"><label for="ja-rel">Relationship to you</label><select id="ja-rel">${sel({ mother: 'Mother', father: 'Father', guardian: 'Guardian' }, a?.endorser_relationship || 'mother')}</select></div>
          <div class="field" data-for="guarantor"><label for="ja-etown">Where they live</label><input type="text" id="ja-etown" maxlength="80" value="${esc(a?.endorser_town || '')}"></div>
          <div class="field" data-for="guarantor"><label for="ja-eocc">Their work</label><input type="text" id="ja-eocc" maxlength="80" value="${esc(a?.endorser_occupation || '')}"></div>
        </div>
        <div class="field"><label for="ja-letter" id="ja-letter-l">Photo of a letter from your pastor (optional)</label><input type="file" id="ja-letter" accept="image/*">${a?.letter_path ? '<span class="hint">A photo is already attached. Choose another to replace it.</span>' : ''}</div>
        <span class="hint">The regional coordinator will call this person to confirm before you are accepted.</span>
      </fieldset>
      <label class="check"><input type="checkbox" id="ja-adult" required ${a ? 'checked' : ''}> I am 18 years or older</label>
      <label class="check"><input type="checkbox" id="ja-consent" required ${a ? 'checked' : ''}> I agree that NHYIAMU may call me and the person above about this application</label>
      <button class="btn" type="submit">${a ? 'Update my application' : 'Send my application'}</button><div id="ja-msg"></div>
    </form>`}`);
  if (locked) return;
  const etSel = document.getElementById('ja-et');
  const sync = () => {
    const v = etSel.value;
    document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== v; });
    document.getElementById('ja-en-l').textContent = v === 'pastor' ? "Pastor's name" : "Parent or guardian's name";
    document.getElementById('ja-letter-l').textContent = v === 'pastor' ? 'Photo of a letter from your pastor (optional)' : 'Photo of a signed note from your guarantor (optional)';
  };
  etSel.addEventListener('change', sync); sync();
  document.getElementById('ja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('ja-msg'); const g = (id) => document.getElementById(id).value.trim();
    const phone = toGhanaPhone(g('ja-phone')), ephone = toGhanaPhone(g('ja-ep'));
    if (!phone || !ephone) return (msg.innerHTML = '<div class="notice error">Please enter valid Ghana phone numbers for you and the person who recommends you.</div>');
    if (phone === ephone) return (msg.innerHTML = '<div class="notice error">The person who recommends you needs their own phone number.</div>');
    const type = etSel.value;
    if (type === 'pastor' && !g('ja-church')) return (msg.innerHTML = '<div class="notice error">Please enter your pastor\'s church and town.</div>');
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      let letter_path = a?.letter_path || null;
      const file = document.getElementById('ja-letter').files[0];
      if (file) {
        msg.innerHTML = '<div class="notice">Uploading the photo…</div>';
        const blob = await shrink(file, 1600, 0.78);
        letter_path = `${u.id}/team/${Date.now()}.jpg`;
        const up = await db.storage.from('listing-photos').upload(letter_path, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
      }
      const row = {
        user_id: u.id, full_name: g('ja-name'), phone, town_id: Number(g('ja-town')), role_wanted: g('ja-role'), work_status: g('ja-work'),
        education: g('ja-edu') || null, languages: g('ja-lang') || null, has_smartphone: document.getElementById('ja-phone-ok').checked,
        motivation: g('ja-why') || null, endorsement_type: type, endorser_name: g('ja-en'), endorser_phone: ephone,
        endorser_church: type === 'pastor' ? g('ja-church') : null,
        endorser_relationship: type === 'guarantor' ? g('ja-rel') : null,
        endorser_town: type === 'guarantor' ? (g('ja-etown') || null) : null,
        endorser_occupation: type === 'guarantor' ? (g('ja-eocc') || null) : null,
        letter_path, is_adult: document.getElementById('ja-adult').checked, consent: document.getElementById('ja-consent').checked
      };
      const { error } = a ? await db.from('team_applications').update(row).eq('id', a.id) : await db.from('team_applications').insert(row);
      if (error) throw error;
      toast(a ? 'Application updated.' : 'Application sent. The regional coordinator will call you.');
      go('/me');
    } catch (err) { btn.disabled = false; fail(err, 'Sending your application'); }
  });
}

async function applications(u, params) {
  const st = params.get('s') || 'open';
  shell(u, 'apps', 'Team applications', '<div class="skeleton"></div>');
  let q = db.from('team_applications').select('*').order('created_at');
  q = st === 'open' ? q.in('status', ['new', 'checking']) : q.eq('status', st);
  const { data, error } = await q;
  if (error) return fail(error, 'Loading applications');
  const wa = (p, text) => `https://wa.me/${String(p).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
  const tabs = [['open', 'To check'], ['accepted', 'Accepted'], ['declined', 'Declined']];
  document.getElementById('dash').innerHTML = `
    <p class="muted" style="max-width:760px">${u.role === 'coordinator' ? 'Applicants from your region who want to be field agents.' : 'All applications. Coordinators handle field agents in their regions; applications to be a coordinator, and regions without a coordinator, are yours.'} Call the applicant, then their pastor or guarantor, before accepting.</p>
    <div class="filters" style="margin-bottom:12px">${tabs.map(([k, t]) => `<a class="btn btn-small ${k === st ? '' : 'btn-ghost'}" href="#/me/apps?s=${k}">${t}</a>`).join('')}</div>
    <div class="row-list">${(data || []).map((a) => {
      const town = REF.townById[a.town_id];
      return `<div class="row app-card">
        <div class="row-top"><div><b>${esc(a.full_name)}</b> · ${esc(ROLE_WANT_ALL[a.role_wanted])}<br><span class="muted">${esc(town?.name || '')}${town ? ', ' + esc(regionOf(town)) : ''} · applied ${new Date(a.created_at).toLocaleDateString('en-GB')}</span></div><span class="status status-${esc(a.status)}">${esc(a.status)}</span></div>
        <dl class="kv">
          <dt>Work now</dt><dd>${esc(WORK[a.work_status])}${a.education ? ' · ' + esc(a.education) : ''}${a.languages ? ' · ' + esc(a.languages) : ''}${a.has_smartphone ? '' : ' · <b>no smartphone</b>'}</dd>
          ${a.motivation ? `<dt>Why</dt><dd>${esc(a.motivation)}</dd>` : ''}
          <dt>${a.endorsement_type === 'pastor' ? 'Pastor' : 'Guarantor'}</dt><dd><b>${esc(a.endorser_name)}</b>${a.endorsement_type === 'pastor' ? ` · ${esc(a.endorser_church || '')}` : ` · ${esc(a.endorser_relationship || '')}${a.endorser_town ? ', ' + esc(a.endorser_town) : ''}${a.endorser_occupation ? ', ' + esc(a.endorser_occupation) : ''}`}<br>${esc(localPhone(a.endorser_phone))}</dd>
          ${a.letter_path ? `<dt>Letter</dt><dd><a href="${esc(photoUrl(a.letter_path))}" target="_blank" rel="noopener">View photo</a></dd>` : ''}
          ${a.staff_note ? `<dt>Notes</dt><dd>${esc(a.staff_note)}</dd>` : ''}
        </dl>
        <div class="row-actions">
          <a class="btn btn-wa" href="${wa(a.phone, `Hello ${a.full_name}, this is NHYIAMU about your application to join the team.`)}" target="_blank" rel="noopener">WhatsApp applicant</a>
          <a class="btn btn-ghost" href="tel:${esc(a.phone)}">Call applicant</a>
          <a class="btn btn-ghost" href="tel:${esc(a.endorser_phone)}">Call ${a.endorsement_type === 'pastor' ? 'pastor' : 'guarantor'}</a>
        </div>
        ${['new', 'checking'].includes(a.status) ? `<form class="filters" data-app="${a.id}">
          <input type="text" maxlength="300" placeholder="Notes, e.g. spoke to pastor, good report" value="${esc(a.staff_note || '')}" style="flex:1;min-width:200px">
          <button class="btn btn-small btn-ghost" type="submit" data-to="checking">Save as checking</button>
          <button class="btn btn-small" type="submit" data-to="accept">Accept</button>
          <button class="btn btn-small btn-ghost" type="submit" data-to="declined">Decline</button></form>` : ''}
      </div>`; }).join('') || '<div class="empty"><p class="muted">No applications here.</p></div>'}</div>`;
  document.querySelectorAll('[data-app]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = e.submitter?.dataset.to || 'checking'; const note = f.querySelector('input').value.trim() || null;
    if (to === 'accept') {
      const { data: m, error } = await db.rpc('accept_application', { p_id: f.dataset.app, p_note: note });
      if (error) return fail(error, 'Accepting');
      toast(m + (m.includes('field agent') ? ' You can add more towns for them in My region.' : ''));
    } else {
      const { error } = await db.from('team_applications').update({ status: to, staff_note: note }).eq('id', f.dataset.app);
      if (error) return fail(error, 'Saving');
      toast(to === 'declined' ? 'Application declined.' : 'Saved.');
    }
    applications(u, params);
  }));
}

async function partnersAdmin(u) {
  shell(u, 'partners', 'Loan partners', '<div class="skeleton"></div>');
  const { data } = await db.from('loan_partners').select('id,name,phone,email,towns,products,active,owner_id').order('name');
  document.getElementById('dash').innerHTML = `
    <form class="form panel" id="lp-f" style="max-width:620px;margin-bottom:18px"><h3 style="margin:0">Add a loan partner</h3>
      <div class="form-grid two">
        <div class="field"><label>Institution name</label><input type="text" id="lp-n" required></div>
        <div class="field"><label>Branch towns</label><input type="text" id="lp-t" placeholder="e.g. Ejisu, Kumasi, Accra"></div>
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
