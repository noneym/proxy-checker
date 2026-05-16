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
  const probes = [
    { url: 'https://api.ipify.org?format=json', extract: (b) => JSON.parse(b).ip },
    { url: 'https://ifconfig.me/ip', extract: (b) => b.trim() },
    { url: 'https://icanhazip.com', extract: (b) => b.trim() },
  ];
  let lastErr;
  for (const probe of probes) {
    try {
      const t0 = Date.now();
      const res = await httpGet(probe.url, { agent, timeoutMs: 15000 });
      const latencyMs = Date.now() - t0;
      if (res.status === 200) {
        const ip = probe.extract(res.body);
        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return { ip, latencyMs };
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

async function getGetIpIntelScore(ip, contact) {
  // oflags=r returns two fields:
  //   result          — combined VPN/badIP/residential score (0-1)
  //   ResidentialProxy — residential-proxy-specific probability (0-1)
  // For residential proxy checking we want the latter as the primary score.
  const url = `https://check.getipintel.net/check.php?ip=${encodeURIComponent(
    ip
  )}&contact=${encodeURIComponent(contact)}&format=json&oflags=r`;
  const res = await httpGet(url, { timeoutMs: 30000 });
  const raw = (res.body || '').trim();
  let combined = NaN;
  let residential = NaN;
  let apiStatus = 'unknown';
  try {
    const data = JSON.parse(raw);
    apiStatus = data.status || 'unknown';
    if (apiStatus === 'success') {
      combined = parseFloat(data.result);
      if (data.ResidentialProxy !== undefined && data.ResidentialProxy !== null) {
        residential = parseFloat(data.ResidentialProxy);
      }
    }
  } catch (e) {
    combined = parseFloat(raw);
    apiStatus = Number.isNaN(combined) ? 'error' : 'success';
  }
  // Primary score = ResidentialProxy when available, else combined result.
  // Normalize 0-1 → 0-100 for the unified score scale.
  const primary = Number.isFinite(residential) && residential >= 0
    ? residential
    : combined;
  const score100 = Number.isFinite(primary) && primary >= 0 ? primary * 100 : NaN;
  const combined100 =
    Number.isFinite(combined) && combined >= 0 ? combined * 100 : null;
  const residential100 =
    Number.isFinite(residential) && residential >= 0 ? residential * 100 : null;
  return {
    provider: 'getipintel',
    score: score100,
    combinedScore: combined100,
    residentialScore: residential100,
    raw,
    apiStatus,
    httpStatus: res.status,
  };
}

async function getAbuseIpDbInfo(ip, apiKey) {
  // AbuseIPDB free tier: 1000 checks/day with email-only signup.
  // Returns abuseConfidenceScore (0-100) based on community abuse reports.
  // Catches "burned" residential proxies that have been reported for spam/bot/scan.
  try {
    // maxAgeInDays=365 catches a full year of abuse history. Free tier max.
    const res = await httpGet(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(
        ip
      )}&maxAgeInDays=365&verbose`,
      {
        headers: { Key: apiKey, Accept: 'application/json' },
        timeoutMs: 15000,
      }
    );
    if (res.status === 401 || res.status === 403) {
      return { error: 'AbuseIPDB: anahtar geçersiz', fatal: true };
    }
    if (res.status === 429) {
      return { error: 'AbuseIPDB: günlük limit aşıldı', fatal: true };
    }
    if (res.status !== 200) return { error: `AbuseIPDB HTTP ${res.status}` };
    const parsed = JSON.parse(res.body);
    if (parsed.errors) {
      return { error: parsed.errors.map((e) => e.detail).join(', '), fatal: true };
    }
    const d = parsed.data || {};
    return {
      abuseScore: d.abuseConfidenceScore,
      totalReports: d.totalReports,
      lastReportedAt: d.lastReportedAt,
      isWhitelisted: d.isWhitelisted,
      usageType: d.usageType,
      isTor: d.isTor,
    };
  } catch (e) {
    return { error: `AbuseIPDB: ${e.message || e}` };
  }
}

async function getIpqsScore(ip, apiKey) {
  // strictness=1: balanced. allow_public_access_points=true: avoid false positives on shared wifi.
  const url = `https://www.ipqualityscore.com/api/json/ip/${encodeURIComponent(
    apiKey
  )}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true`;
  const res = await httpGet(url, { timeoutMs: 30000 });
  const raw = (res.body || '').trim();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return {
      provider: 'ipqs',
      score: NaN,
      raw,
      apiStatus: 'error',
      error: 'Geçersiz IPQS yanıtı',
    };
  }
  if (!data.success) {
    const msg = (data.message || '').toLowerCase();
    // Account-level errors that affect every subsequent call too. Surface as fatal
    // so the caller can abort the batch instead of repeating the same error per IP.
    const fatal =
      msg.includes('insufficient credit') ||
      msg.includes('unauthorized') ||
      msg.includes('invalid') ||
      msg.includes('disabled') ||
      msg.includes('exceeded');
    return {
      provider: 'ipqs',
      score: NaN,
      raw,
      apiStatus: 'error',
      fatal,
      error: data.message || 'IPQS hatası',
    };
  }
  return {
    provider: 'ipqs',
    score: typeof data.fraud_score === 'number' ? data.fraud_score : NaN,
    raw,
    apiStatus: 'success',
    flags: {
      proxy: !!data.proxy,
      vpn: !!data.vpn,
      tor: !!data.tor,
      activeVpn: !!data.active_vpn,
      activeTor: !!data.active_tor,
      recentAbuse: !!data.recent_abuse,
      bot: !!data.bot_status,
      mobile: !!data.mobile,
      crawler: !!data.is_crawler,
      connectionType: data.connection_type || '',
    },
    isp: data.ISP || '',
    asn: data.ASN || '',
    countryCode: data.country_code || '',
  };
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

ipcMain.handle('check-proxies', async (event, { lines, contact, ipqsKey, abuseKey }) => {
  const useIpqs = !!(ipqsKey && ipqsKey.trim());
  const useAbuse = !!(abuseKey && abuseKey.trim());
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
      const { ip, latencyMs } = await detectIP(item.parsed);
      const info = await getIpApiInfo(ip);
      const abuse = useAbuse ? await getAbuseIpDbInfo(ip, abuseKey.trim()) : null;
      ipResults[idx] = {
        ip,
        latencyMs,
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
        abuseScore: abuse && typeof abuse.abuseScore === 'number' ? abuse.abuseScore : null,
        abuseReports: abuse && typeof abuse.totalReports === 'number' ? abuse.totalReports : null,
        abuseLastReportedAt: abuse ? abuse.lastReportedAt : null,
        abuseUsageType: abuse ? abuse.usageType : null,
        abuseIsTor: abuse ? !!abuse.isTor : false,
        abuseError: abuse && abuse.error ? abuse.error : null,
      };
      event.sender.send('check-progress', {
        index: idx,
        total,
        stage: 'ip-detected',
        raw: item.raw,
        ip,
        latencyMs,
        country: ipResults[idx].country,
        isp: ipResults[idx].isp,
        isProxy: ipResults[idx].isProxy,
        isHosting: ipResults[idx].isHosting,
        isMobile: ipResults[idx].isMobile,
        abuseScore: ipResults[idx].abuseScore,
        abuseReports: ipResults[idx].abuseReports,
        abuseUsageType: ipResults[idx].abuseUsageType,
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

  // Phase 2: scoring. We collect signals from up to three sources and pick the
  // worst (max score) so a single source missing a residential proxy doesn't
  // mask abuse signal from another. Sources:
  //   - AbuseIPDB (already fetched in phase 1) — abuseConfidenceScore 0-100
  //   - IPQS — fraud_score 0-100, plus proxy/vpn/tor/active_vpn/recent_abuse flags
  //   - getipintel — score 0-1 normalized to 0-100
  // IPQS turns itself off if the account hits a fatal error mid-batch (e.g.
  // insufficient credits) so we don't burn rate limit on guaranteed failures.
  const finalResults = [];
  let activeIpqs = useIpqs;
  // Run getipintel whenever an email is provided, independent of IPQS. They
  // give different signals (getipintel oflags=r = residential proxy probability,
  // IPQS = ML fraud_score) and we want both as candidates when available.
  // The 15/min rate limit is enforced by the 4.5s inter-iteration sleep below.
  let activeGetIntel = !!(contact && contact.trim());

  let warnedNoScorer = false;

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

    const candidates = [];
    let lastErr = null;

    // 1. AbuseIPDB (already fetched in phase 1)
    if (typeof ipData.abuseScore === 'number') {
      candidates.push({ provider: 'abuseipdb', score: ipData.abuseScore });
    }
    if (ipData.abuseError) lastErr = ipData.abuseError;

    // 2. IPQS
    if (activeIpqs) {
      try {
        const r = await getIpqsScore(ipData.ip, ipqsKey.trim());
        if (r.flags) {
          result.isProxy = r.flags.proxy || result.isProxy;
          result.isVpn = r.flags.vpn;
          result.isTor = r.flags.tor;
          result.isActiveVpn = r.flags.activeVpn;
          result.isActiveTor = r.flags.activeTor;
          result.isRecentAbuse = r.flags.recentAbuse;
          result.isBot = r.flags.bot;
          result.isCrawler = r.flags.crawler;
          result.connectionType = r.flags.connectionType;
        }
        if (r.apiStatus === 'success' && Number.isFinite(r.score)) {
          candidates.push({ provider: 'ipqs', score: r.score });
        } else {
          lastErr = r.error || `ipqs: ${r.raw}`;
          if (r.fatal) {
            activeIpqs = false;
            event.sender.send('check-aborted', {
              reason: `IPQS devre dışı bırakıldı: ${r.error}`,
              fatalSource: 'ipqs',
              softAbort: true,
            });
          }
        }
      } catch (e) {
        lastErr = `ipqs: ${e.message || e}`;
      }
    }

    // 3. getipintel (only when no IPQS, to avoid wasting its tight rate limit)
    if (activeGetIntel) {
      try {
        const r = await getGetIpIntelScore(ipData.ip, contact);
        if (r.apiStatus === 'success' && Number.isFinite(r.score)) {
          // Score here = ResidentialProxy probability (preferred) or combined.
          candidates.push({ provider: 'getipintel', score: r.score });
        } else {
          lastErr = r.error || `getipintel: ${r.raw}`;
        }
        if (typeof r.residentialScore === 'number') {
          result.residentialScore = r.residentialScore;
          if (r.residentialScore >= 30) result.isResidentialProxy = true;
        }
        if (typeof r.combinedScore === 'number') {
          result.combinedScore = r.combinedScore;
        }
      } catch (e) {
        lastErr = `getipintel: ${e.message || e}`;
      }
    }

    if (candidates.length > 0) {
      // Pick highest score across sources — abuse signal from any source counts.
      const top = candidates.reduce((a, b) => (a.score > b.score ? a : b));
      result.score = top.score;
      result.scoreProvider = top.provider;
      result.scoreSources = candidates;
      result.status = 'ok';
    } else {
      result.status = 'score-error';
      result.error = lastErr || 'Hiçbir scorer yapılandırılmamış';
      if (!warnedNoScorer && !activeIpqs && !activeGetIntel && !useAbuse) {
        warnedNoScorer = true;
        event.sender.send('check-aborted', {
          reason:
            'Hiçbir scorer yapılandırılmamış. AbuseIPDB key veya getipintel için email gir.',
          fatalSource: 'config',
        });
      }
    }

    finalResults.push(result);
    event.sender.send('check-result', result);

    // Throttle only when getipintel is the active scorer (15/min limit).
    if (i < proxies.length - 1) {
      await sleep(activeGetIntel ? 4500 : 300);
    }
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
