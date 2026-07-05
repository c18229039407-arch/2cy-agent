# 2CY Agent

开源、本地优先的二次元 Agent：上传一张图，让你喜欢的角色住进电脑——替你干活，陪你说话。

整个界面是一张日漫黑白线稿风的「作者原稿桌」：分镜格、对话气泡、手绘墨线、朱红印章。

## 快速开始（v0.2 · 电脑端）

唯一的前置要求：安装 [Node.js](https://nodejs.org/) 18 或更高版本（下载 LTS 版一路下一步即可）。本项目零依赖，**不需要** `npm install`。

### 方式一：下载即用（推荐，不需要会 git）

1. 点本页面右上角绿色的 **Code** 按钮 → **Download ZIP**，下载后解压；
2. 双击启动脚本：
   - **Windows**：双击 `启动-Windows.bat`；
   - **macOS**：双击 `启动-Mac.command`（如果系统提示「无法验证开发者」，右键点击文件 → 选「打开」即可；若提示没有权限，先在终端里对项目目录执行 `chmod +x 启动-Mac.command`）；
   - **Linux**：终端执行 `bash start-linux.sh`；
3. 浏览器会自动打开 http://127.0.0.1:2333 。

### 方式二：命令行

```bash
git clone https://github.com/c18229039407-arch/2cy-agent.git
cd 2cy-agent
node server.mjs   # 或 npm start
```

然后打开 http://127.0.0.1:2333 。

### 首次使用

1. 点右上角**设置**，选择提供商并填入你自己的 API key（BYOK，只存你本机，不会上传给任何人）；
2. 在右栏上传角色图、填角色名，可以让模型帮你起草人设卡；
3. 开始对话——她会带着人设跟你聊，也能认真干活。

### 支持的模型提供商

通过 Anthropic 原生协议 + OpenAI 兼容协议双通道，覆盖主流模型 API：

| 提供商 | 协议 | 默认接口 |
|---|---|---|
| Anthropic（Claude） | 原生 | api.anthropic.com |
| OpenAI（GPT） | OpenAI 兼容 | api.openai.com/v1 |
| DeepSeek | OpenAI 兼容 | api.deepseek.com/v1 |
| Kimi（月之暗面） | OpenAI 兼容 | api.moonshot.cn/v1 |
| 智谱 GLM | OpenAI 兼容 | open.bigmodel.cn/api/paas/v4 |
| 通义千问（阿里） | OpenAI 兼容 | dashscope.aliyuncs.com/compatible-mode/v1 |
| 豆包（火山方舟） | OpenAI 兼容 | ark.cn-beijing.volces.com/api/v3 |
| OpenRouter（聚合） | OpenAI 兼容 | openrouter.ai/api/v1 |
| Ollama（本地，免 key） | OpenAI 兼容 | 127.0.0.1:11434/v1 |
| 自定义 | OpenAI 兼容 | 任意兼容服务 |

## 隐私

- **本地优先**：对话记录、角色卡、长期记忆、API key 全部存在本机 `./data/` 目录，服务只监听 `127.0.0.1`；
- **BYOK**：对话请求直接从你的电脑发往 Anthropic API，本项目没有任何中间服务器；
- `data/` 已在 `.gitignore` 中，不会被提交。

## v0.2 已实现

- BYOK 配置（key 本地存储、多提供商、模型可选）
- 角色卡：上传角色图、手填或让模型起草人设（性格 / 口癖 / 说话方式 / 羁绊）
- 角色扮演对话：人设注入 system prompt，多会话本地持久化
- **三种对话模式**：
  - **聊天**——轻快直接，适合日常闲聊；
  - **专家**——先思考再回答（Claude 走原生自适应思维链；DeepSeek-R 等推理模型自动捕获思维过程），思维过程可展开查看；
  - **Agent**——调用工具干活：抓取网页、读写工作区文件（沙箱限定在 `data/workspace/`），两种协议分别走原生 tool_use 与标准 function calling，多步循环自动执行；
- **长期记忆与用户画像**（v0.2 新增）：
  - 左栏「记忆」区随时可见；对话后一键「沉淀本话」，用你的模型额度把对话提炼为画像更新和事实清单（手动触发，费用可控）；
  - Agent 模式中她也会主动用 `remember` 工具记下你透露的重要信息；
  - 画像和每条事实都可在设置里查看、编辑、删除，或整体关闭记忆——数据只存本机 `data/memory.json`；
- **技能面板**（v0.2 新增）：左栏点选「生成代码 / 做幻灯片 / 整理文档 / 查资料」，自动切换 Agent 模式并填入任务模板，产出保存在工作区（幻灯片为浏览器可直接放映的单文件 HTML）；
- 黑白线稿风界面（设计规范见 `DESIGN.md`）

## 路线图

- [ ] 上传图 → 本地模型转黑白线稿（CPU 可跑）
- [ ] 联网搜集人设（萌娘百科 / Bangumi 等来源，可追溯）
- [ ] MCP 服务器接入 + 自定义 Skill 加载
- [ ] 联网搜索工具（接入搜索 API）
- [ ] 手机 H5 远程接入（配对码 + 可自托管中转 + 离线降级）
- [ ] 社区角色卡共享库

## 免责声明

用户上传的图片与扮演的角色版权归原权利人所有；本项目不分发任何角色素材，用户对上传内容自行负责。

## License

MIT
