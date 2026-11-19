import test from 'node:test';
import assert from 'node:assert/strict';
import { askAI, compilePDF, newProject, parseProjects, validFilename } from '../lib/editor.ts';

test('project backups round-trip multiple files and Unicode text', () => {
  const project = newProject('Mémoire');
  project.files.push({ name: 'sections/introduction.tex', content: 'Québec — recherche' });
  assert.deepEqual(parseProjects(JSON.stringify([project])), [project]);
});

test('rejects corrupt backups and unsafe or duplicate file paths', () => {
  for (const name of ['../secret.tex', '/etc/file.tex', 'a/../../x.tex', '.env', 'C:/file.tex', 'script.js', 'a//b.tex']) assert.equal(validFilename(name), false);
  assert.equal(validFilename('sections/introduction.tex'), true);
  assert.throws(() => parseProjects('{}'));
  const project = newProject();
  project.main = 'missing.tex';
  assert.throws(() => parseProjects(JSON.stringify([project])));
  project.main = 'main.tex';
  project.files.push({ name: 'main.tex', content: '' });
  assert.throws(() => parseProjects(JSON.stringify([project])));
});

test('AI uses the configured endpoint and reports provider errors', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url.href, 'https://provider.example/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'test-model');
      assert.match(body.messages[1].content, /current source/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Suggested change' } }] }) };
    };
    const settings = { endpoint: 'https://provider.example/chat/completions', model: 'test-model', key: 'test-key' };
    assert.equal(await askAI(settings, 'Fix this', 'current source'), 'Suggested change');
    globalThis.fetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(askAI(settings, 'Fix this', ''), /401/);
    await assert.rejects(askAI({ ...settings, endpoint: 'http://provider.example/chat' }, 'test', ''), /HTTPS/);
    await assert.rejects(askAI({ ...settings, model: '' }, 'test', ''), /model/);
  } finally { globalThis.fetch = oldFetch; }
});

test('browser PDF reports missing assets without starting a worker', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(compilePDF(newProject()), /not installed/);
  } finally { globalThis.fetch = oldFetch; }
});

test('browser PDF worker receives project files, directories, and main file', async () => {
  const oldFetch = globalThis.fetch;
  const oldWorker = globalThis.Worker;
  const messages = [];
  let terminated = false;
  try {
    globalThis.fetch = async () => ({ ok: true });
    globalThis.Worker = class {
      constructor() { queueMicrotask(() => this.onmessage({ data: { result: 'ok' } })); }
      postMessage(data) {
        messages.push(data);
        if (data.cmd === 'compilelatex') queueMicrotask(() => this.onmessage({ data: { cmd: 'compile', result: 'ok', pdf: new ArrayBuffer(8), log: 'Success' } }));
      }
      terminate() { terminated = true; }
    };
    const project = newProject();
    project.files.push({ name: 'sections/intro.tex', content: 'Introduction' });
    const result = await compilePDF(project);
    assert.equal(result.pdf.byteLength, 8);
    assert.ok(messages.some(m => m.cmd === 'mkdir' && m.url === 'sections'));
    assert.ok(messages.some(m => m.cmd === 'setmainfile' && m.url === 'main.tex'));
    assert.ok(terminated);
  } finally { globalThis.fetch = oldFetch; globalThis.Worker = oldWorker; }
});
