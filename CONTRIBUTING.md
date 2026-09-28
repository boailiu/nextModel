# 贡献指南

nextModel 的价值完全取决于数据是否准确、及时，非常感谢你的贡献！

## 补充或修正数据

1. 找到对应厂商的文件 `data/<provider>.yaml`；新厂商请新建文件，`provider.id` 与文件名一致。
2. 按 [README 中的数据格式](README.md#数据格式) 添加或修改条目。
3. 本地校验：

   ```bash
   npm install
   npm test
   ```

4. 提交 PR，在描述中贴上官方公告链接。

### 数据规则

- **每条记录必须附 `source`**，且应为厂商官方文档或公告。媒体报道、博客、第三方平台只能作为线索，不能作为来源。
- `replacement` 填**官方推荐**的替代模型；如果官方没有给出推荐，就不要填，可以把你的建议写进 `notes` 或 `alternatives`。
- `replacement` 和 `alternatives` 引用的模型必须同样收录（通常以 `status: active` 条目形式出现），这样替代链才能解析到底。
- 已公告但还没到下线日期的模型用 `status: deprecated` 并填写 `retire_at`，到期后会自动显示为已下线。
- 模型 ID 与 API 调用时传的 `model` 参数保持一致。控制台展示名、带日期的快照名等其他写法放进 `aliases`。
- 同一模型在第三方平台（如阿里云百炼上的 Kimi）的下线时间可能不同，请按平台分别收录，不要混用。

## 只想反馈、不想写 YAML？

[提交一个 Issue](../../issues/new?template=deprecation.yml)，附上官方公告链接即可，维护者会帮你整理。

## 开发

```bash
npm install
npm run build        # 校验数据 + 编译
npm test             # 构建并运行测试
npm run build:site   # 生成网页到 site/
node lib/cli.js deepseek-chat
```

目录结构：

```
data/            各厂商数据（YAML）
scripts/         数据校验与构建、网站组装
src/core.ts      查询逻辑（CLI 与网页共用，不能依赖 Node API）
src/cli.ts       命令行
web/index.html   查询网页
test/            测试
```
