// 组装 GitHub Pages 站点到 site/：网页 + 共用的 core.js + 数据
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site');

rmSync(site, { recursive: true, force: true });
mkdirSync(site);
cpSync(join(root, 'web'), site, { recursive: true });
cpSync(join(root, 'lib', 'core.js'), join(site, 'core.js'));
cpSync(join(root, 'dist', 'models.json'), join(site, 'models.json'));
console.log('✓ site/ 已生成');
