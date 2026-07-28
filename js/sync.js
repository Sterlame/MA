/* ===========================================================
   Ma — sync layer
   Talks to the Apps Script Web App (see /apps-script/Code.gs).
   IndexedDB is the source of truth for the current session;
   Drive is the cross-device backup. A document's tabs are
   serialized into one .md file per document — same format as
   the in-app "export whole document" — so files stay readable
   and editable outside the app too.

   Set via the "connect drive" button in the sidebar (prompts for
   your deployed Apps Script URL and saves it locally per device) —
   see apps-script/README.md for deployment steps.
   =========================================================== */

const MA_CONFIG = {
  appsScriptUrl: '' // paste your deployed /exec URL here
};

const MaSync = (() => {
  let syncing = false;

  function configured() {
    return !!MA_CONFIG.appsScriptUrl;
  }

  // POST as text/plain to avoid a CORS preflight — Apps Script
  // reads e.postData.contents and parses JSON on its side.
  async function call(action, payload) {
    if (!configured()) throw new Error('Ma is not connected to Drive yet.');
    const res = await fetch(MA_CONFIG.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    });
    if (!res.ok) throw new Error('Sync request failed: ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  }

  // ---------- tab <-> file serialization ----------
  // Mirrors the in-app "export whole document" format:
  //   # Tab name
  //
  //   tab body...
  //
  //   ---
  //
  //   # Next tab name
  //   ...
  function serializeTabs(tabs) {
    return tabs.map((t) => '# ' + t.name + '\n\n' + (t.markdown || '')).join('\n\n---\n\n');
  }
  function parseTabs(body) {
    const sections = (body || '').split(/\n\n---\n\n/);
    const tabs = sections.map((section, i) => {
      const match = section.match(/^# (.*)\n\n([\s\S]*)$/);
      if (match) return { id: null, name: match[1].trim(), markdown: match[2] };
      return { id: null, name: 'Tab ' + (i + 1), markdown: section };
    });
    return tabs.length ? tabs : [{ id: null, name: 'Tab 1', markdown: '' }];
  }

  async function ensureRootFolder() {
    return call('ensureRootFolder', {});
  }
  async function listRemoteNotebooks() {
    return call('listNotebooks', {});
  }
  async function ensureNotebookFolder(notebookName) {
    return call('ensureNotebookFolder', { notebookName });
  }
  async function saveDocumentRemote(doc, notebookName) {
    return call('saveDocument', {
      id: doc.id,
      notebookName,
      title: doc.title,
      markdown: serializeTabs(doc.tabs),
      tags: doc.tags || [],
      updatedAt: doc.updatedAt,
      driveFileId: doc.driveFileId || null
    });
  }
  async function loadDocumentRemote(driveFileId) {
    return call('loadDocument', { driveFileId });
  }
  async function listRemoteDocuments(notebookName) {
    return call('listDocuments', { notebookName });
  }

  // ---------- push: send every locally-dirty document ----------
  async function pushAll(onStatus) {
    const docs = await MaDB.allDocuments();
    const dirty = docs.filter((d) => d.dirty);
    for (const doc of dirty) {
      const notebooks = await MaDB.listNotebooks();
      const notebook = notebooks.find((n) => n.id === doc.notebookId);
      const result = await saveDocumentRemote(doc, notebook ? notebook.name : 'Unsorted');
      doc.driveFileId = result.driveFileId;
      doc.dirty = false;
      await MaDB.putDocument(doc);
    }
    return dirty.length;
  }

  // ---------- pull: bring down anything this device hasn't seen ----------
  async function pullAll(onStatus) {
    const remoteNotebooks = await listRemoteNotebooks();
    let pulled = 0;
    for (const rnb of remoteNotebooks) {
      let localNotebooks = await MaDB.listNotebooks();
      let notebook = localNotebooks.find((n) => n.name === rnb.name);
      if (!notebook) {
        notebook = { id: 'nb_' + rnb.folderId, name: rnb.name, createdAt: Date.now() };
        await MaDB.putNotebook(notebook);
      }
      const remoteDocs = await listRemoteDocuments(rnb.name);
      for (const rdoc of remoteDocs) {
        const existing = await MaDB.findByDriveFileId(rdoc.driveFileId);
        if (existing) continue; // already have it, local push/pull keeps it current
        const loaded = await loadDocumentRemote(rdoc.driveFileId);
        const parsed = parseRemoteFile(loaded.markdown);
        const tabs = parseTabs(parsed.body).map((t) => ({ ...t, id: 'tab_' + Math.random().toString(36).slice(2, 9) }));
        const newDoc = {
          id: 'doc_' + Math.random().toString(36).slice(2, 9),
          notebookId: notebook.id,
          title: parsed.title || rdoc.name.replace(/\.md$/, ''),
          tags: parsed.tags || [],
          tabs,
          activeTabId: tabs[0].id,
          createdAt: Date.now(),
          updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : Date.now(),
          driveFileId: rdoc.driveFileId,
          dirty: false
        };
        await MaDB.putDocument(newDoc);
        pulled += 1;
      }
    }
    return pulled;
  }

  // parses the YAML-ish frontmatter Code.gs writes
  function parseRemoteFile(text) {
    const match = (text || '').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { title: '', tags: [], updatedAt: null, body: text || '' };
    const front = match[1];
    const body = match[2];
    const titleMatch = front.match(/title:\s*(.*)/);
    const tagsMatch = front.match(/tags:\s*\[(.*)\]/);
    const updatedMatch = front.match(/updatedAt:\s*(.*)/);
    return {
      title: titleMatch ? titleMatch[1].trim() : '',
      tags: tagsMatch && tagsMatch[1].trim() ? tagsMatch[1].split(',').map((t) => t.trim()) : [],
      updatedAt: updatedMatch ? updatedMatch[1].trim() : null,
      body: body.replace(/^\n/, '')
    };
  }

  async function syncAll(onStatus) {
    if (!configured()) { onStatus && onStatus('not connected'); return; }
    if (syncing) return;
    syncing = true;
    onStatus && onStatus('syncing');
    try {
      const pushedCount = await pushAll(onStatus);
      const pulledCount = await pullAll(onStatus);
      onStatus && onStatus(pushedCount || pulledCount ? 'synced' : 'up to date');
    } catch (err) {
      console.error(err);
      onStatus && onStatus('sync error');
    } finally {
      syncing = false;
    }
  }

  return { configured, ensureRootFolder, ensureNotebookFolder, syncAll, pushAll, pullAll };
})();
