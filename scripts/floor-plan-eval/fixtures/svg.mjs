// Renders a fixture plan definition (plans.mjs) to SVG. Units in the
// definitions are feet; one foot = SCALE px. Doors are drawn only where a
// definition lists them, so ground-truth adjacency is exact.
export const SCALE = 18;
const MARGIN = 70;
const TITLE_H = 70;
const CAPTION_H = 60;
const GAP = 90;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sharedWall(a, b) {
  const eps = 0.01;
  const yOverlap = [Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h)];
  const xOverlap = [Math.max(a.x, b.x), Math.min(a.x + a.w, b.x + b.w)];
  if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) {
    const x = Math.abs(a.x + a.w - b.x) < eps ? b.x : a.x;
    if (yOverlap[1] - yOverlap[0] >= 3) return { orientation: 'v', x, from: yOverlap[0], to: yOverlap[1] };
  }
  if (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) {
    const y = Math.abs(a.y + a.h - b.y) < eps ? b.y : a.y;
    if (xOverlap[1] - xOverlap[0] >= 3) return { orientation: 'h', y, from: xOverlap[0], to: xOverlap[1] };
  }
  return null;
}

function door(wall, ox, oy) {
  const s = SCALE;
  const width = 2.8;
  const mid = (wall.from + wall.to) / 2;
  const a = mid - width / 2;
  if (wall.orientation === 'v') {
    const x = ox + wall.x * s; const y1 = oy + a * s; const y2 = oy + (a + width) * s;
    return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#fff" stroke-width="6"/>`
      + `<line x1="${x}" y1="${y1}" x2="${x + width * s}" y2="${y1}" stroke="#222" stroke-width="1.5"/>`
      + `<path d="M ${x + width * s} ${y1} A ${width * s} ${width * s} 0 0 1 ${x} ${y2}" fill="none" stroke="#222" stroke-width="1" stroke-dasharray="3 2"/>`;
  }
  const y = oy + wall.y * s; const x1 = ox + a * s; const x2 = ox + (a + width) * s;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#fff" stroke-width="6"/>`
    + `<line x1="${x1}" y1="${y}" x2="${x1}" y2="${y + width * s}" stroke="#222" stroke-width="1.5"/>`
    + `<path d="M ${x1} ${y + width * s} A ${width * s} ${width * s} 0 0 0 ${x2} ${y}" fill="none" stroke="#222" stroke-width="1" stroke-dasharray="3 2"/>`;
}

// Fixture symbols, positioned in feet relative to the room's top-left corner.
function symbol(kind, x, y) {
  const s = SCALE;
  const X = (v) => x + v * s;
  const Y = (v) => y + v * s;
  const st = 'fill="none" stroke="#333" stroke-width="1.3"';
  switch (kind) {
    case 'toilet': return `<rect x="${X(0)}" y="${Y(0)}" width="${1.8 * s}" height="${0.7 * s}" ${st}/><ellipse cx="${X(0.9)}" cy="${Y(1.6)}" rx="${0.75 * s}" ry="${0.95 * s}" ${st}/>`;
    case 'tub': return `<rect x="${X(0)}" y="${Y(0)}" width="${5 * s}" height="${2.5 * s}" ${st}/><rect x="${X(0.3)}" y="${Y(0.3)}" width="${4.4 * s}" height="${1.9 * s}" rx="${0.8 * s}" ${st}/>`;
    case 'shower': return `<rect x="${X(0)}" y="${Y(0)}" width="${3 * s}" height="${3 * s}" ${st}/><line x1="${X(0)}" y1="${Y(0)}" x2="${X(3)}" y2="${Y(3)}" stroke="#333"/><line x1="${X(3)}" y1="${Y(0)}" x2="${X(0)}" y2="${Y(3)}" stroke="#333"/>`;
    case 'sink': return `<rect x="${X(0)}" y="${Y(0)}" width="${2.2 * s}" height="${1.7 * s}" ${st}/><ellipse cx="${X(1.1)}" cy="${Y(0.85)}" rx="${0.7 * s}" ry="${0.5 * s}" ${st}/>`;
    case 'double_sink': return `<rect x="${X(0)}" y="${Y(0)}" width="${6 * s}" height="${1.8 * s}" ${st}/><ellipse cx="${X(1.5)}" cy="${Y(0.9)}" rx="${0.7 * s}" ry="${0.5 * s}" ${st}/><ellipse cx="${X(4.5)}" cy="${Y(0.9)}" rx="${0.7 * s}" ry="${0.5 * s}" ${st}/>`;
    case 'wd': return `<rect x="${X(0)}" y="${Y(0)}" width="${2.6 * s}" height="${2.6 * s}" ${st}/><circle cx="${X(1.3)}" cy="${Y(1.3)}" r="${1 * s}" ${st}/><rect x="${X(2.8)}" y="${Y(0)}" width="${2.6 * s}" height="${2.6 * s}" ${st}/><circle cx="${X(4.1)}" cy="${Y(1.3)}" r="${1 * s}" ${st}/>`;
    case 'range': return `<rect x="${X(0)}" y="${Y(0)}" width="${2.6 * s}" height="${2.2 * s}" ${st}/>${[[0.65, 0.55], [1.95, 0.55], [0.65, 1.65], [1.95, 1.65]].map(([a, b]) => `<circle cx="${X(a)}" cy="${Y(b)}" r="${0.35 * s}" ${st}/>`).join('')}`;
    case 'island': return `<rect x="${X(0)}" y="${Y(0)}" width="${6 * s}" height="${3 * s}" ${st}/>`;
    case 'counter': return `<rect x="${X(0)}" y="${Y(0)}" width="${10 * s}" height="${2 * s}" ${st}/>`;
    case 'bed': return `<rect x="${X(0)}" y="${Y(0)}" width="${5 * s}" height="${6.6 * s}" ${st}/><rect x="${X(0.4)}" y="${Y(0.3)}" width="${1.8 * s}" height="${1 * s}" ${st}/><rect x="${X(2.8)}" y="${Y(0.3)}" width="${1.8 * s}" height="${1 * s}" ${st}/>`;
    case 'desk': return `<rect x="${X(0)}" y="${Y(0)}" width="${4.5 * s}" height="${2 * s}" ${st}/><circle cx="${X(2.25)}" cy="${Y(3)}" r="${0.8 * s}" ${st}/>`;
    case 'table': return `<rect x="${X(0)}" y="${Y(0)}" width="${6 * s}" height="${3.5 * s}" rx="${0.4 * s}" ${st}/>`;
    case 'sofa': return `<rect x="${X(0)}" y="${Y(0)}" width="${7 * s}" height="${3 * s}" rx="${0.5 * s}" ${st}/>`;
    case 'car': return `<rect x="${X(0)}" y="${Y(0)}" width="${6.5 * s}" height="${15 * s}" rx="${1.2 * s}" fill="none" stroke="#999" stroke-width="1.2" stroke-dasharray="6 4"/>`;
    case 'fireplace': return `<rect x="${X(0)}" y="${Y(0)}" width="${5 * s}" height="${1.6 * s}" fill="url(#hatch)" stroke="#333" stroke-width="1.3"/>`;
    case 'stairs': return `<rect x="${X(0)}" y="${Y(0)}" width="${3.5 * s}" height="${10 * s}" ${st}/>${Array.from({ length: 10 }, (_, i) => `<line x1="${X(0)}" y1="${Y(i)}" x2="${X(3.5)}" y2="${Y(i)}" stroke="#333" stroke-width="1"/>`).join('')}`;
    case 'rod': return `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(5)}" y2="${Y(0)}" stroke="#333" stroke-width="1.3" stroke-dasharray="2 3"/>`;
    default: throw new Error(`unknown symbol ${kind}`);
  }
}

function drawingSize(drawing) {
  const w = Math.max(...drawing.rooms.map((r) => r.x + r.w));
  const h = Math.max(...drawing.rooms.map((r) => r.y + r.h));
  return { w, h };
}

// Returns { svg, width, height }.
export function renderPlanSvg(plan) {
  const sizes = plan.drawings.map(drawingSize);
  const width = MARGIN * 2 + sizes.reduce((sum, d) => sum + d.w * SCALE, 0) + GAP * (plan.drawings.length - 1);
  const notesH = (plan.notes || []).reduce((sum, n) => sum + n.lines.length * (n.size || 16) * 1.5 + 16, 0);
  const height = MARGIN + TITLE_H + Math.max(...sizes.map((d) => d.h)) * SCALE + CAPTION_H + notesH + MARGIN / 2;
  const parts = [];
  parts.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#555" stroke-width="1.5"/></pattern></defs>`);
  parts.push(`<rect width="${width}" height="${height}" fill="#fff"/>`);
  if (plan.title) parts.push(`<text x="${MARGIN}" y="${MARGIN + 18}" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#111">${esc(plan.title)}</text>`);
  if (plan.subtitle) parts.push(`<text x="${MARGIN}" y="${MARGIN + 46}" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="#444">${esc(plan.subtitle)}</text>`);

  let ox = MARGIN;
  const oy = MARGIN + TITLE_H;
  plan.drawings.forEach((drawing, i) => {
    const byId = new Map(drawing.rooms.map((room) => [room.id, room]));
    for (const room of drawing.rooms) {
      const dash = room.dashed ? ' stroke-dasharray="10 6"' : '';
      parts.push(`<rect x="${ox + room.x * SCALE}" y="${oy + room.y * SCALE}" width="${room.w * SCALE}" height="${room.h * SCALE}" fill="#fff" stroke="#111" stroke-width="${room.dashed ? 2 : 4}"${dash}/>`);
    }
    for (const [a, b] of drawing.doors || []) {
      const wall = sharedWall(byId.get(a), byId.get(b));
      if (!wall) throw new Error(`${plan.id}: no shared wall ≥ 3 ft between ${a} and ${b}`);
      parts.push(door(wall, ox, oy));
    }
    for (const room of drawing.rooms) {
      for (const sym of room.symbols || []) parts.push(symbol(sym.kind, ox + (room.x + sym.at[0]) * SCALE, oy + (room.y + sym.at[1]) * SCALE));
      const lines = room.text || [];
      const cx = ox + (room.x + (room.textAt?.[0] ?? room.w / 2)) * SCALE;
      let cy = oy + (room.y + (room.textAt?.[1] ?? room.h / 2)) * SCALE - (lines.length - 1) * 10;
      for (const line of lines) {
        const small = line.small;
        const text = typeof line === 'string' ? line : line.t;
        parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${small ? 12 : (room.fontSize || 15)}" font-weight="${small ? 400 : 700}" fill="#111">${esc(text)}</text>`);
        cy += small ? 16 : 20;
      }
    }
    for (const t of drawing.texts || []) {
      parts.push(`<text x="${ox + t.at[0] * SCALE}" y="${oy + t.at[1] * SCALE}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${t.size || 13}" font-weight="${t.bold ? 700 : 400}" fill="#111">${esc(t.t)}</text>`);
    }
    const size = sizes[i];
    if (drawing.caption) {
      parts.push(`<text x="${ox + (size.w * SCALE) / 2}" y="${oy + size.h * SCALE + 42}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" fill="#111" letter-spacing="2">${esc(drawing.caption)}</text>`);
    }
    ox += size.w * SCALE + GAP;
  });

  let ny = oy + Math.max(...sizes.map((d) => d.h)) * SCALE + CAPTION_H + 20;
  for (const note of plan.notes || []) {
    for (const line of note.lines) {
      parts.push(`<text x="${MARGIN}" y="${ny}" font-family="Arial, Helvetica, sans-serif" font-size="${note.size || 16}" font-weight="${note.bold ? 700 : 400}" font-style="${note.italic ? 'italic' : 'normal'}" fill="${note.color || '#333'}">${esc(line)}</text>`);
      ny += (note.size || 16) * 1.5;
    }
    ny += 16;
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">${parts.join('')}</svg>`, width: Math.round(width), height: Math.round(height) };
}
