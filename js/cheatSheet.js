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

/** Pick a readable place name for a destination group (not the coach operator). */
function groupDestName(sampleMovement) {
  if (window.AD.shortDestinationLabel) return window.AD.shortDestinationLabel(sampleMovement);
  return (sampleMovement.destinationName || sampleMovement.destinationCode || '')
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

function minuteToken(minute) {
  return `:${String(minute).padStart(2, '0')}`;
}

function sortMinuteTokens(tokens) {
  return [...tokens].sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
}

function minutePatternFromSet(minuteSet) {
  return sortMinuteTokens(minuteSet).join(' ');
}

/** Label for hour-specific pattern tabs (e.g. 7 → "07:00"). */
function formatHourTab(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * Compare departure minutes per clock hour; pick the usual pattern and flag hours that differ.
 */
function analyzeHourPatterns(byHour) {
  const hourEntries = [];
  for (const [hour, minutes] of byHour) {
    if (!minutes.size) continue;
    hourEntries.push({ hour, minutes, key: minutePatternFromSet(minutes) });
  }
  if (!hourEntries.length) {
    return { minutePattern: '', minutes: [], hourVariants: [] };
  }

  const keyCounts = new Map();
  for (const entry of hourEntries) {
    keyCounts.set(entry.key, (keyCounts.get(entry.key) || 0) + 1);
  }

  let defaultKey = hourEntries[0].key;
  let maxCount = 0;
  for (const [key, count] of keyCounts) {
    if (count > maxCount) {
      maxCount = count;
      defaultKey = key;
    }
  }

  const defaultSet = new Set(defaultKey.split(' ').filter(Boolean));
  const variantGroups = new Map();

  for (const entry of hourEntries) {
    if (entry.key === defaultKey) continue;

    const variantSet = new Set(entry.key.split(' ').filter(Boolean));
    let isSubsetOfDefault = true;
    for (const token of variantSet) {
      if (!defaultSet.has(token)) {
        isSubsetOfDefault = false;
        break;
      }
    }
    // Skip hours with fewer departures than usual (start/end of service).
    if (variantSet.size < defaultSet.size && isSubsetOfDefault) continue;

    if (!variantGroups.has(entry.key)) {
      variantGroups.set(entry.key, { minutePattern: entry.key, hours: [] });
    }
    variantGroups.get(entry.key).hours.push(entry.hour);
  }

  const defaultMinutes = sortMinuteTokens(defaultKey.split(' ').filter(Boolean));
  const hourVariants = [...variantGroups.values()]
    .map((v) => {
      v.hours.sort((a, b) => a - b);
      return {
        minutePattern: v.minutePattern,
        hours: v.hours,
        tabLabel: v.hours.map(formatHourTab).join(' · '),
      };
    })
    .sort((a, b) => a.hours[0] - b.hours[0]);

  return {
    minutePattern: defaultKey,
    minutes: defaultMinutes,
    hourVariants,
  };
}

function buildCheatSheet(movements, sheetCode) {
  const deps = movements.filter((m) => window.AD.isDepartureFromStation(m));
  const groups = new Map();

  for (const m of deps) {
    const [h, min] = m.time.split(':').map(Number);
    if (h < 5 || h > 23) continue;

    const code = groupDestCode(m.destinationCode, sheetCode);
    if (!code) continue;

    if (!groups.has(code)) {
      groups.set(code, {
        code,
        name: groupDestName(m),
        byHour: new Map(),
        sampleMovement: m,
      });
    }
    const g = groups.get(code);
    if (!g.byHour.has(h)) g.byHour.set(h, new Set());
    g.byHour.get(h).add(minuteToken(min));
    if ((m.callingPattern?.length || 0) > (g.sampleMovement?.callingPattern?.length || 0)) {
      g.sampleMovement = m;
    }
  }

  return [...groups.values()]
    .map((g) => {
      const hourAnalysis = analyzeHourPatterns(g.byHour);
      const pattern = callingPatternDisplay(g.sampleMovement, sheetCode);
      return {
        code: g.code,
        name: g.name || g.code,
        minutes: hourAnalysis.minutes,
        minutePattern: hourAnalysis.minutePattern,
        hourVariants: hourAnalysis.hourVariants,
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

/** Which pattern tab applies for a given clock hour (e.g. 7 → "variant-0", else "usual"). */
function patternTabKeyForHour(route, hour) {
  const variants = route.hourVariants || [];
  for (let i = 0; i < variants.length; i++) {
    if (variants[i].hours.includes(hour)) return `variant-${i}`;
  }
  return 'usual';
}

function patternForTabKey(route, tabKey) {
  if (tabKey === 'usual') return route.minutePattern;
  const idx = parseInt(tabKey.replace('variant-', ''), 10);
  const variant = route.hourVariants?.[idx];
  return variant?.minutePattern || route.minutePattern;
}

(function (g) {
  g.AD = g.AD || {};
  g.AD.buildCheatSheet = buildCheatSheet;
  g.AD.collectStationCodes = collectStationCodes;
  g.AD.patternTabKeyForHour = patternTabKeyForHour;
  g.AD.patternForTabKey = patternForTabKey;
})(window);
