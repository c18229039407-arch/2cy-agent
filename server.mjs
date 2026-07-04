// 2CY Agent · 本地服务（零依赖）
// 架构：本地 HTTP 服务 = 静态 UI + JSON API + Claude 转发（BYOK）。
// 数据全部落在 ./data/，不出用户设备；API key 仅存本地。
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, unlink, chmod, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const SESSIONS = join(DATA, 'sessions');
const PORT = Number(process.env.PORT || 2333);
const HOST = '127.0.0.1'; // 只监听本机；手机端接入走后续的配对中转
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
  await writeFile(file, JSON.stringify(value, null, 2));
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
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}
const safeId = (id) => /^[a-z0-9-]{6,64}$/.test(id);

// ---------- 配置与角色卡 ----------
const configFile = join(DATA, 'config.json');
const characterFile = join(DATA, 'character.json');
const avatarFile = join(DATA, 'avatar');

async function getConfig() {
  const config = (await readJSON(configFile, {})) || {};
  // BYOK 优先级：设置界面填的 key > 启动时的环境变量
  if (!config.apiKey && process.env.ANTHROPIC_API_KEY) config.apiKey = process.env.ANTHROPIC_API_KEY;
  return config;
}
function maskKey(key) { return key ? key.slice(0, 10) + '…' + key.slice(-4) : null; }

// ---------- 角色扮演 system prompt ----------
function buildSystemPrompt(card, config = {}) {
  const userLines = [];
  if (config.userName) userLines.push(`称呼用户为「${config.userName}」。`);
  if (config.userBio) userLines.push(`关于用户：${config.userBio}`);
  const userInfo = userLines.length ? '\n\n用户信息：\n' + userLines.join('\n') : '';
  if (!card || !card.name) {
    return '你是 2CY Agent 的默认助手。用中文简洁、务实地回复。用户还没有创建角色卡：如果对话合适，可以提醒用户在右侧「角色」面板上传角色图并填写角色名，让专属角色登场。' + userInfo;
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
  return lines.join('\n') + userInfo;
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
    if (/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) throw new Error('不允许访问内网地址');
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 2CYAgent/0.1' } });
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
  throw new Error('未知工具：' + name);
}
function stepLabel(name, input) {
  if (name === 'fetch_url') return `抓取网页 · ${String(input.url || '').slice(0, 60)}`;
  if (name === 'save_file') return `保存文件 · ${input.filename}`;
  if (name === 'read_file') return `读取文件 · ${input.filename}`;
  if (name === 'list_files') return '查看工作区文件';
  return name;
}

// ---------- 三种模式的一轮对话 ----------
// chat：直接回复 | expert：思维链 | agent：工具循环
const MAX_TOOL_ROUNDS = 6;
async function runTurn(config, { system, history, mode }) {
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
    if (mode === 'agent') body.tools = TOOLS;

    let thinking = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const data = await fetchLLM(base + '/v1/messages', headers, body);
      if (data.stop_reason === 'refusal') return { text: '（这个话题我不能接。换个方向聊聊？）', thinking, steps };
      for (const b of data.content || []) if (b.type === 'thinking' && b.thinking) thinking += b.thinking + '\n';
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
  if (mode === 'agent') {
    body.tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  }
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
      let system = buildSystemPrompt(card, config);
      if (mode === 'agent') system += '\n\n你现在处于 Agent 模式，可以调用工具（抓网页、读写工作区文件）完成任务。需要时果断使用工具，多步任务可以连续调用；完成后用中文简洁汇报结果。';
      try {
        const { text: reply, thinking, steps } = await runTurn(config, {
          system,
          history: s.messages.slice(-60).map((m) => ({ role: m.role, content: m.text })),
          mode,
        });
        const record = { role: 'assistant', text: reply, at: new Date().toISOString() };
        if (thinking) record.thinking = thinking;
        if (steps && steps.length) record.steps = steps;
        s.messages.push(record);
        s.updatedAt = new Date().toISOString();
        await writeJSON(file, s);
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
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

// ---------- 启动 ----------
await mkdir(SESSIONS, { recursive: true });
createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await handleStatic(req, res, url);
  } catch (e) {
    return send(res, 500, { error: e.message || 'internal error' });
  }
}).listen(PORT, HOST, () => {
  console.log(`2CY Agent 已启动 → http://${HOST}:${PORT}`);
  console.log('数据目录：' + DATA + '（对话、角色卡、API key 均只存本机）');
});
