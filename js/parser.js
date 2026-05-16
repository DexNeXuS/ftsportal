/**
 * Robust A&D parser for PDF text, CSV exports, and XLS/XLSX grids.
 * Designed around First Travel Solutions A&D sheets such as HUD/SPT examples.
 */

function normaliseText(text = '') {
  return String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function squash(text = '') {
  return normaliseText(text).replace(/\s+/g, ' ').trim();
}

function padTime(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(t || '');
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function cellToString(val) {
  if (val == null) return '';
  if (typeof val === 'number') {
    if (Number.isFinite(val) && val >= 0 && val < 1) return normalizeTime(val);
    return Number.isInteger(val) ? String(val) : String(val);
  }
  return normaliseText(String(val)).trim();
}

function normalizeTime(val) {
  if (typeof val === 'number' && val >= 0 && val < 1) {
    const mins = Math.round(val * 24 * 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = cellToString(val).match(/(\d{1,2}):(\d{2})/);
  return m ? padTime(`${m[1]}:${m[2]}`) : cellToString(val);
}

function isoDate(y, mo, d) {
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseSheetHeader(line) {
  const s = squash(line);
  const m = s.match(/([A-Za-z0-9][A-Za-z0-9\s\-&'.]*?)\s*\(([A-Z0-9]{2,8})\)\s+from\s+.+?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}).+?to\s+.+?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i);
  if (!m) return null;
  return {
    name: m[1].trim(),
    code: m[2].toUpperCase(),
    start: isoDate(m[5], m[4], m[3]),
    end: isoDate(m[8], m[7], m[6]),
  };
}

function parseSheetHeaderFromFilename(fileName = '') {
  const base = normaliseText(fileName).replace(/\.(pdf|xlsx?|xls|csv)$/i, '');
  const m = base.match(/(?:AD[-_\s])?(.+?)\s*\(([A-Z0-9]{2,8})\)[-_\s]+(\d{1,2})[\/._-](\d{1,2})[\/._-](\d{4})/i);
  if (!m) return null;
  const start = isoDate(m[5], m[4], m[3]);
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return {
    name: m[1].replace(/^AD[-_\s]*/i, '').trim(),
    code: m[2].toUpperCase(),
    start,
    end: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  };
}

function findSheetMetaInGrid(gridRows) {
  for (let i = 0; i < Math.min(gridRows.length, 30); i++) {
    const row = (gridRows[i] || []).map(cellToString);
    for (const cell of row) {
      const found = parseSheetHeader(cell);
      if (found) return found;
    }
    const joined = row.filter(Boolean).join(' ');
    const found = parseSheetHeader(joined);
    if (found) return found;
  }
  return null;
}

function parseDestination(raw = '') {
  const s = squash(raw);
  const m = s.match(/^([A-Z0-9]{2,8})\s*-\s*(.+)$/i);
  if (!m) return { code: '', name: s, nameFull: s };
  const nameFull = m[2].trim();
  return {
    code: m[1].toUpperCase(),
    name: nameFull.replace(/\s*\([^)]*\)\s*$/, '').trim(),
    nameFull,
  };
}

function parseCallingLine(line) {
  let s = squash(line);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}:\d{2})\s+([A-Z0-9]{2,8})\s*-\s*(.+?)(?:,\s*[A-Z]{1,2}\d|$)/i);
  if (!m) return null;
  const code = m[2].toUpperCase();
  let name = m[3].trim();
  // Some rows are "MSNH - MSNH - Marsden ...". Remove duplicated code from name.
  name = name.replace(new RegExp(`^${code}\\s*-\\s*`, 'i'), '').trim();
  name = name.replace(/\s+/g, ' ');
  return { time: padTime(m[1]), code, name };
}

function formatCoachNumber(val) {
  const s = cellToString(val);
  const m = s.match(/\b\d{4,8}\b/);
  return m ? m[0] : s;
}

function parseOperatorField(raw = '', explicitVehicle = '') {
  const original = normaliseText(raw).trim();
  let vehicleType = cellToString(explicitVehicle);
  const vehicleMatches = [...original.matchAll(/\(([^)]*(?:coach|bus|deck|wheelchair|standard|vehicle)[^)]*)\)/gi)];
  if (!vehicleType && vehicleMatches.length) vehicleType = vehicleMatches[vehicleMatches.length - 1][1].trim();
  let operator = original.replace(/\(([^)]*(?:coach|bus|deck|wheelchair|standard|vehicle)[^)]*)\)/gi, ' ');
  operator = squash(operator);
  return { operator, vehicleType };
}

function detectColumnMap(headerRow) {
  const map = { time: 0, movementType: 1, destination: 2, operator: 3, calling: 4, coach: 5, toc: 6, comments: 7, vehicle: -1 };
  headerRow.forEach((h, i) => {
    const label = squash(h).toLowerCase();
    if (label === 'time') map.time = i;
    else if (label === 'destination') map.destination = i;
    else if (label.includes('operator')) map.operator = i;
    else if (label.includes('calling')) map.calling = i;
    else if (label === 'coach' || label.includes('job')) map.coach = i;
    else if (label === 'toc') map.toc = i;
    else if (label.includes('comment')) map.comments = i;
    else if (label.includes('vehicle')) map.vehicle = i;
    else if (label === 'a/d' || label === 'type' || label.includes('arr')) map.movementType = i;
  });
  return map;
}

function splitCSVRows(text) {
  const rows = [];
  let row = '', inQ = false;
  text = normaliseText(text);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { row += '"'; i++; }
      else { inQ = !inQ; row += ch; }
    } else if ((ch === '\n') && !inQ) {
      if (row.trim()) rows.push(row);
      row = '';
    } else row += ch;
  }
  if (row.trim()) rows.push(row);
  return rows;
}

function parseCSVRow(row) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQ && row[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  return cols.map((c) => normaliseText(c).trim());
}

function splitCallingCell(cell) {
  return normaliseText(cell).split('\n').map(squash).filter(Boolean);
}

function parseSheetGrid(gridRows, fileName = '') {
  let sheet = findSheetMetaInGrid(gridRows) || parseSheetHeaderFromFilename(fileName);
  let colMap = null;
  let current = null;
  const rawMovements = [];

  for (const rawRow of gridRows) {
    const row = (rawRow || []).map(cellToString);
    if (!row.some(Boolean)) continue;

    if (!sheet) sheet = parseSheetHeader(row.join(' ')) || sheet;
    if (row.some((c) => squash(c).toLowerCase() === 'time')) {
      colMap = detectColumnMap(row);
      continue;
    }
    if (!colMap || !sheet) continue;

    const time = normalizeTime(row[colMap.time]);
    const movementType = squash(row[colMap.movementType]).toUpperCase();
    const isMovement = /^\d{1,2}:\d{2}$/.test(time) && /^[AD]$/.test(movementType);

    if (isMovement) {
      if (current) rawMovements.push(current);
      const dest = parseDestination(row[colMap.destination]);
      const { operator, vehicleType } = parseOperatorField(row[colMap.operator], colMap.vehicle >= 0 ? row[colMap.vehicle] : '');
      current = {
        time: padTime(time),
        movementType,
        destinationCode: dest.code,
        destinationName: dest.name,
        destinationNameFull: dest.nameFull,
        operator,
        vehicleType,
        coachNumber: formatCoachNumber(row[colMap.coach]),
        toc: cellToString(row[colMap.toc]),
        comments: cellToString(row[colMap.comments]),
        callingLines: splitCallingCell(row[colMap.calling]),
      };
    } else if (current) {
      // Continuation rows normally only contain another calling-pattern stop.
      const candidates = [row[colMap.calling], row[colMap.operator], row[colMap.destination]].map(cellToString);
      for (const c of candidates) {
        for (const part of splitCallingCell(c)) {
          if (/^\d{1,2}:\d{2}\s+[A-Z0-9]{2,8}\s*-/i.test(part)) current.callingLines.push(part);
        }
      }
    }
  }
  if (current) rawMovements.push(current);
  return { sheet, rawMovements };
}

function parseCSVText(text, fileName = '') {
  return parseSheetGrid(splitCSVRows(text).map(parseCSVRow), fileName);
}

function buildDatetime(sheetStart, sheetEnd, timeStr) {
  const [h, mi] = padTime(timeStr).split(':').map(Number);
  const base = new Date(`${sheetStart}T00:00:00`);
  let dt = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi, 0);
  // A&D sheets commonly run to ~03:00 next calendar day. Times up to 04:00 belong on the end date.
  if (sheetStart !== sheetEnd && h <= 4) {
    const endBase = new Date(`${sheetEnd}T00:00:00`);
    dt = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), h, mi, 0);
  }
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00`;
}

function dedupeCallingPattern(stops) {
  const out = [];
  const seen = new Set();
  for (const s of stops) {
    const key = `${s.time}|${s.code}|${s.name}`;
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  }
  return out;
}

function normaliseMovement(raw, sheet, index) {
  let callingPattern = (raw.callingLines || []).map(parseCallingLine).filter(Boolean);
  callingPattern = dedupeCallingPattern(callingPattern);

  if (raw.movementType === 'D') {
    const depTime = padTime(raw.time);
    const stationAtDep = callingPattern.findIndex((s) => s.code === sheet.code && s.time === depTime);
    const anyStation = callingPattern.findIndex((s) => s.code === sheet.code);
    const startIdx = stationAtDep >= 0 ? stationAtDep : anyStation;
    if (startIdx > 0) callingPattern = callingPattern.slice(startIdx);

    if (!callingPattern.some((s) => s.code === sheet.code)) {
      callingPattern.unshift({ time: depTime, code: sheet.code, name: sheet.name });
    }

    // If the export has duplicated/reversed calling-pattern blocks, keep the first complete
    // sequence from the sheet station to the destination. Example: HUD > BGH > BGH > HUD
    // becomes HUD > BGH.
    const firstDestAfterStart = callingPattern.findIndex((s, idx) => idx > 0 && s.code === raw.destinationCode);
    if (firstDestAfterStart > 0) callingPattern = callingPattern.slice(0, firstDestAfterStart + 1);

    if (raw.destinationCode && !callingPattern.some((s) => s.code === raw.destinationCode)) {
      callingPattern.push({ time: depTime, code: raw.destinationCode, name: raw.destinationName });
    }
  }

  const id = `${sheet.code}-${raw.movementType}-${padTime(raw.time)}-${raw.coachNumber || index}-${raw.destinationCode || 'UNK'}`;
  return {
    id,
    sheetStationCode: sheet.code,
    sheetStationName: sheet.name,
    sheetStartDate: sheet.start,
    sheetEndDate: sheet.end,
    time: padTime(raw.time),
    datetime: buildDatetime(sheet.start, sheet.end, raw.time),
    movementType: raw.movementType,
    destinationCode: raw.destinationCode,
    destinationName: raw.destinationName,
    destinationNameFull: raw.destinationNameFull || raw.destinationName,
    operator: raw.operator,
    vehicleType: raw.vehicleType,
    callingPattern,
    isDirect: callingPattern.length <= 2,
    coachNumber: raw.coachNumber,
    toc: raw.toc,
    comments: raw.comments || '',
    status: 'upcoming',
    completedAt: null,
  };
}

function parseAndNormalise(text, fileName = '') {
  const { sheet, rawMovements } = parseCSVText(text, fileName);
  if (!sheet) throw new Error('Could not detect station from this A&D sheet.');
  const movements = rawMovements.map((raw, i) => normaliseMovement(raw, sheet, i));
  return { sheet, movements: enrichMovements(movements, sheet) };
}

/**
 * PDF text fallback parser.
 * Some PDFs export as summary pages first, then calling-pattern pages later.
 * This parser extracts movement summaries, then extracts calling-pattern blocks and pairs them by order.
 */
function parsePDFText(text, fileName = '') {
  const clean = normaliseText(text);
  const sheet = parseSheetHeader(clean) || parseSheetHeaderFromFilename(fileName);
  if (!sheet) throw new Error('Could not detect station from this PDF A&D sheet.');

  const lines = clean.split('\n').map(squash).filter(Boolean);
  const movementLines = [];
  const callingBlocks = [];
  let inCallingSection = false;
  let block = null;

  for (const line of lines) {
    if (/Calling Pattern\s+Coach\s+TOC/i.test(line)) { inCallingSection = true; continue; }
    if (/^Follow the First Safety Principles/i.test(line) || parseSheetHeader(line)) continue;
    if (/^Time\s+Destination\s+Operator/i.test(line)) continue;

    if (!inCallingSection) {
      if (/^\d{1,2}:\d{2}\s+[AD]\b/i.test(line)) movementLines.push(line);
      continue;
    }

    const stop = parseCallingLine(line);
    if (stop) {
      if (!block) block = { callingLines: [], coachNumber: '', toc: '' };
      block.callingLines.push(line);
      continue;
    }

    const coach = line.match(/^\d{4,8}\b/);
    if (coach) {
      if (!block) block = { callingLines: [], coachNumber: '', toc: '' };
      block.coachNumber = coach[0];
      const toc = squash(line.replace(coach[0], ''));
      if (toc) block.toc = toc;
      callingBlocks.push(block);
      block = null;
    } else if (block && /(Trains|Rail|Coast|TransPennine|Avanti|Northern|GWR|SWR)/i.test(line)) {
      block.toc = line;
      callingBlocks.push(block);
      block = null;
    }
  }
  if (block && block.callingLines.length) callingBlocks.push(block);

  const rawMovements = movementLines.map((line, i) => {
    const m = line.match(/^(\d{1,2}:\d{2})\s+([AD])\s+([A-Z0-9]{2,8})\s*-\s*(.+)$/i);
    if (!m) return null;
    const tail = m[4];
    const vehicle = tail.match(/\(([^)]*(?:coach|bus|deck|wheelchair|standard|vehicle)[^)]*)\)/i);
    const beforeVehicle = vehicle ? tail.slice(0, vehicle.index).trim() : tail.trim();

    // Operator is hard to separate in raw PDF text; use a best-effort split.
    const knownOperatorStart = beforeVehicle.search(/\b([A-Z][A-Za-z&.' ]+?(?:Ltd|LTD|Limited|Travel|Travels|Coaches|Bus|Group|Services|Commercials|Cars|Transport|Xpress|Sonic|Zirconia|Diamond|Faredeal|Diya|Atlantic|Ocean|Hastings|Tetleys|Lethers|Ross|Star|Red Rose|Moving People|B&H|A & A|J & B))/);
    const destName = knownOperatorStart > 2 ? beforeVehicle.slice(0, knownOperatorStart).trim() : beforeVehicle;
    const operator = knownOperatorStart > 2 ? beforeVehicle.slice(knownOperatorStart).trim() : '';
    const block = callingBlocks[i] || {};
    return {
      time: padTime(m[1]),
      movementType: m[2].toUpperCase(),
      destinationCode: m[3].toUpperCase(),
      destinationName: destName.replace(/\s*\([^)]*\)\s*$/, '').trim(),
      destinationNameFull: destName,
      operator,
      vehicleType: vehicle ? vehicle[1].trim() : '',
      coachNumber: block.coachNumber || '',
      toc: block.toc || '',
      comments: '',
      callingLines: block.callingLines || [],
    };
  }).filter(Boolean);

  // If the PDF text was actually CSV-like, use the normal CSV parser instead.
  if (rawMovements.length < 3 && clean.includes(',')) return parseAndNormalise(clean, fileName);
  const movements = rawMovements.map((raw, i) => normaliseMovement(raw, sheet, i));
  return { sheet, movements: enrichMovements(movements, sheet) };
}

function isDepartureFromStation(m) {
  return m.movementType === 'D' && m.destinationCode !== m.sheetStationCode;
}

function isArrivalAtStation(m) {
  return m.movementType === 'A' && m.destinationCode === m.sheetStationCode;
}

function compareTimes(t1, t2) {
  const toM = (t) => {
    const [h, mi] = padTime(t).split(':').map(Number);
    return h * 60 + mi;
  };
  return toM(t1) - toM(t2);
}

function sortMovementsChrono(a, b) {
  const dt = new Date(a.datetime) - new Date(b.datetime);
  if (dt !== 0) return dt;
  if (a.movementType !== b.movementType) return a.movementType === 'A' ? -1 : 1;
  return 0;
}

/** Max minutes a coach can reasonably stand between arrival and next departure. */
const MAX_STATION_LAYOVER_MINS = 240;

function layoverBetween(arrival, departure) {
  if (!arrival?.datetime || !departure?.datetime) return null;
  return Math.round((new Date(departure.datetime) - new Date(arrival.datetime)) / 60000);
}

/** True when this arrival can form the next working departure (same coach, sane gap). */
function isValidArrivalDeparturePair(arrival, departure) {
  if (!isArrivalAtStation(arrival) || !isDepartureFromStation(departure)) return false;
  if (arrival.coachNumber && departure.coachNumber && arrival.coachNumber !== departure.coachNumber) {
    return false;
  }
  const mins = layoverBetween(arrival, departure);
  if (mins == null || mins < 0) return false;
  if (mins > MAX_STATION_LAYOVER_MINS) return false;
  return true;
}

/** Link each station arrival to the next valid departure for the same coach. */
function linkMovementsByCoach(movements) {
  const byId = new Map(movements.map((m) => [m.id, { ...m, nextDepartureId: null, previousArrivalId: null }]));
  const byCoach = new Map();

  for (const m of byId.values()) {
    if (!m.coachNumber) continue;
    if (!byCoach.has(m.coachNumber)) byCoach.set(m.coachNumber, []);
    byCoach.get(m.coachNumber).push(m);
  }

  for (const list of byCoach.values()) {
    list.sort(sortMovementsChrono);
    for (let i = 0; i < list.length; i++) {
      const arrival = list[i];
      if (!isArrivalAtStation(arrival)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const candidate = list[j];
        if (!isDepartureFromStation(candidate)) continue;
        if (!isValidArrivalDeparturePair(arrival, candidate)) continue;
        arrival.nextDepartureId = candidate.id;
        candidate.previousArrivalId = arrival.id;
        break;
      }
    }
  }

  return [...byId.values()];
}

function createVehicleCycle(arrival, departure) {
  const mins =
    arrival && isValidArrivalDeparturePair(arrival, departure)
      ? layoverBetween(arrival, departure)
      : null;
  return {
    id: arrival ? `${arrival.id}__${departure.id}` : `dep-${departure.id}`,
    coachNumber: departure.coachNumber || arrival?.coachNumber || '',
    arrival: arrival || null,
    departure,
    arrivalTime: arrival?.time ?? null,
    arrivalDatetime: arrival?.datetime ?? null,
    departureTime: departure.time,
    departureDatetime: departure.datetime,
    destinationCode: departure.destinationCode,
    destinationName: departure.destinationName,
    layoverMins: mins,
    vehicleType: departure.vehicleType || arrival?.vehicleType || '',
    operator: departure.operator || arrival?.operator || '',
    toc: departure.toc || arrival?.toc || '',
    callingPattern: departure.callingPattern,
    isDirect: departure.isDirect,
  };
}

/** Operational vehicle cycles: arrival at station → next departure (same coach). */
function buildVehicleCycles(movements) {
  const cycles = [];
  const departureIdsUsed = new Set();

  for (const m of movements) {
    if (!isArrivalAtStation(m) || !m.nextDepartureId) continue;
    const dep = movements.find((x) => x.id === m.nextDepartureId);
    if (!dep || departureIdsUsed.has(dep.id)) continue;
    if (!isValidArrivalDeparturePair(m, dep)) continue;
    departureIdsUsed.add(dep.id);
    cycles.push(createVehicleCycle(m, dep));
  }

  for (const m of movements) {
    if (!isDepartureFromStation(m)) continue;
    if (m.previousArrivalId || departureIdsUsed.has(m.id)) continue;
    departureIdsUsed.add(m.id);
    cycles.push(createVehicleCycle(null, m));
  }

  return cycles.sort((a, b) => new Date(a.departureDatetime) - new Date(b.departureDatetime));
}

const VEHICLE_STATE_LABELS = {
  inbound: 'Due in',
  waiting: 'At station',
  departing_soon: 'Departs soon',
  scheduled: 'Scheduled departure',
  departed: 'Departed',
  completed: 'Completed',
  in_transit: 'In transit',
};

function getVehicleState(cycle, now = new Date()) {
  const dep = cycle.departure;
  if (dep.status === 'completed') return 'completed';

  const depMins = minutesUntil(dep.datetime, now);
  if (depMins < -2) return 'departed';

  if (!cycle.arrival) {
    if (depMins >= 0 && depMins <= 5) return 'departing_soon';
    return 'scheduled';
  }

  const arrMins = minutesUntil(cycle.arrival.datetime, now);
  if (arrMins > 0) return 'inbound';
  if (depMins >= 0 && depMins <= 5) return 'departing_soon';
  if (arrMins <= 0 && depMins > 0) return 'waiting';
  return 'waiting';
}

function getVehicleStateLabel(state) {
  return VEHICLE_STATE_LABELS[state] || state;
}

function formatLayover(mins) {
  if (mins == null || mins < 0) return '—';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatInboundCountdown(mins) {
  if (mins < 0) return 'Arriving now';
  if (mins === 0) return 'Due now';
  if (mins === 1) return 'Due in 1 min';
  return `Due in ${mins} mins`;
}

function isCycleActive(cycle, now = new Date()) {
  if (cycle.departure.status === 'completed') return false;
  const depMins = minutesUntil(cycle.departureDatetime, now);
  if (depMins < -5) return false;
  if (!cycle.arrival) return depMins >= -2;
  const arrMins = minutesUntil(cycle.arrivalDatetime, now);
  if (arrMins > 45) return false;
  return depMins >= -2;
}

function getActiveVehicleCycles(movements, now = new Date()) {
  return buildVehicleCycles(movements).filter((cycle) => isCycleActive(cycle, now));
}

/** departures = at station / leaving; arrivals = inbound due; all = both */
function filterLiveCyclesByView(cycles, view = 'all', now = new Date()) {
  const filtered = cycles.filter((cycle) => {
    const state = getVehicleState(cycle, now);
    if (view === 'arrivals') return state === 'inbound';
    if (view === 'departures') return state !== 'inbound';
    return true;
  });

  filtered.sort((a, b) => {
    const stateA = getVehicleState(a, now);
    const stateB = getVehicleState(b, now);
    const primaryA =
      view === 'arrivals' || stateA === 'inbound'
        ? a.arrivalDatetime || a.departureDatetime
        : a.departureDatetime;
    const primaryB =
      view === 'arrivals' || stateB === 'inbound'
        ? b.arrivalDatetime || b.departureDatetime
        : b.departureDatetime;
    return new Date(primaryA) - new Date(primaryB);
  });

  return filtered;
}

function getInboundOriginStop(cycle) {
  const pattern = cycle.arrival?.callingPattern;
  if (!pattern?.length) return null;
  const code = cycle.departure.sheetStationCode;
  const atStation = pattern.findIndex((s) => s.code === code);
  if (atStation > 0) return pattern[atStation - 1];
  if (pattern.length > 1 && pattern[pattern.length - 1].code === code) {
    return pattern[pattern.length - 2];
  }
  return pattern[0];
}

function enrichMovements(movements, sheet) {
  return linkMovementsByCoach(movements);
}

function getEffectiveNow(sheet) {
  const now = new Date();
  const start = new Date(`${sheet.start}T00:00:00`);
  const end = new Date(`${sheet.end}T03:00:00`);
  if (now >= start && now <= new Date(end.getTime() + 3600000)) return now;
  return new Date(`${sheet.start}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`);
}

function minutesUntil(departureIso, now = new Date()) {
  return Math.round((new Date(departureIso) - now) / 60000);
}

function formatCountdown(mins) {
  if (mins < 0) return 'Departed';
  if (mins === 0) return 'Departs now';
  if (mins === 1) return 'Departs in 1 min';
  return `Departs in ${mins} mins`;
}

(function (global) {
  global.AD = global.AD || {};
  Object.assign(global.AD, {
    normaliseText, squash, padTime, cellToString, normalizeTime,
    parseSheetHeader, parseSheetHeaderFromFilename, findSheetMetaInGrid,
    parseDestination, parseCallingLine, formatCoachNumber, parseOperatorField,
    detectColumnMap, splitCSVRows, parseCSVRow, parseSheetGrid,
    parseCSVText, buildDatetime, normaliseMovement, parseAndNormalise,
    parsePDFText, isDepartureFromStation, isArrivalAtStation, enrichMovements,
    linkMovementsByCoach, buildVehicleCycles, getActiveVehicleCycles, isCycleActive,
    filterLiveCyclesByView, getInboundOriginStop,
    getVehicleState, getVehicleStateLabel, formatLayover, formatInboundCountdown,
    getEffectiveNow, minutesUntil, formatCountdown,
  });
})(typeof window !== 'undefined' ? window : globalThis);
