import { openSync } from 'fontkit';
import sharp from 'sharp';
import { resolve } from 'node:path';

// Use the same bundled fonts as the site, not fonts installed on the build machine.
const titleFont = openSync(resolve('public/fonts/newsreader.woff2'));
const dateFont = openSync(resolve('public/fonts/jetbrains-mono.woff2'));
const nameFont = openSync(resolve('public/fonts/karla.woff2'));

export const imageWidth = 1200;
export const imageHeight = 630;
const contentWidth = 1040;

function textWidth(text, font, size) {
  return font.layout(text).positions.reduce((width, p) => width + p.xAdvance, 0) * size / font.unitsPerEm;
}

function wrapText(text, font, size) {
  const lines = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, font, size) <= contentWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    // Unusually long words still stay inside the card.
    for (const character of word) {
      if (line && textWidth(line + character, font, size) > contentWidth) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function layoutTitle(title, maxHeight = 300) {
  if (!title.trim()) throw new Error('A blog sharing image needs a title.');
  for (let size = 76; size >= 36; size -= 2) {
    const lines = wrapText(title, titleFont, size);
    const lineHeight = size * 1.2;
    const height = (titleFont.ascent - titleFont.descent) * size / titleFont.unitsPerEm
      + (lines.length - 1) * lineHeight;
    if (height <= maxHeight) {
      return {
        lines, size, lineHeight, height,
        widths: lines.map(line => textWidth(line, titleFont, size)),
        baseline: 170 + (maxHeight - height) / 2 + titleFont.ascent * size / titleFont.unitsPerEm,
      };
    }
  }
  throw new Error(`Blog title is too long for its sharing image: ${title}`);
}

export function layoutShareContent(title, description = '') {
  if (!description.trim()) return { title: layoutTitle(title), description: null };
  const size = 30;
  const lineHeight = 40;
  const lines = wrapText(description, nameFont, size);
  const height = (nameFont.ascent - nameFont.descent) * size / nameFont.unitsPerEm
    + (lines.length - 1) * lineHeight;
  const titleLayout = layoutTitle(title, 300 - height - 24);
  const titleBottom = titleLayout.baseline + (titleLayout.lines.length - 1) * titleLayout.lineHeight
    - titleFont.descent * titleLayout.size / titleFont.unitsPerEm;
  return {
    title: titleLayout,
    description: {
      lines, size, lineHeight, height,
      widths: lines.map(line => textWidth(line, nameFont, size)),
      baseline: titleBottom + 24 + nameFont.ascent * size / nameFont.unitsPerEm,
    },
  };
}

export function formatShareDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

function drawText(text, font, size, x, baseline, fill) {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let cursor = 0;
  return `<g fill="${fill}">${run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const path = `<path d="${glyph.path.toSVG()}" transform="translate(${x + (cursor + position.xOffset) * scale},${baseline - position.yOffset * scale}) scale(${scale},${-scale})"/>`;
    cursor += position.xAdvance;
    return path;
  }).join('')}</g>`;
}

export async function renderBlogShareImage({ title, date, description }) {
  const content = layoutShareContent(title, description);
  const layout = content.title;
  const tagline = content.description;
  // Outlined text keeps rendering identical across machines and avoids XML injection.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}">
    <rect width="100%" height="100%" fill="#F7F7F7"/>
    ${drawText(formatShareDate(date), dateFont, 24, 80, 112, '#626262')}
    ${layout.lines.map((line, index) => drawText(line, titleFont, layout.size, 80, layout.baseline + index * layout.lineHeight, '#1a1a1a')).join('')}
    ${tagline ? tagline.lines.map((line, index) => drawText(line, nameFont, tagline.size, 80, tagline.baseline + index * tagline.lineHeight, '#626262')).join('') : ''}
    ${drawText('Andrew Burkard', nameFont, 30, 80, 550, '#626262')}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
