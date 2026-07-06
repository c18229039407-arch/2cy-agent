// 2CY Agent · 本地服务（零依赖）
// 架构：本地 HTTP 服务 = 静态 UI + JSON API + Claude 转发（BYOK）。
// 数据全部落在 ./data/，不出用户设备；API key 仅存本地。
import { createServer } from 'node:http';
import { exec, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, unlink, chmod, stat, rename } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const SESSIONS = join(DATA, 'sessions');
const PORT = Number(process.env.PORT || 2333);
const LAN_MODE = process.argv.includes('--lan');
const HOST = LAN_MODE ? '0.0.0.0' : '127.0.0.1'; // 默认只监听本机；--lan 开启局域网接入（配对码鉴权）
const DEFAULT_MODEL = 'claude-opus-4-8';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json',
};

// ---------- 小工具 ----------
async function readJSON(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJSON(file, value) {
  // 原子写：写临时文件后 rename，避免进程中断留下半损坏的 JSON
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}
function send(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { const e = new Error('body too large'); e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { const e = new Error('invalid json'); e.status = 400; reject(e); }
    });
    req.on('error', reject);
  });
}
const safeId = (id) => /^[a-z0-9-]{6,64}$/.test(id);

// ---------- 配置与角色卡 ----------
const configFile = join(DATA, 'config.json');
const characterFile = join(DATA, 'character.json');
const avatarFile = join(DATA, 'avatar');
const memoryFile = join(DATA, 'memory.json');

// ---------- 自定义 Skill（v0.8） ----------
const skillsFile = join(DATA, 'skills.json');
async function getCustomSkills() { return (await readJSON(skillsFile, [])) || []; }

// ---------- 局域网配对码（v0.8） ----------
async function getLanCode() {
  const config = await getConfig();
  if (!config.lanCode) {
    config.lanCode = String(Math.floor(100000 + Math.random() * 900000));
    await writeJSON(configFile, config);
  }
  return config.lanCode;
}
function isLocalReq(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function hasLanAuth(req, code) {
  const cookies = String(req.headers.cookie || '');
  return cookies.includes('cy_code=' + code);
}
const LAN_GATE_HTML = (wrong) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>2CY Agent · 配对</title><body style="font-family:system-ui;background:#faf7f0;color:#1a1a1a;display:grid;place-items:center;min-height:90vh">
<form method="GET" action="/" style="text-align:center;border:2px solid #1a1a1a;padding:32px 28px;background:#fff">
<h2 style="margin:0 0 6px">2CY Agent</h2><p style="margin:0 0 18px;font-size:.9rem;color:#666">输入电脑终端里显示的 6 位配对码</p>
${wrong ? '<p style="color:#b3402a;font-size:.85rem">配对码不对，再看看终端。</p>' : ''}
<input name="code" inputmode="numeric" maxlength="6" autofocus style="font-size:1.4rem;letter-spacing:.4em;text-align:center;width:9em;padding:8px;border:2px solid #1a1a1a">
<br><button style="margin-top:16px;font-size:1rem;padding:8px 28px;border:2px solid #1a1a1a;background:#1a1a1a;color:#fff">进入</button></form></body>`;

// ---------- 记忆（v0.2）：画像 + 事实清单，全部本机、可见可删 ----------
async function getMemory() {
  const m = (await readJSON(memoryFile, {})) || {};
  return { enabled: m.enabled !== false, autoDistill: m.autoDistill === true, shortTerm: m.shortTerm !== false, profile: m.profile || '', facts: Array.isArray(m.facts) ? m.facts : [] };
}
async function saveMemory(m) { await writeJSON(memoryFile, m); }
function addFact(memory, text, from) {
  const t = String(text || '').trim().slice(0, 200);
  if (!t) return null;
  // 简单去重：完全相同的事实不重复记
  if (memory.facts.some((f) => f.text === t)) return null;
  const fact = { id: randomUUID().slice(0, 8), text: t, from: from || 'manual', at: new Date().toISOString() };
  memory.facts.push(fact);
  if (memory.facts.length > 200) memory.facts = memory.facts.slice(-200); // 上限保护
  return fact;
}

async function getConfig() {
  const config = (await readJSON(configFile, {})) || {};
  // BYOK 优先级：设置界面填的 key > 启动时的环境变量
  if (!config.apiKey && process.env.ANTHROPIC_API_KEY) config.apiKey = process.env.ANTHROPIC_API_KEY;
  return config;
}
function maskKey(key) { return key ? key.slice(0, 10) + '…' + key.slice(-4) : null; }

// ---------- 角色扮演 system prompt ----------
function buildSystemPrompt(card, config = {}, memory = null) {
  const userLines = [];
  if (config.userName) userLines.push(`称呼用户为「${config.userName}」。`);
  if (config.userBio) userLines.push(`关于用户：${config.userBio}`);
  const userInfo = userLines.length ? '\n\n用户信息：\n' + userLines.join('\n') : '';
  let memoryInfo = '';
  if (memory && memory.enabled && (memory.profile || memory.facts.length)) {
    const lines = [];
    if (memory.profile) lines.push('用户画像（由过往对话沉淀，可能不完整）：' + memory.profile);
    if (memory.facts.length) {
      const recent = memory.facts.slice(-40).map((f) => '- ' + f.text);
      lines.push('已记住的事实：\n' + recent.join('\n'));
    }
    memoryInfo = '\n\n长期记忆：\n' + lines.join('\n') + '\n（自然地运用这些记忆，不要生硬复述；如果记忆与用户当前所说矛盾，以用户当前所说为准。）';
  }
  if (!card || !card.name) {
    return '你是 2CY Agent 的默认助手。用中文简洁、务实地回复。用户还没有创建角色卡：如果对话合适，可以提醒用户在右侧「角色」面板上传角色图并填写角色名，让专属角色登场。' + userInfo + memoryInfo;
  }
  const lines = [
    `你正在扮演「${card.name}」${card.source ? `，出自《${card.source}》` : ''}。用户明确知道这是角色扮演，请始终保持角色身份。`,
    card.personality ? `性格：${card.personality}` : '',
    card.quirk ? `口癖：${card.quirk}` : '',
    card.speechStyle ? `说话方式：${card.speechStyle}` : '',
    card.bond ? `羁绊设定：${card.bond}` : '',
    '',
    '扮演规则：',
    '- 以角色的口吻、性格和口癖对话，中文回复（用户要求其他语言时除外）。',
    '- 你既是伙伴也是助手：闲聊时有角色感，干活时认真高效，两者都不出戏。',
    '- 不要旁白式描写自己的动作，不要每句都堆口癖，克制而自然。',
    '- 被直接问到时可以坦然承认自己是 AI 在扮演该角色，不需要否认。',
    '- 回答问题和完成任务时保证内容质量，角色感体现在语气而非牺牲准确性。',
  ].filter((l) => l !== null && l !== undefined && l !== '');
  return lines.join('\n') + userInfo + memoryInfo;
}

// ---------- LLM 调用（BYOK，双协议，零依赖） ----------
// anthropic 协议：Anthropic 官方 API（x-api-key）
// openai 协议：OpenAI 兼容 /chat/completions（Bearer）—— 覆盖 OpenAI / DeepSeek /
//             Kimi / 智谱 GLM / 通义千问 / 豆包 / OpenRouter / Ollama 本地等主流提供商
function upstreamError(status, detail) {
  const friendly =
    status === 401 || status === 403 ? 'API key 无效或没有权限，请到「设置」里检查。'
    : status === 404 ? '模型名或接口地址不对，请到「设置」里检查。'
    : status === 429 ? '触发了速率限制（或余额不足），稍等再试。'
    : status === 529 ? '模型服务暂时过载，稍后再试。'
    : `上游返回错误：${detail}`;
  const err = new Error(friendly);
  err.status = status === 401 || status === 403 ? 401 : 502;
  return err;
}
async function fetchLLM(endpoint, headers, body) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    const err = new Error(e.name === 'TimeoutError' ? '请求超时了，网络或上游太慢，稍后再试。' : '网络错误：连不上模型服务，请检查网络和接口地址。');
    err.status = 502;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw upstreamError(res.status, data?.error?.message || data?.message || `HTTP ${res.status}`);
  return data;
}

async function callLLM(config, { system, messages, jsonSchema }) {
  const protocol = (config.provider || 'anthropic') === 'anthropic' ? 'anthropic' : 'openai';
  const model = config.model || DEFAULT_MODEL;

  if (protocol === 'anthropic') {
    const body = {
      model,
      max_tokens: 8192,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    };
    if (jsonSchema) body.output_config = { format: { type: 'json_schema', schema: jsonSchema } };
    const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const data = await fetchLLM(base + '/v1/messages', { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }, body);
    if (data.stop_reason === 'refusal') return { text: '（这个话题我不能接。换个方向聊聊？）', stopReason: 'refusal' };
    return {
      text: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n'),
      stopReason: data.stop_reason,
    };
  }

  // openai 兼容协议
  let sys = system;
  if (jsonSchema) sys += '\n\n只输出一个 JSON 对象（字段：' + Object.keys(jsonSchema.properties).join('、') + '），不要输出任何其他文字或代码块标记。';
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const headers = config.apiKey ? { authorization: 'Bearer ' + config.apiKey } : {};
  const data = await fetchLLM(base + '/chat/completions', headers, {
    model,
    max_tokens: 8192,
    messages: [{ role: 'system', content: sys }, ...messages],
  });
  return { text: data?.choices?.[0]?.message?.content || '', stopReason: data?.choices?.[0]?.finish_reason };
}

// 从可能带代码块标记的文本里抠出 JSON（openai 协议的人设起草用）
function extractJSON(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error('模型没有返回有效的 JSON，换个模型或再试一次。');
  return JSON.parse(match[0]);
}

// ---------- MCP（v0.7）：stdio 传输的 MCP 客户端，零依赖 ----------
const mcpFile = join(DATA, 'mcp.json');
async function getMcpServers() { return (await readJSON(mcpFile, [])) || []; }
async function saveMcpServers(list) { await writeJSON(mcpFile, list); }

const mcpClients = new Map();     // serverId -> McpClient
let mcpToolIndex = new Map();     // 命名空间工具名 -> { cfg, real, label }

class McpClient {
  constructor(cfg) { this.cfg = cfg; this.nextId = 1; this.pending = new Map(); this.tools = []; this.ready = null; this.proc = null; }
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const parts = String(this.cfg.command).trim().split(/\s+/);
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; this.ready = null; reject(e); } };
      try {
        this.proc = spawn(parts[0], parts.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      } catch (e) { return fail(new Error('MCP 启动失败：' + e.message)); }
      let buf = '';
      this.proc.stdout.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          try { this.onMessage(JSON.parse(line)); } catch {}
        }
      });
      this.proc.on('error', (e) => fail(new Error('MCP 启动失败：' + e.message)));
      this.proc.on('exit', () => { this.ready = null; this.proc = null; for (const p of this.pending.values()) p.reject(new Error('MCP 服务已退出')); this.pending.clear(); });
      setTimeout(() => fail(new Error('MCP 初始化超时（15s）')), 15_000);
      this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: '2cy-agent', version: '0.7.0' } })
        .then(() => { this.notify('notifications/initialized', {}); return this.request('tools/list', {}); })
        .then((r) => { this.tools = r?.tools || []; if (!settled) { settled = true; resolve(this); } })
        .catch(fail);
    });
    return this.ready;
  }
  send(msg) { this.proc?.stdin.write(JSON.stringify(msg) + '\n'); }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('MCP 请求超时：' + method)); } }, 30_000);
    });
  }
  onMessage(m) {
    if (m.id !== undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message || 'MCP 错误')) : p.resolve(m.result);
    }
  }
  async callTool(name, args) {
    const r = await this.request('tools/call', { name, arguments: args || {} });
    const text = (r?.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
    return text.slice(0, 8000) || '（无输出）';
  }
  stop() { try { this.proc?.kill(); } catch {} mcpClients.delete(this.cfg.id); }
}
async function getMcpClient(cfg) {
  let c = mcpClients.get(cfg.id);
  if (!c) { c = new McpClient(cfg); mcpClients.set(cfg.id, c); }
  await c.start();
  return c;
}
// 收集所有启用的 MCP 服务的工具（命名空间隔离），返回工具定义数组
async function collectMcpTools() {
  const servers = await getMcpServers();
  const index = new Map(); const defs = [];
  for (const cfg of servers) {
    if (cfg.enabled === false) continue;
    try {
      const c = await getMcpClient(cfg);
      for (const t of c.tools) {
        const nsName = `mcp_${cfg.id}_${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        index.set(nsName, { cfg, real: t.name, label: `${cfg.name} · ${t.name}` });
        defs.push({ name: nsName, description: `[MCP:${cfg.name}] ${t.description || ''}`.slice(0, 500), input_schema: t.inputSchema || { type: 'object', properties: {} } });
      }
    } catch { /* 单个服务失败不影响其他 */ }
  }
  mcpToolIndex = index;
  return defs;
}

// ---------- 第三方搜索（v0.6）：Tavily，补齐无原生搜索的提供商 ----------
const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: '联网搜索最新信息。返回若干条结果的标题、链接与摘要。',
  input_schema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
};
async function tavilySearch(query) {
  const config = await getConfig();
  if (!config.searchApiKey) throw new Error('没有配置搜索 API key（设置 → 供应商 → 搜索 API Key）');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.searchApiKey },
    body: JSON.stringify({ query: String(query).slice(0, 200), max_results: 5, search_depth: 'basic' }),
  });
  if (!res.ok) throw new Error('搜索服务返回 ' + res.status + (res.status === 401 ? '（搜索 key 无效）' : ''));
  const data = await res.json();
  const items = (data.results || []).map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${String(r.content || '').slice(0, 300)}`);
  return items.length ? items.join('\n\n').slice(0, 6000) : '（没有搜到相关结果）';
}

// ---------- Agent 模式：内置工具（v0.1，全部本地安全） ----------
const WORKSPACE = join(DATA, 'workspace');
const TOOLS = [
  {
    name: 'fetch_url',
    description: '抓取一个公网网页并返回其正文文本（已去除 HTML 标签）。用于查资料、看文章。',
    input_schema: { type: 'object', properties: { url: { type: 'string', description: '要抓取的 http(s) 网址' } }, required: ['url'] },
  },
  {
    name: 'save_file',
    description: '把文本内容保存为工作区里的一个文件（工作区在用户电脑的 data/workspace/ 目录）。',
    input_schema: { type: 'object', properties: { filename: { type: 'string', description: '文件名，如 notes.md' }, content: { type: 'string' } }, required: ['filename', 'content'] },
  },
  {
    name: 'read_file',
    description: '读取工作区里某个文件的内容。可先用 list_files 查看有哪些文件。',
    input_schema: { type: 'object', properties: { filename: { type: 'string' } }, required: ['filename'] },
  },
  {
    name: 'list_files',
    description: '列出工作区里的所有文件。',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'remember',
    description: '把关于用户的一条重要事实存入长期记忆（例如偏好、习惯、正在做的事、重要日期）。只记稳定、跨对话有用的信息，不记一次性琐事。',
    input_schema: { type: 'object', properties: { fact: { type: 'string', description: '一句话事实，40 字以内' } }, required: ['fact'] },
  },
];

function safeName(name) {
  const base = String(name).split('/').pop().split('\\').pop();
  if (!base || base.startsWith('.')) throw new Error('文件名不合法');
  return base;
}
async function execTool(name, input) {
  if (name === 'fetch_url') {
    const u = new URL(String(input.url));
    if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http/https');
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const blocked = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) // IPv4 内网/回环/链路本地
      || host === '::1' || host === '::' // IPv6 回环
      || /^(fe80|fc00|fd)/.test(host)     // IPv6 链路本地 / 唯一本地
      || /^::ffff:(127|10|192\.168|169\.254)/.test(host) // IPv4-mapped IPv6
      || /^\d+$/.test(host);              // 纯十进制 IP（如 2130706433）
    if (blocked) throw new Error('不允许访问内网地址');
    const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 2CYAgent/0.1' } });
    if (res.status >= 300 && res.status < 400) throw new Error('目标地址发生重定向，出于安全考虑已阻止');
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s{2,}/g, ' ').trim();
    return text.slice(0, 8000) || '（该页面没有可读文本）';
  }
  if (name === 'save_file') {
    await mkdir(WORKSPACE, { recursive: true });
    const file = safeName(input.filename);
    await writeFile(join(WORKSPACE, file), String(input.content ?? ''));
    return `已保存到 data/workspace/${file}`;
  }
  if (name === 'read_file') {
    return await readFile(join(WORKSPACE, safeName(input.filename)), 'utf8');
  }
  if (name === 'list_files') {
    const files = await readdir(WORKSPACE).catch(() => []);
    return files.length ? files.join('\n') : '（工作区还是空的）';
  }
  if (name === 'web_search') {
    return await tavilySearch(input.query);
  }
  if (name.startsWith('mcp_')) {
    const t = mcpToolIndex.get(name);
    if (!t) throw new Error('MCP 工具不可用：' + name);
    const c = await getMcpClient(t.cfg);
    return await c.callTool(t.real, input);
  }
  if (name === 'remember') {
    const memory = await getMemory();
    if (!memory.enabled) return '记忆功能已被用户关闭，本条未保存。';
    const fact = addFact(memory, input.fact, 'agent');
    if (!fact) return '这条已经记过了（或内容为空）。';
    await saveMemory(memory);
    return '已记住：' + fact.text;
  }
  throw new Error('未知工具：' + name);
}
function stepLabel(name, input) {
  if (name === 'fetch_url') return `抓取网页 · ${String(input.url || '').slice(0, 60)}`;
  if (name === 'save_file') return `保存文件 · ${input.filename}`;
  if (name === 'read_file') return `读取文件 · ${input.filename}`;
  if (name === 'list_files') return '查看工作区文件';
  if (name === 'remember') return `记住 · ${String(input.fact || '').slice(0, 40)}`;
  if (name === 'web_search') return `联网搜索 · ${String(input.query || '').slice(0, 40)}`;
  if (name.startsWith('mcp_')) return `MCP · ${mcpToolIndex.get(name)?.label || name}`;
  return name;
}

// ---------- 短期记忆（v0.5）：长对话后台压缩为前情提要 ----------
const RECENT_WINDOW = 24;   // 每轮原文携带的最近消息数
const COMPRESS_BATCH = 16;  // 积累多少条未压缩消息后触发一次压缩
async function compressSession(file, config) {
  try {
    const s = await readJSON(file);
    if (!s) return;
    const from = s.summarizedUpTo || 0;
    const to = s.messages.length - RECENT_WINDOW;
    if (to - from < COMPRESS_BATCH) return;
    const chunk = s.messages.slice(from, to)
      .map((m) => (m.role === 'user' ? '用户' : '助手') + '：' + String(m.text || '').slice(0, 400))
      .join('\n');
    const { text } = await callLLM(config, {
      system: '你是对话压缩助手。把旧的前情提要与新增对话合并为一段新的前情提要：保留关键事实、决定、任务进展和情感基调，300 字以内，只输出提要本身。',
      messages: [{ role: 'user', content: `旧前情提要：${s.summary || '（无）'}\n\n新增对话：\n${chunk}` }],
    });
    if (!text) return;
    // 重新读取后落盘，尽量避免覆盖压缩期间新写入的消息
    const fresh = await readJSON(file);
    if (!fresh) return;
    fresh.summary = String(text).trim().slice(0, 1200);
    fresh.summarizedUpTo = to;
    await writeJSON(file, fresh);
  } catch { /* 压缩失败静默跳过，下轮再试 */ }
}

// ---------- 三种模式的一轮对话 ----------
// chat：直接回复 | expert：思维链 | agent：工具循环
const MAX_TOOL_ROUNDS = 6;
async function runTurn(config, { system, history, mode, mcpDefs = [] }) {
  const protocol = (config.provider || 'anthropic') === 'anthropic' ? 'anthropic' : 'openai';
  const model = config.model || DEFAULT_MODEL;
  const steps = [];

  if (protocol === 'anthropic') {
    const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const headers = { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' };
    const body = {
      model,
      max_tokens: mode === 'expert' ? 16000 : 8192,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: history.map((m) => ({ role: m.role, content: m.content })),
    };
    if (mode === 'expert') body.thinking = { type: 'adaptive', display: 'summarized' };
    if (mode === 'agent') body.tools = [...TOOLS, ...mcpDefs];
    // Anthropic 官方联网搜索（服务端工具，按次计费走用户自己的 key）
    if (config.webSearch === true) {
      body.tools = [...(body.tools || []), { type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    }

    let thinking = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const data = await fetchLLM(base + '/v1/messages', headers, body);
      if (data.stop_reason === 'refusal') return { text: '（这个话题我不能接。换个方向聊聊？）', thinking, steps };
      for (const b of data.content || []) {
        if (b.type === 'thinking' && b.thinking) thinking += b.thinking + '\n';
        if (b.type === 'server_tool_use' && b.name === 'web_search') steps.push({ label: `联网搜索 · ${String(b.input?.query || '').slice(0, 40)}` });
      }
      const toolUses = (data.content || []).filter((b) => b.type === 'tool_use');
      if (data.stop_reason !== 'tool_use' || !toolUses.length || round === MAX_TOOL_ROUNDS) {
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
        return { text: text || '（她没说出话来，再试一次？）', thinking: thinking.trim(), steps };
      }
      body.messages.push({ role: 'assistant', content: data.content });
      const results = [];
      for (const t of toolUses) {
        let result, isError = false;
        try { result = await execTool(t.name, t.input || {}); }
        catch (e) { result = '工具执行失败：' + e.message; isError = true; }
        steps.push({ label: stepLabel(t.name, t.input || {}), error: isError });
        results.push({ type: 'tool_result', tool_use_id: t.id, content: result, ...(isError ? { is_error: true } : {}) });
      }
      body.messages.push({ role: 'user', content: results });
    }
  }

  // ---- openai 兼容协议 ----
  const base = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const headers = config.apiKey ? { authorization: 'Bearer ' + config.apiKey } : {};
  const oaMessages = [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  const body = { model, max_tokens: 8192, messages: oaMessages };
  const oaTools = [];
  if (mode === 'agent') {
    oaTools.push(...[...TOOLS, ...mcpDefs].map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })));
  }
  // 提供商原生联网搜索：Kimi 内建 $web_search（搜索在服务端执行，参数原样回传即可）；GLM 的 web_search 工具
  if (config.webSearch === true && config.provider === 'kimi') {
    oaTools.push({ type: 'builtin_function', function: { name: '$web_search' } });
  }
  if (config.webSearch === true && config.provider === 'glm') {
    oaTools.push({ type: 'web_search', web_search: { enable: true, search_result: true } });
  }
  // 其余提供商没有原生搜索：配置了第三方搜索 key 时挂本地 web_search 工具（由 Tavily 执行）
  if (config.webSearch === true && !['kimi', 'glm'].includes(config.provider) && config.searchApiKey) {
    oaTools.push({ type: 'function', function: { name: WEB_SEARCH_TOOL.name, description: WEB_SEARCH_TOOL.description, parameters: WEB_SEARCH_TOOL.input_schema } });
  }
  if (oaTools.length) body.tools = oaTools;
  let thinking = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const data = await fetchLLM(base + '/chat/completions', headers, body);
    const msg = data?.choices?.[0]?.message || {};
    if (msg.reasoning_content) thinking += msg.reasoning_content + '\n'; // DeepSeek-R / GLM / Qwen 推理模型
    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length || round === MAX_TOOL_ROUNDS) {
      return { text: msg.content || '（她没说出话来，再试一次？）', thinking: thinking.trim(), steps };
    }
    oaMessages.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });
    for (const c of toolCalls) {
      // Kimi 内建搜索：搜索由 Kimi 服务端完成，客户端只需把 arguments 原样回传
      if (c.function?.name === '$web_search') {
        steps.push({ label: '联网搜索', error: false });
        oaMessages.push({ role: 'tool', tool_call_id: c.id, content: c.function.arguments || '{}' });
        continue;
      }
      let input = {};
      try { input = JSON.parse(c.function?.arguments || '{}'); } catch {}
      let result, isError = false;
      try { result = await execTool(c.function?.name, input); }
      catch (e) { result = '工具执行失败：' + e.message; isError = true; }
      steps.push({ label: stepLabel(c.function?.name, input), error: isError });
      oaMessages.push({ role: 'tool', tool_call_id: c.id, content: result });
    }
  }
}

// ---------- API 路由 ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // ---------- 记忆（v0.2） ----------
  if (req.method === 'GET' && url.pathname === '/api/memory') {
    return send(res, 200, await getMemory());
  }
  if (req.method === 'PUT' && url.pathname === '/api/memory') {
    const body = await readBody(req);
    const memory = await getMemory();
    if (typeof body.enabled === 'boolean') memory.enabled = body.enabled;
    if (typeof body.autoDistill === 'boolean') memory.autoDistill = body.autoDistill;
    if (typeof body.shortTerm === 'boolean') memory.shortTerm = body.shortTerm;
    if (typeof body.profile === 'string') memory.profile = body.profile.trim().slice(0, 600);
    await saveMemory(memory);
    return send(res, 200, memory);
  }
  if (req.method === 'POST' && url.pathname === '/api/memory/facts') {
    const body = await readBody(req);
    const memory = await getMemory();
    const fact = addFact(memory, body.text, 'manual');
    if (!fact) return send(res, 400, { error: '内容为空或已存在' });
    await saveMemory(memory);
    return send(res, 200, fact);
  }
  if (req.method === 'DELETE' && parts[1] === 'memory' && parts[2] === 'facts' && parts[3]) {
    const memory = await getMemory();
    memory.facts = memory.facts.filter((f) => f.id !== parts[3]);
    await saveMemory(memory);
    return send(res, 200, { ok: true });
  }
  // 沉淀：把一个会话的对话内容提炼为画像更新 + 新事实（消耗一次用户的 LLM 调用）
  if (req.method === 'POST' && url.pathname === '/api/memory/distill') {
    const body = await readBody(req);
    if (!body.sessionId || !safeId(body.sessionId)) return send(res, 400, { error: '需要 sessionId' });
    const s = await readJSON(join(SESSIONS, `${body.sessionId}.json`));
    if (!s || !s.messages.length) return send(res, 404, { error: '会话不存在或还是空的' });
    const config = await getConfig();
    if (!config.apiKey && config.provider !== 'ollama') return send(res, 401, { error: '先在「设置」里填入 API key。' });
    const memory = await getMemory();
    if (!memory.enabled) return send(res, 400, { error: '记忆功能已关闭，先在左栏打开。' });
    const transcript = s.messages.slice(-40)
      .map((m) => (m.role === 'user' ? '用户' : '助手') + '：' + String(m.text || '').slice(0, 500))
      .join('\n');
    const schema = {
      type: 'object',
      properties: {
        profile: { type: 'string', description: '更新后的用户画像，一段话，120 字以内。基于旧画像微调，没有新信息就原样返回。' },
        facts: { type: 'array', items: { type: 'string' }, description: '本次对话中值得长期记住的新事实，每条 40 字以内，0-5 条。已记住的不要重复。' },
      },
      required: ['profile', 'facts'],
      additionalProperties: false,
    };
    try {
      const { text } = await callLLM(config, {
        system: '你是记忆整理助手。根据对话记录，更新用户画像并提取值得长期记住的新事实（偏好、习惯、身份、正在做的事、重要日期）。只记稳定、跨对话有用的信息；宁缺毋滥。输出 JSON。',
        messages: [{ role: 'user', content: `旧画像：${memory.profile || '（暂无）'}\n\n已记住的事实：\n${memory.facts.slice(-40).map((f) => '- ' + f.text).join('\n') || '（暂无）'}\n\n对话记录：\n${transcript}` }],
        jsonSchema: schema,
      });
      const out = extractJSON(text);
      if (typeof out.profile === 'string' && out.profile.trim()) memory.profile = out.profile.trim().slice(0, 600);
      const added = [];
      for (const f of Array.isArray(out.facts) ? out.facts.slice(0, 5) : []) {
        const fact = addFact(memory, f, 'distill');
        if (fact) added.push(fact);
      }
      await saveMemory(memory);
      return send(res, 200, { profile: memory.profile, added, total: memory.facts.length });
    } catch (e) {
      return send(res, e.status || 502, { error: e.message });
    }
  }

  // ---------- 自定义 Skill（v0.8） ----------
  if (req.method === 'GET' && url.pathname === '/api/skills') {
    return send(res, 200, await getCustomSkills());
  }
  if (req.method === 'POST' && url.pathname === '/api/skills') {
    const body = await readBody(req);
    if (!body.name || !body.tpl) return send(res, 400, { error: '需要名称和任务模板' });
    const list = await getCustomSkills();
    const skill = { id: randomUUID().slice(0, 8), name: String(body.name).trim().slice(0, 20), desc: String(body.desc || '').trim().slice(0, 40), tpl: String(body.tpl).trim().slice(0, 500) };
    list.push(skill);
    await writeJSON(skillsFile, list);
    return send(res, 200, skill);
  }
  if (req.method === 'DELETE' && parts[1] === 'skills' && parts[2]) {
    const list = await getCustomSkills();
    await writeJSON(skillsFile, list.filter((x) => x.id !== parts[2]));
    return send(res, 200, { ok: true });
  }

  // ---------- MCP（v0.7） ----------
  if (req.method === 'GET' && url.pathname === '/api/mcp') {
    const servers = await getMcpServers();
    const out = [];
    for (const cfg of servers) {
      let status = 'off', tools = [];
      if (cfg.enabled !== false) {
        try { const c = await getMcpClient(cfg); status = 'ok'; tools = c.tools.map((t) => t.name); }
        catch (e) { status = '连接失败：' + e.message; }
      }
      out.push({ id: cfg.id, name: cfg.name, command: cfg.command, enabled: cfg.enabled !== false, status, tools });
    }
    return send(res, 200, out);
  }
  if (req.method === 'POST' && url.pathname === '/api/mcp') {
    const body = await readBody(req);
    if (!body.name || !body.command) return send(res, 400, { error: '需要名称和启动命令' });
    const servers = await getMcpServers();
    const cfg = { id: randomUUID().slice(0, 8), name: String(body.name).trim().slice(0, 30), command: String(body.command).trim().slice(0, 300), enabled: true };
    servers.push(cfg);
    await saveMcpServers(servers);
    return send(res, 200, cfg);
  }
  if (parts[1] === 'mcp' && parts[2]) {
    const servers = await getMcpServers();
    const cfg = servers.find((x) => x.id === parts[2]);
    if (!cfg) return send(res, 404, { error: 'not found' });
    if (req.method === 'DELETE') {
      mcpClients.get(cfg.id)?.stop();
      await saveMcpServers(servers.filter((x) => x.id !== cfg.id));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (typeof body.enabled === 'boolean') { cfg.enabled = body.enabled; if (!body.enabled) mcpClients.get(cfg.id)?.stop(); }
      await saveMcpServers(servers);
      return send(res, 200, cfg);
    }
    if (req.method === 'POST' && parts[3] === 'test') {
      const body = await readBody(req);
      try {
        const c = await getMcpClient(cfg);
        const tool = body.tool || c.tools[0]?.name;
        if (!tool) return send(res, 400, { error: '该服务没有可用工具' });
        const result = await c.callTool(tool, body.args || {});
        return send(res, 200, { tool, result: result.slice(0, 2000) });
      } catch (e) { return send(res, 502, { error: e.message }); }
    }
  }

  // 应用状态
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const config = await getConfig();
    const card = await readJSON(characterFile);
    return send(res, 200, {
      configured: Boolean(config.apiKey) || config.provider === 'ollama',
      provider: config.provider || 'anthropic',
      baseUrl: config.baseUrl || '',
      model: config.model || DEFAULT_MODEL,
      maskedKey: maskKey(config.apiKey),
      webSearch: config.webSearch === true,
      maskedSearchKey: maskKey(config.searchApiKey),
      userName: config.userName || '',
      userBio: config.userBio || '',
      character: card,
    });
  }

  // 工作空间文件（Agent 模式的产出）
  if (req.method === 'GET' && url.pathname === '/api/workspace') {
    const names = (await readdir(WORKSPACE).catch(() => []));
    const files = [];
    for (const n of names) {
      const st = await stat(join(WORKSPACE, n)).catch(() => null);
      if (st?.isFile()) files.push({ name: n, size: st.size, mtime: st.mtime.toISOString() });
    }
    files.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return send(res, 200, files);
  }
  if (parts[1] === 'workspace' && parts[2]) {
    let name;
    try { name = safeName(decodeURIComponent(parts[2])); } catch { return send(res, 400, { error: '文件名不合法' }); }
    if (req.method === 'GET') {
      try {
        const content = await readFile(join(WORKSPACE, name), 'utf8');
        return send(res, 200, { name, content: content.slice(0, 20000) });
      } catch { return send(res, 404, { error: '文件不存在' }); }
    }
    if (req.method === 'DELETE') {
      await unlink(join(WORKSPACE, name)).catch(() => {});
      return send(res, 200, { ok: true });
    }
  }

  // 配置（BYOK key 只写不读全文；provider 决定协议）
  if (req.method === 'PUT' && url.pathname === '/api/config') {
    const body = await readBody(req);
    const config = await getConfig();
    if (typeof body.provider === 'string' && body.provider.trim()) {
      const next = body.provider.trim();
      if (config.provider && config.provider !== next) delete config.apiKey; // 换提供商时旧 key 作废
      config.provider = next;
    }
    if (typeof body.baseUrl === 'string') config.baseUrl = body.baseUrl.trim();
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) config.apiKey = body.apiKey.trim();
    if (body.clearApiKey === true) delete config.apiKey;
    if (typeof body.model === 'string' && body.model.trim()) config.model = body.model.trim();
    if (typeof body.webSearch === 'boolean') config.webSearch = body.webSearch;
    if (typeof body.searchApiKey === 'string' && body.searchApiKey.trim()) config.searchApiKey = body.searchApiKey.trim();
    if (body.clearSearchKey === true) delete config.searchApiKey;
    if (typeof body.userName === 'string') config.userName = body.userName.trim();
    if (typeof body.userBio === 'string') config.userBio = body.userBio.trim();
    await writeJSON(configFile, config);
    await chmod(configFile, 0o600).catch(() => {});
    return send(res, 200, {
      configured: Boolean(config.apiKey) || config.provider === 'ollama',
      provider: config.provider || 'anthropic',
      baseUrl: config.baseUrl || '',
      model: config.model || DEFAULT_MODEL,
      maskedKey: maskKey(config.apiKey),
      webSearch: config.webSearch === true,
    });
  }

  // 角色卡
  if (req.method === 'PUT' && url.pathname === '/api/character') {
    const body = await readBody(req);
    if (!body.name || !String(body.name).trim()) return send(res, 400, { error: '角色名不能为空' });
    const card = {
      name: String(body.name).trim(),
      source: String(body.source || '').trim(),
      personality: String(body.personality || '').trim(),
      quirk: String(body.quirk || '').trim(),
      speechStyle: String(body.speechStyle || '').trim(),
      bond: String(body.bond || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    await writeJSON(characterFile, card);
    return send(res, 200, card);
  }

  // 让模型起草人设（v0.1 用模型自身知识；联网搜索在路线图）
  if (req.method === 'POST' && url.pathname === '/api/character/generate') {
    const body = await readBody(req);
    const config = await getConfig();
    if (!config.apiKey && config.provider !== 'ollama') return send(res, 401, { error: '先在「设置」里填入 API key。' });
    if (!body.name) return send(res, 400, { error: '需要角色名' });
    const schema = {
      type: 'object',
      properties: {
        source: { type: 'string', description: '角色出处作品名，不含书名号' },
        personality: { type: 'string', description: '性格概括，25 字以内' },
        quirk: { type: 'string', description: '口癖或标志性语言习惯，20 字以内' },
        speechStyle: { type: 'string', description: '说话方式，20 字以内' },
        bond: { type: 'string', description: '一条适合日常互动的羁绊设定，25 字以内' },
      },
      required: ['source', 'personality', 'quirk', 'speechStyle', 'bond'],
      additionalProperties: false,
    };
    try {
      const { text } = await callLLM(config, {
        system: '你是二次元角色资料整理助手。根据角色名（和可选的出处提示）输出该角色的人设卡字段。如果角色广为人知，基于公开设定填写；如果不认识这个角色，各字段基于名字合理原创，不要编造出处（source 留空字符串）。',
        messages: [{ role: 'user', content: `角色名：${body.name}${body.source ? `\n出处提示：${body.source}` : ''}` }],
        jsonSchema: schema,
      });
      return send(res, 200, extractJSON(text));
    } catch (e) {
      return send(res, e.status || 502, { error: e.message });
    }
  }

  // 头像（上传原图；转线稿在路线图）
  if (req.method === 'POST' && url.pathname === '/api/avatar') {
    const body = await readBody(req);
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(body.dataUrl || '');
    if (!match) return send(res, 400, { error: '仅支持 png / jpg / webp 图片' });
    await writeFile(avatarFile, Buffer.from(match[2], 'base64'));
    const card = (await readJSON(characterFile, {})) || {};
    card.avatarMime = match[1];
    await writeJSON(characterFile, card);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/avatar') {
    const card = await readJSON(characterFile);
    try {
      const buf = await readFile(avatarFile);
      res.writeHead(200, { 'content-type': card?.avatarMime || 'image/png', 'cache-control': 'no-cache' });
      return res.end(buf);
    } catch { return send(res, 404, { error: 'no avatar' }); }
  }

  // 会话
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const files = (await readdir(SESSIONS).catch(() => [])).filter((f) => f.endsWith('.json'));
    const list = [];
    for (const f of files) {
      const s = await readJSON(join(SESSIONS, f));
      if (s) list.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, count: s.messages.length });
    }
    list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return send(res, 200, list);
  }
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const s = { id: randomUUID(), title: '白纸一页', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
    await writeJSON(join(SESSIONS, `${s.id}.json`), s);
    return send(res, 200, s);
  }
  if (parts[1] === 'sessions' && parts[2] && safeId(parts[2])) {
    const file = join(SESSIONS, `${parts[2]}.json`);
    if (req.method === 'GET' && parts.length === 3) {
      const s = await readJSON(file);
      return s ? send(res, 200, s) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'DELETE' && parts.length === 3) {
      await unlink(file).catch(() => {});
      return send(res, 200, { ok: true });
    }
    // 发消息 → 调 Claude → 存回复
    if (req.method === 'POST' && parts[3] === 'messages') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return send(res, 400, { error: '消息不能为空' });
      const s = await readJSON(file);
      if (!s) return send(res, 404, { error: 'not found' });
      const config = await getConfig();
      if (!config.apiKey && config.provider !== 'ollama') return send(res, 401, { error: '还没有配置 API key。点右上角「设置」，选择提供商并填入对应的 API key。' });

      const mode = ['chat', 'expert', 'agent'].includes(body.mode) ? body.mode : 'chat';
      s.messages.push({ role: 'user', text, at: new Date().toISOString() });
      if (s.title === '白纸一页') s.title = text.slice(0, 14);
      const card = await readJSON(characterFile);
      const memory = await getMemory();
      let system = buildSystemPrompt(card, config, memory);
      if (mode === 'agent') system += '\n\n你现在处于 Agent 模式，可以调用工具（抓网页、读写工作区文件、remember 记忆）完成任务。需要时果断使用工具，多步任务可以连续调用；用户透露值得长期记住的信息时用 remember 记下；完成后用中文简洁汇报结果。';
      // 短期记忆：有前情提要时注入，并缩小携带的原文窗口
      const mcpDefs = mode === 'agent' ? await collectMcpTools() : [];
      const useShortTerm = memory.shortTerm && s.summary;
      if (useShortTerm) system += '\n\n本话前情提要（此前对话的压缩摘要，自然衔接，不要复述）：\n' + s.summary;
      const windowSize = useShortTerm ? RECENT_WINDOW : 60;
      try {
        const { text: reply, thinking, steps } = await runTurn(config, {
          system,
          history: s.messages.slice(-windowSize).map((m) => ({ role: m.role, content: m.text })),
          mode,
          mcpDefs,
        });
        const record = { role: 'assistant', text: reply, at: new Date().toISOString() };
        if (thinking) record.thinking = thinking;
        if (steps && steps.length) record.steps = steps;
        s.messages.push(record);
        s.updatedAt = new Date().toISOString();
        await writeJSON(file, s);
        // 长对话后台压缩前情提要（不阻塞响应；关闭短期记忆则跳过）
        if (memory.shortTerm && s.messages.length - (s.summarizedUpTo || 0) >= RECENT_WINDOW + COMPRESS_BATCH) {
          compressSession(file, config);
        }
        return send(res, 200, { reply, thinking: record.thinking || '', steps: record.steps || [], title: s.title });
      } catch (e) {
        s.updatedAt = new Date().toISOString();
        await writeJSON(file, s); // 用户消息保留，回复失败可重试
        return send(res, e.status || 502, { error: e.message, title: s.title });
      }
    }
  }

  return send(res, 404, { error: 'not found' });
}

// ---------- 静态文件 ----------
async function handleStatic(req, res, url) {
  let file = normalize(join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || url.pathname === '') file = join(PUBLIC, 'index.html');
  try {
    const buf = await readFile(file);
    const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream' };
    if (file.endsWith('.html')) headers['cache-control'] = 'no-cache'; // 升级后普通刷新即可见新版
    res.writeHead(200, headers);
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

// ---------- 启动 ----------
await mkdir(SESSIONS, { recursive: true });
createServer(async (req, res) => {
  // 局域网模式：非本机请求需配对码（一次输入，cookie 保持）
  if (LAN_MODE && !isLocalReq(req)) {
    const code = await getLanCode();
    // Origin 校验：拦截跨源写请求（防局域网内恶意页面借用已配对的 cookie）
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers.host;
        try { if (new URL(origin).host !== host) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"跨源请求被拒绝"}'); } }
        catch { res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"非法来源"}'); }
      }
    }
    if (!hasLanAuth(req, code)) {
      const u = new URL(req.url, 'http://x');
      const given = u.searchParams.get('code');
      if (given === code) {
        res.writeHead(302, { 'set-cookie': `cy_code=${code}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`, location: '/' });
        return res.end();
      }
      if (u.pathname.startsWith('/api/')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"需要配对码"}'); }
      res.writeHead(given ? 401 : 200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(LAN_GATE_HTML(!!given));
    }
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  // CSRF 防护：写请求的 Origin 必须与 Host 同源（无 Origin 的本地工具请求放行）
  if (url.pathname.startsWith('/api/') && req.method !== 'GET' && req.headers.origin) {
    try {
      const oHost = new URL(req.headers.origin).host;
      if (oHost !== String(req.headers.host || '')) return send(res, 403, { error: '跨源写请求被拒绝' });
    } catch { return send(res, 403, { error: '非法 Origin' }); }
  }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await handleStatic(req, res, url);
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'internal error' });
  }
}).listen(PORT, HOST, async () => {
  const url = `http://${LAN_MODE ? '127.0.0.1' : HOST}:${PORT}`;
  console.log(`2CY Agent 已启动 → ${url}`);
  if (LAN_MODE) {
    const { networkInterfaces } = await import('node:os');
    const nets = networkInterfaces();
    const ips = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    const code = await getLanCode();
    console.log('局域网模式已开启：手机连同一 Wi-Fi，浏览器访问 ' + (ips.length ? ips.map((ip) => `http://${ip}:${PORT}`).join(' 或 ') : '（未找到内网地址）'));
    console.log('配对码：' + code + '（首次访问输入一次即可）');
  }
  console.log('数据目录：' + DATA + '（对话、角色卡、API key 均只存本机）');
  // 进程退出时清理所有 MCP 子进程，避免遗留孤儿进程
  const shutdown = () => { for (const c of mcpClients.values()) { try { c.proc?.kill(); } catch {} } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // 自动打开浏览器（设 NO_OPEN=1 可关闭）
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === 'darwin' ? `open ${url}`
      : process.platform === 'win32' ? `start "" ${url}`
      : `xdg-open ${url}`;
    setTimeout(() => exec(cmd, () => {}), 300);
  }
});
