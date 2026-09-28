# nextModel

> 模型要下线了？查一下该换成什么。

国内大模型厂商迭代很快，旧模型隔一段时间就会下线，调用直接报错。**nextModel** 收录各厂商的模型下线信息和官方推荐的替代模型，帮你快速找到该换成什么。

- 🔍 **查询**：输入模型名，直接给出当前可用的替代模型（自动沿替代链解析，A → B → C 直接告诉你 C）
- 🧹 **扫描**：一条命令扫描整个项目，找出代码和配置里已下线或即将下线的模型名，可接入 CI
- 🔗 **可追溯**：每条数据都附官方文档或公告链接
- 🌐 **网页版**：[boailiu.github.io/nextModel](https://boailiu.github.io/nextModel)

## 快速开始

无需安装，直接用 `npx`（需要 Node.js 18+）；也可以 `npm i -g @boailiu/nextmodel` 全局安装后直接用 `nextmodel` 命令：

```console
$ npx @boailiu/nextmodel deepseek-reasoner
deepseek-reasoner  已下线  DeepSeek
  下线日期  2026-07-24
  替代模型  deepseek-v4-flash
  其他可选  deepseek-v4-pro
  说明      下线前 deepseek-reasoner 路由到 deepseek-v4-flash 的思考模式，替换后需在请求中开启思考模式。
  来源      https://api-docs.deepseek.com/news/news260424/
```

### 扫描项目

```console
$ npx @boailiu/nextmodel scan
src/llm.py:12:46  deepseek-chat  已下线 (2026-07-24)  → deepseek-v4-flash
.env:3:7  moonshot-v1-32k  已下线 (2026-08-31)  → kimi-k3

共 2 处：2 处已下线，0 处即将下线
```

默认扫描当前目录的常见代码与配置文件（跳过 `node_modules`、`.git`、`dist` 等）。

同一个模型名在不同平台的状态可能不同（例如 `deepseek-v4-flash` 在阿里云百炼即将下线，在 DeepSeek 官方仍可用）。默认只要有一个平台可用就不报告；如果你通过特定平台调用，加上 `--provider bailian` 这类参数按该平台检查。

发现**已下线**模型时退出码为 1，可直接用于 CI：

```yaml
# .github/workflows/model-check.yml
- run: npx @boailiu/nextmodel@latest scan --latest --fail-on deprecated
```

### 全部命令

| 命令 | 说明 |
| --- | --- |
| `nextmodel <模型名...>` | 查询一个或多个模型，支持 `provider/model` 写法（如 `deepseek/deepseek-chat`） |
| `nextmodel scan [路径...]` | 扫描代码中已弃用/已下线的模型名 |
| `nextmodel list` | 列出收录的模型 |
| `--provider <id>` | 只看指定平台（`bailian`、`volcengine`、`deepseek`…），用于 scan 与 list |
| `--json` | 以 JSON 输出，便于脚本处理 |
| `--latest` | 从线上获取最新数据（默认使用安装包内置数据） |
| `--fail-on <retired\|deprecated\|none>` | scan 的失败阈值，默认 `retired` |

### 作为库使用

```js
import { ModelIndex } from '@boailiu/nextmodel';
import db from '@boailiu/nextmodel/models.json' with { type: 'json' };

const index = new ModelIndex(db);
const [r] = index.lookup('moonshot-v1-8k');
console.log(r.status, r.target?.id); // retired kimi-k3
```

数据文件也可以直接获取：`https://boailiu.github.io/nextModel/models.json`

## 收录情况

| 厂商 | 数据文件 | 状态 |
| --- | --- | --- |
| DeepSeek | [`data/deepseek.yaml`](data/deepseek.yaml) | ✅ 已收录 |
| 月之暗面 Kimi | [`data/moonshot.yaml`](data/moonshot.yaml) | ✅ 已收录 |
| 火山方舟（豆包及托管的 DeepSeek / Kimi / GLM 等） | [`data/volcengine.yaml`](data/volcengine.yaml) | ✅ 已收录（第一至第十批） |
| 阿里云百炼（通义千问及托管的 DeepSeek / Kimi / GLM 等） | [`data/bailian.yaml`](data/bailian.yaml) | ✅ 2026 年公告已收录，2025 年部分批次待补充 |
| 智谱 BigModel | [`data/zhipu.yaml`](data/zhipu.yaml) | 🙋 待补充 |

**欢迎贡献！** 发现遗漏、错误或新的下线公告，请参考 [CONTRIBUTING.md](CONTRIBUTING.md) 提交 PR，或[提交 Issue](https://github.com/boailiu/nextModel/issues/new?template=deprecation.yml) 告诉我们。

## 数据格式

每个厂商一个 YAML 文件：

```yaml
provider:
  id: deepseek                 # 与文件名一致
  name: DeepSeek
  deprecation_page: https://…  # 厂商官方的下线公告页

models:
  - id: deepseek-chat
    status: retired            # active | deprecated（已公告、未到下线日） | retired
    retire_at: 2026-07-24      # 下线日期
    replacement: deepseek-v4-flash   # 官方推荐替代；跨厂商写 provider/id
    alternatives: [deepseek-v4-pro]  # 其他可选
    notes: 迁移注意事项
    source: https://…          # 必填：官方来源
```

`deprecated` 状态的模型过了 `retire_at` 会自动视为已下线，无需手动改状态。

## 免责声明

本项目数据由社区整理，力求准确但不做保证。上线前请以厂商官方公告为准，并测试替代模型在你业务上的效果。

## License

[MIT](LICENSE)
