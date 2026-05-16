/**
 * Coordinate-based PDF A&D parser.
 *
 * This is built for the landscape First A&D PDF format where each page is a
 * visual table:
 * Time | A/D | Destination | Operator | Calling Pattern | Coach | TOC | Comments
 *
 * Why this exists:
 * Plain PDF text extraction reads the page in a messy order. This parser reads
 * text positions, rebuilds the table columns, then creates proper movement
 * objects with calling patterns/stoppers.
 */

(function (g) {
  g.AD = g.AD || {};

  const DEFAULT_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function getPDFJS() {
    const pdfjsLib = g.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js is not loaded. Add pdf.js before pdfParser.js.');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER;
    }
    return pdfjsLib;
  }

  function clean(s = '') {
    return String(s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function joinParts(parts) {
    return parts.map(clean).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function isTime(s) {
    return /^\d{1,2}:\d{2}$/.test(clean(s));
  }

  function isMovementRow(row) {
    return isTime(row.time) && /^[AD]$/i.test(clean(row.ad));
  }

  function pushOrAppendCallingLine(lines, text) {
    const s = clean(text);
    if (!s) return;

    // New stop line: 07:25 HUD - Huddersfield,HD1 1JB
    if (/^\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-/i.test(s)) {
      lines.push(s);
      return;
    }

    // Continuation line, usually because long stop names wrap in the PDF.
    if (lines.length) {
      lines[lines.length - 1] = clean(`${lines[lines.length - 1]} ${s}`);
    }
  }

  function parsePDFHeader(fullText, fileName = '') {
    const text = clean(fullText);

    // Newer/alternate export title:
    // A & D Sheet for HUD - Huddersfield from Saturday 16/05/2026 00:00 to Sunday 17/05/2026 03:00
    const adTitle = text.match(
      /A\s*&\s*D\s*Sheet\s*for\s*([A-Z0-9]{2,8})\s*-\s*(.+?)\s+from\s+.*?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\s+\d{1,2}:\d{2}\s+to\s+.*?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i
    );

    if (adTitle) {
      return {
        code: adTitle[1].toUpperCase(),
        name: clean(adTitle[2]),
        start: g.AD.isoDate
          ? g.AD.isoDate(adTitle[5], adTitle[4], adTitle[3])
          : `${adTitle[5]}-${String(adTitle[4]).padStart(2, '0')}-${String(adTitle[3]).padStart(2, '0')}`,
        end: g.AD.isoDate
          ? g.AD.isoDate(adTitle[8], adTitle[7], adTitle[6])
          : `${adTitle[8]}-${String(adTitle[7]).padStart(2, '0')}-${String(adTitle[6]).padStart(2, '0')}`,
      };
    }

    if (g.AD.parseSheetHeader) {
      const fromText = g.AD.parseSheetHeader(text);
      if (fromText) return fromText;
    }

    if (g.AD.parseSheetHeaderFromFilename) {
      const fromName = g.AD.parseSheetHeaderFromFilename(fileName);
      if (fromName) return fromName;
    }

    return null;
  }

  function getColumnName(x, pageWidth) {
    // The uploaded A&D PDF is landscape A4 around 842 points wide. These are
    // ratio-based so they still work if PDF.js gives a slightly different width.
    const r = x / pageWidth;

    if (r < 0.052) return 'time';       // 0-44
    if (r < 0.066) return 'ad';         // 44-56
    if (r < 0.173) return 'destination';// 56-146
    if (r < 0.338) return 'operator';   // 146-284
    if (r < 0.711) return 'calling';    // 284-599
    if (r < 0.753) return 'coach';      // 599-634
    if (r < 0.855) return 'toc';        // 634-720
    return 'comments';
  }

  function makeEmptyRow(y) {
    return {
      y,
      time: [],
      ad: [],
      destination: [],
      operator: [],
      calling: [],
      coach: [],
      toc: [],
      comments: [],
      items: [],
    };
  }

  function groupItemsIntoRows(items, yTolerance = 3) {
    const rows = [];

    for (const item of items) {
      let row = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance);
      if (!row) {
        row = makeEmptyRow(item.y);
        rows.push(row);
      }
      row.items.push(item);
    }

    // PDF.js usually uses a bottom-left origin, so higher y is visually higher.
    rows.sort((a, b) => b.y - a.y);

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      for (const item of row.items) {
        row[item.col].push(item.text);
      }
      for (const col of ['time', 'ad', 'destination', 'operator', 'calling', 'coach', 'toc', 'comments']) {
        row[col] = joinParts(row[col]);
      }
      row.text = joinParts(row.items.map((i) => i.text));
    }

    return rows;
  }

  function finaliseRawMovement(raw) {
    if (!raw) return null;

    const dest = g.AD.parseDestination
      ? g.AD.parseDestination(raw.destinationText)
      : { code: '', name: raw.destinationText, nameFull: raw.destinationText };

    const op = g.AD.parseOperatorField
      ? g.AD.parseOperatorField(raw.operatorText)
      : { operator: raw.operatorText, vehicleType: '' };

    const coachNumber = g.AD.formatCoachNumber
      ? g.AD.formatCoachNumber(raw.coachText)
      : clean(raw.coachText);

    return {
      time: g.AD.padTime ? g.AD.padTime(raw.time) : raw.time,
      movementType: clean(raw.movementType).toUpperCase(),
      destinationCode: dest.code,
      destinationName: dest.name,
      destinationNameFull: dest.nameFull,
      operator: op.operator,
      vehicleType: op.vehicleType,
      callingLines: raw.callingLines || [],
      coachNumber,
      toc: clean(raw.tocText),
      comments: clean(raw.commentsText),
    };
  }

  function parseRowsIntoRawMovements(rows) {
    const rawMovements = [];
    let current = null;

    function closeCurrent() {
      const finished = finaliseRawMovement(current);
      if (finished) rawMovements.push(finished);
      current = null;
    }

    for (const row of rows) {
      const rowText = clean(row.text);
      if (!rowText) continue;

      // Skip table headers/title/safety/footer fragments.
      if (/^(Time\s+Destination\s+Operator|Follow the First Safety Principles|A\s*&\s*D\s*Sheet)/i.test(rowText)) continue;
      if (/^from\s+\w+/i.test(rowText)) continue;

      if (isMovementRow(row)) {
        closeCurrent();
        current = {
          time: clean(row.time),
          movementType: clean(row.ad),
          destinationText: clean(row.destination),
          operatorText: clean(row.operator),
          callingLines: [],
          coachText: clean(row.coach),
          tocText: clean(row.toc),
          commentsText: clean(row.comments),
        };
        pushOrAppendCallingLine(current.callingLines, row.calling);
        continue;
      }

      if (!current) continue;

      // Wrapped destination/operator cells. Example: Brighouse (Car / Park).
      if (row.destination) current.destinationText = clean(`${current.destinationText} ${row.destination}`);
      if (row.operator) current.operatorText = clean(`${current.operatorText} ${row.operator}`);

      // Calling pattern lines can be multiple stops or wrapped text.
      if (row.calling) pushOrAppendCallingLine(current.callingLines, row.calling);

      // Coach and TOC are usually on the first line, but keep this safe.
      if (row.coach && !current.coachText) current.coachText = clean(row.coach);
      if (row.toc) current.tocText = clean(`${current.tocText} ${row.toc}`);
      if (row.comments) current.commentsText = clean(`${current.commentsText} ${row.comments}`);
    }

    closeCurrent();
    return rawMovements;
  }

  async function extractPositionedRowsFromPDF(file) {
    const pdfjsLib = getPDFJS();
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;

    const allRows = [];
    const fullTextParts = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width || 842;
      const content = await page.getTextContent();

      const items = content.items
        .map((item) => {
          const text = clean(item.str || '');
          const x = item.transform[4] || 0;
          const y = item.transform[5] || 0;
          return {
            text,
            x,
            y,
            page: pageNo,
            col: getColumnName(x, pageWidth),
          };
        })
        .filter((item) => item.text);

      fullTextParts.push(items.map((i) => i.text).join(' '));
      const pageRows = groupItemsIntoRows(items).map((r) => ({ ...r, page: pageNo }));
      allRows.push(...pageRows);
    }

    return {
      rows: allRows,
      text: clean(fullTextParts.join('\n')),
    };
  }

  async function extractTextFromPDF(file) {
    const { rows } = await extractPositionedRowsFromPDF(file);
    return rows.map((r) => r.text).join('\n');
  }

  async function parsePDFFile(file) {
    const { rows, text } = await extractPositionedRowsFromPDF(file);
    const sheet = parsePDFHeader(text, file.name || '');
    if (!sheet) throw new Error('Could not detect station/date range from this PDF A&D sheet.');

    const rawMovements = parseRowsIntoRawMovements(rows);

    if (!rawMovements.length) {
      // Last-resort fallback to the old text parser from parser.js.
      if (g.AD.parsePDFText) return g.AD.parsePDFText(text, file.name || '');
      throw new Error('No A&D movements could be read from this PDF.');
    }

    const movements = rawMovements.map((raw, i) => g.AD.normaliseMovement(raw, sheet, i));
    return { sheet, movements: g.AD.enrichMovements(movements, sheet) };
  }

  Object.assign(g.AD, {
    parsePDFFile,
    extractTextFromPDF,
    extractPositionedRowsFromPDF,
    parsePDFHeader,
  });
})(typeof window !== 'undefined' ? window : globalThis);
