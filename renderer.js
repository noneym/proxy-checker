const els = {
  email: document.getElementById('email'),
  proxies: document.getElementById('proxies'),
  checkBtn: document.getElementById('check-btn'),
  clearBtn: document.getElementById('clear-btn'),
  exportBtn: document.getElementById('export-btn'),
  proxyCount: document.getElementById('proxy-count'),
  statusText: document.getElementById('status-text'),
  counter: document.getElementById('counter'),
  progressFill: document.getElementById('progress-fill'),
  resultsBody: document.getElementById('results-body'),
};

// Restore saved email
els.email.value = localStorage.getItem('contactEmail') || '';
els.email.addEventListener('input', () => {
  localStorage.setItem('contactEmail', els.email.value.trim());
});

// Live proxy count
function updateProxyCount() {
  const lines = els.proxies.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  els.proxyCount.textContent = `${lines.length} proxy`;
}
els.proxies.addEventListener('input', updateProxyCount);
updateProxyCount();

// State
let rows = [];
let isRunning = false;

// Helpers
function setStatus(text) {
  els.statusText.textContent = text;
}
function setCounter(text) {
  els.counter.textContent = text;
}
function setProgress(done, total) {
  const pct = total === 0 ? 0 : (done / total) * 100;
  els.progressFill.style.width = `${pct}%`;
}

function clearResults() {
  rows = [];
  els.resultsBody.innerHTML =
    '<tr class="empty"><td colspan="7">Henüz sonuç yok. Proxy listesini yapıştırıp <b>Kontrol Et</b>\'e bas.</td></tr>';
  els.exportBtn.disabled = true;
  setProgress(0, 1);
  setStatus('Hazır.');
  setCounter('');
}

function ensureRow(index, proxyRaw) {
  if (rows[index]) return rows[index];
  // Remove "empty" placeholder row on first insert
  const empty = els.resultsBody.querySelector('tr.empty');
  if (empty) empty.remove();
  const tr = document.createElement('tr');
  tr.dataset.index = String(index);
  tr.innerHTML = `
    <td class="col-num">${index + 1}</td>
    <td class="col-proxy">${escapeHtml(proxyRaw)}</td>
    <td class="col-ip">—</td>
    <td class="col-country">—</td>
    <td class="col-isp">—</td>
    <td class="col-score">—</td>
    <td class="col-status"><span class="badge badge-pending">Bekliyor</span></td>
  `;
  els.resultsBody.appendChild(tr);
  const row = { tr, data: { index, raw: proxyRaw } };
  rows[index] = row;
  return row;
}

function updateRow(index, patch) {
  const row = rows[index];
  if (!row) return;
  Object.assign(row.data, patch);
  const d = row.data;
  const cells = row.tr.children;
  cells[2].textContent = d.ip || '—';
  cells[3].textContent = d.country || '—';
  cells[4].textContent = d.isp || '—';

  // Score cell with color
  const scoreCell = cells[5];
  if (typeof d.score === 'number' && !Number.isNaN(d.score) && d.score >= 0) {
    scoreCell.textContent = d.score.toFixed(4);
    scoreCell.className = 'col-score ' + scoreClass(d.score);
  } else {
    scoreCell.textContent = '—';
    scoreCell.className = 'col-score';
  }

  // Status badge
  const statusCell = cells[6];
  statusCell.innerHTML = renderStatus(d);
}

function scoreClass(s) {
  if (s < 0.5) return 'score-ok';
  if (s < 0.9) return 'score-warn';
  return 'score-bad';
}

function renderStatus(d) {
  if (d.status === 'ok') {
    if (d.score < 0.5)
      return '<span class="badge badge-ok">Temiz</span>';
    if (d.score < 0.9)
      return '<span class="badge badge-warn">Şüpheli</span>';
    return '<span class="badge badge-bad">VPN/Proxy</span>';
  }
  if (d.status === 'proxy-error')
    return `<span class="badge badge-error" title="${escapeAttr(
      d.error || ''
    )}">Proxy hata</span>`;
  if (d.status === 'score-error')
    return `<span class="badge badge-error" title="${escapeAttr(
      d.error || ''
    )}">Skor hata</span>`;
  if (d.stage === 'ip-detected')
    return '<span class="badge badge-pending">Skorlanıyor</span>';
  if (d.stage === 'scoring')
    return '<span class="badge badge-pending">Skorlanıyor</span>';
  return '<span class="badge badge-pending">İşleniyor</span>';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// Buttons
els.clearBtn.addEventListener('click', () => {
  if (isRunning) return;
  els.proxies.value = '';
  updateProxyCount();
  clearResults();
});

els.checkBtn.addEventListener('click', async () => {
  if (isRunning) return;
  const contact = els.email.value.trim();
  if (!contact || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) {
    alert('Geçerli bir contact email girmelisin (getipintel.net için zorunlu).');
    els.email.focus();
    return;
  }
  const lines = els.proxies.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    alert('En az bir proxy gir.');
    return;
  }

  // Clear prior rows
  rows = [];
  els.resultsBody.innerHTML = '';
  lines.forEach((line, i) => ensureRow(i, line));

  isRunning = true;
  els.checkBtn.disabled = true;
  els.clearBtn.disabled = true;
  els.exportBtn.disabled = true;
  setStatus('Proxy IP\'leri tespit ediliyor...');
  setProgress(0, lines.length);
  setCounter(`0 / ${lines.length}`);

  try {
    await window.api.checkProxies({ lines, contact });
  } catch (e) {
    setStatus('Hata: ' + (e.message || String(e)));
  } finally {
    isRunning = false;
    els.checkBtn.disabled = false;
    els.clearBtn.disabled = false;
    els.exportBtn.disabled = rows.length === 0;
  }
});

els.exportBtn.addEventListener('click', async () => {
  const header = ['#', 'Proxy', 'IP', 'Country', 'Region', 'City', 'ISP', 'Score', 'Status', 'Error'];
  const lines = [header.join(',')];
  rows.forEach((row, i) => {
    const d = row.data;
    const cells = [
      i + 1,
      d.raw || '',
      d.ip || '',
      d.country || '',
      d.region || '',
      d.city || '',
      d.isp || '',
      typeof d.score === 'number' ? d.score : '',
      d.status || '',
      d.error || '',
    ].map(csvEscape);
    lines.push(cells.join(','));
  });
  const csv = lines.join('\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await window.api.saveCsv({ csv, suggestedName: `proxy-results-${stamp}.csv` });
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// IPC events
let progressDone = 0;
let progressTotal = 0;

window.api.onStarted(({ total }) => {
  progressDone = 0;
  progressTotal = total;
  setProgress(0, total);
  setCounter(`0 / ${total}`);
});

window.api.onProgress((data) => {
  const row = rows[data.index];
  if (!row) return;
  const patch = { stage: data.stage };
  if (data.ip) patch.ip = data.ip;
  if (data.country !== undefined) patch.country = data.country;
  if (data.isp !== undefined) patch.isp = data.isp;
  if (data.error) patch.error = data.error;
  if (data.stage === 'ip-failed') patch.status = 'proxy-error';
  updateRow(data.index, patch);

  if (data.stage === 'scoring') {
    setStatus(`getipintel skoru alınıyor: ${data.ip || ''}`);
  } else if (data.stage === 'ip-detected') {
    setStatus(`IP tespit edildi: ${data.ip} (${data.country || '?'})`);
  } else if (data.stage === 'ip-failed') {
    setStatus(`IP tespit edilemedi: ${data.error || ''}`);
  }
});

window.api.onResult((data) => {
  updateRow(data.index, data);
  progressDone++;
  setProgress(progressDone, progressTotal);
  setCounter(`${progressDone} / ${progressTotal}`);
});

window.api.onDone(({ total }) => {
  setStatus(`Tamamlandı (${total} proxy).`);
  setProgress(total, total);
  els.exportBtn.disabled = rows.length === 0;
});
