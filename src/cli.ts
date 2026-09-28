#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ModelIndex, type Database, type Model, type Resolution, type Status } from './core.js';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

const HELP = `nextmodel ${pkg.version} — 查询国内大模型下线后的替代模型

用法:
  nextmodel <模型名>                 查询模型状态与替代模型
  nextmodel scan [路径...]            扫描代码中已弃用/已下线的模型名（默认当前目录）
  nextmodel list                     列出收录的模型

选项:
  --provider <id>           只看指定平台，如 bailian、volcengine（scan 与 list 可用）
  --json                    以 JSON 输出
  --latest                  从线上获取最新数据（默认使用安装包内置数据）
  --fail-on <级别>          scan 时遇到该级别即以退出码 1 结束: retired（默认）| deprecated | none
  -v, --version             显示版本
  -h, --help                显示帮助

示例:
  npx nextmodel deepseek-chat
  npx nextmodel scan src --fail-on deprecated`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { red: paint(31), green: paint(32), yellow: paint(33), cyan: paint(36), dim: paint(2), bold: paint(1) };

const STATUS_LABEL: Record<Status, string> = {
  active: c.green('可用'),
  deprecated: c.yellow('即将下线'),
  retired: c.red('已下线'),
};

interface Options {
  json: boolean;
  latest: boolean;
  failOn: 'retired' | 'deprecated' | 'none';
  provider?: string;
  args: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { json: false, latest: false, failOn: 'retired', args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '-v' || a === '--version') {
      console.log(pkg.version);
      process.exit(0);
    } else if (a === '--json') opts.json = true;
    else if (a === '--latest') opts.latest = true;
    else if (a === '--provider') opts.provider = argv[++i];
    else if (a === '--fail-on') {
      const v = argv[++i];
      if (v !== 'retired' && v !== 'deprecated' && v !== 'none') die(`--fail-on 只能是 retired / deprecated / none`);
      opts.failOn = v;
    } else if (a.startsWith('-')) die(`未知选项 ${a}，使用 --help 查看用法`);
    else opts.args.push(a);
  }
  return opts;
}

function die(msg: string): never {
  console.error(c.red(`错误: ${msg}`));
  process.exit(2);
}

async function loadDatabase(latest: boolean): Promise<Database> {
  if (latest) {
    const url = `${String(pkg.homepage).replace(/\/$/, '')}/models.json`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Database;
    } catch (e) {
      console.error(c.yellow(`无法获取最新数据（${(e as Error).message}），改用内置数据`));
    }
  }
  return JSON.parse(readFileSync(join(pkgRoot, 'dist', 'models.json'), 'utf8'));
}

function label(index: ModelIndex, m: Model): string {
  return `${m.id} ${c.dim(`(${index.providers.get(m.provider)?.name ?? m.provider})`)}`;
}

function printResolution(index: ModelIndex, r: Resolution) {
  const m = r.model;
  console.log(`${c.bold(m.id)}  ${STATUS_LABEL[r.status]}  ${c.dim(index.providers.get(m.provider)?.name ?? m.provider)}`);
  if (m.retire_at) console.log(`  下线日期  ${m.retire_at}`);
  if (r.status !== 'active') {
    if (r.target) console.log(`  替代模型  ${c.green(c.bold(r.target.id))}`);
    else console.log(`  替代模型  ${c.yellow('暂无收录的可用替代')}`);
    if (r.chain.length > 1) console.log(`  替代链    ${[m, ...r.chain].map((x) => x.id).join(' → ')}`);
    if (r.alternatives.length) console.log(`  其他可选  ${r.alternatives.map((x) => x.id).join(', ')}`);
  }
  if (m.notes) console.log(`  说明      ${m.notes}`);
  console.log(`  来源      ${c.cyan(m.source)}`);
}

function toJson(r: Resolution) {
  return {
    model: r.model,
    status: r.status,
    replacement: r.target?.id ?? null,
    chain: r.chain.map((m) => m.id),
    alternatives: r.alternatives.map((m) => m.id),
  };
}

function query(index: ModelIndex, opts: Options): number {
  const results = opts.args.map((q) => ({ query: q, results: index.lookup(q) }));
  if (opts.json) {
    console.log(JSON.stringify(results.map((x) => ({ query: x.query, results: x.results.map(toJson) })), null, 2));
    return results.every((x) => x.results.length) ? 0 : 1;
  }
  let missing = false;
  for (const [i, { query: q, results: rs }] of results.entries()) {
    if (i) console.log();
    if (!rs.length) {
      missing = true;
      console.log(`${c.bold(q)}  ${c.yellow('未收录')}`);
      const s = index.suggest(q);
      if (s.length) console.log(`  你是不是要找: ${s.join(', ')}`);
      console.log(c.dim(`  如果这个模型已下线，欢迎提交数据: ${pkg.bugs?.url ?? pkg.homepage}`));
      continue;
    }
    rs.forEach((r, j) => {
      if (j) console.log();
      printResolution(index, r);
    });
  }
  return missing ? 1 : 0;
}

const SCAN_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.vue', '.svelte',
  '.py', '.go', '.java', '.kt', '.rs', '.rb', '.php', '.cs', '.swift', '.dart',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env', '.properties', '.md', '.txt', '.sh',
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'vendor', '.venv', 'venv', '__pycache__', 'target', 'coverage']);
const MAX_FILE_BYTES = 1024 * 1024;

function* walk(path: string): Generator<string> {
  const st = statSync(path);
  if (st.isFile()) {
    yield path;
    return;
  }
  if (!st.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile() && (SCAN_EXTS.has(extname(entry.name)) || entry.name.startsWith('.env'))) {
      if (statSync(full).size <= MAX_FILE_BYTES) yield full;
    }
  }
}

function scan(index: ModelIndex, opts: Options): number {
  const paths = opts.args.length ? opts.args : ['.'];
  const findings: { file: string; line: number; column: number; text: string; r: Resolution }[] = [];
  for (const p of paths) {
    let files: string[];
    try {
      files = [...walk(p)];
    } catch {
      die(`路径不存在: ${p}`);
    }
    for (const file of files) {
      const rel = relative(process.cwd(), file);
      const shown = rel && !rel.startsWith('..') ? rel : file;
      for (const hit of index.scan(readFileSync(file, 'utf8'), opts.provider ? [opts.provider] : undefined)) {
        findings.push({ file: shown, line: hit.line, column: hit.column, text: hit.text, r: hit.resolution });
      }
    }
  }

  const failing = findings.filter((f) =>
    opts.failOn === 'none' ? false : opts.failOn === 'deprecated' ? true : f.r.status === 'retired',
  );

  if (opts.json) {
    console.log(JSON.stringify(findings.map((f) => ({ file: f.file, line: f.line, column: f.column, text: f.text, ...toJson(f.r) })), null, 2));
  } else if (!findings.length) {
    console.log(c.green('✓ 未发现已弃用或已下线的模型'));
  } else {
    for (const f of findings) {
      const to = f.r.target ? `→ ${c.green(f.r.target.id)}` : c.yellow('暂无收录的可用替代');
      const date = f.r.model.retire_at ? c.dim(` (${f.r.model.retire_at})`) : '';
      console.log(`${c.cyan(`${f.file}:${f.line}:${f.column}`)}  ${f.text}  ${STATUS_LABEL[f.r.status]}${date}  ${to}`);
    }
    const retired = findings.filter((f) => f.r.status === 'retired').length;
    console.log(`\n共 ${findings.length} 处：${retired} 处已下线，${findings.length - retired} 处即将下线`);
  }
  return failing.length ? 1 : 0;
}

function list(index: ModelIndex, opts: Options): number {
  const models = index.db.models.filter((m) => !opts.provider || m.provider === opts.provider);
  const rows = models.map((m) => index.resolve(m));
  if (opts.json) {
    console.log(JSON.stringify(rows.map(toJson), null, 2));
    return 0;
  }
  for (const p of index.db.providers) {
    const ps = rows.filter((r) => r.model.provider === p.id);
    if (!ps.length) continue;
    console.log(c.bold(p.name));
    for (const r of ps) {
      const to = r.status === 'active' ? '' : r.target ? ` → ${r.target.id}` : '';
      console.log(`  ${r.model.id.padEnd(34)} ${STATUS_LABEL[r.status]}${c.dim(to)}`);
    }
    console.log();
  }
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [cmd] = opts.args;
  if (!cmd) {
    console.log(HELP);
    return 0;
  }
  const index = new ModelIndex(await loadDatabase(opts.latest));
  if (opts.provider && !index.providers.has(opts.provider)) {
    die(`未知平台 ${opts.provider}，可选: ${[...index.providers.keys()].join(', ')}`);
  }
  if (cmd === 'scan') return scan(index, { ...opts, args: opts.args.slice(1) });
  if (cmd === 'list') return list(index, opts);
  if (cmd === 'query') return query(index, { ...opts, args: opts.args.slice(1) });
  return query(index, opts);
}

main().then(
  (code) => process.exit(code),
  (e) => die((e as Error).message),
);
