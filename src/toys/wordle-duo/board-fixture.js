// Test helper: draws a Wordle-style screenshot with real letters using @napi-rs/canvas (dev dependency only).
import { createCanvas } from '@napi-rs/canvas';
import { pattern } from './solve.js';

const THEMES = {
  dark: { bg: '#121213', text: '#ffffff', G: '#538d4e', Y: '#b59f3b', B: '#3a3a3c', empty: '#3a3a3c', key: '#818384' },
  light: { bg: '#ffffff', text: '#000000', G: '#6aaa64', Y: '#c9b458', B: '#787c7e', empty: '#d3d6da', key: '#d3d6da' },
  contrast: { bg: '#121213', text: '#ffffff', G: '#f5793a', Y: '#85c0f9', B: '#3a3a3c', empty: '#3a3a3c', key: '#818384' },
};

// words: guesses in order; answer: the day's word. Returns { data, width, height } like canvas ImageData.
export function drawBoard({ words, answer, font, theme = 'dark', tile = 62, gap = 6, width = 430, height = 900 }) {
  const t = THEMES[theme];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = t.text;
  ctx.font = 'bold 30px "Liberation Serif"';
  ctx.textAlign = 'center';
  ctx.fillText('Wordle', width / 2, 50);

  const boardW = tile * 5 + gap * 4;
  const left = (width - boardW) / 2;
  const top = 90;
  for (let r = 0; r < 6; r++) {
    const word = words[r];
    const colours = word ? pattern(word, answer) : null;
    for (let c = 0; c < 5; c++) {
      const x = left + c * (tile + gap);
      const y = top + r * (tile + gap);
      if (!word) {
        ctx.strokeStyle = t.empty;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, tile - 2, tile - 2);
        continue;
      }
      ctx.fillStyle = t[colours[c]];
      ctx.fillRect(x, y, tile, tile);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(tile * 0.52)}px "${font}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(word[c], x + tile / 2, y + tile / 2 + tile * 0.03);
    }
  }

  // Keyboard: taller-than-wide keys the parser must ignore.
  const keyW = 34;
  const keyH = 52;
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  rows.forEach((row, i) => {
    const rowW = row.length * (keyW + 6);
    [...row].forEach((letter, j) => {
      const x = (width - rowW) / 2 + j * (keyW + 6);
      const y = height - 200 + i * (keyH + 8);
      ctx.fillStyle = t.key;
      ctx.fillRect(x, y, keyW, keyH);
      ctx.fillStyle = t.text;
      ctx.font = `bold 16px "${font}"`;
      ctx.fillText(letter, x + keyW / 2, y + keyH / 2);
    });
  });

  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

// Reference letters drawn the same way the browser renderer does, but with Node's canvas.
export function nodeRenderer() {
  const size = 96;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  return (letter, font) => {
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(size * 0.55)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2);
    return { data: ctx.getImageData(0, 0, size, size).data, width: size, box: { x: 0, y: 0, w: size, h: size } };
  };
}
