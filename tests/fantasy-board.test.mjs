import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, BASE_SCORING, SCORING_DEFAULTS, SCORING_FIELDS, playerStatus, preset, rankPlayers, scorePlayer, validateSettings, visibleRows } from '../src/lib/fantasy-board.mjs';

const data = JSON.parse(readFileSync(new URL('../src/data/fantasy-2026.json', import.meta.url), 'utf8'));
const ppr = rankPlayers(data.players, DEFAULTS);

test('status badges abbreviate designations without inventing injuries from news', () => {
  assert.deepEqual(playerStatus('Questionable / review', 'Ankle'), { code: 'Q', label: 'Questionable / review: Ankle' });
  for (const [status, code] of [['IR', 'IR'], ['PUP', 'PUP'], ['Out', 'O'], ['Doubtful', 'D'], ['Suspended', 'SUSP'], ['Exempt List', 'EX'], ['League review', '!']]) {
    assert.equal(playerStatus(status).code, code);
  }
  for (const status of ['Full go', 'Expected Week 1', 'No discipline']) assert.equal(playerStatus(status).code, 'i');
  assert.equal(playerStatus('').code, '');
});

test('original league scoring preserves every saved blended projection exactly', () => {
  assert.deepEqual(data.baseScoring, BASE_SCORING);
  for (const p of data.players) {
    assert.equal(scorePlayer(p, { ...DEFAULTS, ...BASE_SCORING }), p.points);
    const reconstructed = Object.entries(BASE_SCORING).reduce((total, [k, coefficient]) => total + coefficient * p.stats[k], 0);
    assert.ok(Math.abs(reconstructed - p.points) < 1e-8);
    assert.ok(Math.abs(scorePlayer(p, DEFAULTS) - (p.points - p.stats.soloTackle)) < 1e-8);
  }
});

test('half/standard scoring changes only the predicted reception contribution', () => {
  const wr = data.players.find(p => p.position === 'WR');
  const base = scorePlayer(wr, DEFAULTS);
  assert.ok(Math.abs(scorePlayer(wr, preset('half')) - (base - wr.receptions * .5)) < 1e-8);
  assert.ok(Math.abs(scorePlayer(wr, preset('standard')) - (base - wr.receptions)) < 1e-8);
});

test('TE premium does not affect a receiver or quarterback', () => {
  for (const p of data.players) {
    const delta = scorePlayer(p, { ...DEFAULTS, teBonus: .5 }) - scorePlayer(p, DEFAULTS);
    assert.ok(Math.abs(delta - (p.position === 'TE' ? p.receptions * .5 : 0)) < 1e-8);
  }
});

test('all starter slots filled once and exactly once', () => {
  assert.equal(Object.values(ppr.demand).reduce((sum, n) => sum + n, 0), 12 * 7);
  assert.equal(ppr.demand.QB, 12);
  assert.ok(ppr.demand.RB >= 24 && ppr.demand.WR >= 24 && ppr.demand.TE >= 12);
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const sorted = ppr.rows.filter(p => p.position === pos).sort((a, b) => b.points - a.points);
    assert.equal(ppr.baselines[pos], sorted[ppr.demand[pos] - 1].points);
  }
});

test('superflex increases QB demand and hides incompatible market deltas', () => {
  const sf = rankPlayers(data.players, { ...DEFAULTS, SF: 1 });
  assert.ok(sf.demand.QB > ppr.demand.QB);
  assert.ok(sf.baselines.QB < ppr.baselines.QB);
  assert.equal(Object.values(sf.demand).reduce((sum, n) => sum + n, 0), 12 * 8);
  assert.ok(sf.rows.every(p => p.delta === null && p.adpDelta === null));
});

test('custom scoring and team counts never silently re-label PPR market ranks', () => {
  for (const s of [preset('half'), preset('standard'), { ...DEFAULTS, teams: 10 }, { ...DEFAULTS, WR: 3 }]) {
    assert.equal(rankPlayers(data.players, s).comparable, false);
  }
  assert.equal(ppr.comparable, true);
});

test('deltas have correct sign and absent ADP stays missing', () => {
  for (const p of ppr.rows) {
    assert.equal(p.delta, p.ecr == null ? null : p.ecr - p.rank);
    assert.equal(p.adpDelta, p.adp == null ? null : p.adp - p.rank);
  }
});

test('taken filtering does not change league values or ranks', () => {
  const first = ppr.rows[0];
  const taken = new Set([first.id]);
  assert.ok(visibleRows(ppr.rows, { taken }).some(p => p.id === first.id));
  assert.ok(!visibleRows(ppr.rows, { taken, view: 'available' }).some(p => p.id === first.id));
  assert.equal(visibleRows(ppr.rows, { taken, view: 'taken' })[0].id, first.id);
  assert.equal(visibleRows(ppr.rows, { taken, view: 'all' })[0].rank, first.rank);
});

test('draftable toggle excludes deep names but keeps market or model sleepers', () => {
  const full = visibleRows(ppr.rows, { draftable: false });
  const filtered = visibleRows(ppr.rows);
  assert.ok(filtered.length < full.length);
  assert.ok(filtered.every(p => p.rank <= 180 || (p.ecr != null && p.ecr <= 180) || (p.adp != null && p.adp <= 180)));
});

test('search, position and sorting compose and nulls sort last both ways', () => {
  assert.equal(visibleRows(ppr.rows, { search: 'jeanty', position: 'RB' })[0].name, 'Ashton Jeanty');
  assert.equal(visibleRows(ppr.rows, { search: 'jeanty', position: 'WR' }).length, 0);
  for (const direction of [-1, 1]) {
    const rows = visibleRows(ppr.rows, { draftable: false, sort: 'adp', direction });
    let foundNull = false;
    for (const p of rows) {
      if (p.adp == null) foundNull = true;
      else assert.equal(foundNull, false);
    }
  }
});

test('invalid input never produces NaN or an impossible league', () => {
  for (const s of [{ teams: '' }, { teams: 1 }, { teams: 12.5 }, { reception: 'abc' }, { SF: 7 }, { QB: -1 }, { reception: Infinity }]) {
    assert.throws(() => validateSettings({ ...DEFAULTS, ...s }));
  }
  assert.throws(() => validateSettings({ ...DEFAULTS, QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SF: 0 }));
});

test('zero required TE slots does not give flex-ineligible TEs artificial value', () => {
  const noTE = rankPlayers(data.players, { ...DEFAULTS, TE: 0, FLEX: 0 });
  assert.ok(!visibleRows(noTE.rows, { draftable: false }).some(p => p.position === 'TE'));
  const flexTE = rankPlayers(data.players, { ...DEFAULTS, TE: 0 });
  assert.ok(flexTE.baselines.TE > 0);
});

test('oversized demand warns instead of indexing missing projections', () => {
  const oversized = rankPlayers(data.players.slice(0, 20), { ...DEFAULTS, teams: 20, QB: 2, SF: 2 });
  assert.ok(oversized.warnings.length > 0);
  assert.ok(oversized.rows.every(p => Number.isFinite(p.points) && Number.isFinite(p.vor)));
});

test('public export has only allowlisted fields and no league/account data', () => {
  const allowed = ['id', 'name', 'position', 'team', 'points', 'receptions', 'stats', 'originalRank', 'ecr', 'adp', 'status', 'news'];
  assert.equal(new Set(data.players.map(p => p.id)).size, data.players.length);
  for (const p of data.players) {
    assert.deepEqual(Object.keys(p).sort(), allowed.toSorted());
    assert.ok(Number.isFinite(p.points) && Number.isFinite(p.receptions));
    assert.deepEqual(Object.keys(p.stats).sort(), Object.keys(BASE_SCORING).sort());
    assert.ok(Object.values(p.stats).every(n => Number.isFinite(n) && n >= 0));
  }
});

test('exactly three scoring presets preserve the chosen roster', () => {
  for (const name of ['ppr', 'half', 'standard']) {
    const s = preset(name, { ...DEFAULTS, SF: 1, WR: 3, teams: 10, passingTD: 6 });
    assert.equal(s.SF, 1); assert.equal(s.WR, 3); assert.equal(s.teams, 10);
    assert.equal(s.passingTD, 4);
  }
  assert.throws(() => preset('superflex'));
});

for (const [, key, label] of SCORING_FIELDS) {
  test(`${label} changes the score by the projected stat count times the point change`, () => {
    for (const p of data.players) {
      const difference = scorePlayer(p, { ...DEFAULTS, [key]: DEFAULTS[key] + .5 }) - scorePlayer(p, DEFAULTS);
      const count = key === 'teBonus' ? (p.position === 'TE' ? p.stats.reception : 0) : p.stats[key];
      assert.ok(Math.abs(difference - .5 * count) < 1e-8);
    }
  });
}

test('zeroing every scoring rule produces zero points, not a hidden PPR offset', () => {
  const settings = { ...DEFAULTS, ...Object.fromEntries(Object.keys(SCORING_DEFAULTS).map(k => [k, 0])) };
  for (const p of data.players) assert.equal(scorePlayer(p, settings), 0);
});

test('six-point passing TDs update points, positional boundary, VOR and ranks', () => {
  const changed = rankPlayers(data.players, { ...DEFAULTS, passingTD: 6 });
  assert.notEqual(changed.baselines.QB, ppr.baselines.QB);
  assert.ok(changed.rows.some(p => p.vor !== ppr.rows.find(old => old.id === p.id).vor));
  assert.ok(changed.rows.some(p => p.rank !== ppr.rows.find(old => old.id === p.id).rank));
  const allen = changed.rows.find(p => p.name === 'Josh Allen');
  const before = ppr.rows.find(p => p.id === allen.id);
  assert.ok(Math.abs(allen.points - before.points - 2 * allen.stats.passingTD) < 1e-8);
  assert.equal(changed.comparable, false);
});

test('missing stat forecasts fail explicitly instead of silently leaving points unchanged', () => {
  assert.throws(() => scorePlayer({ ...data.players[0], stats: {} }, DEFAULTS), /Missing/);
});
