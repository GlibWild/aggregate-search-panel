/**
 * 冒烟测试：以 headless Edge 加载 dist，验证后台启动、面板渲染、会话检测与核心消息链路。
 *
 * 用法：
 *   npm run build && npm run smoke
 *
 * 需要本机安装 Microsoft Edge；可通过 EDGE_PATH 环境变量指定浏览器路径。
 * 该脚本仅用于开发验证，不参与构建。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, '..', 'dist');
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const edgeCandidates = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    : '',
].filter(Boolean);
const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('未找到 dist/manifest.json，请先运行 npm run build');
  process.exit(1);
}
if (!edgePath) {
  console.error('未找到 Microsoft Edge，请通过 EDGE_PATH 指定 msedge.exe 路径');
  process.exit(1);
}

// 使用纯英文临时目录，规避部分环境对非 ASCII 扩展路径的兼容问题。
// 如需测试指定目录，可通过 SMOKE_EXT_DIR 传入（不会复制、不会删除该目录）。
const workDir = await mkdtemp(join(tmpdir(), 'agg-ext-smoke-'));
const profileDir = join(workDir, 'profile');
const customExtDir = process.env.SMOKE_EXT_DIR;
const extDir = customExtDir ? resolve(customExtDir) : join(workDir, 'extension');
let canTestLogin = false;
if (!customExtDir) {
  await cp(distDir, extDir, { recursive: true });
  // 为了让冒烟测试能模拟“浏览器中已有登录态”，临时给测试扩展授予 example.com 主机权限。
  const manifestPath = join(extDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['*://*.example.com/*', '*://127.0.0.1/*'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  canTestLogin = true;
}

// 本地搜索页：用于验证“只保留本站域名结果”的过滤链路。
const searchServer = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><body><main>
    <a href="/page/1">站内结果标题一</a>
    <a href="https://external.example.net/ad">站外广告标题二</a>
    <section class="note-item">
      <a href="/page/2"><img alt="" /></a>
      <h2>图片卡片结果标题三</h2>
    </section>
  </main></body></html>`);
});
await new Promise((resolvePromise) => searchServer.listen(0, '127.0.0.1', resolvePromise));
const localPort = searchServer.address().port;
const localBase = `http://127.0.0.1:${localPort}`;

const port = 9300 + Math.floor(Math.random() * 400);
const baseUrl = `http://127.0.0.1:${port}`;

function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const events = [];
  let nextId = 1;
  const ready = new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolvePromise(message.result);
      }
      return;
    }
    if (message.method) {
      events.push(message);
    }
  });
  return {
    ready,
    events,
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { resolve: resolvePromise, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP 超时: ${method}`));
          }
        }, 15_000);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function listTargets() {
  const response = await fetch(`${baseUrl}/json/list`);
  return response.json();
}

async function findExtension() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const targets = await listTargets();
    const workers = targets.filter(
      (target) => target.type === 'service_worker' && target.url.startsWith('chrome-extension://'),
    );
    for (const worker of workers) {
      try {
        const client = cdp(worker.webSocketDebuggerUrl);
        await client.ready;
        await client.send('Runtime.enable');
        const result = await client.send('Runtime.evaluate', {
          expression: 'JSON.stringify(chrome.runtime.getManifest())',
          returnByValue: true,
        });
        const manifest = JSON.parse(result.result.value);
        client.close();
        if (String(manifest.name).includes('聚合搜索')) {
          return { id: worker.url.split('/')[2], manifest, worker };
        }
      } catch {
        // 忽略无法连接的 target
      }
    }
    await sleep(500);
  }
  return null;
}

const child = spawn(
  edgePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extDir}`,
    `--disable-extensions-except=${extDir}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let exitCode = 1;
try {
  await sleep(2_000);
  const found = await findExtension();
  if (!found) {
    throw new Error('未找到扩展的 Service Worker，可能未加载或已休眠');
  }
  console.log('扩展 ID:', found.id);
  console.log('后台已启动:', found.worker.url);

  const pageUrl = `chrome-extension://${found.id}/sidepanel/index.html`;
  const createResponse = await fetch(`${baseUrl}/json/new?${encodeURIComponent(pageUrl)}`, {
    method: 'PUT',
  });
  const page = await createResponse.json();
  const client = cdp(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await sleep(3_500);

  const result = await client.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      title: document.title,
      text: document.body.innerText.slice(0, 800),
      hasRoot: !!document.querySelector('#root')?.children.length
    })`,
    returnByValue: true,
  });
  const info = JSON.parse(result.result.value);
  console.log('页面标题:', info.title);
  console.log('面板文本:', info.text.replace(/\n+/g, ' | '));
  console.log('React 已挂载:', info.hasRoot);

  const errors = client.events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .map((event) => {
      if (event.method === 'Runtime.exceptionThrown') {
        return `EXCEPTION: ${event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text}`;
      }
      return `LOG ${event.params.entry?.level}: ${event.params.entry?.text}`;
    })
    .filter((line) => !/favicon|ERR_FILE_NOT_FOUND/i.test(line));
  console.log('错误日志:', errors.length === 0 ? '无' : errors.slice(0, 10));

  const flow = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const canTestLogin = ${canTestLogin};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const result = {};
      const saved = await chrome.runtime.sendMessage({
        type: 'sites:save',
        draft: {
          name: '冒烟站点',
          homepage: 'https://example.com',
          login: {
            loginUrl: canTestLogin ? 'https://example.com/' : 'https://example.com/login',
            sessionCookieNames: [],
            autoDetectAuthCookie: true,
            sessionTtlMinutes: 60
          },
          search: {
            urlTemplate: 'https://example.com/search?q={q}',
            requiresLogin: true,
            strategy: 'fetch'
          }
        }
      });
      result.saved = saved.ok;
      result.siteId = saved.ok ? saved.data.id : null;
      result.origins = saved.ok ? saved.data.origins : [];
      const exported = await chrome.runtime.sendMessage({ type: 'sites:export' });
      result.exported = exported.ok && exported.data.payload.includes('冒烟站点');

      if (canTestLogin) {
        const cookie = await chrome.cookies.set({
          url: 'https://example.com/',
          name: 'sid',
          value: 'smoke-session-token',
          domain: '.example.com',
          path: '/',
          secure: true,
          expirationDate: Math.floor(Date.now() / 1000) + 3600
        });
        result.cookieSet = Boolean(cookie && cookie.name === 'sid');

        const diagnosis = await chrome.runtime.sendMessage({
          type: 'sessions:diagnose',
          siteId: result.siteId
        });
        result.diagnosisDetected = diagnosis.ok ? diagnosis.data.detectedCookies : [];
        result.diagnosisCookieCount = diagnosis.ok ? diagnosis.data.cookieNames.length : -1;
        result.diagnosisGranted = diagnosis.ok ? diagnosis.data.granted : false;

        const fixed = await chrome.runtime.sendMessage({
          type: 'sites:set-session-cookies',
          siteId: result.siteId,
          cookieNames: result.diagnosisDetected
        });
        result.cookiesFixed = fixed.ok;

        const checked = await chrome.runtime.sendMessage({
          type: 'sessions:check',
          siteId: result.siteId
        });
        result.sessionStatus = checked.ok ? checked.data.status : checked.error;

        const started = await chrome.runtime.sendMessage({
          type: 'login:start',
          siteId: result.siteId
        });
        result.loginStartStatus = started.ok ? started.data.status : started.error;
        await sleep(2600);
        const polled = await chrome.runtime.sendMessage({
          type: 'login:poll',
          siteId: result.siteId
        });
        result.loginStatus = polled.ok ? polled.data.status : polled.error;
        await sleep(700);
        result.panelShowsLoggedIn = /已登录/.test(document.body.innerText);
        await chrome.cookies.remove({ url: 'https://example.com/', name: 'sid' });

        const localBase = ${JSON.stringify(localBase)};
        const scopedSite = await chrome.runtime.sendMessage({
          type: 'sites:save',
          draft: {
            name: '本地搜索测试',
            homepage: localBase,
            login: {
              loginUrl: localBase + '/login',
              sessionCookieNames: [],
              autoDetectAuthCookie: true
            },
            search: {
              urlTemplate: localBase + '/search?q={q}',
              requiresLogin: false,
              strategy: 'fetch',
              sameSiteOnly: true
            }
          }
        });
        result.scopedSiteSaved = scopedSite.ok;
        const scopedSiteId = scopedSite.ok ? scopedSite.data.id : null;
        const scopedOutcomes = [];
        const scopedListener = (message) => {
          if (
            message &&
            message.type === 'agg:event' &&
            message.event.kind === 'search-outcome' &&
            message.event.requestId === 'smoke_search_scope'
          ) {
            scopedOutcomes.push(message.event.outcome);
          }
        };
        chrome.runtime.onMessage.addListener(scopedListener);
        await chrome.runtime.sendMessage({
          type: 'search:run',
          keyword: 'smoke',
          siteIds: [scopedSiteId],
          requestId: 'smoke_search_scope'
        });
        await sleep(3000);
        chrome.runtime.onMessage.removeListener(scopedListener);
        const scopedOutcome = scopedOutcomes[0];
        result.searchScope = scopedOutcome
          ? {
              status: scopedOutcome.status,
              count: scopedOutcome.items.length,
              firstUrl: scopedOutcome.items[0] ? scopedOutcome.items[0].url : '',
              message: scopedOutcome.message || ''
            }
          : null;
        await chrome.runtime.sendMessage({ type: 'sites:delete', siteId: scopedSiteId });
      }

      const events = [];
      const listener = (message) => {
        if (message && message.type === 'agg:event') {
          events.push(message.event.kind);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      const run = await chrome.runtime.sendMessage({
        type: 'search:run',
        keyword: 'smoke',
        siteIds: [result.siteId],
        requestId: 'smoke_request_1'
      });
      result.searchAccepted = run.ok;
      await new Promise((resolve) => setTimeout(resolve, 2500));
      chrome.runtime.onMessage.removeListener(listener);
      result.events = events;
      const removed = await chrome.runtime.sendMessage({ type: 'sites:delete', siteId: result.siteId });
      result.removed = removed.ok;
      return JSON.stringify(result);
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const flowInfo = JSON.parse(flow.result.value);
  console.log('站点保存:', flowInfo.saved, '| 权限来源:', flowInfo.origins);
  console.log('导出包含站点:', flowInfo.exported);
  if (canTestLogin) {
    console.log('测试 Cookie 写入:', flowInfo.cookieSet);
    console.log(
      '诊断结果:',
      `授权=${flowInfo.diagnosisGranted}`,
      `读取=${flowInfo.diagnosisCookieCount} 条`,
      `自动识别=${flowInfo.diagnosisDetected}`,
      `修复=${flowInfo.cookiesFixed}`,
    );
    console.log('会话自动检测:', flowInfo.sessionStatus);
    console.log('扫码流程:', flowInfo.loginStartStatus, '→', flowInfo.loginStatus);
    console.log('面板显示已登录:', flowInfo.panelShowsLoggedIn);
    console.log('同站过滤搜索:', flowInfo.searchScope);
  }
  console.log('搜索请求:', flowInfo.searchAccepted, '| 事件:', flowInfo.events);
  console.log('站点清理:', flowInfo.removed);

  const loginOk = canTestLogin
    ? flowInfo.sessionStatus === 'active' &&
      flowInfo.loginStatus === 'success' &&
      flowInfo.panelShowsLoggedIn === true &&
      flowInfo.diagnosisDetected.includes('sid') &&
      flowInfo.cookiesFixed === true
    : true;
  const scopeOk = canTestLogin
    ? flowInfo.scopedSiteSaved === true &&
      flowInfo.searchScope &&
      flowInfo.searchScope.status === 'ok' &&
      flowInfo.searchScope.count === 2 &&
      flowInfo.searchScope.firstUrl.includes('127.0.0.1') &&
      /已过滤 1 条/.test(flowInfo.searchScope.message)
    : true;
  const ok =
    info.hasRoot &&
    !/无法连接扩展后台/.test(info.text) &&
    /聚合搜索/.test(info.text) &&
    flowInfo.saved &&
    flowInfo.exported &&
    flowInfo.origins.includes('*://*.example.com/*') &&
    flowInfo.searchAccepted &&
    flowInfo.events.includes('search-outcome') &&
    flowInfo.events.includes('search-done') &&
    flowInfo.removed &&
    loginOk &&
    scopeOk;
  if (ok) {
    console.log('冒烟测试通过');
    exitCode = 0;
  } else {
    console.error('断言未通过');
  }
  client.close();
} catch (error) {
  console.error('冒烟测试失败:', error.message);
} finally {
  child.kill();
  searchServer.close();
  await sleep(500);
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}

process.exit(exitCode);
