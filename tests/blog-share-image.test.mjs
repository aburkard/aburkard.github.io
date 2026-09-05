import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { layoutTitle, layoutShareContent, formatShareDate, renderBlogShareImage } from '../src/lib/blog-share-image.mjs';

for (const title of [
  'Vibe-Coded Fantasy Football Projections',
  'Who Has the Best Home Court Advantage in College Basketball?',
  'A Short Title',
  'A much longer blog title with enough words to require smaller type while keeping the entire headline readable on a sharing image',
  'AnUnusuallyLongUnbrokenWord'.repeat(6),
  '“Quotes,” apostrophes & <angle brackets>: 2026–2027',
]) {
  test(`title fits the image: ${title}`, () => {
    const layout = layoutTitle(title);
    assert.ok(layout.widths.every(width => width <= 1040));
    assert.ok(layout.height <= 300);
    assert.equal(layout.lines.join('').replace(/\s/g, ''), title.replace(/\s/g, ''));
  });
}

test('date formatting does not shift to the previous day in Pacific time', () => {
  assert.equal(formatShareDate('2026-09-05'), 'September 5, 2026');
});

test('empty titles fail clearly', () => {
  assert.throws(() => layoutTitle('  '), /needs a title/);
});

for (const [title, description] of [
  ['Vibe-Coded Fantasy Football Projections', "You're right to be skeptical. This isn't just a draft board. It's a genuinely sophisticated way to finish last."],
  ['Who Has the Best Home Court Advantage in College Basketball?', "Spoiler: it's not Duke. A Bayesian model ranks all 372 Division I home courts."],
  ['A much longer blog title with enough words to require smaller type while keeping the entire headline readable on a sharing image', 'A short tagline.'],
]) {
  test(`title and full description fit together: ${title}`, () => {
    const layout = layoutShareContent(title, description);
    assert.ok(layout.title.height + 24 + layout.description.height <= 300);
    assert.ok(layout.description.widths.every(width => width <= 1040));
    assert.ok(layout.title.widths.every(width => width <= 1040));
    assert.equal(layout.description.lines.join(' '), description);
    assert.ok(layout.description.baseline > layout.title.baseline + (layout.title.lines.length - 1) * layout.title.lineHeight);
    assert.ok(layout.description.baseline + (layout.description.lines.length - 1) * layout.description.lineHeight < 470);
  });
}

test('missing and empty descriptions preserve the original title layout', () => {
  const title = 'A Short Title';
  for (const description of [undefined, '', '   ']) {
    assert.deepEqual(layoutShareContent(title, description), { title: layoutTitle(title), description: null });
  }
});

test('description changes the generated image', async () => {
  const post = { title: 'A Short Title', date: '2026-09-05' };
  assert.notDeepEqual(await renderBlogShareImage(post), await renderBlogShareImage({ ...post, description: 'A tagline with <markup> & quotes.' }));
});

test('renders a deterministic 1200 × 630 PNG using bundled fonts', async () => {
  const post = { title: 'Quotes, & <markup> are plain text', date: '2026-09-05' };
  const image = await renderBlogShareImage(post);
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
  assert.deepEqual(image, await renderBlogShareImage(post));
});
