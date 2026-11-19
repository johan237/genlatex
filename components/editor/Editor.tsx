'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FilePlus2, Play, Plus, Settings2, Sparkles, Upload, X } from 'lucide-react';
import { AISettings, Project, STORAGE_KEY, askAI, compilePDF, downloadFile, newProject, parseProjects, validFilename } from '@/lib/editor';
import './editor.css';

export default function Editor() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState('');
  const [file, setFile] = useState('main.tex');
  const [loaded, setLoaded] = useState(false);
  const [persist, setPersist] = useState(true);
  const [status, setStatus] = useState('Loading local projects…');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AISettings>({ endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: '', key: '' });
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [proposal, setProposal] = useState<{ text: string; project: string; file: string; original: string } | null>(null);
  const [undo, setUndo] = useState<{ text: string; project: string; file: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [pdf, setPdf] = useState<{ url: string; project: string } | null>(null);
  const [log, setLog] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const project = projects.find(p => p.id === active);
  const current = project?.files.find(f => f.name === file);

  useEffect(() => {
    let restored: Project[];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      restored = stored ? parseProjects(stored) : [newProject('My first paper')];
      setStatus('Saved on this device');
    } catch {
      restored = [newProject('Recovery workspace')];
      setPersist(false);
      setStatus('Stored projects could not be read. Original data was preserved. Export a backup before resetting browser storage.');
    }
    try {
      const params = new URLSearchParams(location.hash.startsWith('#payload=') ? location.hash.slice(1) : location.search);
      const payload = params.get('payload');
      if (payload && payload.length <= 300_000) {
        const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
        const data = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof data.latex !== 'string' || data.latex.length > 200_000) throw new Error('Invalid tool output.');
        const name = typeof data.filename === 'string' && validFilename(data.filename) ? data.filename : 'main.tex';
        const imported = newProject('Imported from tools');
        imported.files = [{ name: 'main.tex', content: data.latex.includes('\\documentclass') ? data.latex : `\\documentclass{article}\n\\usepackage{amsmath,booktabs}\n\\begin{document}\n${data.latex}\n\\end{document}\n` }];
        if (name !== 'main.tex') imported.files.push({ name, content: data.latex });
        restored.push(imported);
        history.replaceState({}, '', location.pathname);
      }
    } catch { setStatus('Tool output could not be imported. Your saved projects are available.'); }
    const last = restored[restored.length - 1];
    setProjects(restored); setActive(last.id); setFile(last.main); setLoaded(true);
    return () => request.current?.abort();
  }, []);

  useEffect(() => {
    if (!loaded || !persist) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); setStatus('Saved on this device'); }
      catch { setStatus('Browser storage is full or unavailable. Export a backup to keep your changes.'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [projects, loaded, persist]);

  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);

  function update(content: string) {
    setProjects(list => list.map(p => p.id === active ? { ...p, files: p.files.map(f => f.name === file ? { ...f, content } : f) } : p));
    setStatus('Unsaved changes…');
  }
  function addProject() {
    const name = window.prompt('Project name', 'Untitled project');
    if (!name?.trim()) return;
    const p = newProject(name.trim()); setProjects([...projects, p]); setActive(p.id); setFile(p.main);
  }
  function addFile() {
    if (!project) return;
    const name = window.prompt('File name (for example sections/introduction.tex)', 'notes.tex');
    if (!name) return;
    if (!validFilename(name) || project.files.some(f => f.name === name)) { setStatus('Use a unique text filename, without parent-directory paths.'); return; }
    setProjects(projects.map(p => p.id === active ? { ...p, files: [...p.files, { name, content: '' }] } : p)); setFile(name);
  }
  async function importFiles(files: FileList | null) {
    if (!files || !project) return;
    try {
      if (files.length === 1 && files[0].name.endsWith('.genlatex.json')) {
        const restored = parseProjects(await files[0].text());
        const imported = restored.map(p => ({ ...p, id: crypto.randomUUID() }));
        setProjects([...projects, ...imported]); setActive(imported[0].id); setFile(imported[0].main); return;
      }
      const imported = await Promise.all(Array.from(files).map(async f => {
        if (!validFilename(f.name) || f.size > 2_000_000) throw new Error('Import text files up to 2 MB each.');
        return { name: f.name, content: await f.text() };
      }));
      if (imported.some(f => project.files.some(old => old.name === f.name)) && !window.confirm('Replace existing files with matching names?')) return;
      setProjects(projects.map(p => p.id === active ? { ...p, files: [...p.files.filter(f => !imported.some(i => i.name === f.name)), ...imported] } : p));
      if (imported[0]) setFile(imported[0].name);
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Import failed.'); }
    finally { if (upload.current) upload.current.value = ''; }
  }
  async function runAI() {
    if (!current || !prompt.trim() || aiBusy) return;
    if (!settings.model) { setSettingsOpen(true); return; }
    request.current = new AbortController();
    const snapshot = { project: active, file, original: current.content };
    setAiBusy(true); setAnswer(''); setProposal(null);
    try {
      const reply = await askAI(settings, prompt, current.content, request.current.signal);
      setAnswer(reply);
      const match = reply.match(/```(?:latex|tex)?\s*\n([\s\S]*?)```/i);
      if (match) setProposal({ ...snapshot, text: match[1] });
    } catch (e) { setAnswer(e instanceof Error ? (e.name === 'AbortError' ? 'Request cancelled.' : `${e.message}\nIf the request cannot connect, check that the endpoint allows browser requests (CORS).`) : 'AI request failed.'); }
    finally { setAiBusy(false); }
  }
  function applyProposal() {
    if (!proposal || proposal.project !== active || proposal.file !== file || current?.content !== proposal.original) { setAnswer('The file changed since this suggestion. Ask again using the latest version.'); return; }
    setUndo({ text: current.content, project: active, file }); update(proposal.text); setProposal(null);
  }
  async function compile() {
    if (!project || compiling) return;
    setCompiling(true); setLog('Loading browser PDF engine…');
    try {
      const result = await compilePDF(project);
      const url = URL.createObjectURL(new Blob([result.pdf], { type: 'application/pdf' }));
      setPdf({ url, project: project.id }); setLog(result.log || 'Compilation succeeded.');
    } catch (e) { setLog(e instanceof Error ? e.message : 'Compilation failed.'); }
    finally { setCompiling(false); }
  }

  if (!loaded) return <div className="gl-loading">Loading GenLaTeX…</div>;
  return <div className="gl-editor">
    <header className="gl-topbar">
      <Link className="gl-brand" href="/"><ArrowLeft size={16} /><img src="/logo_genlatex_only.svg" width="26" height="26" alt="" /> GenLaTeX <span>Editor</span></Link>
      <div className="gl-actions">
        <button onClick={() => upload.current?.click()}><Upload size={15} />Import</button>
        <button onClick={() => downloadFile('projects.genlatex.json', JSON.stringify(projects, null, 2), 'application/json')}><Download size={15} />Backup</button>
        <button className="gl-primary" disabled={compiling} onClick={compile}><Play size={14} />{compiling ? 'Compiling…' : 'Compile PDF'}</button>
      </div>
      <input ref={upload} type="file" multiple accept=".tex,.bib,.sty,.cls,.txt,.csv,.json,.md" hidden onChange={e => void importFiles(e.target.files)} />
    </header>
    <div className="gl-layout">
      <aside className="gl-sidebar">
        <div className="gl-section-title">PROJECTS <button aria-label="New project" onClick={addProject}><Plus size={16} /></button></div>
        <select aria-label="Active project" value={active} onChange={e => { const p = projects.find(p => p.id === e.target.value)!; setActive(p.id); setFile(p.main); }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="gl-section-title">FILES <button aria-label="New file" onClick={addFile}><FilePlus2 size={16} /></button></div>
        {project?.files.map(f => <button key={f.name} className={`gl-file ${f.name === file ? 'active' : ''}`} onClick={() => setFile(f.name)}><span>⊞</span>{f.name}{f.name === project.main && <small>main</small>}</button>)}
        <div className="gl-sidebar-note">Open source.<br />Your projects stay in this browser.<br />Export backups to keep a copy.</div>
        <Link href="/tools/" className="gl-tool-link">Explore LaTeX tools ↗</Link>
      </aside>
      <main className="gl-source">
        <div className="gl-pane-header"><span>{file}</span><div className="gl-actions">
          {file.endsWith('.tex') && project?.main !== file && <button onClick={() => setProjects(projects.map(p => p.id === active ? { ...p, main: file } : p))}>Set as main</button>}
          <button onClick={() => current && downloadFile(current.name.split('/').pop()!, current.content)} aria-label="Download current file"><Download size={15} /></button>
        </div></div>
        <label className="sr-only" htmlFor="latex-source">LaTeX source</label>
        <textarea id="latex-source" spellCheck={false} value={current?.content || ''} onChange={e => update(e.target.value)} onKeyDown={e => {
          if (e.key === 'Tab') { e.preventDefault(); const el = e.currentTarget; const start = el.selectionStart; const end = el.selectionEnd; update(el.value.slice(0, start) + '  ' + el.value.slice(end)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; }); }
          if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (current) downloadFile(current.name.split('/').pop()!, current.content); }
        }} />
        <div className="gl-status" role="status">{status}<span>{current?.content.split('\n').length || 0} lines · UTF-8</span></div>
      </main>
      <section className="gl-right">
        <div className="gl-preview"><div className="gl-pane-header"><span>PDF preview</span>{pdf?.project === active && <a href={pdf.url} download="document.pdf">Download PDF</a>}</div>
          {pdf?.project === active ? <iframe title="Compiled PDF" src={pdf.url} /> : <div className="gl-preview-empty"><span className="gl-paper-icon">T<span>E</span>X</span><h2>A place for your next paper.</h2><p>Edit your source, then compile to see the PDF here.</p><small>Browser compilation requires the optional SwiftLaTeX engine assets.</small></div>}
          <details className="gl-log"><summary>Compilation log</summary><pre>{log || 'No compilation yet.'}</pre></details>
        </div>
        <section className="gl-assistant"><div className="gl-pane-header"><span><Sparkles size={15} /> AI assistant</span><button aria-label="AI settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /></button></div>
          <div className="gl-chat">
            {answer ? <pre aria-live="polite">{answer}</pre> : <p>Explain an equation, improve a paragraph, or fix a LaTeX error. Connect your own model to begin.</p>}
            {proposal && <button className="gl-primary" onClick={applyProposal}>Apply suggestion to file</button>}
            {undo && undo.project === active && undo.file === file && <button onClick={() => { update(undo.text); setUndo(null); }}>Undo AI change</button>}
          </div>
          <div className="gl-prompt"><label className="sr-only" htmlFor="ai-prompt">Ask the AI assistant</label><textarea id="ai-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask about the current file…" />
            <button className="gl-primary" disabled={aiBusy || !prompt.trim()} onClick={runAI}>{aiBusy ? 'Thinking…' : 'Ask AI'}</button>{aiBusy && <button onClick={() => request.current?.abort()}>Cancel</button>}
          </div>
          <small className="gl-disclosure">Sending a prompt shares the current file with your selected provider.</small>
        </section>
      </section>
    </div>
    {settingsOpen && <div className="gl-modal-backdrop"><section className="gl-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={e => { if (e.key === 'Escape') setSettingsOpen(false); }}>
      <div className="gl-pane-header"><h2 id="settings-title">Connect your AI</h2><button aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
      <p>Use an OpenAI-compatible chat-completions endpoint that supports browser requests. Provider usage may cost money.</p>
      <label>Endpoint<input autoFocus type="url" value={settings.endpoint} onChange={e => setSettings({ ...settings, endpoint: e.target.value })} /></label>
      <label>Model ID<input value={settings.model} onChange={e => setSettings({ ...settings, model: e.target.value })} placeholder="Your provider’s model ID" /></label>
      <label>API key<input type="password" autoComplete="off" value={settings.key} onChange={e => setSettings({ ...settings, key: e.target.value })} /></label>
      <p>Your key stays in memory for this tab and is sent only to the endpoint above. It is cleared on reload.</p>
      <div className="gl-actions"><button onClick={() => setSettings({ ...settings, key: '' })}>Clear key</button><button className="gl-primary" onClick={() => setSettingsOpen(false)}>Done</button></div>
    </section></div>}
  </div>;
}
