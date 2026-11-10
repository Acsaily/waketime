// 沙箱限制：Node 用管道 stdio 起子进程会 EPERM，而 Vite 在 Windows 上会执行
// `exec("net use")` 探测网络盘，导致 vite build / vitest 直接失败。
// 这里把该探测绕开：不走 windowsSafeRealPathSync，直接用 fs.realpathSync.native。
// npm install 后由 postinstall 自动执行，可重复运行。
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'node_modules');
const PATTERN = 'exec("net use"';
let patched = 0;
let scanned = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && p.endsWith('.js')) check(p);
  }
}

function check(file) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  scanned++;
  if (!src.includes(PATTERN)) return;
  let out = src.split('isWindows$1 ? windowsSafeRealPathSync :').join('isWindows$1 ? fs.realpathSync.native :');
  out = out.split('isWindows ? windowsSafeRealPathSync :').join('isWindows ? fs.realpathSync.native :');
  if (out === src) {
    console.log('[patch-vite] found exec("net use") but pattern not replaced:', file);
    return;
  }
  writeFileSync(file, out);
  patched++;
  console.log('[patch-vite] patched', file);
}

walk(ROOT);
console.log(`[patch-vite] scanned ${scanned} js files, patched ${patched}`);
