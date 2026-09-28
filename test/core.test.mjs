import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModelIndex, effectiveStatus } from '../lib/core.js';

const src = 'https://example.com';
const db = {
  version: 1,
  providers: [
    { id: 'acme', name: 'Acme' },
    { id: 'other', name: 'Other' },
  ],
  models: [
    { provider: 'acme', id: 'acme-1', status: 'retired', retire_at: '2025-01-01', replacement: 'acme-2', alternatives: ['acme-lite'], source: src },
    { provider: 'acme', id: 'acme-2', status: 'deprecated', retire_at: '2026-06-01', replacement: 'acme-3', source: src },
    { provider: 'acme', id: 'acme-3', aliases: ['acme-latest'], status: 'active', source: src },
    { provider: 'acme', id: 'acme-lite', status: 'active', source: src },
    { provider: 'acme', id: 'acme-dead', status: 'retired', retire_at: '2025-01-01', source: src },
    { provider: 'other', id: 'acme-1', status: 'active', source: src },
  ],
};

test('deprecated 模型过了下线日期视为 retired', () => {
  const m = db.models[1];
  assert.equal(effectiveStatus(m, '2026-05-31'), 'deprecated');
  assert.equal(effectiveStatus(m, '2026-06-01'), 'retired');
});

test('沿替代链解析到最终可用模型', () => {
  const index = new ModelIndex(db, '2026-01-01');
  const [r] = index.lookup('acme/acme-1');
  assert.equal(r.status, 'retired');
  assert.deepEqual(r.chain.map((m) => m.id), ['acme-2', 'acme-3']);
  assert.equal(r.target.id, 'acme-3');
  assert.deepEqual(r.alternatives.map((m) => m.id), ['acme-lite']);
});

test('无替代时 target 为空', () => {
  const index = new ModelIndex(db, '2026-01-01');
  const [r] = index.lookup('acme-dead');
  assert.equal(r.target, undefined);
});

test('名称不区分大小写，支持别名与厂商前缀', () => {
  const index = new ModelIndex(db);
  assert.equal(index.lookup('ACME-LATEST')[0].model.id, 'acme-3');
  assert.equal(index.lookup('acme-1').length, 2);
  assert.equal(index.lookup('other/acme-1')[0].model.provider, 'other');
  assert.equal(index.lookup('openrouter/acme/acme-1')[0].model.provider, 'acme');
  assert.equal(index.lookup('nope').length, 0);
});

test('版本号中的点与连字符等价', () => {
  const index = new ModelIndex({
    version: 1,
    providers: [{ id: 'acme', name: 'Acme' }],
    models: [
      { provider: 'acme', id: 'acme-1-5-pro', status: 'active', source: src },
      { provider: 'acme', id: 'acme-v0.2', status: 'active', source: src },
    ],
  });
  assert.equal(index.lookup('acme-1.5-pro')[0].model.id, 'acme-1-5-pro');
  assert.equal(index.lookup('acme/acme-1.5-pro')[0].model.id, 'acme-1-5-pro');
  assert.equal(index.lookup('acme-v0.2')[0].model.id, 'acme-v0.2');
});

test('suggest 返回相近名称', () => {
  const index = new ModelIndex(db);
  assert.ok(index.suggest('acme-4').includes('acme-3'));
});

test('scan 只报告非 active 模型，并给出行列号', () => {
  const index = new ModelIndex({ ...db, models: db.models.filter((m) => m.provider === 'acme') }, '2026-01-01');
  const text = 'const a = "acme-3";\nclient.chat({ model: "acme-2" })\n// acme-2-extended is not a match\n';
  const hits = index.scan(text);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].line, hits[0].column, hits[0].text], [2, 23, 'acme-2']);
});

test('scan 对跨平台同名模型：任一平台可用即不报告，指定平台时按该平台判断', () => {
  const index = new ModelIndex(db, '2026-01-01');
  const text = 'model = "acme-1"';
  assert.equal(index.scan(text).length, 0);
  assert.equal(index.scan(text, ['acme']).length, 1);
  assert.equal(index.scan(text, ['other']).length, 0);
});

test('内置数据中的非 active 模型都能解析到可用替代', () => {
  const real = JSON.parse(readFileSync(new URL('../dist/models.json', import.meta.url), 'utf8'));
  const index = new ModelIndex(real);
  for (const m of real.models) {
    if (m.status === 'active' || !m.replacement) continue;
    assert.ok(index.resolve(m).target, `${m.provider}/${m.id} 的替代链没有终点`);
  }
});
