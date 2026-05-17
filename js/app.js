/**
 * A&D Rail Replacement Dashboard — works with any station from uploaded A&D sheets.
 */

const state = {
  sheet: null,
  movements: [],
  filters: { search: '', type: '', sort: 'asc' },
  liveFilter: 'departures',
};

let clockTimer = null;
let lastCheatPatternHour = null;

function init() {
  bindTabs();
  bindLiveSubtabs();
  bindScrollUX();
  bindUpload();
  bindTableFilters();
  bindTableFiltersToggle();
  bindDelegation();
  startClock();
  window.AD.updateChromeMetrics();
  window.addEventListener('resize', () => window.AD.updateChromeMetrics());

  const session = window.AD.loadActiveSession();
  if (session?.sheet && session.movements?.length) {
    setData(session.sheet, session.movements, { silent: true });
    window.AD.showParseStatus(
      `Loaded ${session.sheet.name} (${session.sheet.code}) — ${session.movements.length} movements`,
      false
    );
  } else {
    setUploadPanelMode(false);
    window.AD.showEmptyState();
  }
}

function syncCheatSheetToCurrentHour() {
  if (!state.sheet) return;
  const AD = window.AD;
  const now = AD.getEffectiveNow(state.sheet);
  const hour = now.getHours();
  lastCheatPatternHour = hour;
  const container = document.getElementById('cheat-sheet-content');
  if (container?.querySelector('.cheat-route')) {
    AD.applyCheatSheetTimeTabs(container, hour);
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn, .dock-btn').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    if (b.getAttribute('role') === 'tab') b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${tab}`);
  });
  document.getElementById('live-chrome-bar')?.classList.toggle('is-visible', tab === 'live');
  if (tab === 'cheat') syncCheatSheetToCurrentHour();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  window.requestAnimationFrame(() => {
    window.AD.updateChromeMetrics();
    if (tab === 'full') {
      window.AD.setupTimeScrubberSync();
      window.AD.updateChromeMetrics();
    }
  });
  document.getElementById('app-chrome')?.classList.add('app-chrome--peek');
  window.setTimeout(() => {
    document.getElementById('app-chrome')?.classList.remove('app-chrome--peek');
    window.AD.updateChromeMetrics();
  }, 600);
}

function bindTabs() {
  document.querySelectorAll('.tab-btn, .dock-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) switchTab(btn.dataset.tab);
    });
  });
}

function bindLiveSubtabs() {
  document.querySelectorAll('.live-sub-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.liveFilter;
      if (!view) return;
      state.liveFilter = view;
      document.querySelectorAll('.live-sub-btn').forEach((b) => {
        const on = b.dataset.liveFilter === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (state.sheet) {
        const now = window.AD.getEffectiveNow(state.sheet);
        window.AD.renderLiveBoard(state.movements, state.sheet, now, state.liveFilter);
      }
      window.requestAnimationFrame(() => window.AD.updateChromeMetrics());
    });
  });
}

function bindScrollUX() {
  const scrollBtn = document.getElementById('scroll-top-btn');
  const chrome = document.getElementById('app-chrome');
  let ticking = false;
  let lastY = 0;

  const onScroll = () => {
    const y = window.scrollY || document.documentElement.scrollTop;
    if (scrollBtn) {
      scrollBtn.classList.toggle('scroll-top-btn--visible', y > 320);
    }
    if (chrome && y < lastY && y > 40) {
      chrome.classList.add('app-chrome--peek');
    } else if (chrome) {
      chrome.classList.remove('app-chrome--peek');
    }
    window.AD.syncScrubberToTableScroll();
    lastY = y;
    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );

  scrollBtn?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  onScroll();
}

function bindUpload() {
  const input = document.getElementById('file-input');
  const trigger = document.getElementById('upload-trigger');

  input?.addEventListener('change', () => {
    if (input.files?.[0]) {
      handleFile(input.files[0]);
      input.value = '';
    }
  });

  trigger?.addEventListener('click', () => input?.click());

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    trigger?.classList.add('drag-over');
  };

  const onDragLeave = (e) => {
    if (e.relatedTarget && trigger?.contains(e.relatedTarget)) return;
    trigger?.classList.remove('drag-over');
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    trigger?.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  trigger?.addEventListener('dragover', onDragOver);
  trigger?.addEventListener('dragleave', onDragLeave);
  trigger?.addEventListener('drop', onDrop);
}

function setUploadPanelMode(loaded, sheet = null) {
  const section = document.getElementById('upload-section');
  const label = document.getElementById('upload-loaded-label');
  const trigger = document.getElementById('upload-trigger');

  if (loaded && sheet) {
    section?.removeAttribute('hidden');
    if (label) {
      label.textContent = `${sheet.name} (${sheet.code}) · ${sheet.start} → ${sheet.end}`;
    }
    if (trigger) {
      trigger.title = 'Replace A&D sheet — PDF, XLSX, XLS, or CSV';
    }
  } else {
    section?.setAttribute('hidden', '');
    if (label) label.textContent = '';
    if (trigger) {
      trigger.title = 'Upload A&D sheet — PDF, XLSX, XLS, or CSV';
    }
  }
  window.requestAnimationFrame(() => window.AD.updateChromeMetrics?.());
}

function bindTableFilters() {
  const search = document.getElementById('table-search');
  const type = document.getElementById('filter-type');
  const sort = document.getElementById('filter-sort');

  search?.addEventListener('input', () => {
    state.filters.search = search.value;
    refreshFullTable();
  });
  type?.addEventListener('change', () => {
    state.filters.type = type.value;
    refreshFullTable();
  });
  sort?.addEventListener('change', () => {
    state.filters.sort = sort.value;
    refreshFullTable();
  });
}

function bindTableFiltersToggle() {
  const toggle = document.getElementById('table-filters-toggle');
  const toolbar = document.getElementById('table-toolbar');
  const mq = window.matchMedia('(max-width: 767px)');

  const applyLayout = () => {
    if (!toolbar || !toggle) return;
    if (!mq.matches) {
      toolbar.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.classList.remove('table-filters-toggle--open');
      return;
    }
    if (!toggle.hasAttribute('data-mobile-init')) {
      toolbar.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('data-mobile-init', '1');
    }
  };

  mq.addEventListener('change', () => {
    applyLayout();
    window.requestAnimationFrame(() => window.AD.updateChromeMetrics());
  });
  applyLayout();

  toggle?.addEventListener('click', () => {
    if (!mq.matches || !toolbar) return;
    const opening = toolbar.hidden;
    toolbar.hidden = !opening;
    toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
    toggle.classList.toggle('table-filters-toggle--open', opening);
    window.requestAnimationFrame(() => window.AD.updateChromeMetrics());
  });
}

function bindDelegation() {
  document.body.addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('.time-scrub-btn');
    if (jumpBtn?.dataset.jumpTime) {
      window.AD.scrollToTableTime(jumpBtn.dataset.jumpTime);
      return;
    }

    const stopperBtn = e.target.closest('[data-action="toggle-stoppers"]');
    if (stopperBtn) {
      const card = stopperBtn.closest('.vehicle-card');
      const panel = card?.querySelector('.vehicle-route-detail');
      if (panel) {
        const opening = panel.hidden;
        panel.hidden = !opening;
        stopperBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
      }
      return;
    }

    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.action === 'complete') completeMovement(id);
    if (btn.dataset.action === 'undo') undoMovement(id);
  });
}

async function handleFile(file) {
  const AD = window.AD;
  const name = file.name.toLowerCase();
  AD.showParseStatus('Parsing…');
  try {
    let result;
    if (name.endsWith('.pdf')) {
      result = await AD.parsePDFFile(file);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      result = await AD.parseXLSXFile(file);
    } else if (name.endsWith('.csv')) {
      const text = await file.text();
      result = AD.parseAndNormalise(text, file.name);
    } else {
      throw new Error('Please upload a PDF, XLSX, XLS, or CSV A&D sheet.');
    }
    setData(result.sheet, result.movements, {
      statusMsg: `Loaded ${result.sheet.name} (${result.sheet.code}) — ${result.movements.length} movements from ${file.name}`,
    });
  } catch (err) {
    console.error(err);
    AD.showParseStatus(err.message || 'Failed to parse file.', true);
  }
}

function setData(sheet, movements, { statusMsg, silent } = {}) {
  const AD = window.AD;
  state.sheet = sheet;
  state.movements = AD.enrichMovements(AD.applyStoredStatus(movements, sheet.code), sheet);
  AD.saveSheetMeta(sheet);
  AD.saveActiveSession(sheet, state.movements);

  document.getElementById('station-title').textContent = `${sheet.name} (${sheet.code})`;
  setUploadPanelMode(true, sheet);

  const liveSub = document.getElementById('panel-live-sub');
  if (liveSub) {
    liveSub.textContent = `Vehicles at ${sheet.name} (${sheet.code}) · arrived → next departure`;
  }

  refreshAll();
  window.requestAnimationFrame(() => window.AD.updateChromeMetrics());

  if (statusMsg && !silent) AD.showParseStatus(statusMsg);
  else if (!silent) AD.showParseStatus('', false);
}

function refreshAll() {
  if (!state.sheet) return;
  const AD = window.AD;
  const now = AD.getEffectiveNow(state.sheet);
  AD.renderLiveBoard(state.movements, state.sheet, now, state.liveFilter);
  AD.renderCompleted(state.movements);
  AD.renderCheatSheet(state.movements, state.sheet, now);
  AD.updateCountdowns(now, state.movements);
  refreshFullTable();
}

function refreshFullTable() {
  if (!state.sheet) return;
  window.AD.renderFullTable(state.movements, state.filters);
  window.requestAnimationFrame(() => window.AD.updateChromeMetrics());
}

function completeMovement(id) {
  const AD = window.AD;
  const m = state.movements.find((x) => x.id === id);
  if (!m || !state.sheet) return;

  m.status = 'completed';
  m.completedAt = new Date().toISOString();

  const ids = AD.loadCompletedIds(state.sheet.code);
  ids.add(id);
  AD.saveCompletedIds(state.sheet.code, ids);

  const times = AD.loadCompletedTimestamps(state.sheet.code);
  times[id] = m.completedAt;
  AD.saveCompletedTimestamps(state.sheet.code, times);

  AD.saveActiveSession(state.sheet, state.movements);
  refreshAll();
}

function undoMovement(id) {
  const AD = window.AD;
  const m = state.movements.find((x) => x.id === id);
  if (!m || !state.sheet) return;

  m.status = 'upcoming';
  m.completedAt = null;

  const ids = AD.loadCompletedIds(state.sheet.code);
  ids.delete(id);
  AD.saveCompletedIds(state.sheet.code, ids);

  const times = AD.loadCompletedTimestamps(state.sheet.code);
  delete times[id];
  AD.saveCompletedTimestamps(state.sheet.code, times);

  AD.saveActiveSession(state.sheet, state.movements);
  refreshAll();
}

function startClock() {
  const AD = window.AD;
  const tick = () => {
    const now = state.sheet ? AD.getEffectiveNow(state.sheet) : new Date();
    AD.renderClock(now);
    AD.updateCountdowns(now);
    if (state.sheet) {
      AD.renderLiveBoard(state.movements, state.sheet, now, state.liveFilter);
      AD.updateCountdowns(now, state.movements);
      const hour = now.getHours();
      const cheatOpen = document.getElementById('panel-cheat')?.classList.contains('active');
      if (cheatOpen && hour !== lastCheatPatternHour) {
        lastCheatPatternHour = hour;
        const container = document.getElementById('cheat-sheet-content');
        if (container?.querySelector('.cheat-route')) {
          AD.applyCheatSheetTimeTabs(container, hour);
        }
      }
    }
  };
  tick();
  clockTimer = setInterval(tick, 1000);
}

document.addEventListener('DOMContentLoaded', init);
