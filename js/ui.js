/**
 * DOM rendering for A&D Rail Replacement Dashboard
 */

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function formatCallingPattern(pattern) {
  if (!pattern?.length) return '<span class="tag tag-direct">Direct</span>';
  return pattern
    .map(
      (s) =>
        `<span class="stop-chip"><span class="stop-time">${escapeHtml(s.time)}</span> <span class="stop-code">${escapeHtml(s.code)}</span> ${escapeHtml(s.name)}</span>`
    )
    .join('');
}

/** Compact stop list for live vehicle cards (time + code only). */
function formatCallingPatternCompact(pattern) {
  if (!pattern?.length) return '';
  return pattern
    .map(
      (s) =>
        `<span class="stop-chip stop-chip--mini"><span class="stop-time">${escapeHtml(s.time)}</span> <span class="stop-code">${escapeHtml(s.code)}</span></span>`
    )
    .join('');
}

function formatCallingChain(pattern, sheetCode) {
  if (!pattern?.length) return `${sheetCode} → destination`;
  const codes = [];
  const seen = new Set();
  for (const s of pattern) {
    const c = s.code.replace(/H\d?$/, '').slice(0, 3);
    const key = s.code.substring(0, 3);
    if (!seen.has(key)) {
      seen.add(key);
      codes.push(s.code.length > 3 ? s.code.slice(0, 3) : s.code);
    }
  }
  return codes.join(' › ');
}

function renderClock(now) {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const pad = (n) => String(n).padStart(2, '0');
  el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const dateEl = document.getElementById('live-date');
  if (dateEl) {
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    dateEl.textContent = narrow
      ? now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      : now.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
  }
}

function renderUploadMeta(sheet) {
  const meta = document.getElementById('upload-meta');
  if (!meta) return;
  if (!sheet) {
    meta.hidden = true;
    return;
  }
  meta.hidden = false;
  meta.innerHTML = `
    <div class="meta-card">
      <span class="meta-label">Station</span>
      <strong>${escapeHtml(sheet.name)} <span class="code-badge">${escapeHtml(sheet.code)}</span></strong>
    </div>
    <div class="meta-card">
      <span class="meta-label">Valid</span>
      <strong>${escapeHtml(sheet.start)} 00:00 → ${escapeHtml(sheet.end)} 03:00</strong>
    </div>
  `;
}

function vehicleCard(
  cycle,
  { highlight = false, showComplete = true, showUndo = false, now = new Date(), view = 'departures' } = {}
) {
  const AD = window.AD;
  const vehicleState = AD.getVehicleState(cycle, now);
  const stateLabel = AD.getVehicleStateLabel(vehicleState);
  const dep = cycle.departure;
  const depMins = AD.minutesUntil(cycle.departureDatetime, now);
  const arrMins = cycle.arrivalDatetime ? AD.minutesUntil(cycle.arrivalDatetime, now) : null;
  const arrivalView = view === 'arrivals' || vehicleState === 'inbound';
  const stationCode = dep.sheetStationCode;
  const inbound = AD.getInboundOriginStop(cycle);

  const actionBtn = showComplete
    ? `<button type="button" class="btn btn-complete" data-action="complete" data-id="${escapeHtml(dep.id)}">Complete</button>`
    : showUndo
      ? `<button type="button" class="btn btn-undo" data-action="undo" data-id="${escapeHtml(dep.id)}">Reopen</button>`
      : '';

  const completedInfo =
    showUndo && dep.completedAt
      ? `<p class="completed-at">Completed ${new Date(dep.completedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>`
      : '';

  const countdownText =
    vehicleState === 'inbound'
      ? AD.formatInboundCountdown(arrMins)
      : AD.formatCountdown(depMins);

  const countdownDatetime =
    vehicleState === 'inbound' && cycle.arrivalDatetime
      ? cycle.arrivalDatetime
      : cycle.departureDatetime;

  const inboundLine = inbound
    ? `<p class="inbound-route">From <strong>${escapeHtml(inbound.code)}</strong>${inbound.time ? ` · ${escapeHtml(inbound.time)}` : ''}</p>`
    : '';

  let timesBlock;
  if (arrivalView && cycle.arrival) {
    timesBlock = `
      <div class="vehicle-times vehicle-times--arrival">
        <div class="v-time-block v-time-block--primary">
          <span class="time-label">Expected ${escapeHtml(stationCode)}</span>
          <span class="v-time arr-time">${escapeHtml(cycle.arrivalTime)}</span>
        </div>
        ${inboundLine}
        <div class="v-time-block v-time-block--secondary">
          <span class="time-label">Then departs</span>
          <span class="v-time">${escapeHtml(cycle.departureTime)} <span class="dep-arrow">→</span> ${escapeHtml(cycle.destinationCode)}</span>
        </div>
      </div>`;
  } else {
    const arrivalBlock = cycle.arrival
      ? `<div class="v-time-block">
          <span class="time-label">Arrived ${escapeHtml(stationCode)}</span>
          <span class="v-time arr-time">${escapeHtml(cycle.arrivalTime)}</span>
        </div>`
      : '';
    timesBlock = `
      <div class="vehicle-times">
        ${arrivalBlock}
        <div class="v-time-block v-time-block--dep">
          <span class="time-label">${cycle.arrival ? 'Next departure' : 'Departure'}</span>
          <span class="v-time dep-time">${escapeHtml(cycle.departureTime)} <span class="dep-arrow">→</span> ${escapeHtml(cycle.destinationCode)}</span>
        </div>
      </div>`;
  }

  const layoverBlock =
    cycle.arrival && cycle.layoverMins != null
      ? arrivalView
        ? `<p class="layover">Stands <strong>${escapeHtml(AD.formatLayover(cycle.layoverMins))}</strong> before departure</p>`
        : `<p class="layover">Layover: <strong>${escapeHtml(AD.formatLayover(cycle.layoverMins))}</strong></p>`
      : '';

  const callingPattern = cycle.callingPattern || dep.callingPattern || [];
  const isStoppers = !cycle.isDirect && callingPattern.length > 2;
  const routeChain = isStoppers ? formatCallingChain(callingPattern, stationCode) : '';

  const directTag = cycle.isDirect
    ? '<span class="tag tag-direct">Direct</span>'
    : `<button type="button" class="tag tag-stoppers tag-stoppers--toggle" data-action="toggle-stoppers" aria-expanded="false" title="Tap to show stop times">Stoppers</button>`;

  const routeInline = isStoppers
    ? `<span class="vehicle-route-inline" title="Calling pattern">${escapeHtml(routeChain)}</span>`
    : '';

  const routeDetail = isStoppers
    ? `<div class="vehicle-route-detail" hidden>
        <div class="calling-stops calling-stops--compact">${formatCallingPatternCompact(callingPattern)}</div>
      </div>`
    : '';

  const typeTag =
    vehicleState === 'inbound'
      ? '<span class="tag tag-inbound">Inbound</span>'
      : cycle.arrival
        ? '<span class="tag tag-at-station">At station</span>'
        : '';

  return `
    <article class="movement-card vehicle-card vehicle-card--${escapeHtml(vehicleState)} ${highlight ? 'movement-card--next' : ''}"
      data-cycle-id="${escapeHtml(cycle.id)}" data-id="${escapeHtml(dep.id)}">
      <header class="card-header">
        <span class="vehicle-state-badge">${escapeHtml(stateLabel)}</span>
        <div class="card-countdown" data-datetime="${escapeHtml(countdownDatetime)}">${escapeHtml(countdownText)}</div>
      </header>
      <div class="coach-head">
        <span class="coach-badge">Coach <strong>${escapeHtml(cycle.coachNumber || '—')}</strong></span>
        <span class="vehicle-badge">${escapeHtml(cycle.vehicleType || 'Vehicle unknown')}</span>
      </div>
      ${timesBlock}
      ${layoverBlock}
      <p class="dest-name-line">${escapeHtml(AD.shortDestinationLabel({ destinationCode: cycle.destinationCode, destinationName: cycle.destinationName }))}</p>
      <div class="card-tags card-tags--vehicle">
        ${typeTag}
        ${directTag}
        ${routeInline}
      </div>
      ${routeDetail}
      <dl class="card-details card-details--compact">
        <div><dt>Operator</dt><dd>${escapeHtml(AD.displayOperator(cycle.departure || cycle.arrival || cycle))}</dd></div>
        <div><dt>TOC</dt><dd>${escapeHtml(cycle.toc || '—')}</dd></div>
      </dl>
      ${completedInfo}
      <footer class="card-footer">${actionBtn}</footer>
    </article>
  `;
}

function movementCard(m, { highlight = false, showComplete = true, showUndo = false } = {}) {
  const typeClass = m.movementType === 'D' ? 'type-departure' : 'type-arrival';
  const directTag = m.isDirect
    ? '<span class="tag tag-direct">Direct</span>'
    : '<span class="tag tag-stoppers">Stoppers</span>';

  const actionBtn = showComplete
    ? `<button type="button" class="btn btn-complete" data-action="complete" data-id="${escapeHtml(m.id)}">Complete</button>`
    : showUndo
      ? `<button type="button" class="btn btn-undo" data-action="undo" data-id="${escapeHtml(m.id)}">Reopen</button>`
      : '';

  const completedInfo =
    showUndo && m.completedAt
      ? `<p class="completed-at">Completed ${new Date(m.completedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>`
      : '';

  return `
    <article class="movement-card ${highlight ? 'movement-card--next' : ''}" data-id="${escapeHtml(m.id)}">
      <header class="card-header">
        <div class="dep-time">${escapeHtml(m.time)}</div>
        <div class="card-countdown" data-datetime="${escapeHtml(m.datetime)}">${escapeHtml(window.AD.formatCountdown(window.AD.minutesUntil(m.datetime)))}</div>
      </header>
      <div class="card-dest">
        <span class="dest-code">${escapeHtml(m.destinationCode)}</span>
        <span class="dest-name">${escapeHtml(window.AD.shortDestinationLabel(m))}</span>
      </div>
      <div class="card-ops-ids">
        <span class="coach-badge" title="Coach / job number">Coach <strong>${escapeHtml(m.coachNumber || '—')}</strong></span>
        <span class="vehicle-badge" title="Vehicle type">${escapeHtml(m.vehicleType || 'Vehicle unknown')}</span>
      </div>
      <div class="card-tags">
        <span class="tag ${typeClass}">${m.movementType === 'D' ? 'Departure' : 'Arrival'}</span>
        ${directTag}
      </div>
      <dl class="card-details">
        <div><dt>Operator</dt><dd>${escapeHtml(window.AD.displayOperator(m))}</dd></div>
        <div><dt>Vehicle</dt><dd>${escapeHtml(m.vehicleType || '—')}</dd></div>
        <div><dt>Coach / Job</dt><dd>${escapeHtml(m.coachNumber || '—')}</dd></div>
        <div><dt>TOC</dt><dd>${escapeHtml(m.toc || '—')}</dd></div>
      </dl>
      <section class="card-calling">
        <h4>Calling pattern</h4>
        <p class="calling-chain">${escapeHtml(formatCallingChain(m.callingPattern, m.sheetStationCode))}</p>
        <div class="calling-stops">${formatCallingPattern(m.callingPattern)}</div>
      </section>
      ${completedInfo}
      <footer class="card-footer">${actionBtn}</footer>
    </article>
  `;
}

const LIVE_SUBTITLES = {
  departures: 'At station or leaving soon · arrived → next departure',
  arrivals: 'Inbound coaches · expected arrival then next departure',
  all: 'All active coaches · arrivals and departures',
};

const LIVE_EMPTY_MSG = {
  departures: 'No coaches at the station or due to leave in this window.',
  arrivals: 'No inbound coaches expected in the next 45 minutes.',
  all: 'No active coaches in the current time window.',
};

function renderLiveBoard(movements, sheet, now, liveFilter = 'departures') {
  const container = document.getElementById('live-board-list');
  const empty = document.getElementById('live-board-empty');
  if (!container) return;

  const AD = window.AD;
  const view = liveFilter || 'departures';
  const active = AD.filterLiveCyclesByView(AD.getActiveVehicleCycles(movements, now), view, now);

  const liveSub = document.getElementById('panel-live-sub');
  if (liveSub) liveSub.textContent = LIVE_SUBTITLES[view] || LIVE_SUBTITLES.departures;

  if (active.length === 0) {
    container.innerHTML = '';
    if (empty) {
      empty.hidden = false;
      empty.classList.remove('empty-msg--hero');
      empty.textContent =
        LIVE_EMPTY_MSG[view] ||
        (movements.some((m) => AD.isDepartureFromStation(m) || AD.isArrivalAtStation(m))
          ? 'Nothing in this view for the current time window.'
          : 'No vehicle movements found for this station on the sheet.');
    }
    return;
  }
  if (empty) {
    empty.hidden = true;
    empty.classList.remove('empty-msg--hero');
  }

  container.innerHTML = active
    .map((cycle, i) =>
      vehicleCard(cycle, {
        highlight: i === 0,
        showComplete: true,
        now,
        view: view === 'all' ? (AD.getVehicleState(cycle, now) === 'inbound' ? 'arrivals' : 'departures') : view,
      })
    )
    .join('');

  updateCountdowns(now, movements);
}

function renderCompleted(movements) {
  const container = document.getElementById('completed-list');
  const empty = document.getElementById('completed-empty');
  if (!container) return;

  const done = window.AD.buildVehicleCycles(movements)
    .filter((c) => c.departure.status === 'completed')
    .sort((a, b) => new Date(b.departure.completedAt) - new Date(a.departure.completedAt));

  if (done.length === 0) {
    container.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  container.innerHTML = done
    .map((cycle) => vehicleCard(cycle, { showComplete: false, showUndo: true }))
    .join('');
}

function activateCheatPatternTab(route, tab) {
  if (!tab) return;
  route.querySelectorAll('.cheat-tab').forEach((t) => {
    const on = t === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const value = route.querySelector('.cheat-pattern-value');
  if (value) value.textContent = tab.dataset.minutes;
}

function applyCheatSheetTimeTabs(container, hour) {
  if (!container) return;
  container.querySelectorAll('.cheat-route').forEach((route) => {
    const tabs = route.querySelectorAll('.cheat-tab');
    if (!tabs.length) return;

    let active = route.querySelector('.cheat-tab[data-tab-key="usual"]');
    route.querySelectorAll('.cheat-tab[data-hours]').forEach((tab) => {
      const hours = tab.dataset.hours.split(',').map((h) => parseInt(h, 10));
      if (hours.includes(hour)) active = tab;
    });
    activateCheatPatternTab(route, active);
  });
}

function cheatRouteCard(r, hour) {
  const variants = r.hourVariants || [];
  const activeKey = window.AD.patternTabKeyForHour(r, hour);
  const activePattern = window.AD.patternForTabKey(r, activeKey);
  const tabs =
    variants.length > 0
      ? `
          <nav class="cheat-pattern-tabs" aria-label="Departure pattern by time of day">
            <button type="button" class="cheat-tab${activeKey === 'usual' ? ' active' : ''}" data-tab-key="usual" data-minutes="${escapeHtml(r.minutePattern)}" aria-selected="${activeKey === 'usual' ? 'true' : 'false'}">Usual</button>
            ${variants
              .map(
                (v, i) => {
                  const key = `variant-${i}`;
                  const isActive = activeKey === key;
                  return `
              <button type="button" class="cheat-tab${isActive ? ' active' : ''}" data-tab-key="${key}" data-hours="${v.hours.join(',')}" data-minutes="${escapeHtml(v.minutePattern)}" aria-selected="${isActive ? 'true' : 'false'}" title="Pattern during ${escapeHtml(v.tabLabel)}">
                ${escapeHtml(v.tabLabel)}
              </button>`;
                }
              )
              .join('')}
          </nav>`
      : '';

  return `
        <article class="cheat-route">
          <header>
            <span class="cheat-code">${escapeHtml(r.code)}</span>
            <h3>${escapeHtml(r.name)}</h3>
          </header>
          ${tabs}
          <p class="cheat-pattern"><span class="label">Pattern:</span> <strong class="cheat-pattern-value">${escapeHtml(activePattern)}</strong></p>
          <p class="cheat-stops">
            <span class="label">${r.isDirect ? 'Route:' : 'Stops:'}</span>
            <code>${escapeHtml(r.stops)}</code>
          </p>
          ${r.isDirect ? '<span class="tag tag-direct">Fast direct mostly</span>' : '<span class="tag tag-stoppers">Stopper service</span>'}
        </article>`;
}

function wireCheatSheetTabs(container) {
  container.onclick = (e) => {
    const tab = e.target.closest('.cheat-tab');
    if (!tab) return;
    const route = tab.closest('.cheat-route');
    if (!route) return;
    activateCheatPatternTab(route, tab);
  };
}

function renderCheatSheet(movements, sheet, now = new Date()) {
  const container = document.getElementById('cheat-sheet-content');
  if (!container) return;

  if (!sheet) {
    container.innerHTML = '';
    return;
  }

  const sheetCode = sheet.code;
  const routes = window.AD.buildCheatSheet(movements, sheetCode);
  const legend = window.AD.collectStationCodes(movements, sheet);

  if (!routes.length) {
    container.innerHTML =
      '<p class="empty-msg">No departure patterns found on this sheet to build a cheat sheet.</p>';
    return;
  }

  const hour = now.getHours();

  container.innerHTML = `
    <div class="cheat-grid">
      ${routes.map((r) => cheatRouteCard(r, hour)).join('')}
    </div>
    <aside class="cheat-legend">
      <h4>Station codes on this sheet</h4>
      <ul>
        ${legend
          .map((s) => `<li><code>${escapeHtml(s.code)}</code> ${escapeHtml(s.name)}</li>`)
          .join('')}
      </ul>
    </aside>
  `;

  wireCheatSheetTabs(container);
}

function showEmptyState() {
  document.getElementById('station-title').textContent = 'Upload an A&D sheet to begin';

  const msg =
    '<p class="empty-msg empty-msg--hero">Tap ◈ in the header to upload your A&amp;D sheet (PDF, XLSX, or CSV).</p>';

  document.getElementById('live-board-list').innerHTML = '';
  const liveEmpty = document.getElementById('live-board-empty');
  if (liveEmpty) {
    liveEmpty.hidden = false;
    liveEmpty.innerHTML = msg;
  }

  document.getElementById('completed-list').innerHTML = '';
  const doneEmpty = document.getElementById('completed-empty');
  if (doneEmpty) {
    doneEmpty.hidden = false;
    doneEmpty.textContent = 'No sheet loaded yet.';
  }

  document.getElementById('cheat-sheet-content').innerHTML = msg;
  document.getElementById('full-table-body').innerHTML = '';
  const countEl = document.getElementById('table-count');
  if (countEl) countEl.textContent = '';
  const scrubPanel = document.getElementById('time-scrubber-panel');
  if (scrubPanel) scrubPanel.hidden = true;

  const liveSub = document.getElementById('panel-live-sub');
  if (liveSub) liveSub.textContent = 'Upload a sheet to track vehicles at the station';
}

function renderFullTable(movements, filters = {}) {
  const tbody = document.getElementById('full-table-body');
  if (!tbody) return;

  let rows = [...movements];
  const q = (filters.search || '').toLowerCase().trim();

  if (q) {
    rows = rows.filter((m) => {
      const hay = [
        m.time,
        m.destinationCode,
        m.destinationName,
        m.operator,
        m.vehicleType,
        m.coachNumber,
        m.toc,
        m.movementType,
        m.callingPattern?.map((s) => s.code + s.name).join(' '),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  if (filters.type) {
    rows = rows.filter((m) => m.movementType === filters.type);
  }

  const sortAsc = filters.sort !== 'desc';
  rows.sort((a, b) => {
    const cmp = a.time.localeCompare(b.time);
    return sortAsc ? cmp : -cmp;
  });

  tbody.innerHTML = rows
    .map(
      (m) => `
    <tr data-id="${escapeHtml(m.id)}" data-row-time="${escapeHtml(window.AD.padTime(m.time))}">
      <td>${escapeHtml(m.time)}</td>
      <td><span class="tag ${m.movementType === 'D' ? 'type-departure' : 'type-arrival'}">${m.movementType}</span></td>
      <td><strong>${escapeHtml(m.destinationCode)}</strong> ${escapeHtml(window.AD.shortDestinationLabel(m))}</td>
      <td>${escapeHtml(window.AD.displayOperator(m))}</td>
      <td>${escapeHtml(m.vehicleType || '—')}</td>
      <td class="cell-calling">${escapeHtml(formatCallingChain(m.callingPattern, m.sheetStationCode))}</td>
      <td class="cell-coach"><strong>${escapeHtml(m.coachNumber || '—')}</strong></td>
      <td>${escapeHtml(m.toc || '—')}</td>
      <td>${m.isDirect ? 'Direct' : 'Stoppers'}</td>
    </tr>
  `
    )
    .join('');

  const countEl = document.getElementById('table-count');
  if (countEl) countEl.textContent = `${rows.length} movements`;

  renderTimeScrubber(movements);
  setupTimeScrubberSync();
  window.requestAnimationFrame(() => updateChromeMetrics());
}

function renderTimeScrubber(movements) {
  const panel = document.getElementById('time-scrubber-panel');
  const scrubber = document.getElementById('time-scrubber');
  if (!panel || !scrubber) return;

  const times = [...new Set(movements.map((m) => window.AD.padTime(m.time)))].sort();
  if (times.length < 2) {
    panel.hidden = true;
    scrubber.innerHTML = '';
    return;
  }

  panel.hidden = false;
  scrubber.innerHTML = times
    .map(
      (t) =>
        `<button type="button" class="time-scrub-btn" data-jump-time="${escapeHtml(t)}" role="listitem">${escapeHtml(t)}</button>`
    )
    .join('');
}

let scrubberJumpLock = false;
let scrubberJumpLockTimer = null;
let tableSnapTimer = null;
let tableSnapInProgress = false;

function setActiveScrubTime(time, { scrollStrip = false } = {}) {
  const t = window.AD.padTime(time);
  document.querySelectorAll('.time-scrub-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.jumpTime === t);
  });
  document.querySelectorAll('#full-table-body tr.data-row--active').forEach((row) => {
    row.classList.remove('data-row--active');
  });
  document
    .querySelector(`#full-table-body tr[data-row-time="${t}"]`)
    ?.classList.add('data-row--active');
  if (scrollStrip) {
    const btn = document.querySelector(`.time-scrub-btn[data-jump-time="${t}"]`);
    btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }
}

function getTableScrollAnchorY() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--table-scroll-anchor');
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const sticky = document.getElementById('full-ad-sticky');
  if (sticky) return sticky.getBoundingClientRect().bottom + 8;
  const chromeH = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--app-chrome-h')
  );
  return (Number.isFinite(chromeH) ? chromeH : 100) + 24;
}

function findTableRowAtAnchor() {
  const tbody = document.getElementById('full-table-body');
  if (!tbody) return null;
  const anchorY = getTableScrollAnchorY();
  const rows = tbody.querySelectorAll('tr[data-row-time]');
  if (!rows.length) return null;

  for (const row of rows) {
    if (row.getBoundingClientRect().top >= anchorY - 2) return row;
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].getBoundingClientRect().bottom > anchorY) return rows[i];
  }
  return null;
}

function snapRowToAnchor(row, { behavior = 'smooth' } = {}) {
  if (!row) return;
  const anchorY = getTableScrollAnchorY();
  const delta = row.getBoundingClientRect().top - anchorY;
  if (Math.abs(delta) < 3) return;

  tableSnapInProgress = true;
  window.scrollBy({ top: delta, behavior });
  window.setTimeout(
    () => {
      tableSnapInProgress = false;
    },
    behavior === 'smooth' ? 420 : 40
  );
}

function syncScrubberToTableScroll() {
  if (scrubberJumpLock || tableSnapInProgress) return;
  const panel = document.getElementById('panel-full');
  if (!panel?.classList.contains('active')) return;

  const row = findTableRowAtAnchor();
  if (!row) return;

  setActiveScrubTime(row.dataset.rowTime, { scrollStrip: true });

  clearTimeout(tableSnapTimer);
  if (!window.matchMedia('(max-width: 767px)').matches) return;

  tableSnapTimer = window.setTimeout(() => {
    if (scrubberJumpLock || tableSnapInProgress) return;
    const at = findTableRowAtAnchor();
    if (!at) return;
    setActiveScrubTime(at.dataset.rowTime, { scrollStrip: true });
    snapRowToAnchor(at);
  }, 140);
}

function setupTimeScrubberSync() {
  const scrubber = document.getElementById('time-scrubber');
  if (!scrubber || scrubber.dataset.wheelBound) return;
  scrubber.dataset.wheelBound = '1';

  scrubber.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      scrubber.scrollLeft += e.deltaY;
    },
    { passive: false }
  );
}

function scrollToTableTime(time) {
  const t = window.AD.padTime(time);
  const row = document.querySelector(`#full-table-body tr[data-row-time="${t}"]`);
  if (!row) return;

  scrubberJumpLock = true;
  if (scrubberJumpLockTimer) window.clearTimeout(scrubberJumpLockTimer);
  clearTimeout(tableSnapTimer);

  setActiveScrubTime(t, { scrollStrip: true });
  snapRowToAnchor(row, { behavior: 'smooth' });

  scrubberJumpLockTimer = window.setTimeout(() => {
    scrubberJumpLock = false;
  }, 550);
}

function updateCountdowns(now = new Date(), movements = []) {
  const AD = window.AD;
  document.querySelectorAll('.vehicle-card').forEach((card) => {
    const cycleId = card.dataset.cycleId;
    const depId = card.dataset.id;
    const cycles = movements.length ? AD.buildVehicleCycles(movements) : [];
    const cycle =
      cycles.find((c) => c.id === cycleId) ||
      cycles.find((c) => c.departure.id === depId);
    if (!cycle) return;

    const state = AD.getVehicleState(cycle, now);
    const badge = card.querySelector('.vehicle-state-badge');
    if (badge) badge.textContent = AD.getVehicleStateLabel(state);

    card.className = card.className.replace(/vehicle-card--\w+/g, '').trim();
    card.classList.add(`vehicle-card--${state}`);

    const el = card.querySelector('.card-countdown[data-datetime]');
    if (!el) return;
    const depMins = AD.minutesUntil(cycle.departureDatetime, now);
    const text =
      state === 'inbound'
        ? AD.formatInboundCountdown(AD.minutesUntil(cycle.arrivalDatetime, now))
        : AD.formatCountdown(depMins);
    el.textContent = text;
    card.classList.toggle('movement-card--imminent', state === 'departing_soon' || (depMins >= 0 && depMins <= 5));
  });

  document.querySelectorAll('.movement-card:not(.vehicle-card) .card-countdown[data-datetime]').forEach((el) => {
    const mins = AD.minutesUntil(el.dataset.datetime, now);
    el.textContent = AD.formatCountdown(mins);
  });
}

function showParseStatus(message, isError = false) {
  const el = document.getElementById('parse-status');
  if (!el) return;
  el.textContent = message || '';
  if (!message) {
    el.hidden = true;
    return;
  }
  el.className = `parse-status ${isError ? 'parse-status--error' : 'parse-status--ok'}`;
  el.hidden = false;
}

function updateChromeMetrics() {
  const chrome = document.getElementById('app-chrome');
  if (!chrome) return;
  const chromeH = Math.ceil(chrome.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--app-chrome-h', `${chromeH}px`);

  const sticky = document.getElementById('full-ad-sticky');
  const panelFull = document.getElementById('panel-full');
  if (sticky && panelFull?.classList.contains('active')) {
    const anchor = Math.ceil(sticky.getBoundingClientRect().bottom) + 8;
    document.documentElement.style.setProperty('--table-scroll-anchor', `${anchor}px`);
  } else {
    document.documentElement.style.setProperty(
      '--table-scroll-anchor',
      `${chromeH + 8}px`
    );
  }
}

(function (g) {
  g.AD = g.AD || {};
  Object.assign(g.AD, {
    renderClock,
    renderUploadMeta,
    renderLiveBoard,
    renderCompleted,
    renderCheatSheet,
    applyCheatSheetTimeTabs,
    renderFullTable,
    updateCountdowns,
    showParseStatus,
    showEmptyState,
    scrollToTableTime,
    setActiveScrubTime,
    syncScrubberToTableScroll,
    setupTimeScrubberSync,
    updateChromeMetrics,
  });
})(window);
