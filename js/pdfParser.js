/**
 * Robust PDF A&D parser.
 *
 * Reads First A&D PDFs using coordinates first, then falls back to row/text
 * recovery if the PDF groups the Time + A/D columns together or wraps cells in
 * an unhelpful order. Basically: assumes the PDF is a goblin and plans for it.
 */

(function (g) {
  g.AD = g.AD || {};

  const DEFAULT_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const COLS = ['time', 'ad', 'destination', 'operator', 'calling', 'coach', 'toc', 'comments'];
  const TOC_RE = /(Avanti\s+West\s+Coast|TransPennine\s+Trains|Great\s+Western\s+Railway|South\s+Western\s+Railway|Northern|Lumo|Hull\s+Trains)/i;
  const VEHICLE_RE = /\(([^)]*(?:coach|bus|deck|wheelchair|standard|vehicle)[^)]*)\)/i;

  function getPDFJS() {
    const pdfjsLib = g.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js is not loaded. Add pdf.js before pdfParser.js.');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = DEFAULT_WORKER;
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

  function pad(t) {
    return g.AD.padTime ? g.AD.padTime(t) : clean(t).replace(/^(\d):(\d{2})$/, '0$1:$2');
  }

  function parsePDFHeader(fullText, fileName = '') {
    const text = clean(fullText);
    const adTitle = text.match(
      /A\s*&\s*D\s*Sheet\s*for\s*([A-Z0-9]{2,8})\s*-\s*(.+?)\s+from\s+.*?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\s+\d{1,2}:\d{2}\s+to\s+.*?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/i
    );
    if (adTitle) {
      return {
        code: adTitle[1].toUpperCase(),
        name: clean(adTitle[2]),
        start: g.AD.isoDate ? g.AD.isoDate(adTitle[5], adTitle[4], adTitle[3]) : `${adTitle[5]}-${String(adTitle[4]).padStart(2, '0')}-${String(adTitle[3]).padStart(2, '0')}`,
        end: g.AD.isoDate ? g.AD.isoDate(adTitle[8], adTitle[7], adTitle[6]) : `${adTitle[8]}-${String(adTitle[7]).padStart(2, '0')}-${String(adTitle[6]).padStart(2, '0')}`,
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
    const r = x / pageWidth;
    if (r < 0.052) return 'time';
    if (r < 0.066) return 'ad';
    if (r < 0.173) return 'destination';
    if (r < 0.338) return 'operator';
    if (r < 0.711) return 'calling';
    if (r < 0.753) return 'coach';
    if (r < 0.855) return 'toc';
    return 'comments';
  }

  function makeEmptyRow(y) {
    return { y, time: [], ad: [], destination: [], operator: [], calling: [], coach: [], toc: [], comments: [], items: [] };
  }

  function groupItemsIntoRows(items, yTolerance = 3) {
    const rows = [];
    for (const item of items) {
      let row = rows.find((r) => Math.abs(r.y - item.y) <= yTolerance && r.page === item.page);
      if (!row) { row = makeEmptyRow(item.y); row.page = item.page; rows.push(row); }
      row.items.push(item);
    }

    rows.sort((a, b) => (a.page - b.page) || (b.y - a.y));
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      for (const item of row.items) row[item.col].push(item.text);
      for (const col of COLS) row[col] = joinParts(row[col]);
      row.text = joinParts(row.items.map((i) => i.text));
    }
    return rows;
  }

  function pushOrAppendCallingLine(lines, text) {
    const s = clean(text);
    if (!s) return;
    const parts = s.split(/(?=\b\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-)/g).map(clean).filter(Boolean);
    for (const part of parts.length ? parts : [s]) {
      if (/^\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-/i.test(part)) lines.push(part);
      else if (lines.length) lines[lines.length - 1] = clean(`${lines[lines.length - 1]} ${part}`);
    }
  }

  function movementStartFromRow(row) {
    let time = clean(row.time);
    let ad = clean(row.ad).toUpperCase();

    const timeAd = clean(`${row.time} ${row.ad}`).match(/^(\d{1,2}:\d{2})\s*([AD])\b/i);
    const textMatch = clean(row.text).match(/^(\d{1,2}:\d{2})\s*([AD])\b/i);

    if (!isTime(time) && timeAd) time = timeAd[1];
    if (!/^[AD]$/.test(ad) && timeAd) ad = timeAd[2].toUpperCase();
    if ((!isTime(time) || !/^[AD]$/.test(ad)) && textMatch) {
      time = textMatch[1];
      ad = textMatch[2].toUpperCase();
    }
    return isTime(time) && /^[AD]$/.test(ad) ? { time: pad(time), ad } : null;
  }

  function parseDestinationFromTextFragment(row) {
    const m = clean(row.text).match(/^\d{1,2}:\d{2}\s+[AD]\s+([A-Z0-9]{2,8}\s*-\s*.+?)(?=\s{2,}|\s+[A-Z][A-Za-z&'.()\-/ ]+(?:Ltd|LTD|Limited|Travel|Travels|Coaches|Bus|Group|Services|Commercials|Cars|Transport|Xpress|Sonic|Zirconia|Diamond|Faredeal|Diya|Atlantic|Ocean|Hastings|Tetleys|Lethers|Ross|Star|Red Rose|Moving People|B&H|A & A|J & B)\b|$)/i);
    return m ? clean(m[1]) : '';
  }

  function finaliseRawMovement(raw) {
    if (!raw) return null;
    const destText = clean(raw.destinationText);
    const opText = clean(raw.operatorText);
    const dest = g.AD.parseDestination ? g.AD.parseDestination(destText) : { code: '', name: destText, nameFull: destText };
    const op = g.AD.parseOperatorField ? g.AD.parseOperatorField(opText) : { operator: opText, vehicleType: '' };
    const coachNumber = g.AD.formatCoachNumber ? g.AD.formatCoachNumber(raw.coachText) : clean(raw.coachText);
    return {
      time: pad(raw.time),
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
      if (/^(Time\s+Destination\s+Operator|Follow the First Safety Principles|A\s*&\s*D\s*Sheet)/i.test(rowText)) continue;
      if (/^from\s+\w+/i.test(rowText)) continue;

      const start = movementStartFromRow(row);
      if (start) {
        closeCurrent();
        current = {
          time: start.time,
          movementType: start.ad,
          destinationText: clean(row.destination) || parseDestinationFromTextFragment(row),
          operatorText: clean(row.operator),
          callingLines: [],
          coachText: clean(row.coach),
          tocText: clean(row.toc),
          commentsText: clean(row.comments),
        };
        pushOrAppendCallingLine(current.callingLines, row.calling);
        if (!current.coachText) {
          const coachMatch = rowText.match(/\b\d{4,8}\b/);
          if (coachMatch) current.coachText = coachMatch[0];
        }
        if (!current.tocText) {
          const tocMatch = rowText.match(TOC_RE);
          if (tocMatch) current.tocText = tocMatch[0];
        }
        continue;
      }

      if (!current) continue;

      if (row.destination) current.destinationText = clean(`${current.destinationText} ${row.destination}`);
      if (row.operator) {
        const op = clean(row.operator);
        if (/^\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-/i.test(op)) pushOrAppendCallingLine(current.callingLines, op);
        else current.operatorText = clean(`${current.operatorText} ${op}`);
      }
      if (row.calling) pushOrAppendCallingLine(current.callingLines, row.calling);
      if (row.coach && !current.coachText) current.coachText = clean(row.coach);
      if (row.toc) current.tocText = clean(`${current.tocText} ${row.toc}`);
      if (row.comments) current.commentsText = clean(`${current.commentsText} ${row.comments}`);

      // Some PDFs put continuation calling pattern stops in row.text rather than row.calling.
      if (!row.calling && /^\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-/i.test(rowText)) pushOrAppendCallingLine(current.callingLines, rowText);
      const vehicle = rowText.match(VEHICLE_RE);
      if (vehicle && !VEHICLE_RE.test(current.operatorText)) current.operatorText = clean(`${current.operatorText} ${vehicle[0]}`);
    }

    closeCurrent();
    return rawMovements;
  }

  function scoreRawMovements(rawMovements) {
    if (!rawMovements.length) return 0;
    let score = rawMovements.length * 10;
    for (const m of rawMovements) {
      if (m.coachNumber) score += 2;
      if (m.toc) score += 2;
      if (m.callingLines?.length) score += 3;
      if (m.destinationCode) score += 2;
    }
    return score;
  }

  function recoverFromLinearText(text) {
    const lines = String(text || '').split('\n').map(clean).filter(Boolean);
    const raw = [];
    let current = null;

    const close = () => { const f = finaliseRawMovement(current); if (f) raw.push(f); current = null; };

    for (const line of lines) {
      if (/^(Time\s+Destination\s+Operator|Follow the First Safety Principles|A\s*&\s*D\s*Sheet|from\s+\w+)/i.test(line)) continue;
      const m = line.match(/^(\d{1,2}:\d{2})\s+([AD])\s+([A-Z0-9]{2,8}\s*-\s*.*)$/i);
      if (m) {
        close();
        current = { time: m[1], movementType: m[2].toUpperCase(), destinationText: m[3], operatorText: '', callingLines: [], coachText: '', tocText: '', commentsText: '' };
        const coach = line.match(/\b\d{4,8}\b/);
        if (coach) current.coachText = coach[0];
        const toc = line.match(TOC_RE);
        if (toc) current.tocText = toc[0];
        pushOrAppendCallingLine(current.callingLines, line.replace(/^\d{1,2}:\d{2}\s+[AD]\s+[A-Z0-9]{2,8}\s*-\s*.*?(?=\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-|$)/i, ''));
        continue;
      }
      if (!current) continue;
      if (/^\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-/i.test(line)) pushOrAppendCallingLine(current.callingLines, line);
      else if (VEHICLE_RE.test(line) || /(Ltd|LTD|Limited|Travel|Travels|Coaches|Bus|Group|Services)/.test(line)) current.operatorText = clean(`${current.operatorText} ${line}`);
      const coach = line.match(/^\d{4,8}\b/);
      if (coach && !current.coachText) current.coachText = coach[0];
      const toc = line.match(TOC_RE);
      if (toc) current.tocText = clean(`${current.tocText} ${toc[0]}`);
    }
    close();
    return raw;
  }

  function repairRawMovements(rawMovements, sheet) {
    const repaired = rawMovements.map((m) => ({ ...m, callingLines: [...(m.callingLines || [])] }));

    for (const m of repaired) {
      // If calling pattern is blank, at least give departures a station start and destination end.
      if (!m.callingLines.length && m.movementType === 'D') {
        m.callingLines.push(`${m.time} ${sheet.code} - ${sheet.name}`);
        if (m.destinationCode && m.destinationCode !== sheet.code) m.callingLines.push(`${m.time} ${m.destinationCode} - ${m.destinationName}`);
      }
      // If an arrival at this sheet station has no stops, add the arrival stop so it can still link by coach.
      if (!m.callingLines.length && m.movementType === 'A' && (!m.destinationCode || m.destinationCode === sheet.code)) {
        m.callingLines.push(`${m.time} ${sheet.code} - ${sheet.name}`);
      }
    }

    return repaired;
  }

  async function extractPositionedRowsFromPDF(file) {
    const pdfjsLib = getPDFJS();
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allRows = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width || 842;
      const content = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const items = content.items.map((item) => {
        const text = clean(item.str || '');
        const x = item.transform?.[4] || 0;
        const y = item.transform?.[5] || 0;
        return { text, x, y, page: pageNo, col: getColumnName(x, pageWidth) };
      }).filter((item) => item.text);
      allRows.push(...groupItemsIntoRows(items).map((r) => ({ ...r, page: pageNo })));
    }

    allRows.sort((a, b) => (a.page - b.page) || (b.y - a.y));
    return { rows: allRows, text: allRows.map((r) => r.text).join('\n') };
  }

  async function extractTextFromPDF(file) {
    const { text } = await extractPositionedRowsFromPDF(file);
    return text;
  }

  async function parsePDFFile(file) {
    const { rows, text } = await extractPositionedRowsFromPDF(file);
    const sheet = parsePDFHeader(text, file.name || '');
    if (!sheet) throw new Error('Could not detect station/date range from this PDF A&D sheet.');

    const coordinateRaw = parseRowsIntoRawMovements(rows);
    const fallbackRaw = coordinateRaw.length < 3 ? recoverFromLinearText(text) : [];
    let rawMovements = scoreRawMovements(fallbackRaw) > scoreRawMovements(coordinateRaw) ? fallbackRaw : coordinateRaw;

    if (!rawMovements.length && g.AD.parsePDFText) {
      return g.AD.parsePDFText(text, file.name || '');
    }
    if (!rawMovements.length) throw new Error('No A&D movements could be read from this PDF.');

    rawMovements = repairRawMovements(rawMovements, sheet);
    const movements = rawMovements.map((raw, i) => g.AD.normaliseMovement(raw, sheet, i));
    return { sheet, movements: g.AD.enrichMovements(movements, sheet) };
  }

  Object.assign(g.AD, { parsePDFFile, extractTextFromPDF, extractPositionedRowsFromPDF, parsePDFHeader });
})(typeof window !== 'undefined' ? window : globalThis);
