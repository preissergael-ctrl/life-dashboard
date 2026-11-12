'use strict';

/* =========================================================
   Pixel-art icons. Each icon is a 16x16 grid:
   one letter = one pixel, "." = see-through.
   Edit a grid here to redraw an icon.
   ========================================================= */

const PIXEL_COLORS = {
  k: '#2a2a3c', // outline
  w: '#ffffff', // white
  G: '#c3c7d4', // light gray
  g: '#8a8fa3', // gray
  r: '#e5484d', // red
  y: '#ffd23f', // yellow
  Y: '#fff1a6', // pale yellow
  o: '#f59e0b', // orange
  b: '#3b82f6', // blue
  B: '#a5cdfc', // light blue
  n: '#7a4a24', // dark brown
  N: '#c98a4b', // brown
  e: '#22a35a', // green
  E: '#86e0a8', // light green
  p: '#8b5cf6', // purple
  P: '#c9b8fd', // light purple
};

const PIXEL_ART = {
  home: [
    '................',
    '.......kk.......',
    '......krrk......',
    '.....krrrrk.....',
    '....krrrrrrk....',
    '...krrrrrrrrk...',
    '..krrrrrrrrrrk..',
    '.kkkkkkkkkkkkkk.',
    '..kNNNNNNNNNNk..',
    '..kNkkkNNkkkNk..',
    '..kNkBkNNknkNk..',
    '..kNkkkNNknkNk..',
    '..kNNNNNNknkNk..',
    '..kNNNNNNknkNk..',
    '..kkkkkkkkkkkk..',
    '................',
  ],
  check: [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.keeeeeeeeeeeek.',
    '.keeeeeeeeeewek.',
    '.keeeeeeeeewwek.',
    '.keeeeeeeewwwek.',
    '.keeeeeeewwweek.',
    '.kewweeewwweeek.',
    '.kewwwewwweeeek.',
    '.keewwwwweeeeek.',
    '.keeewwweeeeeek.',
    '.keeeeweeeeeeek.',
    '.keeeeeeeeeeeek.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  coin: [
    '................',
    '.....kkkkkk.....',
    '...kkyyyyyykk...',
    '..kyyYYyyyyyyk..',
    '..kyYyykkyyyyk..',
    '.kyyYykkkkyyyok.',
    '.kyyyykkyyyyyok.',
    '.kyyyyykkkyyyok.',
    '.kyyyyyyykkyyok.',
    '.kyyyykkkkyyyok.',
    '..kyyyyykkyyok..',
    '..kyyyyyyyyook..',
    '...kkyyyyookk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ],
  gear: [
    '................',
    '......kkkk......',
    '..kk..kGGk..kk..',
    '..kGkkkGGkkkGk..',
    '..kGGGGGGGGGGk..',
    '...kGGGkkGGGk...',
    '.kkkGGk..kGGkkk.',
    '.kGGGk....kGGGk.',
    '.kGGGk....kGGGk.',
    '.kkkGGk..kGGkkk.',
    '...kGGGkkGGGk...',
    '..kGGGGGGGGGGk..',
    '..kGkkkGGkkkGk..',
    '..kk..kGGk..kk..',
    '......kkkk......',
    '................',
  ],
  burger: [
    '................',
    '................',
    '....kkkkkkkk....',
    '..kkNNNNNNNNkk..',
    '.kNNYNNNNYNNNNk.',
    '.kNNNNNYNNNNNNk.',
    '.kkkkkkkkkkkkkk.',
    '.keeEeeEeeEeeek.',
    '.krrrrrrrrrrrrk.',
    '.knnnnnnnnnnnnk.',
    '.kyyyyyyyyyyyyk.',
    '.kNNNNNNNNNNNNk.',
    '..kkNNNNNNNNkk..',
    '....kkkkkkkk....',
    '................',
    '................',
  ],
  bus: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kyyyyyyyyyyyyk.',
    '.kykkkkkkkkkkyk.',
    '.kykBBkBBkBBkyk.',
    '.kykBBkBBkBBkyk.',
    '.kykkkkkkkkkkyk.',
    '.kyyyyyyyyyyyyk.',
    '.kooooooooooook.',
    '.kwwyyyyyyyywwk.',
    '.kyyyyyyyyyyyyk.',
    '.kkkkkkkkkkkkkk.',
    '..kkk......kkk..',
    '..kgk......kgk..',
    '..kkk......kkk..',
    '................',
  ],
  books: [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..krrrrrrrrrwk..',
    '..krrrrrrrrrwk..',
    '...kkkkkkkkkkkk.',
    '...kbbbbbbbbbwk.',
    '...kbyybbbbbbwk.',
    '...kbbbbbbbbbwk.',
    '.kkkkkkkkkkkkk..',
    '.keeeeeeeeeewk..',
    '.keEEeeeeeeewk..',
    '.keeeeeeeeeewk..',
    '.kkkkkkkkkkkkk..',
    '................',
    '................',
  ],
  controller: [
    '................',
    '................',
    '................',
    '...kkkkkkkkkk...',
    '..kppppppppppk..',
    '.kppppppppppppk.',
    '.kppkppppppeppk.',
    '.kpkkkpppprpbpk.',
    '.kppkppppppyppk.',
    '.kppppppppppppk.',
    '.kppppkkkkppppk.',
    '.kpppk....kpppk.',
    '..kkk......kkk..',
    '................',
    '................',
    '................',
  ],
  bag: [
    '................',
    '......kkkk......',
    '.....k....k.....',
    '.....k....k.....',
    '..kkkkkkkkkkkk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kPppppppppPk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
  receipt: [
    '................',
    '...kkkkkkkkkk...',
    '...kwwwwwwwwk...',
    '...kwGGGGGGwk...',
    '...kwwwwwwwwk...',
    '...kwGGGGwwwk...',
    '...kwwwwwwwwk...',
    '...kwGGGGGwwk...',
    '...kwwwwwwwwk...',
    '...kwwwwwwwwk...',
    '...kwrrrrrrwk...',
    '...kwwwwwwwwk...',
    '...kwwwwwwwwk...',
    '...k.kk.kk.kk...',
    '................',
    '................',
  ],
  firstaid: [
    '................',
    '................',
    '......kkkk......',
    '..kkkkkkkkkkkk..',
    '..kwwwwwwwwwwk..',
    '..kwwwwrrwwwwk..',
    '..kwwwwrrwwwwk..',
    '..kwwrrrrrrwwk..',
    '..kwwrrrrrrwwk..',
    '..kwwwwrrwwwwk..',
    '..kwwwwrrwwwwk..',
    '..kwwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ],
  box: [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kNNNNnnNNNNk..',
    '..kNNNNnnNNNNk..',
    '..kkkkkkkkkkkk..',
    '..kNNNNnnNNNNk..',
    '..kNNNNnnNNNNk..',
    '..kNNNNnnNNNNk..',
    '..kNNNNnnNwwNk..',
    '..kNNNNnnNNNNk..',
    '..kNNNNnnNNNNk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ],
  banknote: [
    '................',
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.keeeeeeeeeeeek.',
    '.keEEEEkkEEEEek.',
    '.keEEEkEEkEEEek.',
    '.keEEEkEEkEEEek.',
    '.keEEEEkkEEEEek.',
    '.keeeeeeeeeeeek.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
    '................',
  ],
  briefcase: [
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....kk..kk.....',
    '..kkkkkkkkkkkk..',
    '..knnnnnnnnnnk..',
    '..kNNNNNNNNNNk..',
    '..kNNNNNNNNNNk..',
    '..kkkkkyykkkkk..',
    '..kNNNNyyNNNNk..',
    '..kNNNNNNNNNNk..',
    '..kNNNNNNNNNNk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
  gift: [
    '................',
    '................',
    '.....kk..kk.....',
    '....krrkkrrk....',
    '.....kkrrkk.....',
    '..kkkkkkkkkkkk..',
    '..kbbbbrrbbbbk..',
    '..kkkkkkkkkkkk..',
    '...kbbbrrbbbk...',
    '...kbbbrrbbbk...',
    '...kbbbrrbbbk...',
    '...kbbbrrbbbk...',
    '...kbbbrrbbbk...',
    '...kkkkkkkkkk...',
    '................',
    '................',
  ],
};

const _pixelCache = {};

/** Returns an <svg> string for a pixel icon. Runs of the same color become one rectangle. */
function pixelIcon(name, size = 24) {
  const key = `${name}@${size}`;
  if (_pixelCache[key]) return _pixelCache[key];
  const rows = PIXEL_ART[name];
  if (!rows) return '';
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (c !== '.') rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${PIXEL_COLORS[c]}"/>`;
      x = end;
    }
  });
  return (_pixelCache[key] =
    `<svg class="px" viewBox="0 0 16 16" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`);
}
