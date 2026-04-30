const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function parseProxy(rawLine) {
  let line = String(rawLine || '').trim();
  if (!line) return null;
  // Strip markdown auto-link artifacts like [text](mailto:text)
  line = line.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/g, '$1');
  // Also strip surrounding quotes/whitespace
  line = line.replace(/^["'`]|["'`]$/g, '').trim();
  const m = line.match(
    /^(socks5|socks4|http|https):\/\/(?:([^:@\s]+):([^@\s]+)@)?([^:@\s]+):(\d+)\s*$/i
  );
  if (!m) return null;
  return {
    protocol: m[1].toLowerCase(),
    user: m[2] || '',
    pass: m[3] || '',
    host: m[4],
    port: parseInt(m[5], 10),
    raw: line,
  };
}

function buildProxyUrl(p) {
  const auth = p.user
    ? `${encodeURIComponent(p.user)}:${encodeURIComponent(p.pass)}@`
    : '';
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

function httpGet(targetUrl, { agent = null, timeoutMs = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 ProxyChecker/1.0',
        Accept: '*/*',
        ...headers,
      },
      timeout: timeoutMs,
    };
    if (agent) opts.agent = agent;
    const req = lib.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function detectIP(proxy) {
  const agent = new SocksProxyAgent(buildProxyUrl(proxy));
  // Try ipify, fall back to ifconfig.me, then icanhazip
  const probes = [
    { url: 'https://api.ipify.org?format=json', extract: (b) => JSON.parse(b).ip },
    { url: 'https://ifconfig.me/ip', extract: (b) => b.trim() },
    { url: 'https://icanhazip.com', extract: (b) => b.trim() },
  ];
  let lastErr;
  for (const probe of probes) {
    try {
      const res = await httpGet(probe.url, { agent, timeoutMs: 15000 });
      if (res.status === 200) {
        const ip = probe.extract(res.body);
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
      }
      lastErr = new Error(`HTTP ${res.status} from ${probe.url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('IP tespit edilemedi');
}

async function getIpApiInfo(ip) {
  // ip-api.com free tier: HTTP only, 45 req/min, no API key needed.
  // Returns proxy/hosting/mobile booleans which catch residential proxy services
  // that getipintel's blacklist alone misses.
  try {
    const fields =
      'status,message,country,countryCode,region,regionName,city,isp,org,as,proxy,hosting,mobile';
    const res = await httpGet(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`,
      { timeoutMs: 10000 }
    );
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      if (data.status === 'success') return data;
    }
  } catch (e) {
    /* ignore */
  }
  return {};
}

async function getIpScore(ip, contact) {
  const url = `https://check.getipintel.net/check.php?ip=${encodeURIComponent(
    ip
  )}&contact=${encodeURIComponent(contact)}&format=json`;
  const res = await httpGet(url, { timeoutMs: 30000 });
  const raw = (res.body || '').trim();
  let score = NaN;
  let apiStatus = 'unknown';
  try {
    const data = JSON.parse(raw);
    apiStatus = data.status || 'unknown';
    if (apiStatus === 'success') {
      score = parseFloat(data.result);
    }
  } catch (e) {
    // Fall back to plain text parsing in case API ever returns non-JSON
    score = parseFloat(raw);
    apiStatus = Number.isNaN(score) ? 'error' : 'success';
  }
  return { score, raw, apiStatus, httpStatus: res.status };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    worker
  );
  await Promise.all(workers);
  return results;
}

ipcMain.handle('check-proxies', async (event, { lines, contact }) => {
  const proxies = (lines || [])
    .map((l) => ({ raw: l, parsed: parseProxy(l) }))
    .filter((x) => x.raw && x.raw.trim());

  const total = proxies.length;
  event.sender.send('check-started', { total });

  // Phase 1: detect IP through proxy + ipinfo lookup (parallel)
  const ipResults = new Array(total);
  await pool(proxies, 5, async (item, idx) => {
    if (!item.parsed) {
      ipResults[idx] = { error: 'Geçersiz format' };
      event.sender.send('check-progress', {
        index: idx,
        total,
        stage: 'ip-failed',
        raw: item.raw,
        error: 'Geçersiz format',
      });
      return;
    }
    try {
      const ip = await detectIP(item.parsed);
      const info = await getIpApiInfo(ip);
      ipResults[idx] = {
        ip,
        country: info.countryCode || info.country || '',
        countryName: info.country || '',
        region: info.regionName || info.region || '',
        city: info.city || '',
        isp: info.isp || info.org || '',
        org: info.org || '',
        as: info.as || '',
        isProxy: info.proxy === true,
        isHosting: info.hosting === true,
        isMobile: info.mobile === true,
      };
      event.sender.send('check-progress', {
        index: idx,
        total,
        stage: 'ip-detected',
        raw: item.raw,
        ip,
        country: ipResults[idx].country,
        isp: ipResults[idx].isp,
        isProxy: ipResults[idx].isProxy,
        isHosting: ipResults[idx].isHosting,
        isMobile: ipResults[idx].isMobile,
      });
    } catch (e) {
      ipResults[idx] = { error: e.message || String(e) };
      event.sender.send('check-progress', {
        index: idx,
        total,
        stage: 'ip-failed',
        raw: item.raw,
        error: e.message || String(e),
      });
    }
  });

  // Phase 2: getipintel scoring (serial, throttled to ~13/min)
  const finalResults = [];
  for (let i = 0; i < proxies.length; i++) {
    const item = proxies[i];
    const ipData = ipResults[i] || {};
    const result = {
      index: i,
      raw: item.raw,
      ...ipData,
    };

    if (ipData.error || !ipData.ip) {
      result.status = 'proxy-error';
      result.error = ipData.error || 'IP yok';
      finalResults.push(result);
      event.sender.send('check-result', result);
      continue;
    }

    event.sender.send('check-progress', {
      index: i,
      total,
      stage: 'scoring',
      raw: item.raw,
      ip: ipData.ip,
    });

    try {
      const { score, raw, apiStatus } = await getIpScore(ipData.ip, contact);
      result.score = score;
      result.scoreRaw = raw;
      if (apiStatus !== 'success' || Number.isNaN(score) || score < 0) {
        result.status = 'score-error';
        result.error = `getipintel: ${raw}`;
      } else {
        result.status = 'ok';
      }
    } catch (e) {
      result.status = 'score-error';
      result.error = e.message || String(e);
    }

    finalResults.push(result);
    event.sender.send('check-result', result);

    // Free tier rate limit: 15/min — leave headroom with 4.5s gap
    if (i < proxies.length - 1) await sleep(4500);
  }

  event.sender.send('check-done', { total, results: finalResults });
  return finalResults;
});

ipcMain.handle('save-csv', async (event, { csv, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Sonuçları CSV olarak kaydet',
    defaultPath: suggestedName || 'proxy-results.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, csv, 'utf8');
  return { saved: true, path: result.filePath };
});
