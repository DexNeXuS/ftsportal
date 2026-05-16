/**
 * localStorage persistence for completed movements and active session.
 */

const COMPLETED_KEY = 'ad_dashboard_completed';
const SHEET_KEY = 'ad_dashboard_sheet_meta';
const SESSION_KEY = 'ad_dashboard_session';

function loadCompletedIds(stationCode) {
  try {
    const all = JSON.parse(localStorage.getItem(COMPLETED_KEY) || '{}');
    return new Set(all[stationCode] || []);
  } catch {
    return new Set();
  }
}

function saveCompletedIds(stationCode, idSet) {
  try {
    const all = JSON.parse(localStorage.getItem(COMPLETED_KEY) || '{}');
    all[stationCode] = [...idSet];
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('Could not save completed state', e);
  }
}

function loadCompletedTimestamps(stationCode) {
  try {
    const all = JSON.parse(localStorage.getItem(`${COMPLETED_KEY}_times`) || '{}');
    return all[stationCode] || {};
  } catch {
    return {};
  }
}

function saveCompletedTimestamps(stationCode, times) {
  try {
    const all = JSON.parse(localStorage.getItem(`${COMPLETED_KEY}_times`) || '{}');
    all[stationCode] = times;
    localStorage.setItem(`${COMPLETED_KEY}_times`, JSON.stringify(all));
  } catch (e) {
    console.warn('Could not save completion times', e);
  }
}

function saveSheetMeta(sheet) {
  try {
    localStorage.setItem(SHEET_KEY, JSON.stringify(sheet));
  } catch (_) {}
}

function loadSheetMeta() {
  try {
    return JSON.parse(localStorage.getItem(SHEET_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Remember last uploaded/parsed sheet so refresh restores any station. */
function saveActiveSession(sheet, movements) {
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ sheet, movements, savedAt: Date.now() })
    );
  } catch (e) {
    console.warn('Could not save session (sheet may be too large for storage)', e);
  }
}

function loadActiveSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.sheet?.code || !Array.isArray(data.movements)) return null;
    return data;
  } catch {
    return null;
  }
}

function clearActiveSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

function applyStoredStatus(movements, stationCode) {
  const completed = loadCompletedIds(stationCode);
  const times = loadCompletedTimestamps(stationCode);
  return movements.map((m) => {
    if (completed.has(m.id)) {
      return {
        ...m,
        status: 'completed',
        completedAt: times[m.id] || new Date().toISOString(),
      };
    }
    return { ...m, status: 'upcoming', completedAt: null };
  });
}

(function (g) {
  g.AD = g.AD || {};
  Object.assign(g.AD, {
    loadCompletedIds,
    saveCompletedIds,
    loadCompletedTimestamps,
    saveCompletedTimestamps,
    saveSheetMeta,
    loadSheetMeta,
    saveActiveSession,
    loadActiveSession,
    clearActiveSession,
    applyStoredStatus,
  });
})(window);
