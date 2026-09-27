// Her düzen: kolon/satır sayısı ve hücrelerin grid yerleşimi (row-start / col-start / row-end / col-end).
export interface Layout {
  id: string;
  label: string;
  cols: number;
  rows: number;
  cells: string[];
}

const grid = (id: string, label: string, cols: number, rows: number): Layout => {
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(`${r + 1} / ${c + 1} / ${r + 2} / ${c + 2}`);
  return { id, label, cols, rows, cells };
};

export const LAYOUTS: Layout[] = [
  grid('1', 'Tek', 1, 1),
  grid('2', '2 · yan yana', 2, 1),
  grid('2v', '2 · alt alta', 1, 2),
  { id: '3', label: '3 · 1 büyük + 2', cols: 2, rows: 2, cells: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
  grid('4', '4 · 2×2', 2, 2),
  grid('6', '6 · 3×2', 3, 2),
  grid('8', '8 · 4×2', 4, 2),
];

export const layoutById = (id: string): Layout => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0];

/** Verilen pane sayısını sığdıran en küçük düzen. */
export function layoutFor(count: number, current: Layout): Layout {
  if (count <= current.cells.length) return current;
  return LAYOUTS.find((l) => l.cells.length >= count && l.id !== '2v') ?? LAYOUTS[LAYOUTS.length - 1];
}

/** Toolbar için küçük düzen ikonu. */
export function layoutIcon(l: Layout): string {
  const W = 18, H = 12, g = 1.5;
  const cw = (W - g * (l.cols - 1)) / l.cols;
  const rh = (H - g * (l.rows - 1)) / l.rows;
  const rects = l.cells
    .map((cell) => {
      const [r1, c1, r2, c2] = cell.split('/').map((s) => Number(s.trim()) - 1);
      const x = c1 * (cw + g), y = r1 * (rh + g);
      const w = (c2 - c1) * cw + (c2 - c1 - 1) * g, h = (r2 - r1) * rh + (r2 - r1 - 1) * g;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="1.5"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="currentColor">${rects}</svg>`;
}
