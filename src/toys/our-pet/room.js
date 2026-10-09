// The room the cat lives in: one illustrated SVG living room (arched window, sofa, plants, rug, lamp, bed and bowls),
// lit for the time of day in India. The room is 1600 × 900 units; the art bleeds past the sides for wide screens.

export const ROOM_W = 1600;
export const ROOM_H = 900;
export const FLOOR = { x0: 70, x1: 1530, y0: 706, y1: 846 };
export const scaleAt = (y) => 0.6 + ((y - 640) / 260) * 0.55;
export const SPOTS = {
  sill: { x: 590, y: 472, s: 0.58, x0: 490, x1: 690, below: 714 },
  sofa: { x: 1270, y: 552, s: 0.66, x0: 1140, x1: 1420, below: 722 },
  bed: { x: 300, y: 790 },
  bowl: { x: 150, y: 832 },
  beam: { x: 810, y: 772 },
  door: { x: 800, y: 822 },
};

const IST_OFFSET_MS = 5.5 * 3600000;
const istHours = (now) => { const d = new Date(now + IST_OFFSET_MS); return d.getUTCHours() + d.getUTCMinutes() / 60; };

export function timeOfDay(now, override) {
  if (['morning', 'day', 'evening', 'night'].includes(override)) return override;
  const h = istHours(now);
  if (h >= 5.5 && h < 9.5) return 'morning';
  if (h >= 9.5 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19.5) return 'evening';
  return 'night';
}

// Sun or moon in the window, the clock on the wall, and the light on everything.
export function paintTime(scene, svg, now, override) {
  const tod = timeOfDay(now, override);
  for (const t of ['morning', 'day', 'evening', 'night']) scene.classList.toggle(`t-${t}`, t === tod);
  let h = istHours(now);
  if (override) h = { morning: 7.5, day: 12.5, evening: 18, night: 22.5 }[tod];
  const sunU = Math.min(1, Math.max(0, (h - 6) / 13));
  const moonU = ((h + 24 - 19) % 24) / 11;
  svg.querySelector('#sun').setAttribute('transform', `translate(${455 + 270 * sunU} ${400 - 250 * Math.sin(Math.PI * sunU)})`);
  svg.querySelector('#moon').setAttribute('transform', `translate(${470 + 240 * Math.min(1, moonU)} ${330 - 170 * Math.sin(Math.PI * Math.min(1, moonU))})`);
  const real = istHours(now);
  svg.querySelector('#clock-h').setAttribute('transform', `rotate(${(real % 12) * 30} 900 200)`);
  svg.querySelector('#clock-m').setAttribute('transform', `rotate(${(real % 1) * 360} 900 200)`);
  return tod;
}

// Floor seams run towards a vanishing point above the middle of the room.
function seams() {
  const out = [];
  for (let i = -24; i <= 52; i++) {
    const xb = i * 64 - 200;
    const xt = 800 + (xb - 800) * 0.658;
    const x2 = 800 + (xb - 800) * 1.789;
    out.push(`M${xt.toFixed(0)} 640 L${x2.toFixed(0)} 1500`);
  }
  const joints = [[690, 3], [735, 5], [790, 2], [850, 4]];
  for (const [y, off] of joints) {
    for (let i = -6; i < 30; i += 3) {
      const xb = (i + off) * 64 - 200;
      const k = (y - 140) / 760;
      const x1 = 800 + (xb - 800) * k;
      const x2 = 800 + (xb + 64 - 800) * k;
      out.push(`M${x1.toFixed(0)} ${y} L${x2.toFixed(0)} ${y}`);
    }
  }
  return out.join(' ');
}

function panels() {
  let d = '';
  for (let x = -380; x < 1980; x += 190) d += `M${x} 528 h150 v84 h-150 Z `;
  return d;
}

function books() {
  const spec = [[1126, 18, 74, '#7d8c7a'], [1146, 14, 62, '#c9a26b'], [1162, 20, 80, '#a45d4f'], [1184, 12, 56, '#3f4d63'], [1198, 16, 70, '#d8cbb3'],
    [1262, 22, 66, '#5d6b58', -12], [1342, 16, 72, '#b5806a'], [1360, 14, 60, '#e2d7c5'], [1376, 18, 76, '#4a5a70']];
  return spec.map(([x, w, h, c, r]) => `<rect x="${x}" y="${300 - h}" width="${w}" height="${h}" rx="2" fill="${c}"${r ? ` transform="rotate(${r} ${x + w} 300)"` : ''} />`).join('');
}

function leaf(x, y, rot, s, dark) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
    <path d="M0 0 C-34 -10 -58 -46 -50 -86 C-44 -112 -16 -128 0 -132 C16 -128 44 -112 50 -86 C58 -46 34 -10 0 0 Z" fill="${dark ? '#2f5f41' : '#3d7550'}" />
    <path d="M0 -4 L0 -124" stroke="#5f9a6e" stroke-width="2.4" fill="none" />
    <path d="M-50 -70 L-22 -64 M-48 -96 L-18 -90 M50 -70 L22 -64 M48 -96 L18 -90 M-36 -30 L-12 -34 M36 -30 L12 -34" stroke="var(--wall-top)" stroke-width="5" stroke-linecap="round" opacity=".9" />
  </g>`;
}

export function roomSVG() {
  return `<svg class="room" id="room" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" role="img" aria-label="A cosy living room">
  <defs>
    <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky-top)" /><stop offset="1" style="stop-color:var(--sky-low)" /></linearGradient>
    <linearGradient id="g-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--wall-top)" /><stop offset="1" style="stop-color:var(--wall-low)" /></linearGradient>
    <linearGradient id="g-wains" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--wains-top)" /><stop offset="1" style="stop-color:var(--wains-low)" /></linearGradient>
    <linearGradient id="g-floor" gradientUnits="userSpaceOnUse" x1="0" y1="640" x2="0" y2="1000"><stop offset="0" style="stop-color:var(--floor-back)" /><stop offset="1" style="stop-color:var(--floor-front)" /></linearGradient>
    <linearGradient id="g-sofa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c8b7c" /><stop offset="1" stop-color="#46614f" /></linearGradient>
    <linearGradient id="g-seat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a9a8a" /><stop offset=".55" stop-color="#5b7869" /><stop offset="1" stop-color="#4b6657" /></linearGradient>
    <linearGradient id="g-curtain" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f6efe4" /><stop offset=".18" stop-color="#e6dccd" /><stop offset=".34" stop-color="#f8f2e9" /><stop offset=".52" stop-color="#e2d6c6" />
      <stop offset=".7" stop-color="#f6efe5" /><stop offset=".86" stop-color="#e5dacb" /><stop offset="1" stop-color="#f3ebdf" />
    </linearGradient>
    <linearGradient id="g-pot" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9cbb6" /><stop offset=".45" stop-color="#f1e8db" /><stop offset="1" stop-color="#c7b7a0" /></linearGradient>
    <linearGradient id="g-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6a49" /><stop offset="1" stop-color="#6e4630" /></linearGradient>
    <linearGradient id="g-beam" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#fff6dc" stop-opacity=".8" /><stop offset="1" stop-color="#fff6dc" stop-opacity="0" /></linearGradient>
    <radialGradient id="g-patch"><stop offset="0" stop-color="#fff4d6" stop-opacity=".95" /><stop offset=".7" stop-color="#ffeec6" stop-opacity=".55" /><stop offset="1" stop-color="#ffeec6" stop-opacity="0" /></radialGradient>
    <radialGradient id="g-lamp"><stop offset="0" stop-color="#ffd59a" stop-opacity=".9" /><stop offset=".35" stop-color="#ffbf73" stop-opacity=".35" /><stop offset="1" stop-color="#ffb060" stop-opacity="0" /></radialGradient>
    <radialGradient id="g-winglow"><stop offset="0" stop-color="#fff8ea" stop-opacity=".85" /><stop offset="1" stop-color="#fff8ea" stop-opacity="0" /></radialGradient>
    <radialGradient id="g-moonglow"><stop offset="0" stop-color="#c9d6ff" stop-opacity=".7" /><stop offset="1" stop-color="#c9d6ff" stop-opacity="0" /></radialGradient>
    <radialGradient id="g-sun"><stop offset="0" stop-color="#fff7d9" /><stop offset=".3" stop-color="#ffe7a6" stop-opacity=".8" /><stop offset="1" stop-color="#ffd47a" stop-opacity="0" /></radialGradient>
    <radialGradient id="g-contact"><stop offset="0" stop-color="#1a1210" stop-opacity=".45" /><stop offset="1" stop-color="#1a1210" stop-opacity="0" /></radialGradient>
    <linearGradient id="g-fur" gradientUnits="userSpaceOnUse" x1="0" y1="-170" x2="0" y2="0">
      <stop offset="0" style="stop-color:var(--fur1)" /><stop offset=".38" style="stop-color:var(--fur2)" /><stop offset="1" style="stop-color:var(--fur3)" />
    </linearGradient>
    <linearGradient id="g-head" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--head1)" /><stop offset=".5" style="stop-color:var(--head2)" /><stop offset="1" style="stop-color:var(--head3)" /></linearGradient>
    <radialGradient id="g-iris" cx=".5" cy=".55" r=".55"><stop offset="0" style="stop-color:var(--iris1)" /><stop offset=".45" style="stop-color:var(--iris2)" /><stop offset=".85" style="stop-color:var(--iris3)" /><stop offset="1" style="stop-color:var(--iris4)" /></radialGradient>
    <filter id="f-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" /></filter>
    <filter id="f-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16" /></filter>
    <filter id="f-grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" /><feColorMatrix values="0 0 0 0 .2  0 0 0 0 .15  0 0 0 0 .1  0 0 0 .55 0" /></filter>
    <filter id="f-woodgrain"><feTurbulence type="fractalNoise" baseFrequency=".003 .09" numOctaves="3" seed="9" /><feColorMatrix values="0 0 0 0 .18  0 0 0 0 .1  0 0 0 0 .05  0 0 0 1.1 -.35" /></filter>
    <clipPath id="clip-glass"><path d="M440 470 V250 A150 150 0 0 1 740 250 V470 Z" /></clipPath>
    <clipPath id="clip-floor"><rect x="-400" y="640" width="2400" height="860" /></clipPath>
  </defs>

  <!-- outside -->
  <g clip-path="url(#clip-glass)">
    <rect x="400" y="80" width="380" height="400" fill="url(#g-sky)" />
    <g class="stars">${[[470, 150], [520, 120], [560, 190], [640, 140], [700, 180], [610, 230], [480, 240], [690, 260], [540, 280], [730, 220], [600, 110]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.3 : 2}" style="animation-delay:${-i * 0.7}s" />`).join('')}</g>
    <g id="sun"><circle r="80" fill="url(#g-sun)" class="sun-glow" /><circle r="22" class="sun-disc" /></g>
    <g id="moon"><circle r="60" fill="url(#g-moonglow)" /><circle r="18" fill="#f4efdc" /><circle cx="-6" cy="-4" r="4" fill="#e2dbc3" /><circle cx="6" cy="6" r="2.6" fill="#e2dbc3" /></g>
    <g class="clouds">
      <g class="cloud c1"><ellipse cx="0" cy="0" rx="46" ry="14" /><ellipse cx="-18" cy="-10" rx="22" ry="14" /><ellipse cx="14" cy="-14" rx="26" ry="17" /></g>
      <g class="cloud c2"><ellipse cx="0" cy="0" rx="34" ry="10" /><ellipse cx="10" cy="-9" rx="20" ry="12" /></g>
    </g>
    <path class="far" d="M400 470 V412 H428 V384 H452 V398 H478 V352 H498 V340 H514 V352 H530 V402 H556 V374 H586 V362 Q598 330 610 362 V374 H640 V392 H658 V346 H688 V330 H700 V346 H720 V386 H748 V402 H780 V470 Z" />
    <g class="city-lights">${[[484, 362], [490, 380], [484, 400], [664, 356], [676, 370], [664, 390], [676, 410], [566, 390], [576, 406], [700, 360], [704, 380], [440, 420], [622, 400]].map(([x, y]) => `<rect x="${x}" y="${y}" width="5" height="6" rx="1" />`).join('')}</g>
    <g class="trees">
      <g class="tree-l"><circle cx="452" cy="430" r="48" /><circle cx="500" cy="418" r="40" /><circle cx="530" cy="452" r="36" /><circle cx="420" cy="462" r="40" />
        <g class="blooms">${[[440, 412], [470, 398], [502, 404], [520, 436], [458, 440], [488, 430], [430, 444]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" />`).join('')}</g></g>
      <g class="tree-r"><circle cx="736" cy="440" r="44" /><circle cx="694" cy="458" r="32" /><circle cx="760" cy="470" r="30" /></g>
    </g>
    <g id="birds"></g>
    <path d="M440 470 L560 250 L610 250 L490 470 Z" fill="#fff" opacity=".07" />
  </g>

  <!-- wall -->
  <path fill="url(#g-wall)" fill-rule="evenodd" d="M-400 0 H2000 V640 H-400 Z M440 470 V250 A150 150 0 0 1 740 250 V470 Z" />
  <rect x="-400" y="0" width="2400" height="640" filter="url(#f-grain)" opacity=".06" style="pointer-events:none" />
  <rect x="-400" y="504" width="2400" height="136" fill="url(#g-wains)" />
  <path d="${panels()}" fill="none" class="panel-line" />
  <rect x="-400" y="498" width="2400" height="12" class="trim" /><rect x="-400" y="510" width="2400" height="3" fill="#000" opacity=".06" />

  <!-- window -->
  <path class="trim" fill-rule="evenodd" d="M418 490 V250 A172 172 0 0 1 762 250 V490 Z M440 470 V250 A150 150 0 0 1 740 250 V470 Z" />
  <path d="M440 470 V250 A150 150 0 0 1 740 250 V470" fill="none" stroke="#000" stroke-opacity=".08" stroke-width="3" />
  <g class="mullions"><path d="M590 100 V470 M440 330 H740 M440 250 H740 M590 250 L484 144 M590 250 L696 144" /></g>
  <rect x="398" y="466" width="384" height="16" rx="3" class="trim" /><rect x="398" y="466" width="384" height="4" rx="2" fill="#fff" opacity=".35" />
  <rect x="404" y="482" width="372" height="10" fill="#000" opacity=".07" />
  <path d="M356 76 H824" stroke="#b8955a" stroke-width="4" stroke-linecap="round" /><circle cx="352" cy="76" r="7" fill="#b8955a" /><circle cx="828" cy="76" r="7" fill="#b8955a" />
  <g class="curtain l"><path d="M366 80 H438 C432 260 446 420 456 610 H348 C356 420 370 260 366 80 Z" fill="url(#g-curtain)" opacity=".93" /></g>
  <g class="curtain r"><path d="M814 80 H742 C748 260 734 420 724 610 H832 C824 420 810 260 814 80 Z" fill="url(#g-curtain)" opacity=".93" /></g>

  <!-- wall art, clock, shelf -->
  <g class="frame">
    <rect x="128" y="150" width="168" height="214" rx="3" fill="#2f2825" /><rect x="138" y="160" width="148" height="194" fill="#f5efe4" />
    <rect x="156" y="178" width="112" height="158" fill="#efe2cf" /><path d="M172 336 V262 A40 40 0 0 1 252 262 V336 Z" fill="#c98d6b" />
    <circle cx="232" cy="222" r="16" fill="#e2b45a" /><path d="M156 336 Q196 300 268 318 V336 Z" fill="#7f9781" />
  </g>
  <g class="frame">
    <rect x="34" y="232" width="74" height="96" rx="2" fill="#2f2825" /><rect x="40" y="238" width="62" height="84" fill="#f5efe4" />
    <path d="M71 312 C71 290 60 280 52 270 M71 300 C71 284 82 276 90 266 M71 290 C66 278 70 264 72 254" stroke="#5f7d64" stroke-width="2" fill="none" stroke-linecap="round" />
  </g>
  <g class="clock">
    <circle cx="900" cy="200" r="44" fill="#2e2927" /><circle cx="900" cy="200" r="38" fill="#f7f2ea" />
    ${Array.from({ length: 12 }, (_, i) => `<rect x="898.8" y="166" width="2.4" height="${i % 3 ? 4 : 7}" fill="#2e2927" transform="rotate(${i * 30} 900 200)" />`).join('')}
    <rect id="clock-h" x="898" y="180" width="4" height="22" rx="2" fill="#2e2927" /><rect id="clock-m" x="899" y="170" width="2.4" height="32" rx="1.2" fill="#2e2927" />
    <circle cx="900" cy="200" r="3" fill="#c0614b" />
  </g>
  <g class="shelf">
    <rect x="1104" y="300" width="332" height="10" rx="2" fill="url(#g-wood)" /><rect x="1110" y="310" width="320" height="6" fill="#000" opacity=".08" />
    ${books()}
    <path d="M1300 300 C1290 280 1292 262 1306 252 C1320 262 1322 280 1312 300 Z" fill="#c4a07e" /><path d="M1306 252 C1302 230 1290 214 1278 206 M1306 252 C1312 228 1326 218 1340 214" stroke="#6f8f6a" stroke-width="2" fill="none" />
    <circle cx="1278" cy="206" r="5" fill="#d98b75" /><circle cx="1340" cy="214" r="4" fill="#e2b45a" />
    <g class="pothos"><path d="M1414 300 C1420 330 1410 360 1418 392 C1424 414 1416 432 1420 450" stroke="#4d7a55" stroke-width="2.5" fill="none" />
      ${[[1416, 318, -30], [1414, 344, 30], [1418, 370, -25], [1420, 398, 35], [1418, 424, -30], [1420, 446, 20]].map(([x, y, r]) => `<ellipse cx="${x + (r > 0 ? 7 : -7)}" cy="${y}" rx="9" ry="6" fill="#5c9466" transform="rotate(${r} ${x} ${y})" />`).join('')}
      <rect x="1398" y="282" width="34" height="18" rx="3" fill="#e8ddcc" /></g>
  </g>

  <!-- floor -->
  <rect x="-400" y="640" width="2400" height="860" fill="url(#g-floor)" />
  <rect x="-400" y="640" width="2400" height="860" filter="url(#f-woodgrain)" opacity=".5" style="mix-blend-mode:multiply" />
  <path d="${seams()}" class="seams" clip-path="url(#clip-floor)" />
  <rect x="-400" y="624" width="2400" height="22" class="trim" /><rect x="-400" y="644" width="2400" height="4" fill="#000" opacity=".12" />
  <ellipse cx="600" cy="700" rx="260" ry="40" fill="url(#g-winglow)" class="floor-sheen" />

  <!-- sunbeam -->
  <g class="beam">
    <path d="M446 170 L734 170 L1050 860 L690 860 Z" fill="url(#g-beam)" filter="url(#f-blur)" opacity=".35" />
    <path d="M622 692 L884 692 L1010 858 L706 858 Z" fill="url(#g-patch)" filter="url(#f-soft)" />
    <path d="M753 692 L858 858 M664 760 L948 760" stroke="#6b4a33" stroke-width="7" opacity=".16" filter="url(#f-soft)" />
    <g class="motes">${Array.from({ length: 14 }, (_, i) => `<circle cx="${560 + (i * 97) % 380}" cy="${300 + (i * 61) % 420}" r="${1 + (i % 3) * 0.6}" style="animation-delay:${-i * 1.3}s" />`).join('')}</g>
  </g>
  <g class="moonbeam"><path d="M632 694 L878 694 L990 856 L716 856 Z" fill="#b9c8ff" opacity=".22" filter="url(#f-soft)" /></g>

  <!-- rug -->
  <g class="rug">
    <ellipse cx="820" cy="800" rx="520" ry="92" fill="url(#g-contact)" opacity=".5" />
    <ellipse cx="820" cy="792" rx="506" ry="86" fill="#c7a487" />
    <ellipse cx="820" cy="790" rx="482" ry="76" fill="#e9dccb" stroke="#9c6a4e" stroke-width="3" />
    <ellipse cx="820" cy="790" rx="400" ry="60" fill="none" stroke="#c48a69" stroke-width="2" stroke-dasharray="14 10" />
    <ellipse cx="820" cy="790" rx="300" ry="44" fill="none" stroke="#a9b8a3" stroke-width="5" />
    <ellipse cx="820" cy="790" rx="150" ry="21" fill="#dcc0a6" />
  </g>

  <!-- monstera -->
  <g class="monstera">
    <ellipse cx="890" cy="652" rx="70" ry="10" fill="url(#g-contact)" />
    <g class="sway">
      <path d="M888 570 C870 520 840 470 818 430 M890 570 C892 500 900 440 910 380 M892 570 C920 520 952 486 990 456 M889 570 C860 540 830 520 800 512" stroke="#3f6b48" stroke-width="5" fill="none" stroke-linecap="round" />
      ${leaf(818, 440, -38, 0.72, true)}${leaf(990, 462, 46, 0.66, true)}${leaf(910, 392, 6, 0.8, false)}${leaf(804, 516, -70, 0.52, false)}${leaf(960, 520, 64, 0.5, false)}
    </g>
    <path d="M846 566 H934 L922 650 H858 Z" fill="url(#g-pot)" /><rect x="842" y="560" width="96" height="12" rx="4" fill="#e8ddcc" />
    <path d="M852 600 H928" stroke="#c98d6b" stroke-width="6" />
  </g>

  <!-- sofa -->
  <g class="sofa">
    <ellipse cx="1280" cy="712" rx="290" ry="22" fill="url(#g-contact)" />
    <path d="M1096 672 L1100 712 H1110 L1114 672 Z M1450 672 L1454 712 H1464 L1468 672 Z" fill="#5a3a28" />
    <rect x="1074" y="420" width="412" height="190" rx="42" fill="url(#g-sofa)" />
    <path d="M1100 432 Q1280 418 1460 432" stroke="#88a596" stroke-width="3" fill="none" opacity=".6" />
    <rect x="1094" y="544" width="194" height="70" rx="20" fill="url(#g-seat)" /><rect x="1282" y="544" width="194" height="70" rx="20" fill="url(#g-seat)" />
    <rect x="1066" y="598" width="428" height="76" rx="16" fill="#46614f" /><rect x="1066" y="598" width="428" height="10" rx="5" fill="#5f7d6d" />
    <rect x="1030" y="496" width="78" height="180" rx="32" fill="url(#g-sofa)" /><rect x="1452" y="496" width="78" height="180" rx="32" fill="url(#g-sofa)" />
    <path d="M1040 510 Q1069 498 1098 510 M1462 510 Q1491 498 1520 510" stroke="#8eab9b" stroke-width="3" fill="none" opacity=".7" />
    <g transform="rotate(-9 1196 512)"><rect x="1140" y="466" width="112" height="92" rx="26" fill="#d9a441" /><path d="M1150 512 Q1196 500 1242 512" stroke="#b9862c" stroke-width="2" fill="none" /><circle cx="1196" cy="512" r="4" fill="#b9862c" /></g>
    <g transform="rotate(10 1416 520)"><rect x="1374" y="480" width="88" height="80" rx="24" fill="#c98b84" /><path d="M1384 520 Q1418 510 1452 520" stroke="#a96f69" stroke-width="2" fill="none" /></g>
    <path d="M1452 500 C1476 488 1514 490 1532 506 L1536 640 C1516 650 1484 650 1462 640 Z" fill="#efe6d8" />
    <path d="M1466 512 V640 M1480 506 V646 M1494 504 V648 M1508 504 V648 M1522 506 V644" stroke="#d9cdbb" stroke-width="3" />
  </g>

  <!-- lamp -->
  <g class="lamp">
    <ellipse cx="1584" cy="712" rx="40" ry="8" fill="#2f2a28" />
    <path d="M1584 712 V300 Q1584 222 1500 230 Q1446 236 1424 302" stroke="#b89356" stroke-width="6" fill="none" stroke-linecap="round" />
    <path d="M1380 334 Q1424 272 1468 334 Z" fill="#c9a35c" /><path d="M1380 334 Q1424 324 1468 334" stroke="#9c7b40" stroke-width="2" fill="none" />
    <ellipse class="bulb" cx="1424" cy="334" rx="24" ry="5" fill="#fff1c8" />
    <path class="cone" d="M1384 336 L1468 336 L1620 720 L1220 720 Z" fill="#ffd28a" opacity=".12" filter="url(#f-blur)" />
  </g>

  <!-- basket, bed, bowls -->
  <g class="basket">
    <ellipse cx="520" cy="704" rx="58" ry="9" fill="url(#g-contact)" />
    <circle cx="500" cy="652" r="20" fill="#c98b84" /><circle cx="536" cy="650" r="17" fill="#d9a441" />
    <path d="M492 640 Q500 652 508 664 M528 638 Q536 650 544 662" stroke="#00000022" stroke-width="2" fill="none" />
    <path d="M544 640 L566 604 M550 642 L578 610" stroke="#8a6a4a" stroke-width="3" stroke-linecap="round" />
    <path d="M470 660 H570 L560 702 H480 Z" fill="#b48a5e" />
    <path d="M474 672 H566 M477 684 H563 M480 696 H560" stroke="#8e6a44" stroke-width="2" />
    <path d="M490 660 V702 M510 660 V702 M530 660 V702 M550 660 V702" stroke="#9c7650" stroke-width="2" opacity=".6" />
  </g>
  <g class="bed">
    <ellipse cx="300" cy="812" rx="118" ry="20" fill="url(#g-contact)" />
    <ellipse cx="300" cy="794" rx="100" ry="34" fill="#9c6f6b" />
    <ellipse cx="300" cy="786" rx="98" ry="32" fill="#c08d87" />
    <path d="M206 782 Q300 744 394 782" stroke="#d8aaa3" stroke-width="5" fill="none" opacity=".7" />
    <ellipse cx="300" cy="790" rx="74" ry="21" fill="#7f5552" />
    <ellipse cx="300" cy="794" rx="68" ry="16" fill="#efe3d6" />
    <ellipse cx="290" cy="791" rx="40" ry="8" fill="#f8f0e6" />
  </g>
  <g class="bowls">
    <ellipse cx="150" cy="842" rx="52" ry="10" fill="url(#g-contact)" />
    <path d="M110 828 Q114 852 150 852 Q186 852 190 828 Z" fill="#f2ede6" /><path d="M113 838 Q150 848 187 838" stroke="#33466a" stroke-width="5" fill="none" />
    <ellipse cx="150" cy="828" rx="40" ry="9" fill="#e6dfd5" /><ellipse cx="150" cy="829" rx="32" ry="6" fill="#cfc6ba" />
    <ellipse cx="62" cy="852" rx="40" ry="8" fill="url(#g-contact)" />
    <path d="M32 840 Q35 860 62 860 Q89 860 92 840 Z" fill="#f2ede6" /><ellipse cx="62" cy="840" rx="30" ry="7" fill="#e6dfd5" /><ellipse cx="62" cy="841" rx="24" ry="4.6" fill="#9cc3d9" />
  </g>

  <!-- extra room for wide screens -->
  <g class="sideboard"><rect x="-330" y="520" width="280" height="128" rx="6" fill="url(#g-wood)" /><path d="M-190 530 V640" stroke="#4e3222" stroke-width="2" />
    <rect x="-300" y="490" width="110" height="30" rx="4" fill="#2f2a28" /><circle cx="-245" cy="505" r="11" fill="#151313" /><circle cx="-245" cy="505" r="3" fill="#c98b84" /></g>
  <g class="tall-plant"><path d="M1700 648 L1712 560 H1788 L1800 648 Z" fill="url(#g-pot)" />
    ${leaf(1730, 566, -20, 0.6, true)}${leaf(1770, 560, 20, 0.66, false)}${leaf(1750, 500, 0, 0.5, true)}</g>

  <!-- props and the cat, sorted by depth each frame -->
  <g id="props-back"></g>
  <g id="cat-layer" class="cat-layer"></g>
  <g id="props-front">
    <path id="bed-front" d="M200 788 Q202 828 300 828 Q398 828 400 788 Q392 812 300 812 Q208 812 200 788 Z" fill="#b5827c" opacity="0" />
  </g>
  <g id="toys"></g>

  <!-- light -->
  <rect class="tint" x="-400" y="0" width="2400" height="1500" />
  <rect class="warm" x="-400" y="0" width="2400" height="1500" />
  <ellipse class="winglow" cx="590" cy="320" rx="380" ry="360" fill="url(#g-winglow)" />
  <circle class="lampglow" cx="1424" cy="350" r="560" fill="url(#g-lamp)" />
  <g id="laser"></g>
</svg>`;
}
