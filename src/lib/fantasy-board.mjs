// Pure league-value calculations. No network, AI calls, or browser-side training.
export const BASE_SCORING = Object.freeze({ passingYards: .04, passingTD: 4, interceptions: -2, rushingYards: .1, rushingTD: 6, reception: 1, receivingYards: .1, receivingTD: 6, fumblesLost: -2, twoPoint: 2, returnTD: 6, recoveryTD: 6, soloTackle: 1 });
export const SCORING_DEFAULTS = Object.freeze({ ...BASE_SCORING, soloTackle: 0, teBonus: 0 });
export const SCORING_FIELDS = [
  ['Passing', 'passingYards', 'Per passing yard', -1, 2, .01],
  ['Passing', 'passingTD', 'Passing touchdown', -12, 12, 1],
  ['Passing', 'interceptions', 'Interception thrown', -12, 0, 1],
  ['Rushing', 'rushingYards', 'Per rushing yard', -1, 2, .01],
  ['Rushing', 'rushingTD', 'Rushing touchdown', -12, 12, 1],
  ['Receiving', 'receivingYards', 'Per receiving yard', -1, 2, .01],
  ['Receiving', 'receivingTD', 'Receiving touchdown', -12, 12, 1],
  ['Receiving', 'reception', 'Per reception (PPR)', 0, 3, .1],
  ['Receiving', 'teBonus', 'Extra PPR for TEs', 0, 3, .1],
  ['Other', 'fumblesLost', 'Fumble lost', -12, 0, 1],
  ['Other', 'twoPoint', 'Two-point conversion', 0, 12, 1],
  ['Other', 'returnTD', 'Return touchdown', 0, 12, 1],
  ['Other', 'recoveryTD', 'Fumble-recovery TD', 0, 12, 1],
  ['Other', 'soloTackle', 'Solo tackle (offensive player)', 0, 5, .1],
];
export const DEFAULTS = Object.freeze({ teams: 12, QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SF: 0, ...SCORING_DEFAULTS });
export const LIMITS = Object.freeze({ teams: [4, 20], QB: [0, 2], RB: [0, 4], WR: [0, 5], TE: [0, 3], FLEX: [0, 3], SF: [0, 2], ...Object.fromEntries(SCORING_FIELDS.map(([, key, , min, max]) => [key, [min, max]])) });
export const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

export function playerStatus(status = '', news = '') {
  const label = [status, news].filter(Boolean).join(': ');
  if (!status) return { code: '', label };
  const codes = { questionable: 'Q', doubtful: 'D', out: 'O', ir: 'IR', 'injured reserve': 'IR', pup: 'PUP', suspended: 'SUSP', 'exempt list': 'EX', 'league review': '!' };
  const primary = status.split('/')[0].trim().toLowerCase();
  // Narrative news is not an injury designation. Keep it as an information marker.
  return { code: codes[primary] || 'i', label };
}

export function validateSettings(input) {
  const result = {};
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const raw = input[key] ?? DEFAULTS[key];
    const n = Number(raw);
    const scoring = key in SCORING_DEFAULTS;
    if (String(raw).trim() === '' || !Number.isFinite(n) || n < min || n > max || (!scoring && !Number.isInteger(n))) {
      const label = SCORING_FIELDS.find(([, k]) => k === key)?.[2] || (key === 'SF' ? 'superflex' : key);
      throw new Error(`Check ${label}: enter ${min}–${max}${scoring ? '' : ' (whole numbers)'}.`);
    }
    result[key] = n;
  }
  if (POSITIONS.reduce((n, p) => n + result[p], 0) + result.FLEX + result.SF === 0) throw new Error('Add at least one starting slot.');
  return result;
}

export function preset(name, current = DEFAULTS) {
  if (!['ppr', 'half', 'standard'].includes(name)) throw new Error('Unknown scoring preset');
  // Scoring presets never silently reset superflex or other roster choices.
  const s = { ...current, ...SCORING_DEFAULTS };
  if (name === 'half') s.reception = 0.5;
  else if (name === 'standard') s.reception = 0;
  return s;
}

export function scorePlayer(player, settings) {
  if (Object.keys(BASE_SCORING).every(k => settings[k] === BASE_SCORING[k]) && settings.teBonus === 0) return player.points;
  let points = 0;
  for (const key of Object.keys(BASE_SCORING)) {
    if (!Number.isFinite(player.stats?.[key])) throw new Error(`Missing ${key} projection for ${player.name}`);
    points += player.stats[key] * settings[key];
  }
  return points + (player.position === 'TE' ? player.stats.reception * settings.teBonus : 0);
}

export function marketComparable(s) {
  return Object.keys(DEFAULTS).every(key => s[key] === DEFAULTS[key]);
}

export function rankPlayers(players, input) {
  const settings = validateSettings(input);
  const scored = players.map(p => ({ ...p, points: scorePlayer(p, settings) }));
  const order = (a, b) => b.points - a.points || a.name.localeCompare(b.name);
  const pools = Object.fromEntries(POSITIONS.map(pos => [pos, scored.filter(p => p.position === pos).sort(order)]));
  const assigned = new Set();
  const demand = Object.fromEntries(POSITIONS.map(pos => [pos, 0]));
  const warnings = [];
  for (const pos of POSITIONS) {
    const wanted = settings.teams * settings[pos];
    if (wanted > pools[pos].length) warnings.push(`Not enough projected ${pos}s for all starting slots.`);
    for (const p of pools[pos].slice(0, wanted)) { assigned.add(p.id); demand[pos]++; }
  }
  // Fill narrower FLEX eligibility before superflex, without reusing players.
  const flexThresholds = {};
  for (const slot of ['FLEX', 'SF']) {
    const eligible = scored.filter(p => !assigned.has(p.id) && (slot === 'SF' || p.position !== 'QB')).sort(order);
    const wanted = settings.teams * settings[slot];
    if (wanted > eligible.length) warnings.push(`Not enough projected players for all ${slot} slots.`);
    const selected = eligible.slice(0, wanted);
    for (const p of selected) { assigned.add(p.id); demand[p.position]++; }
    if (selected.length) flexThresholds[slot] = selected.at(-1).points;
  }
  // Last projected starter, not a claimed waiver replacement or optimal strategy.
  const baselines = Object.fromEntries(POSITIONS.map(pos => {
    const eligibleThresholds = Object.entries(flexThresholds).filter(([slot]) => slot === 'SF' || pos !== 'QB').map(([, n]) => n);
    return [pos, demand[pos] ? pools[pos][demand[pos] - 1].points : eligibleThresholds.length ? Math.min(...eligibleThresholds) : 0];
  }));
  const comparable = marketComparable(settings);
  const rows = scored.map(p => ({ ...p, eligible: settings[p.position] > 0 || settings.SF > 0 || (p.position !== 'QB' && settings.FLEX > 0), vor: p.points - baselines[p.position] }));
  rows.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.vor - a.vor || order(a, b));
  let previous = null;
  let rank = 0;
  rows.forEach((p, index) => {
    if (!p.eligible) { p.rank = null; p.delta = null; p.adpDelta = null; return; }
    if (previous === null || Math.abs(p.vor - previous) > 1e-8) rank = index + 1;
    previous = p.vor;
    p.rank = rank;
    p.delta = comparable && p.ecr != null ? p.ecr - rank : null;
    p.adpDelta = comparable && p.adp != null ? p.adp - rank : null;
  });
  return { rows, baselines, demand, warnings, comparable, settings };
}

export function visibleRows(rows, { search = '', position = 'ALL', view = 'all', draftable = true, taken = new Set(), sort = 'rank', direction = 1 } = {}) {
  const q = search.trim().toLowerCase();
  return rows.filter(p => p.eligible && (!draftable || p.rank <= 180 || (p.ecr != null && p.ecr <= 180) || (p.adp != null && p.adp <= 180))
    && (position === 'ALL' || position === p.position)
    && (view === 'all' || (view === 'taken' ? taken.has(p.id) : !taken.has(p.id)))
    && (!q || `${p.name} ${p.team}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (a[sort] == null && b[sort] == null) return a.rank - b.rank;
      if (a[sort] == null) return 1;
      if (b[sort] == null) return -1;
      const comparison = typeof a[sort] === 'string' ? a[sort].localeCompare(b[sort]) : a[sort] - b[sort];
      return direction * comparison || a.rank - b.rank;
    });
}
