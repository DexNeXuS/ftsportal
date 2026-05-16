/**
 * XLS / XLSX / CSV / HTML-XLS A&D parser.
 *
 * Important:
 * The First A&D ".xls" exports in the supplied examples are NOT real binary
 * Excel workbooks. They are HTML tables saved with an .xls extension:
 *   <HTML><BODY><TABLE>...</TABLE></BODY></HTML>
 *
 * SheetJS usually handles real .xlsx and real BIFF .xls files well, but these
 * HTML-XLS files are more reliably parsed by reading the HTML table directly.
 */

(function (g) {
  g.AD = g.AD || {};

  function cleanText(value = '') {
    return String(value)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }

  function decodeBuffer(buffer, encoding = 'utf-8') {
    return new TextDecoder(encoding).decode(buffer);
  }

  function looksLikeHtml(text = '') {
    const sample = String(text).slice(0, 2000).toLowerCase();
    return sample.includes('<html') || sample.includes('<table') || sample.includes('<tr');
  }

  function cellTextFromElement(cell) {
    // Preserve <br> as new lines so calling-pattern stops stay split.
    const clone = cell.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));

    // Nested tables inside Calling Pattern cells contain one TR per stop. Add a
    // newline after each nested row, otherwise stops become glued together.
    clone.querySelectorAll('tr').forEach((tr) => tr.appendChild(document.createTextNode('\n')));

    const text = clone.textContent || '';
    return cleanText(text)
      .replace(/\n{2,}/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function htmlTableToGrid(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const tables = [...doc.querySelectorAll('table')];
    const grid = [];

    // The export normally has a small title table, then the real A&D table.
    // Reading every top-level table preserves the station header and the main
    // A&D rows. Nested calling-pattern tables are ignored here because their
    // text is already captured inside the parent cell.
    const topTables = tables.filter((table) => !table.parentElement.closest('table'));

    for (const table of topTables) {
      for (const tr of [...table.rows]) {
        const row = [];
        for (const cell of [...tr.cells]) {
          const colspan = Number(cell.getAttribute('colspan') || 1);
          const value = cellTextFromElement(cell);
          row.push(value);
          for (let i = 1; i < colspan; i++) row.push('');
        }
        if (row.some(Boolean)) grid.push(row);
      }
    }

    return grid;
  }

  function workbookToGrid(workbook) {
    const XLSX = g.XLSX;
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet && sheet['!ref'];
    if (!ref) return [];

    const range = XLSX.utils.decode_range(ref);
    const grid = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        row.push(cell ? (cell.w != null && cell.w !== '' ? cell.w : cell.v ?? '') : '');
      }
      if (row.some((v) => String(v ?? '').trim() !== '')) grid.push(row);
    }

    return grid;
  }

  function normaliseGridForAD(grid) {
    // HTML-XLS title rows often have colspan=8 and therefore become:
    // ["Huddersfield (HUD) from ...", "", "", ...]
    // The normal parser can detect that. This function mostly keeps rows as-is,
    // but removes totally empty rows and trims cells.
    return (grid || [])
      .map((row) => (row || []).map((cell) => cleanText(cell)))
      .filter((row) => row.some(Boolean));
  }

  async function parseXLSXFile(file) {
    if (!file) throw new Error('No spreadsheet file supplied.');
    const fileName = file.name || '';
    const ext = fileName.split('.').pop().toLowerCase();
    const buffer = await file.arrayBuffer();

    // CSV: parse as real text so quoted multi-line cells survive.
    if (ext === 'csv') {
      const text = decodeBuffer(buffer);
      return g.AD.parseAndNormalise(text, fileName);
    }

    // HTML masquerading as .xls: this is what the supplied First exports are.
    // Check the actual file contents rather than trusting the extension.
    const firstText = decodeBuffer(buffer.slice(0, Math.min(buffer.byteLength, 4096)));
    if (looksLikeHtml(firstText)) {
      const html = decodeBuffer(buffer);
      const grid = normaliseGridForAD(htmlTableToGrid(html));
      const { sheet, rawMovements } = g.AD.parseSheetGrid(grid, fileName);
      if (!sheet) throw new Error('Could not detect station from this HTML/XLS A&D sheet.');
      const movements = rawMovements.map((raw, i) => g.AD.normaliseMovement(raw, sheet, i));
      return { sheet, movements: g.AD.enrichMovements(movements, sheet) };
    }

    // Real .xlsx or binary .xls. SheetJS supports both when loaded in the page.
    const XLSX = g.XLSX;
    if (!XLSX) throw new Error('SheetJS (XLSX) is not loaded. Add xlsx.full.min.js before xlsxParser.js.');

    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: false,
      raw: false,
      dense: false,
    });

    const grid = normaliseGridForAD(workbookToGrid(workbook));
    const { sheet, rawMovements } = g.AD.parseSheetGrid(grid, fileName);
    if (!sheet) throw new Error('Could not detect station from this spreadsheet A&D sheet.');

    const movements = rawMovements.map((raw, i) => g.AD.normaliseMovement(raw, sheet, i));
    return { sheet, movements: g.AD.enrichMovements(movements, sheet) };
  }

  // Friendly aliases so your main app can call one thing for all spreadsheet types.
  g.AD.parseXLSXFile = parseXLSXFile;
  g.AD.parseSpreadsheetFile = parseXLSXFile;
  g.AD.workbookToGrid = workbookToGrid;
  g.AD.htmlTableToGrid = htmlTableToGrid;
})(typeof window !== 'undefined' ? window : globalThis);
