const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');
const bcrypt = require('bcryptjs');

const root = join(__dirname, '..');
const privateRoute = /\/(?:login|admin|agent|agents|designer|laser|router|clients|client|inventory|designs|expenses|invoices|users|account|api)(?:\/|\b)/i;

async function loadWorker() {
  const source = readFileSync(join(root, 'cloudflare', 'src', 'worker.mjs'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default {', 'const cloudflareWorker = {');
  const { landingHtml } = await import(pathToFileURL(join(root, 'cloudflare', 'src', 'landing.mjs')).href);
  const template = name => readFileSync(join(root, 'views', `${name}.ejs`), 'utf8');
  const context = {
    bcrypt, crypto: webcrypto, Request, Response, Headers, FormData, File, Blob, URL,
    TextEncoder, TextDecoder, atob, btoa, console, landingHtml,
    adminTemplate: template('admin'), agentTemplate: template('agent'), designerTemplate: template('designer'),
    laserTemplate: template('laser'), routerTemplate: template('router'), clientsTemplate: template('clients'),
    inventoryTemplate: template('inventory'), invoicesTemplate: template('invoices'), usersTemplate: template('users'),
    expensesTemplate: template('expenses'), designsTemplate: template('designs'), clientTemplate: template('client'),
    accountTemplate: template('account'), agentsTemplate: template('agents'), agentDetailTemplate: template('agent-detail'),
    handleCustomOrders: async () => null, handleDesignsApi: async () => null, handleAgentsApi: async () => null
  };
  return runInNewContext(`${source}\ncloudflareWorker`, context, { filename: 'worker.mjs' });
}

function environment() {
  const user = { User_ID: 1, Name: 'مدير الاختبار', Role: 'Admin', Username: 'admin', Password: bcrypt.hashSync('test-password', 4) };
  return {
    SESSION_SECRET: 'seo-privacy-test-secret',
    DB: {
      prepare(sql) {
        let value;
        return {
          bind(first) { value = first; return this; },
          async first() {
            if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
            if (/FROM Users u LEFT JOIN Agent_Profiles ap/i.test(sql)) return value === 'admin' || value === 1 ? user : null;
            throw new Error(`Unexpected database query: ${sql}`);
          }
        };
      }
    },
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname !== '/robots.txt' && pathname !== '/sitemap.xml') return new Response('', { status: 404 });
        const file = join(root, 'public', pathname.slice(1));
        return existsSync(file)
          ? new Response(readFileSync(file, 'utf8'), { headers: { 'content-type': pathname.endsWith('.xml') ? 'application/xml' : 'text/plain' } })
          : new Response('', { status: 404 });
      }
    }
  };
}

function request(worker, env, pathname, options = {}) {
  return worker.fetch(new Request(`https://www.kazanjigroup.com${pathname}`, options), env);
}

function assertNoIndex(response, body = '') {
  assert.match(`${response.headers.get('x-robots-tag') || ''} ${body}`, /noindex/i);
}

test('public landing describes manufacturing, not the internal workshop system', async () => {
  const worker = await loadWorker(), env = environment();
  const response = await request(worker, env, '/');
  assert.equal(response.status, 200);
  const page = await response.text();
  const title = page.match(/<title>([^<]+)<\/title>/i)?.[1];
  const description = page.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1];
  assert.ok(title, 'public page needs a title');
  assert.ok(description, 'public page needs a description');
  assert.match(`${title} ${description}`, /قزنجي/);
  assert.match(`${title} ${description}`, /تصنيع|صناعات\s+خشبية|خشبي/);
  assert.doesNotMatch(`${title} ${description}`, /نظام\s+إدارة|إدارة\s+الورشة|ورشة\s+كازانجي|workshop\s+manager/i);
  assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /noindex/i);
});

test('public landing exposes a canonical brand identity and a square logo icon', async () => {
  const worker = await loadWorker(), env = environment();
  const response = await request(worker, env, '/');
  const page = await response.text();
  assert.match(page, /<link rel="canonical" href="https:\/\/www\.kazanjigroup\.com\/">/);
  assert.match(page, /<link rel="icon" type="image\/png"[^>]*href="\/favicon\.png">/);
  assert.equal((page.match(/<link rel="icon"/g) || []).length, 1, 'the homepage should advertise one favicon');
  assert.match(page, /<meta property="og:site_name" content="مجموعة قزنجي">/);
  const structuredData = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || 'null');
  const website = structuredData?.['@graph']?.find(item => item['@type'] === 'WebSite');
  const company = structuredData?.['@graph']?.find(item => item['@type'] === 'Organization');
  assert.equal(website?.name, 'مجموعة قزنجي');
  assert.equal(website?.url, 'https://www.kazanjigroup.com/');
  assert.equal(company?.telephone, '+963981163985');
  assert.equal(company?.email, 'info@kazanjigroup.com');
  assert.equal(company?.logo, 'https://www.kazanjigroup.com/favicon.png');
  const png = readFileSync(join(root, 'public', 'favicon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
  assert.ok(png.readUInt32BE(16) >= 112);
  const ico = readFileSync(join(root, 'public', 'favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'the default favicon path needs a valid ICO');
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt32LE(18), 22);
});

test('HEAD matches the public homepage, and HTTP redirects to the canonical HTTPS URL', async () => {
  const worker = await loadWorker(), env = environment();
  const head = await request(worker, env, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.doesNotMatch(head.headers.get('x-robots-tag') || '', /noindex/i);
  assert.equal(await head.text(), '');

  const insecure = await worker.fetch(new Request('http://www.kazanjigroup.com/', { method: 'HEAD' }), env);
  assert.equal(insecure.status, 308);
  assert.equal(insecure.headers.get('location'), 'https://www.kazanjigroup.com/');
});

test('the duplicate workers.dev landing is not indexable', async () => {
  const worker = await loadWorker(), env = environment();
  const response = await worker.fetch(new Request('https://workshop-manager-cloudflare.example.workers.dev/'), env);
  assert.equal(response.status, 200);
  assertNoIndex(response);
});

test('login is neutral and excluded from search results', async () => {
  const worker = await loadWorker(), env = environment();
  const response = await request(worker, env, '/login');
  assert.equal(response.status, 200);
  const page = await response.text();
  assert.match(page, /تسجيل\s+الدخول/);
  assert.match(page, /href="\/favicon\.png"/);
  assert.doesNotMatch(page, /نظام\s+إدارة|إدارة\s+الورشة|ورشة\s+كازانجي|workshop\s+manager/i);
  assertNoIndex(response, page);
  const head = await request(worker, env, '/login', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assertNoIndex(head);
});

test('robots and sitemap expose only the public website for indexing', async () => {
  const worker = await loadWorker(), env = environment();
  const robotsResponse = await request(worker, env, '/robots.txt');
  assert.equal(robotsResponse.status, 200);
  const robots = await robotsResponse.text();
  assert.match(robots, /User-agent:\s*\*/i);
  assert.doesNotMatch(robots, /^\s*Disallow:\s*\/\s*$/im, 'do not block the public landing');
  assert.doesNotMatch(robots, /^\s*Allow:\s*\/(?:login|admin|agent|designer|laser|api)\b/im);
  assert.match(robots, /Sitemap:\s*https:\/\/www\.kazanjigroup\.com\/sitemap\.xml/i);

  const sitemapResponse = await request(worker, env, '/sitemap.xml');
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(match => match[1]);
  assert.ok(locations.length, 'sitemap must list the public landing');
  assert.ok(locations.every(location => new URL(location).pathname === '/'));
  assert.ok(locations.every(location => new URL(location).hostname === 'www.kazanjigroup.com'));
  assert.doesNotMatch(sitemap, privateRoute);
});

test('health response reveals no D1/R2 internals, and private HTML/JSON is noindex', async () => {
  const worker = await loadWorker(), env = environment();
  const health = await request(worker, env, '/api/health');
  assert.equal(health.status, 200);
  const healthBody = await health.text();
  assert.doesNotMatch(healthBody, /\bD1\b|\bR2\b|"database"|"storage"|database_id|bucket_name/i);

  const anonymous = await request(worker, env, '/admin');
  assert.equal(anonymous.status, 302);
  assertNoIndex(anonymous);

  const form = new FormData();
  form.set('username', 'admin');
  form.set('password', 'test-password');
  const login = await request(worker, env, '/login', { method: 'POST', body: form });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const privatePage = await request(worker, env, '/admin', { headers: { cookie } });
  assert.equal(privatePage.status, 200);
  const privateHtml = await privatePage.text();
  assertNoIndex(privatePage, privateHtml);
  assert.match(privateHtml, /href="\/favicon\.png"/);
  const privateJson = await request(worker, env, '/api/auth/me', { headers: { cookie } });
  assert.equal(privateJson.status, 200);
  assertNoIndex(privateJson);
});
