// 下载 Android 构建工具链到工作区 .toolchain/（沙箱只允许写工作区，所以不装到系统目录）
// 用法：node scripts/download-toolchain.mjs
import { createWriteStream, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = process.cwd();
const DL = path.join(ROOT, '.toolchain', 'downloads');
mkdirSync(DL, { recursive: true });

const log = (...a) => console.log(...a);

async function download(url, dest, timeoutMs = 900000) {
  if (existsSync(dest) && statSync(dest).size > 1024) {
    log('skip (already downloaded):', path.basename(dest), statSync(dest).size, 'bytes');
    return dest;
  }
  log('GET', url);
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} for ${url}`);
  const total = Number(r.headers.get('content-length') || 0);
  let done = 0;
  const body = Readable.fromWeb(r.body);
  let lastPct = -1;
  body.on('data', (c) => {
    done += c.length;
    if (!total) return;
    const pct = Math.floor((done / total) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      log(`  ${path.basename(dest)}: ${pct}% (${(done / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB)`);
    }
  });
  await pipeline(body, createWriteStream(dest));
  log('  saved', path.basename(dest), statSync(dest).size, 'bytes');
  return dest;
}

function sha1(file) {
  return createHash('sha1').update(readFileSync(file)).digest('hex');
}

// ---------- 1) JDK 21 (Temurin) ----------
const jdkZip = path.join(DL, 'jdk21-win-x64.zip');
await download(
  'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse',
  jdkZip
);

// ---------- 2) Android command-line tools（从官方仓库 XML 里取最新 windows 包） ----------
log('resolve cmdline-tools from repository2-3.xml ...');
const xml = await (await fetch('https://dl.google.com/android/repository/repository2-3.xml', { signal: AbortSignal.timeout(60000) })).text();
const pkgBlock = xml.match(/<remotePackage path="cmdline-tools;latest">([\s\S]*?)<\/remotePackage>/);
if (!pkgBlock) throw new Error('cmdline-tools;latest not found in repository xml');
const archives = [...pkgBlock[1].matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map((m) => m[1]);
const winArchive = archives.find((a) => a.includes('<host-os>windows</host-os>'));
if (!winArchive) throw new Error('no windows archive for cmdline-tools');
const ctUrl = winArchive.match(/<url>([^<]+)<\/url>/)[1];
const ctSha1 = (winArchive.match(/<checksum[^>]*>([^<]+)<\/checksum>/) || [])[1] || null;
log('cmdline-tools:', ctUrl, 'sha1:', ctSha1);
const ctZip = path.join(DL, path.basename(ctUrl));
await download('https://dl.google.com/android/repository/' + path.basename(ctUrl), ctZip);
if (ctSha1) {
  const actual = sha1(ctZip);
  if (actual !== ctSha1) throw new Error(`cmdline-tools sha1 mismatch: ${actual} != ${ctSha1}`);
  log('  sha1 OK');
}

// ---------- 3) Gradle 8.14.3 ----------
const gradleUrl = 'https://services.gradle.org/distributions/gradle-8.14.3-bin.zip';
const gradleZip = path.join(DL, 'gradle-8.14.3-bin.zip');
await download(gradleUrl, gradleZip);
try {
  const expected = (await (await fetch(gradleUrl + '.sha256', { signal: AbortSignal.timeout(30000) })).text()).trim();
  const actual = createHash('sha256').update(readFileSync(gradleZip)).digest('hex');
  if (expected && expected !== actual) throw new Error(`gradle sha256 mismatch: ${actual} != ${expected}`);
  log('  gradle sha256 OK');
} catch (e) {
  log('  gradle sha256 check skipped/failed:', e.message);
}

log('\nALL DOWNLOADS DONE ->', DL);
