/**
 * Auto-generate route cheat sheet from any station's departure patterns.
 */

/** Group similar destination codes (e.g. BGH vs BGH1, MSNH → MSN prefix). */
function groupDestCode(code, sheetCode) {
  const c = (code || '').toUpperCase();
  if (!c || c === sheetCode) return '';
  const letters = c.match(/^[A-Z]+/);
  const prefix = letters ? letters[0] : c;
  if (prefix.length >= 3) return prefix.slice(0, 3);
  return c.slice(0, 4);
}

/** Pick a readable name for a destination group from movement data. */
function groupDestName(sampleMovement) {
  return (sampleMovement.destinationName || sampleMovement.destinationNameFull || sampleMovement.destinationCode || '')
    .replace(/\s*\([^)]*\).*/, '')
    .trim();
}

/** Normalise stop codes for display chains (strip numeric suffixes). */
function simplifyStopCode(code, sheetCode) {
  const c = (code || '').toUpperCase();
  if (!c) return '';
  if (c === sheetCode) return sheetCode;
  const m = c.match(/^([A-Z]{2,4})/);
  return m ? m[1] : c.slice(0, 4);
}

function callingPatternDisplay(movement, sheetCode) {
  const stops = movement.callingPattern || [];
  if (stops.length === 0) {
    const dest = groupDestCode(movement.destinationCode, sheetCode) || movement.destinationCode;
    return {
      chain: `${sheetCode} > ${dest}`,
      isDirect: true,
      label: 'Direct (no pattern listed)',
    };
  }

  const simplified = [];
  const seen = new Set();
  for (const s of stops) {
    const code = simplifyStopCode(s.code, sheetCode);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    simplified.push(code);
  }

  const destKey = groupDestCode(movement.destinationCode, sheetCode) || movement.destinationCode;
  const isDirect =
    movement.isDirect ||
    (simplified.length <= 2 && simplified.includes(sheetCode) && simplified.includes(destKey));

  if (isDirect && simplified.length <= 2) {
    return {
      chain: `${sheetCode} > ${destKey}`,
      isDirect: true,
      label: 'Fast direct',
    };
  }

  return {
    chain: simplified.join(' > '),
    isDirect: false,
    label: simplified.join(' > '),
  };
}

function buildCheatSheet(movements, sheetCode) {
  const deps = movements.filter((m) => window.AD.isDepartureFromStation(m));
  const groups = new Map();

  for (const m of deps) {
    const [h] = m.time.split(':').map(Number);
    if (h < 5 || h > 23) continue;

    const code = groupDestCode(m.destinationCode, sheetCode);
    if (!code) continue;

    if (!groups.has(code)) {
      groups.set(code, {
        code,
        name: groupDestName(m),
        minutes: new Set(),
        sampleMovement: m,
      });
    }
    const g = groups.get(code);
    if (m.destinationName && m.destinationName.length > (g.name || '').length) {
      g.name = groupDestName(m);
    }
    const mins = parseInt(m.time.split(':')[1], 10);
    g.minutes.add(`:${String(mins).padStart(2, '0')}`);
    if ((m.callingPattern?.length || 0) > (g.sampleMovement?.callingPattern?.length || 0)) {
      g.sampleMovement = m;
    }
  }

  return [...groups.values()]
    .map((g) => {
      const minuteList = [...g.minutes].sort(
        (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)
      );
      const pattern = callingPatternDisplay(g.sampleMovement, sheetCode);
      return {
        code: g.code,
        name: g.name || g.code,
        minutes: minuteList,
        minutePattern: minuteList.join(' '),
        stops: pattern.chain,
        isDirect: pattern.isDirect,
        stopLabel: pattern.label,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Collect station codes + names seen on this sheet (for legend). */
function collectStationCodes(movements, sheet) {
  const map = new Map();
  if (sheet?.code) map.set(sheet.code, sheet.name);

  for (const m of movements) {
    if (m.destinationCode) {
      const k = groupDestCode(m.destinationCode, sheet?.code) || m.destinationCode;
      if (!map.has(k)) map.set(k, groupDestName(m) || k);
    }
    for (const s of m.callingPattern || []) {
      const k = simplifyStopCode(s.code, sheet?.code);
      if (k && !map.has(k)) map.set(k, s.name || k);
    }
  }

  return [...map.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

(function (g) {
  g.AD = g.AD || {};
  g.AD.buildCheatSheet = buildCheatSheet;
  g.AD.collectStationCodes = collectStationCodes;
})(window);
