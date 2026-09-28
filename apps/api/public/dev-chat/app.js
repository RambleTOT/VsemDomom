// Симулятор чата: лента чата дома и лички жителя по журналу симулятора, нажатия — событиями MAX.
// Тексты страницы приходят с сервера (ключи dev.chat.* общего словаря); текст сообщений бота
// вставляется только через textContent.
'use strict';

(function () {
  const BASE = '/dev/chat';
  const POLL_MS = 2000;
  const AFTER_ACTION_MS = [400, 1200, 2500, 4500];
  const STORE_KEY = 'devchat.v1';

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let texts = {};
  let state = null;
  let chat = Number(params.get('chat')) || null;
  let user = Number(params.get('user')) || null;
  let timer = null;
  let busy = false;
  let lastRaw = null;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  function save(patch) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(load(), patch)));
    } catch {
      /* хранилище недоступно — настройки просто не запоминаются */
    }
  }

  function t(key, vars) {
    let s = texts[key] || key;
    if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
    return s;
  }

  function toast(message, isError) {
    const el = $('toast');
    el.textContent = message;
    el.className = isError ? 'toast error' : 'toast';
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (el.hidden = true), isError ? 6000 : 2500);
  }

  async function request(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || data.detail || data.title || String(res.status));
    return data;
  }

  // ---------- отрисовка ----------

  /** Как CommonMark: \\X — буквальный символ, **…** — жирный; остальное — текстом. */
  function richText(text) {
    const box = document.createElement('div');
    box.className = 'text';
    let bold = false;
    let buf = '';
    const flush = () => {
      if (!buf) return;
      const node = bold ? document.createElement('strong') : document.createTextNode(buf);
      if (bold) node.textContent = buf;
      box.appendChild(node);
      buf = '';
    };
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (c === '\\' && i + 1 < text.length && /[!-/:-@[-`{-~]/.test(text[i + 1])) {
        buf += text[i + 1];
        i += 1;
      } else if (c === '*' && text[i + 1] === '*') {
        flush();
        bold = !bold;
        i += 1;
      } else {
        buf += c;
      }
    }
    flush();
    return box;
  }

  function formatTime(iso) {
    try {
      return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: state.timezone });
    } catch {
      return iso;
    }
  }

  function keyboardButton(b, message, where) {
    if (b.type === 'link' && b.url) {
      const a = document.createElement('a');
      a.textContent = b.text;
      a.title = t('dev.chat.link', { url: b.url });
      if (/^https?:\/\//.test(b.url)) {
        a.href = b.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      return a;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.text;
    if (b.type === 'callback') {
      btn.disabled = message.deleted;
      btn.addEventListener('click', () => residentAction({ kind: 'callback', where, mid: message.mid, payload: b.payload }));
    } else if (b.type === 'open_app') {
      btn.title = t('dev.chat.open_app', { payload: b.payload || '—' });
      btn.addEventListener('click', () => toast(t('dev.chat.open_app', { payload: b.payload || '—' })));
    } else if (b.type === 'clipboard') {
      btn.addEventListener('click', () => {
        if (!navigator.clipboard) return toast(b.payload || '');
        navigator.clipboard.writeText(b.payload || '').then(
          () => toast(t('dev.chat.copied')),
          () => toast(b.payload || ''),
        );
      });
    } else {
      btn.disabled = true;
    }
    return btn;
  }

  function messageNode(m, where) {
    const el = document.createElement('article');
    el.className = 'msg' + (m.pinned ? ' pinned' : '') + (m.deleted ? ' deleted' : '');
    const meta = [formatTime(m.at)];
    if (m.pinned) meta.push('📌 ' + t('dev.chat.pinned'));
    if (m.replyTo) meta.push('↩ ' + t('dev.chat.reply'));
    if (m.edited) meta.push(t('dev.chat.edited'));
    if (m.silent) meta.push(t('dev.chat.silent'));
    if (m.deleted) meta.push(t('dev.chat.deleted'));
    const head = document.createElement('div');
    head.className = 'meta';
    head.textContent = meta.join(' · ');
    el.appendChild(head);
    el.appendChild(richText(m.text));
    if (m.buttons.length && !m.deleted) {
      const kb = document.createElement('div');
      kb.className = 'kb';
      for (const row of m.buttons) {
        const r = document.createElement('div');
        r.className = 'row';
        for (const b of row) r.appendChild(keyboardButton(b, m, where));
        kb.appendChild(r);
      }
      el.appendChild(kb);
    }
    return el;
  }

  function renderFeed(box, messages, where, since) {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const shown = messages.filter((m) => m.pinned || !since || m.at > since);
    box.replaceChildren();
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = t('dev.chat.empty');
      box.appendChild(p);
    }
    for (const m of shown) box.appendChild(messageNode(m, where));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function option(value, label, selected) {
    const o = document.createElement('option');
    o.value = String(value);
    o.textContent = label;
    o.selected = selected;
    return o;
  }

  function ukButton(label, body, confirmText) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'secondary';
    b.textContent = label;
    b.addEventListener('click', () => {
      if (confirmText && !confirm(confirmText)) return;
      ukAction(body);
    });
    return b;
  }

  function renderUk() {
    const bound = state.chat.bound;
    $('bind-state').textContent = bound ? t('dev.chat.uk.bound') : t('dev.chat.uk.unbound');
    $('bind').hidden = bound;
    const list = $('incidents');
    list.replaceChildren();
    if (bound && !state.uk.incidents.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = t('dev.chat.uk.none');
      list.appendChild(p);
    }
    for (const inc of state.uk.incidents) {
      const box = document.createElement('div');
      box.className = 'incident';
      const title = document.createElement('strong');
      title.textContent = t('dev.chat.uk.incident', { service: inc.service, status: inc.statusText });
      box.appendChild(title);
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const s of ['accepted', 'brigade_on_site', 'localized', 'resolved']) {
        actions.appendChild(ukButton(t('dev.chat.uk.' + s), { kind: 'status', incident: inc.id, status: s }));
      }
      if (state.demo) actions.appendChild(ukButton(t('dev.chat.uk.shift'), { kind: 'shift', incident: inc.id }));
      box.appendChild(actions);
      list.appendChild(box);
    }
    const tools = $('demo-tools');
    tools.replaceChildren();
    if (!bound) return;
    if (!state.demo) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = t('dev.chat.uk.demo_off');
      tools.appendChild(p);
      return;
    }
    tools.appendChild(ukButton(t('dev.chat.uk.neighbours'), { kind: 'neighbours' }));
    tools.appendChild(ukButton(t('dev.chat.uk.reset'), { kind: 'reset' }, t('dev.chat.uk.reset.confirm')));
  }

  function renderStatic() {
    document.title = t('dev.chat.title');
    $('title').textContent = t('dev.chat.title');
    $('note').textContent = t('dev.chat.note');
    $('help').textContent = t('dev.chat.help');
    $('l-chat').textContent = t('dev.chat.label.chat');
    $('l-as').textContent = t('dev.chat.label.as');
    $('h-chat').textContent = t('dev.chat.chat.title');
    $('h-dm').textContent = t('dev.chat.dm.title');
    $('h-uk').textContent = t('dev.chat.uk.title');
    $('start').textContent = t('dev.chat.start');
    $('chat-send').textContent = t('dev.chat.send');
    $('dm-send').textContent = t('dev.chat.send');
    $('chat-text').placeholder = t('dev.chat.chat.placeholder');
    $('dm-text').placeholder = t('dev.chat.dm.placeholder');
    $('bind').textContent = t('dev.chat.uk.bind');
  }

  function render() {
    texts = state.texts;
    renderStatic();
    const chats = $('chat');
    chats.replaceChildren(...state.chats.map((c) => option(c.chatId, c.title, c.chatId === chat)));
    const users = $('user');
    users.replaceChildren(...state.residents.map((r) => option(r.id, t('dev.chat.resident', { n: r.n }), r.id === user)));

    const h = state.chat.house;
    $('house').textContent = h ? t('dev.chat.house', { label: h.label, address: h.address }) : '';
    const me = state.dm.residency;
    $('me').textContent = me ? t('dev.chat.me.flat', { flat: me.flatNo, level: me.trustLevel }) : t('dev.chat.me.none');

    const since = (load().since || {})[chat] || null;
    $('clear').textContent = since ? t('dev.chat.show_all') : t('dev.chat.clear');
    renderFeed($('chat-feed'), state.chat.messages, 'chat', since);
    renderFeed($('dm-feed'), state.dm.messages, 'dm', null);

    const notices = $('notices');
    notices.replaceChildren();
    for (const n of state.dm.notices.slice().reverse().slice(0, 3)) {
      const p = document.createElement('p');
      p.textContent = formatTime(n.at) + ' · ' + n.text;
      notices.appendChild(p);
    }
    renderUk();
  }

  // ---------- данные и действия ----------

  // Перерисовка только при изменении данных: иначе опрос раз в 2 с сбрасывал бы фокус и нажатия.
  async function refresh() {
    try {
      const q = new URLSearchParams({ chat: String(chat), user: String(user) });
      const res = await fetch(BASE + '/state?' + q.toString(), { cache: 'no-store' });
      const raw = await res.text();
      if (!res.ok) throw new Error((JSON.parse(raw || '{}').error) || String(res.status));
      if (raw === lastRaw) return;
      lastRaw = raw;
      state = JSON.parse(raw);
      render();
    } catch (err) {
      toast(t('dev.chat.error', { detail: err.message }), true);
    }
  }

  function burst() {
    for (const ms of AFTER_ACTION_MS) setTimeout(refresh, ms);
  }

  async function act(path, body) {
    if (busy) return;
    busy = true;
    try {
      await request('POST', path, Object.assign({ chat }, body));
      toast(t('dev.chat.done'));
      burst();
    } catch (err) {
      toast(t('dev.chat.error', { detail: err.message }), true);
    } finally {
      busy = false;
    }
  }

  const residentAction = (body) => act('/resident', Object.assign({ user }, body));
  const ukAction = (body) => act('/uk', body);

  function sendText(input, kind) {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    residentAction({ kind, text });
  }

  function syncUrl() {
    const q = new URLSearchParams({ chat: String(chat), user: String(user) });
    history.replaceState(null, '', BASE + '?' + q.toString());
    save({ chat, user });
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, POLL_MS);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const saved = load();
    chat = chat || saved.chat || -1001;
    user = user || saved.user || -9001;
    syncUrl();

    $('chat').addEventListener('change', (e) => {
      chat = Number(e.target.value);
      syncUrl();
      refresh();
    });
    $('user').addEventListener('change', (e) => {
      user = Number(e.target.value);
      syncUrl();
      refresh();
    });
    $('start').addEventListener('click', () => residentAction({ kind: 'start' }));
    $('bind').addEventListener('click', () => ukAction({ kind: 'bind' }));
    $('clear').addEventListener('click', () => {
      const since = Object.assign({}, load().since || {});
      if (since[chat]) delete since[chat];
      else since[chat] = new Date().toISOString();
      save({ since });
      if (state) render();
    });
    for (const [form, input, kind] of [
      ['chat-form', 'chat-text', 'chat_text'],
      ['dm-form', 'dm-text', 'dm_text'],
    ]) {
      $(form).addEventListener('submit', (e) => {
        e.preventDefault();
        sendText($(input), kind);
      });
      // Enter отправляет и там, где неявная отправка формы не срабатывает.
      $(input).addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        sendText($(input), kind);
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh();
    });

    refresh();
    schedule();
  });
})();
