// 校验 data/*.yaml 并生成 dist/models.json。
// 用法：node scripts/build-data.mjs [--check]   (--check 只校验不写文件)
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const checkOnly = process.argv.includes('--check');

const STATUSES = ['active', 'deprecated', 'retired'];
const PROVIDER_KEYS = ['id', 'name', 'website', 'deprecation_page'];
const MODEL_KEYS = [
  'id', 'aliases', 'status', 'announced_at', 'retire_at',
  'replacement', 'alternatives', 'notes', 'source',
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function isUrl(s) {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

const providers = [];
const models = [];

const files = readdirSync(dataDir).filter((f) => /\.ya?ml$/.test(f)).sort();
for (const file of files) {
  let doc;
  try {
    doc = parse(readFileSync(join(dataDir, file), 'utf8'));
  } catch (e) {
    fail(file, `YAML 解析失败: ${e.message}`);
    continue;
  }
  const p = doc?.provider;
  if (!p || typeof p !== 'object') {
    fail(file, '缺少 provider 字段');
    continue;
  }
  for (const k of Object.keys(p)) if (!PROVIDER_KEYS.includes(k)) fail(file, `provider 含未知字段 "${k}"`);
  const expectedId = basename(file).replace(/\.ya?ml$/, '');
  if (p.id !== expectedId) fail(file, `provider.id 应与文件名一致，期望 "${expectedId}"`);
  if (!p.name) fail(file, 'provider.name 必填');
  for (const k of ['website', 'deprecation_page']) {
    if (p[k] !== undefined && !isUrl(p[k])) fail(file, `provider.${k} 不是合法 URL`);
  }
  providers.push({ id: p.id, name: p.name, website: p.website, deprecation_page: p.deprecation_page });

  if (!Array.isArray(doc.models)) {
    fail(file, 'models 必须是数组（没有数据时写 models: []）');
    continue;
  }
  const seen = new Set();
  for (const [i, m] of doc.models.entries()) {
    const where = `models[${i}]${m?.id ? ` (${m.id})` : ''}`;
    if (!m || typeof m !== 'object') {
      fail(file, `${where} 不是对象`);
      continue;
    }
    for (const k of Object.keys(m)) if (!MODEL_KEYS.includes(k)) fail(file, `${where} 含未知字段 "${k}"`);
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) fail(file, `${where} id 缺失或含非法字符`);
    if (!STATUSES.includes(m.status)) fail(file, `${where} status 必须是 ${STATUSES.join(' / ')}`);

    const names = [m.id, ...(m.aliases ?? [])].filter((n) => typeof n === 'string');
    if (m.aliases !== undefined && !Array.isArray(m.aliases)) fail(file, `${where} aliases 必须是数组`);
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) fail(file, `${where} 名称 "${n}" 重复`);
      seen.add(key);
    }

    for (const k of ['announced_at', 'retire_at']) {
      if (m[k] !== undefined && !isValidDate(m[k])) fail(file, `${where} ${k} 必须是 YYYY-MM-DD 格式的日期`);
    }
    if (m.source === undefined) fail(file, `${where} source 必填，请附官方文档或公告链接`);
    else if (!isUrl(m.source)) fail(file, `${where} source 不是合法 URL`);

    if (m.status === 'active') {
      for (const k of ['retire_at', 'replacement']) {
        if (m[k] !== undefined) fail(file, `${where} active 模型不应有 ${k}`);
      }
    } else if (m.status === 'retired' && m.retire_at === undefined) {
      fail(file, `${where} retired 模型必须填写 retire_at`);
    }
    if (m.alternatives !== undefined && !Array.isArray(m.alternatives)) fail(file, `${where} alternatives 必须是数组`);

    models.push({ provider: p.id, ...m });
  }
}

// 解析 "provider/id" 或同厂商内的 "id"
const byKey = new Map(models.map((m) => [`${m.provider}/${m.id}`.toLowerCase(), m]));
const refKey = (from, ref) => (ref.includes('/') ? ref : `${from.provider}/${ref}`).toLowerCase();

for (const m of models) {
  const file = `${m.provider}.yaml`;
  for (const ref of [m.replacement, ...(m.alternatives ?? [])].filter(Boolean)) {
    const key = refKey(m, ref);
    if (key === `${m.provider}/${m.id}`.toLowerCase()) fail(file, `${m.id} 不能以自身为替代`);
    else if (!byKey.has(key)) fail(file, `${m.id} 引用的替代模型 "${ref}" 未收录，请一并添加该模型`);
  }
}

// 替代链不能成环
for (const m of models) {
  const visited = new Set();
  let cur = m;
  while (cur?.replacement) {
    const key = `${cur.provider}/${cur.id}`.toLowerCase();
    if (visited.has(key)) {
      fail(`${m.provider}.yaml`, `${m.id} 的替代链存在循环`);
      break;
    }
    visited.add(key);
    cur = byKey.get(refKey(cur, cur.replacement));
  }
}

if (errors.length) {
  console.error(`数据校验失败（${errors.length} 个问题）：\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}

const out = { version: 1, providers, models };
if (!checkOnly) {
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'models.json'), `${JSON.stringify(out, null, 2)}\n`);
}
console.log(`✓ ${providers.length} 个厂商，${models.length} 个模型${checkOnly ? '，校验通过' : ' → dist/models.json'}`);
