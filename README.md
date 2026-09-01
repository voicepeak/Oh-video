# CineSpec Studio

独立的校园 AI 视频工作流 MVP。它不依赖 New API，使用 Bun、React、Hono 和 SQLite。

当前未配置 LLM 时使用 Codex MCP 协作填写，不再运行规则 Demo。配置 LLM 后，Shot Planner 会生成风险判断、人物与空间连续性锁、完整 0–10 秒时间轴和负面约束；零散字段建议仍只针对空字段，不覆盖用户已选内容。所有输出都经过 CineSpec Schema 和时间轴连续性二次校验。

## 本地运行

```bash
bun install
cp .env.example .env
bun run dev
```

- 前端：http://127.0.0.1:5174
- API：http://127.0.0.1:8788/api/health
- 公开页：https://voicepeak.github.io/Oh-video/

公开页是 GitHub Pages，链接固定。改 `site/index.html` 或 `site/latest.json` 后推送，别人打开的还是同一个地址，内容会换成最新版。

未配置 `DASHSCOPE_API_KEY` 时，可以调试 CineSpec、MCP 协作填写、提示词编译、素材分类和上传，但不能提交真实视频任务。不要使用曾经粘贴到聊天或代码中的旧密钥，请先在阿里云控制台轮换。

Wan 3.0 还需要与密钥同地域的业务空间 Endpoint。例如北京地域：

```env
DASHSCOPE_API_KEY=新密钥
DASHSCOPE_BASE_URL=https://你的业务空间ID.cn-beijing.maas.aliyuncs.com
```

镜头分析当前使用 DeepSeek V4 Flash：

```env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=你的DeepSeek密钥
LLM_MODEL=deepseek-v4-flash
```

版本化的 Agent 系统提示词位于 `src/server/prompts/shot-planner-v1.md`。

## MVP 已有能力

- 文生视频 / 参考图生视频两种输入模式
- CineSpec 结构化镜头字段与实时质量计数
- Codex MCP 协作填写；配置 LLM 后支持 Shot Planner 分析与逐条字段建议
- 三段连续时间轴、人物身份锁、空间起终点和循环风险提示
- 确定性中文提示词编译，自动消除负面约束中的双重否定
- 用户自建素材分类、图片与视频上传
- SQLite 次数账本：提交预扣 1 次，提交或生成失败自动退回
- Wan 异步任务提交、轮询、下载并自动进入素材库
- GitHub Pages 公开页，固定链接分享最新内容

## 检查

```bash
bun run test
bun run typecheck
bun run build
```
