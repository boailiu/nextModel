// 查询核心逻辑。CLI 与网页共用，不得引入 Node 专属模块。

export type Status = 'active' | 'deprecated' | 'retired';

export interface Provider {
  id: string;
  name: string;
  website?: string;
  deprecation_page?: string;
}

export interface Model {
  provider: string;
  id: string;
  aliases?: string[];
  status: Status;
  announced_at?: string;
  retire_at?: string;
  replacement?: string;
  alternatives?: string[];
  notes?: string;
  source: string;
}

export interface Database {
  version: number;
  providers: Provider[];
  models: Model[];
}

export interface Resolution {
  model: Model;
  status: Status;
  /** 从查询模型出发的替代链，不含查询模型本身 */
  chain: Model[];
  /** 最终推荐使用的模型；链走到尽头仍不可用时为 undefined */
  target?: Model;
  alternatives: Model[];
}

export interface ScanHit {
  line: number;
  column: number;
  text: string;
  resolution: Resolution;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 标为 deprecated 但下线日期已过的模型视为 retired */
export function effectiveStatus(m: Model, date = today()): Status {
  if (m.status === 'deprecated' && m.retire_at && m.retire_at <= date) return 'retired';
  return m.status;
}

export class ModelIndex {
  private readonly byName = new Map<string, Model[]>();
  private readonly byKey = new Map<string, Model>();
  readonly providers: Map<string, Provider>;

  constructor(readonly db: Database, readonly date = today()) {
    this.providers = new Map(db.providers.map((p) => [p.id, p]));
    for (const m of db.models) {
      this.byKey.set(`${m.provider}/${m.id}`.toLowerCase(), m);
      for (const name of [m.id, ...(m.aliases ?? [])]) {
        const key = name.toLowerCase();
        const list = this.byName.get(key) ?? [];
        list.push(m);
        this.byName.set(key, list);
      }
    }
  }

  /**
   * 按名称查找，支持 "provider/id" 与 OpenRouter 风格的 "vendor/id" 前缀。
   * 版本号中的点与连字符视为等价：doubao-seed-1.6-250615 可查到 doubao-seed-1-6-250615。
   */
  find(query: string): Model[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const exact = this.byName.get(q);
    if (exact) return exact;
    const dashed = q.replace(/(?<=\d)\.(?=\d)/g, '-');
    if (dashed !== q) return this.find(dashed);
    const slash = q.lastIndexOf('/');
    if (slash === -1) return [];
    const prefix = q.slice(0, slash);
    const name = q.slice(slash + 1);
    const candidates = this.byName.get(name) ?? [];
    const scoped = candidates.filter((m) => m.provider === prefix || prefix.endsWith(`/${m.provider}`));
    return scoped.length ? scoped : candidates;
  }

  private ref(from: Model, ref: string): Model | undefined {
    const key = ref.includes('/') ? ref : `${from.provider}/${ref}`;
    return this.byKey.get(key.toLowerCase());
  }

  resolve(model: Model): Resolution {
    const chain: Model[] = [];
    const seen = new Set([model]);
    let cur = model;
    while (effectiveStatus(cur, this.date) !== 'active' && cur.replacement) {
      const next = this.ref(cur, cur.replacement);
      if (!next || seen.has(next)) break;
      chain.push(next);
      seen.add(next);
      cur = next;
    }
    const last = chain.length ? chain[chain.length - 1] : model;
    const target = effectiveStatus(last, this.date) === 'active' ? last : undefined;
    const alternatives = (model.alternatives ?? [])
      .map((a) => this.ref(model, a))
      .filter((m): m is Model => !!m && m !== target);
    return { model, status: effectiveStatus(model, this.date), chain, target, alternatives };
  }

  lookup(query: string): Resolution[] {
    return this.find(query).map((m) => this.resolve(m));
  }

  /** 找不到时给出相近的模型名 */
  suggest(query: string, limit = 5): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: [string, number][] = [];
    for (const name of this.byName.keys()) {
      const score = name.includes(q) || q.includes(name) ? 0 : distance(q, name);
      if (score <= Math.max(2, Math.floor(q.length / 3))) scored.push([name, score]);
    }
    return scored
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name]) => this.byName.get(name)![0].id);
  }

  /**
   * 扫描文本中出现的已弃用或已下线模型名。
   * 同名模型在多个平台收录时（如 deepseek-v4-flash 在百炼下线、在 DeepSeek 官方仍可用），
   * 只要有一个平台可用就不报告，以免误报；可用 providers 限定只按指定平台判断。
   */
  scan(text: string, providers?: string[]): ScanHit[] {
    const hits: ScanHit[] = [];
    const lines = text.split(/\r?\n/);
    for (const [i, line] of lines.entries()) {
      for (const match of line.matchAll(TOKEN_RE)) {
        const token = match[0];
        const found = this.find(token).filter((m) => !providers?.length || providers.includes(m.provider));
        if (!found.length) continue;
        const resolutions = found.map((m) => this.resolve(m));
        if (resolutions.some((r) => r.status === 'active')) continue;
        hits.push({ line: i + 1, column: match.index! + 1, text: token, resolution: resolutions[0] });
      }
    }
    return hits;
  }
}

// 模型名形如 deepseek-chat、qwen-max-2025-01-25、deepseek/deepseek-chat、kimi-k2.5
const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._:/-]*[A-Za-z0-9]/g;

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
