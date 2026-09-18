# hanmcp

> 一条命令，把任意文档站变成可用的 MCP 服务器。零依赖、不需要 API Key、不做向量化、不联网。

绝大多数文档对 AI Agent 是隐形的。`hanmcp` 抓取一个文档站，把页面转成干净的 markdown，建一个零依赖的检索索引，最后产出一个**独立的 MCP 服务器**以及 `llms.txt`——让 Claude、Cursor 或任何 MCP 客户端都能在本地读取和检索这些文档。

这个项目**中文优先**。绝大多数同类工具是英文优先的，处理中文时表现很糟：中文提问检索不到内容，而 `/docs/指南/快速上手.html` 这种路径会被转成 `e5-bf-ab-e9-80-9f.md` 这样的文件名。`hanmcp` 用重叠二元组切分中日韩文本，并保持中文路径可读。

```bash
$ npx hanmcp http://127.0.0.1:8904/docs/

hanmcp 0.1.0  documentation -> MCP

  source   http://127.0.0.1:8904/docs/
  output   mcp-docs
  limits   depth 2, 50 pages, 120ms delay, robots.txt respected

  [ 1]  hanmcp Documentation
  [ 2]  中文文档 · hanmcp
  [ 3]  Installation · hanmcp Docs
  [ 4]  Command line reference · hanmcp Docs
  [ 5]  How it works · hanmcp Docs
  [ 6]  CJK support · hanmcp Docs
  skip  robots.txt disallows /docs/private/benchmarks.html

  done in 1.0s
  pages   6
  chunks  37
  terms   1,363
  index   66.5 KB
  server  17.3 KB

  files    docs/, llms.txt, llms-full.txt, index.json, server.mjs
```

然后 AI 客户端用中文提问：

```
  an AI client asks, in Chinese:  索引内存占用怎么估算

  1. 中文文档 · hanmcp — 索引内存占用怎么估算
     source: http://127.0.0.1:8904/docs/zh
     path: zh.md
     score: 39.4518

  ## 索引内存占用怎么估算

  这是中文用户最常问的问题，因为中文分词会显著放大索引体积。hanmcp 把中文按
  相邻二字切分成重叠的二元组……
```

这两段都是真实输出，不是手工编造的示意。第一段是 `npx hanmcp` 的原始输出，第二段是一个真实的 MCP 客户端连上它生成的服务器之后的会话。被抓取的是 **hanmcp 自己的文档站**——也就是你现在读到的这份文档的源文件，工具被用在它自己文档化的对象上。你可以自己跑一遍：

```bash
git clone https://github.com/Nephets1010/hanmcp && cd hanmcp
npm run demo
```

注意那个中文提问返回的是什么：**命中标题的那一节**，而不是页面开头。文档的每一节都会被切成独立的检索段落，所以用小节标题提问就能落到那一节。

<!-- 发射前补上录屏 GIF：docs/demo.gif（分镜脚本见 docs/DEMO.md）。 -->

## 三步上手

```bash
# 1. 从任意文档站构建
npx hanmcp https://docs.example.com/

# 2. 把 MCP 客户端指向生成的服务器
claude mcp add example-docs -- node ./mcp-docs/server.mjs
```

迁移到另一台机器只需要三个东西：`server.mjs`、`index.json` 和 `docs/`，它们本身就是一个自包含的包。

## 产物说明

| 产物 | 是什么 | 谁在读 |
| --- | --- | --- |
| `server.mjs` | 完整的独立 MCP 服务器，不需要 `npm install`，没有 lockfile。 | 任意 MCP 客户端 |
| `index.json` | 零依赖倒排索引，BM25 打分加短语加权。 | 生成的服务器 |
| `llms.txt` | 遵循 [llms.txt](https://llmstxt.org/) 约定的站点索引。 | 爬虫、Agent、低成本摄取 |
| `llms-full.txt` | 全部页面内联成单个纯文本文件。 | 长上下文摄取 |
| `docs/*.md` | 干净的 markdown，一页一文件，路径结构与 URL 对齐。 | 你自己、你的仓库、你的 grep |
| `manifest.json` | 构建元信息与统计。 | CI、排查问题 |

生成的服务器暴露三个工具：

- `search_docs` —— BM25 检索，返回带来源 URL 的排序段落。
- `get_doc` —— 按路径读取单页，会拒绝跳出文档目录的路径。
- `list_docs` —— 列出所有已索引页面。

## 三种典型用法

**让 Agent 能读你的内部文档。** 文档在内网，厂商的爬虫进不来。把 `hanmcp` 指向内部地址，产物提交到代码仓库，所有人拿到一致的答案，数据不出机器。

**让依赖库的文档可以离线检索。** 有些库把文档以 HTML 形式打在包里。转换一次、把产物提交进仓库，Agent 就不会再在断网时编造 API 签名。

**给自己的站点产出 `llms.txt`。** 在 CI 里挂上构建，每次文档部署都同步刷新 `llms.txt` 和 `llms-full.txt`，不会和内容脱节。

## 为什么不用现成的抓取方案

- **不需要 API Key、不做向量化、不下载模型。** 检索靠本地 BM25 索引，几百页的文档站几秒建完，体积通常在几 MB 以内。
- **产物可复现、可 diff。** 输出就是仓库里的 markdown，文档改动能在 Pull Request 里逐行 review。
- **默认守规矩。** 遵守 `robots.txt`、请求限速、如实标识自己。
- **为中文而做。** 中日韩文本按二元组切分，非 ASCII 路径保持可读文件名。

## 配置

```
hanmcp <url> [options]        抓取文档站并构建服务器
hanmcp serve [dir]            以 stdio 运行生成的服务器
hanmcp help | version
```

| 参数 | 默认值 | 含义 |
| --- | --- | --- |
| `--out <dir>` | `mcp-docs` | 输出目录 |
| `--max-pages <n>` | `50` | 页面数量上限 |
| `--max-depth <n>` | `2` | 从入口 URL 起算的链接深度 |
| `--name <name>` | 站点标题 | 服务器名称 |
| `--delay <ms>` | `120` | 请求间隔 |
| `--timeout <ms>` | `15000` | 单个请求超时时间 |
| `--no-robots` | 关闭 | 跳过 `robots.txt` 检查 |
| `--force` | 关闭 | 即使 `--out` 不是 `hanmcp` 创建的也覆盖 |
| `--quiet` | 关闭 | 只打印最终汇总 |

**范围规则：** 带结尾斜杠（`/docs/`）抓整个子树；不带斜杠（`/docs/v2/start.html`）只抓所在目录——所以指向单个页面不会把整站拖进来。

**安全规则：** `hanmcp` 拒绝把文件系统根目录或当前工作目录当作 `--out`，也拒绝删除不是自己创建的目录，除非显式传 `--force`。

## 明确不做的事

写下来，是因为只列功能的路线图等于没有终点。

- **不渲染 JavaScript。** 必须靠浏览器才能出内容的页面会被当作空页。这是刻意的取舍：换来零依赖和速度。
- **不做增量重抓。** 每次构建都是全量。在意变化就 diff 产物。
- **不支持 `robots.txt` 的通配符和 `$` 锚点。** 只做前缀匹配。真正有歧义的情况按允许处理，与主流爬虫行为一致。
- **不做语义检索或向量检索。** 只有 BM25。它快、可预测、零依赖，对文档场景够用，而且能离线。
- **不做托管服务。** 以后也不会有。

## 环境要求

Node.js 20 或更高版本，没有其他要求——`hanmcp` 没有任何运行时依赖，并且 CI 里有一道检查：一旦依赖列表非空就直接构建失败。

## 开发

```bash
npm run check            # 语法门禁 + 测试 + 文档一致性 + 发布产物检查
npm test                 # 只跑测试，不需要联网
npm run demo             # 针对 hanmcp 自己的文档站跑完整链路，带录屏停顿
node demo/run-demo.js    # 同样内容但不停顿，约 2 秒（27 秒的是上面那条）
```

测试套件不需要联网：它会在 localhost 起一个夹具文档站然后抓取它。演示抓的是 `site/` 下的真实文档——两者刻意分开，这样改文档永远不会弄挂测试。

`npm run check` 还会把 `npm publish` 将要发出的那份 tarball 打进临时目录、装一遍、端到端跑一次。所以让「发布出去的包不可用」的改动会在构建阶段失败，而不是等到读者那里才失败。它同时挂在 `prepublishOnly` 上。

提 PR 之前请看 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 的方式反馈。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。

---

如果这个工具帮你省掉了一轮「Agent 编造了一个不存在的 API」，点个 star 能帮更多人找到它。
