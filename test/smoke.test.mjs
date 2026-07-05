// 2CY Agent 冒烟 + 安全回归测试（零依赖，node:test 内置）
// 运行：node --test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let proc, base, dataDir;
const PORT = 2789;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), '2cy-test-'));
  proc = spawn('node', ['server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NO_OPEN: '1' },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${PORT}`;
  // 等待端口就绪
  for (let i = 0; i < 40; i++) {
    try { await fetch(base + '/api/state'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
});

after(async () => {
  proc?.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

test('健康检查：/api/state 返回结构完整', async () => {
  const r = await fetch(base + '/api/state').then((x) => x.json());
  assert.ok('configured' in r, '含 configured 字段');
  assert.ok('webSearch' in r, '含 webSearch 字段');
});

test('会话 CRUD：新建→取回→删除', async () => {
  const s = await fetch(base + '/api/sessions', { method: 'POST' }).then((x) => x.json());
  assert.match(s.id, /^[a-z0-9-]{6,64}$/, '返回合法会话 id');
  const got = await fetch(base + '/api/sessions/' + s.id).then((x) => x.json());
  assert.equal(got.id, s.id, '可按 id 取回');
  const del = await fetch(base + '/api/sessions/' + s.id, { method: 'DELETE' });
  assert.equal(del.status, 200, '可删除');
});

test('记忆：手动加事实、去重、删除', async () => {
  const a = await fetch(base + '/api/memory/facts', { method: 'POST', body: JSON.stringify({ text: '测试事实A' }) });
  assert.equal(a.status, 200, '首次添加成功');
  const dup = await fetch(base + '/api/memory/facts', { method: 'POST', body: JSON.stringify({ text: '测试事实A' }) });
  assert.equal(dup.status, 400, '重复添加被拒（去重生效）');
  const mem = await fetch(base + '/api/memory').then((x) => x.json());
  const fact = mem.facts.find((f) => f.text === '测试事实A');
  const del = await fetch(base + '/api/memory/facts/' + fact.id, { method: 'DELETE' });
  assert.equal(del.status, 200, '可删除');
});

test('自定义技能：增删', async () => {
  const s = await fetch(base + '/api/skills', { method: 'POST', body: JSON.stringify({ name: '测试技能', tpl: '做____' }) }).then((x) => x.json());
  assert.ok(s.id, '创建返回 id');
  const list = await fetch(base + '/api/skills').then((x) => x.json());
  assert.ok(list.some((k) => k.id === s.id), '出现在列表');
  await fetch(base + '/api/skills/' + s.id, { method: 'DELETE' });
});

test('安全：畸形会话 id 被拒绝（路径穿越防护）', async () => {
  const r = await fetch(base + '/api/sessions/..%2f..%2fconfig');
  assert.notEqual(r.status, 200, '非法 id 不返回 200');
});

test('安全：超大请求体被拒绝', async () => {
  const big = 'x'.repeat(11 * 1024 * 1024);
  const r = await fetch(base + '/api/memory/facts', { method: 'POST', body: JSON.stringify({ text: big }) }).catch(() => ({ status: 0 }));
  assert.notEqual(r.status, 200, '超限请求不成功');
});

test('配置：webSearch 与搜索 key 存取（key 只返回掩码）', async () => {
  await fetch(base + '/api/config', { method: 'PUT', body: JSON.stringify({ webSearch: true, searchApiKey: 'tvly-secret-123456' }) });
  const st = await fetch(base + '/api/state').then((x) => x.json());
  assert.equal(st.webSearch, true, 'webSearch 已保存');
  assert.ok(!JSON.stringify(st).includes('tvly-secret-123456'), '明文搜索 key 不外泄');
});
