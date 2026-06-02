// Clipboard, CSV/TSV serialization, and PNG report-card composition.
// All functions are pure except those that touch clipboard, DOM, or canvas.
//
// Tables are represented uniformly as { headers: string[], rows: string[][] }.
// First column always treated as the "label" column (sans-serif, left-aligned);
// subsequent columns treated as "value" columns (monospace, right-aligned).

export function tableToTSV(headers, rows) {
  const header = headers.join('\t');
  const body = rows.map(r => r.join('\t')).join('\n');
  return header + '\n' + body;
}

function csvEscape(value) {
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function tableToCSV(headers, rows) {
  const headerLine = headers.map(csvEscape).join(',');
  const body = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  return headerLine + '\n' + body;
}

export async function copyTextToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const PADDING = 32;
const TITLE_H = 44;
const TABLE_ROW_H = 32;
const PLOT_NATIVE_W = 720;
const PLOT_NATIVE_H = 340;
const CELL_PAD_X = 14;
const OUTPUT_SCALE = 1.2;

// Web fonts can't load across the SVG data-URL boundary, so the rasterized
// plot uses OS font fallbacks. The title and table are drawn directly on the
// canvas and use whichever of the listed fonts the OS resolves.
//
// Generalized to any column count. The 2-column case (Metric/Value) and the
// 5-column case (Prior / Posterior / CrI / P-zero / P-MID) both run through
// the same code path.
export function renderReportPNG({ title, headers, rows, plotSvgEl }) {
  const numCols = headers.length;
  const mctx = document.createElement('canvas').getContext('2d');

  // Measure each column: max(header width at small font, max data width at 14px font).
  // First column uses sans-serif data font; other columns use monospace.
  const colTextWidths = new Array(numCols).fill(0);
  mctx.font = '500 10px "IBM Plex Sans", Helvetica, sans-serif';
  for (let c = 0; c < numCols; c++) {
    colTextWidths[c] = Math.max(colTextWidths[c], mctx.measureText(headers[c].toUpperCase()).width);
  }
  for (let c = 0; c < numCols; c++) {
    mctx.font = c === 0
      ? '400 14px "IBM Plex Sans", Helvetica, sans-serif'
      : '500 14px "IBM Plex Mono", "Courier New", monospace';
    for (const row of rows) {
      colTextWidths[c] = Math.max(colTextWidths[c], mctx.measureText(String(row[c] ?? '')).width);
    }
  }
  const colWidths = colTextWidths.map(w => Math.ceil(w + 2 * CELL_PAD_X));
  const tableW = colWidths.reduce((a, b) => a + b, 0);

  mctx.font = '500 26px "Crimson Pro", Georgia, serif';
  const titleW = mctx.measureText(title).width;

  const REPORT_W = Math.ceil((Math.max(tableW, titleW) + 2 * PADDING) * 1.2);
  const plotW = REPORT_W - 2 * PADDING;
  const plotH = Math.round(plotW * (PLOT_NATIVE_H / PLOT_NATIVE_W));

  const rowCount = rows.length + 1;
  const tableH = TABLE_ROW_H * rowCount;
  const REPORT_H = PADDING + TITLE_H + 12 + tableH + 24 + plotH + PADDING;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(REPORT_W * OUTPUT_SCALE);
  canvas.height = Math.round(REPORT_H * OUTPUT_SCALE);
  const ctx = canvas.getContext('2d');
  ctx.scale(OUTPUT_SCALE, OUTPUT_SCALE);

  ctx.fillStyle = '#f8f8fa'; // ea-cool-gray
  ctx.fillRect(0, 0, REPORT_W, REPORT_H);

  ctx.fillStyle = '#20253a'; // ea-ink
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = 'bold 24px "T-Star TW", "JetBrains Mono", monospace';
  ctx.fillText(title, PADDING, PADDING);

  const tableX = Math.round((REPORT_W - tableW) / 2);
  const tableY = PADDING + TITLE_H + 12;

  ctx.strokeStyle = '#d0d0d8'; // ea cool border
  ctx.lineWidth = 1;

  const drawRow = (i, cells, isHeader) => {
    const y = tableY + i * TABLE_ROW_H;
    // Header row: dark navy bg (ea-ink) with white text — matches the on-screen thead pattern.
    ctx.fillStyle = isHeader ? '#20253a' : '#FFFFFF';
    ctx.fillRect(tableX, y, tableW, TABLE_ROW_H);

    let x = tableX;
    for (let c = 0; c < cells.length; c++) {
      const w = colWidths[c];
      ctx.strokeRect(x, y, w, TABLE_ROW_H);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isHeader ? '#FFFFFF' : '#20253a';
      const text = isHeader ? String(cells[c]).toUpperCase() : String(cells[c] ?? '');
      if (c === 0) {
        ctx.textAlign = 'left';
        ctx.font = isHeader
          ? '500 10px "T-Star Pro", "Roboto Condensed", sans-serif'
          : '400 14px "T-Star Pro", "Roboto Condensed", sans-serif';
        ctx.fillText(text, x + CELL_PAD_X, y + TABLE_ROW_H / 2);
      } else {
        ctx.textAlign = 'right';
        ctx.font = isHeader
          ? '500 10px "T-Star Pro", "Roboto Condensed", sans-serif'
          : '500 14px "JetBrains Mono", "Courier New", monospace';
        ctx.fillText(text, x + w - CELL_PAD_X, y + TABLE_ROW_H / 2);
      }
      x += w;
    }
  };

  drawRow(0, headers, true);
  rows.forEach((row, i) => drawRow(i + 1, row, false));

  const plotY = tableY + tableH + 24;

  return new Promise((resolve, reject) => {
    const clone = plotSvgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(PLOT_NATIVE_W));
    clone.setAttribute('height', String(PLOT_NATIVE_H));

    const textScale = Math.max(1, PLOT_NATIVE_W / plotW);
    if (textScale > 1.001) {
      clone.querySelectorAll('text').forEach(t => {
        const size = parseFloat(t.getAttribute('font-size') || '12');
        const newSize = Math.round(size * textScale * 10) / 10;
        t.setAttribute('font-size', String(newSize));
        const y = parseFloat(t.getAttribute('y') || '0');
        const shift = (newSize - size) * 0.7;
        t.setAttribute('y', String(Math.round((y + shift) * 10) / 10));
      });
    }

    const svgString = new XMLSerializer().serializeToString(clone);
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, PADDING, plotY, plotW, plotH);
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('Failed to load plot SVG as image'));
    img.src = dataUrl;
  });
}
