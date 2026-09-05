import data from '../data/fantasy-2026.json';
import { DEFAULTS, SCORING_DEFAULTS, playerStatus, preset, rankPlayers, validateSettings, visibleRows } from './fantasy-board.mjs';

const root = document.querySelector('.fantasy-board');
if (root) {
  const get = id => root.querySelector(`#fantasy-${id}`);
  const controls = get('controls');
  get('advanced-toggle').addEventListener('click', () => {
    const expanded = get('advanced-toggle').getAttribute('aria-expanded') !== 'true';
    get('advanced-toggle').setAttribute('aria-expanded', String(expanded));
    get('advanced').hidden = !expanded;
  });
  const tbody = get('rows');
  const template = tbody.firstElementChild.cloneNode(true);
  const ids = new Set(data.players.map(p => p.id));
  const storageKey = 'fantasy-public-board-2026-v1';
  let settings = { ...DEFAULTS };
  let taken = new Set();
  let history = [];
  let sort = 'rank';
  let direction = 1;
  let result;
  let storageFailed = false;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) {
      try { settings = validateSettings(saved.settings || {}); } catch { settings = { ...DEFAULTS }; }
      if (Array.isArray(saved.taken)) taken = new Set(saved.taken.filter(id => ids.has(id)));
    }
  } catch { storageFailed = true; }

  const signed = n => n == null ? '—' : `${Math.round(n) > 0 ? '+' : ''}${Math.round(n)}`;
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ settings, taken: [...taken] })); }
    catch { storageFailed = true; }
  }
  function syncInputs() {
    for (const [key, value] of Object.entries(settings)) controls.querySelector(`[name="${key}"]`).value = value;
    get('preset').value = ['ppr', 'half', 'standard'].find(name => {
      const candidate = preset(name, settings);
      return Object.keys(SCORING_DEFAULTS).every(key => settings[key] === candidate[key]);
    }) || 'custom';
  }
  function recalculate() {
    result = rankPlayers(data.players, settings);
    const labels = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SF'].filter(k => settings[k]).map(k => `${settings[k]} ${k === 'FLEX' ? 'flex' : k === 'SF' ? 'superflex' : k}`);
    get('roster-summary').textContent = labels.join(' / ');
    const notes = [];
    if (!result.comparable) notes.push('ECR and ADP are based on 12-team PPR. Deltas are hidden for custom settings.');
    notes.push(...result.warnings);
    if (storageFailed) notes.push('Browser storage is unavailable. Changes work here but will not be saved.');
    get('scoring-note').textContent = notes.join(' ');
    get('scoring-note').hidden = !notes.length;
    render();
  }
  function render() {
    const rows = visibleRows(result.rows, { search: get('search').value, position: get('position').value, view: get('view').value, draftable: get('draftable').checked, taken, sort, direction });
    const fragment = document.createDocumentFragment();
    for (const p of rows) {
      const row = template.cloneNode(true);
      const cells = row.children;
      cells[0].textContent = p.rank;
      cells[1].querySelector('strong').textContent = p.name;
      cells[1].querySelector('span').textContent = p.team;
      const status = cells[1].querySelector('small');
      const badge = playerStatus(p.status, p.news);
      status.textContent = '\u00a0' + badge.code;
      status.title = badge.label;
      status.setAttribute('aria-label', badge.label);
      status.dataset.info = String(badge.code === 'i');
      status.hidden = !badge.code;
      cells[2].textContent = p.position;
      cells[3].textContent = Math.round(p.points);
      cells[4].textContent = signed(p.vor);
      cells[4].title = `${p.points.toFixed(1)} points − ${result.baselines[p.position].toFixed(1)} starter boundary`;
      cells[5].textContent = p.ecr ?? '—';
      cells[6].textContent = signed(p.delta);
      cells[7].textContent = p.adp?.toFixed(1) ?? '—';
      cells[8].textContent = p.adpDelta == null ? '—' : `${p.adpDelta > 0 ? '+' : ''}${p.adpDelta.toFixed(1)}`;
      for (const [index, delta] of [[6, p.delta], [8, p.adpDelta]]) {
        cells[index].classList.toggle('positive', delta > 0);
        cells[index].classList.toggle('negative', delta < 0);
      }
      const checkbox = cells[9].querySelector('input');
      checkbox.disabled = false;
      checkbox.checked = taken.has(p.id);
      checkbox.dataset.playerId = p.id;
      checkbox.setAttribute('aria-label', `Mark ${p.name} taken`);
      row.classList.toggle('is-taken', taken.has(p.id));
      fragment.appendChild(row);
    }
    tbody.replaceChildren(fragment);
    get('empty').hidden = rows.length > 0;
    get('count').textContent = `${rows.length} shown / ${data.players.length} players · ${taken.size} taken`;
    get('undo').disabled = history.length === 0;
    get('reset-draft').disabled = taken.size === 0;
    get('undo').title = history.length ? `Undo marking ${data.players.find(p => p.id === history.at(-1).id)?.name}` : 'Undo the last taken mark';
    root.querySelectorAll('[data-sort]').forEach(button => {
      const active = button.dataset.sort === sort;
      button.closest('th').setAttribute('aria-sort', active ? (direction === 1 ? 'ascending' : 'descending') : 'none');
      button.querySelector('span').textContent = active ? (direction === 1 ? ' ↑' : ' ↓') : '';
    });
  }
  controls.addEventListener('input', event => {
    if (!event.target.name) return;
    const input = Object.fromEntries([...controls.querySelectorAll('[name]')].map(el => [el.name, el.value]));
    try {
      settings = validateSettings(input);
      get('error').hidden = true;
      // Do not rewrite the focused number input (e.g. an in-progress 0.04).
      get('preset').value = ['ppr', 'half', 'standard'].find(name => {
        const candidate = preset(name, settings);
        return Object.keys(SCORING_DEFAULTS).every(key => settings[key] === candidate[key]);
      }) || 'custom';
      save(); recalculate();
    } catch (error) {
      get('error').textContent = `${error.message} The table still uses your last valid settings.`;
      get('error').hidden = false;
    }
  });
  get('preset').addEventListener('change', () => {
    settings = preset(get('preset').value, settings);
    get('error').hidden = true;
    syncInputs(); save(); recalculate();
  });
  get('reset').addEventListener('click', () => {
    settings = { ...DEFAULTS };
    get('error').hidden = true;
    syncInputs(); save(); recalculate();
  });
  get('search').addEventListener('input', render);
  for (const id of ['position', 'view', 'draftable']) get(id).addEventListener('change', render);
  root.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
    const next = button.dataset.sort;
    direction = sort === next ? -direction : ['points', 'vor', 'delta', 'adpDelta'].includes(next) ? -1 : 1;
    sort = next; render();
  }));
  tbody.addEventListener('change', event => {
    const id = event.target.dataset.playerId;
    if (!ids.has(id)) return;
    history.push({ id, wasTaken: taken.has(id) });
    history = history.slice(-50);
    event.target.checked ? taken.add(id) : taken.delete(id);
    save(); render();
    // Keep focus on the marked player unless an explicit filter hides the row.
    const checkbox = [...tbody.querySelectorAll('[data-player-id]')].find(el => el.dataset.playerId === id);
    (checkbox || get('undo')).focus({ preventScroll: true });
  });
  get('undo').addEventListener('click', () => {
    const previous = history.pop();
    if (!previous) return;
    previous.wasTaken ? taken.add(previous.id) : taken.delete(previous.id);
    save(); render();
  });
  get('reset-draft').addEventListener('click', () => {
    if (!taken.size || !window.confirm('Reset draft? This clears all taken marks and Undo history. League settings stay unchanged.')) return;
    taken.clear();
    history = [];
    if (get('view').value === 'taken') get('view').value = 'all';
    save(); render();
    get('search').focus({ preventScroll: true });
  });
  syncInputs(); recalculate(); controls.disabled = false;
}
