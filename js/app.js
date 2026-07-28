/* ===========================================================
   Ma — app glue
   =========================================================== */

(() => {
  const M = MaMarkdown;
  const uid = (prefix) => (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  let notebooks = [];
  let activeNotebookId = null;
  let docs = [];
  let activeDocId = null;
  let typewriterOn = false;
  let autosyncTimer = null;
  let cmdkSelectedIndex = 0;

  const el = {};
  function grab(id) { el[id] = document.getElementById(id); }
  [
    'notebookList', 'activeNotebookName', 'docItems', 'docSearch', 'docTitle',
    'editor', 'editorColumn', 'tabsBar', 'wordCount', 'pageCount', 'tagLine',
    'savedState', 'formatMenu', 'toolsMenu', 'themeMenu', 'tagPopover', 'tagChips',
    'tagInput', 'cmdkOverlay', 'cmdkInput', 'cmdkResults', 'syncStatus',
    'styleSelect', 'fontSelect', 'sizeRow', 'ruledToggle', 'typewriterToggle',
    'dimSelect', 'pageWords', 'marksToggle'
  ].forEach(grab);
  el.editorScroll = document.querySelector('.editor-scroll');

  // ---------- bootstrap ----------
  // UI wiring runs first and unconditionally, so nothing (theme,
  // focus mode, etc.) depends on storage having succeeded.
  async function init() {
    wireEvents();
    try {
      await restoreSettings();
      notebooks = await MaDB.listNotebooks();
      if (notebooks.length === 0) {
        const nb = { id: uid('nb_'), name: 'Personal', createdAt: Date.now() };
        await MaDB.putNotebook(nb);
        notebooks = [nb];
      }
      activeNotebookId = (await MaDB.getMeta('activeNotebookId')) || notebooks[0].id;
      renderNotebooks();
      await loadDocsForActiveNotebook();

      const savedUrl = await MaDB.getMeta('appsScriptUrl');
      if (savedUrl) MA_CONFIG.appsScriptUrl = savedUrl;
      updateSyncStatusLabel();
      if (MaSync.configured()) {
        MaSync.syncAll(setSyncStatus);
        autosyncTimer = setInterval(() => MaSync.syncAll(setSyncStatus), 45000);
      }
    } catch (err) {
      console.error('Ma storage init failed:', err);
      showStorageError(err);
    }
  }

  function showStorageError(err) {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;' +
      'font-family:monospace;font-size:12px;padding:8px 16px;z-index:999;';
    banner.textContent = 'Ma could not open local storage (' + err.message + '). ' +
      'Serve this over local HTTP (e.g. "python3 -m http.server") rather than opening the file directly.';
    document.body.prepend(banner);
  }

  async function restoreSettings() {
    const theme = (await MaDB.getMeta('theme')) || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === theme));

    const font = await MaDB.getMeta('font');
    if (font) { document.documentElement.style.setProperty('--editor-font', font); el.fontSelect.value = font; }

    const size = await MaDB.getMeta('size');
    if (size) {
      document.documentElement.style.setProperty('--editor-size', size + 'px');
      document.querySelectorAll('#sizeRow button').forEach((b) => b.classList.toggle('active', b.dataset.size === String(size)));
    }
    const ruled = await MaDB.getMeta('ruled');
    if (ruled) { el.editorColumn.classList.add('ruled'); el.ruledToggle.checked = true; }

    const marks = await MaDB.getMeta('marks');
    if (marks) { document.body.classList.add('show-marks'); el.marksToggle.checked = true; }

    const dim = (await MaDB.getMeta('dim')) || 'line';
    el.dimSelect.value = dim;
    document.body.classList.remove('dim-line', 'dim-paragraph');
    if (dim !== 'off') document.body.classList.add('dim-' + dim);

    const pageWordsVal = await MaDB.getMeta('pageWords');
    if (pageWordsVal) el.pageWords.value = pageWordsVal;

    typewriterOn = !!(await MaDB.getMeta('typewriter'));
    el.typewriterToggle.checked = typewriterOn;
    if (typewriterOn) updateTypewriterPadding();
  }

  // ---------- notebooks ----------
  function renderNotebooks() {
    el.notebookList.innerHTML = '';
    notebooks.forEach((nb) => {
      const item = document.createElement('div');
      item.className = 'notebook-item' + (nb.id === activeNotebookId ? ' active' : '');
      item.innerHTML = '<span></span>';
      item.children[0].textContent = nb.name;
      item.addEventListener('click', () => switchNotebook(nb.id));
      el.notebookList.appendChild(item);
    });
    const active = notebooks.find((n) => n.id === activeNotebookId);
    el.activeNotebookName.textContent = active ? active.name : '—';
  }
  async function switchNotebook(id) {
    activeNotebookId = id;
    await MaDB.setMeta('activeNotebookId', id);
    renderNotebooks();
    await loadDocsForActiveNotebook();
  }
  async function createNotebook() {
    const name = prompt('Notebook name');
    if (!name) return;
    const nb = { id: uid('nb_'), name: name.trim(), createdAt: Date.now() };
    await MaDB.putNotebook(nb);
    notebooks.push(nb);
    if (MaSync.configured()) { try { await MaSync.ensureNotebookFolder(nb.name); } catch (e) { console.warn(e); } }
    await switchNotebook(nb.id);
  }

  // ---------- documents ----------
  function notebookName(id) {
    const nb = notebooks.find((n) => n.id === id);
    return nb ? nb.name : 'Unsorted';
  }
  async function loadDocsForActiveNotebook() {
    docs = await MaDB.listDocuments(activeNotebookId);
    docs.sort((a, b) => b.updatedAt - a.updatedAt);
    renderDocList();
    if (docs.length > 0) openDocument(docs[0].id);
    else await createDocument();
  }
  async function renderDocList(filter) {
    el.docItems.innerHTML = '';
    const q = (filter || '').toLowerCase();
    const pool = q ? (await MaDB.allDocuments()).sort((a, b) => b.updatedAt - a.updatedAt) : docs;
    pool
      .filter((d) => !q || (d.title || '').toLowerCase().includes(q) || (d.tags || []).some((t) => t.toLowerCase().includes(q)))
      .forEach((doc) => {
        const item = document.createElement('div');
        item.className = 'doc-item' + (doc.id === activeDocId ? ' active' : '');
        const title = document.createElement('div');
        title.className = 'doc-item-title';
        title.textContent = doc.title || 'Untitled';
        const meta = document.createElement('div');
        meta.className = 'doc-item-meta';
        const prefix = (q && doc.notebookId !== activeNotebookId) ? notebookName(doc.notebookId) + ' · ' : '';
        meta.textContent = prefix + (doc.tags && doc.tags.length ? doc.tags.join(', ') + ' · ' : '') + timeAgo(doc.updatedAt);
        item.appendChild(title);
        item.appendChild(meta);
        item.addEventListener('click', async () => {
          if (doc.notebookId !== activeNotebookId) {
            activeNotebookId = doc.notebookId;
            await MaDB.setMeta('activeNotebookId', activeNotebookId);
            renderNotebooks();
            docs = await MaDB.listDocuments(activeNotebookId);
          }
          openDocument(doc.id);
        });
        el.docItems.appendChild(item);
      });
  }
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }
  async function createDocument() {
    const firstTab = { id: uid('tab_'), name: 'Tab 1', markdown: '' };
    const doc = {
      id: uid('doc_'), notebookId: activeNotebookId, title: '', tags: [],
      createdAt: Date.now(), updatedAt: Date.now(),
      tabs: [firstTab], activeTabId: firstTab.id,
      driveFileId: null, dirty: true
    };
    await MaDB.putDocument(doc);
    docs.unshift(doc);
    renderDocList();
    openDocument(doc.id);
  }
  function currentDoc() { return docs.find((d) => d.id === activeDocId); }
  function currentTab() {
    const doc = currentDoc();
    if (!doc) return null;
    return doc.tabs.find((t) => t.id === doc.activeTabId) || doc.tabs[0];
  }
  function openDocument(id) {
    activeDocId = id;
    const doc = docs.find((d) => d.id === id) || null;
    if (!doc) return;
    el.docTitle.value = doc.title || '';
    renderTagChips(doc);
    renderTabs(doc);
    loadActiveTabIntoEditor(doc);
    renderDocList(el.docSearch.value);
  }
  function loadActiveTabIntoEditor(doc) {
    const tab = currentTab();
    M.fromMarkdown(el.editor, tab ? tab.markdown : '');
    restyle();
    updateStats(tab ? tab.markdown : '');
  }

  function renderTagChips(doc) {
    el.tagLine.textContent = (doc.tags && doc.tags.length) ? doc.tags.join(', ') : 'no tags';
    el.tagChips.innerHTML = '';
    (doc.tags || []).forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      const label = document.createElement('span');
      label.textContent = tag;
      const remove = document.createElement('span');
      remove.className = 'remove-tag';
      remove.textContent = '×';
      remove.addEventListener('click', async () => {
        doc.tags = doc.tags.filter((t) => t !== tag);
        doc.dirty = true;
        await MaDB.putDocument(doc);
        renderTagChips(doc);
        renderDocList(el.docSearch.value);
      });
      chip.appendChild(label);
      chip.appendChild(remove);
      el.tagChips.appendChild(chip);
    });
  }

  function renderTabs(doc) {
    el.tabsBar.innerHTML = '';
    doc.tabs.forEach((tab) => {
      const item = document.createElement('div');
      item.className = 'tab-item' + (tab.id === doc.activeTabId ? ' active' : '');
      const label = document.createElement('span');
      label.textContent = tab.name;
      item.appendChild(label);

      const rename = document.createElement('span');
      rename.className = 'rename-pencil';
      rename.textContent = '✎';
      rename.title = 'Rename tab';
      rename.addEventListener('click', (e) => { e.stopPropagation(); renameTab(doc, tab); });
      item.appendChild(rename);

      if (doc.tabs.length > 1) {
        const close = document.createElement('span');
        close.className = 'close-x';
        close.textContent = '×';
        close.title = 'Delete tab';
        close.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete tab "' + tab.name + '"?')) return;
          const idx = doc.tabs.findIndex((t) => t.id === tab.id);
          doc.tabs.splice(idx, 1);
          if (doc.activeTabId === tab.id) doc.activeTabId = doc.tabs[Math.max(0, idx - 1)].id;
          doc.dirty = true;
          await MaDB.putDocument(doc);
          renderTabs(doc);
          loadActiveTabIntoEditor(doc);
        });
        item.appendChild(close);
      }
      item.addEventListener('click', () => switchTab(doc, tab.id));
      item.addEventListener('dblclick', () => renameTab(doc, tab));
      el.tabsBar.appendChild(item);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add';
    addBtn.textContent = '+';
    addBtn.title = 'Add tab / section';
    addBtn.addEventListener('click', async () => {
      await saveCurrentTabContent();
      const defaultName = 'Tab ' + (doc.tabs.length + 1);
      const name = prompt('Name this tab / section', defaultName);
      const tab = { id: uid('tab_'), name: (name && name.trim()) || defaultName, markdown: '' };
      doc.tabs.push(tab);
      doc.activeTabId = tab.id;
      doc.dirty = true;
      await MaDB.putDocument(doc);
      renderTabs(doc);
      loadActiveTabIntoEditor(doc);
    });
    el.tabsBar.appendChild(addBtn);
  }
  async function renameTab(doc, tab) {
    const name = prompt('Rename tab', tab.name);
    if (name && name.trim()) {
      tab.name = name.trim();
      doc.dirty = true;
      await MaDB.putDocument(doc);
      renderTabs(doc);
    }
  }
  async function switchTab(doc, tabId) {
    if (doc.activeTabId === tabId) return;
    await saveCurrentTabContent();
    doc.activeTabId = tabId;
    await MaDB.putDocument(doc);
    renderTabs(doc);
    loadActiveTabIntoEditor(doc);
  }
  async function saveCurrentTabContent() {
    const doc = currentDoc();
    const tab = currentTab();
    if (!doc || !tab) return;
    tab.markdown = M.toMarkdown(el.editor);
    doc.updatedAt = Date.now();
    doc.dirty = true;
    await MaDB.putDocument(doc);
  }

  let saveTimer = null;
  function scheduleSave() {
    el.savedState.textContent = 'editing…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveActiveDocument, 500);
  }
  async function saveActiveDocument() {
    const doc = currentDoc();
    const tab = currentTab();
    if (!doc || !tab) return;
    doc.title = el.docTitle.value.trim();
    tab.markdown = M.toMarkdown(el.editor);
    doc.updatedAt = Date.now();
    doc.dirty = true;
    await MaDB.putDocument(doc);
    updateStats(tab.markdown);
    renderDocList(el.docSearch.value);
    el.savedState.textContent = 'saved';
  }
  function updateStats(markdown) {
    const md = markdown || '';
    const count = M.wordCount(md);
    el.wordCount.textContent = count + (count === 1 ? ' word' : ' words');
    const sw = document.getElementById('statWords'); if (sw) sw.textContent = count;
    const sc = document.getElementById('statChars'); if (sc) sc.textContent = md.length;
    const scn = document.getElementById('statCharsNoSpace'); if (scn) scn.textContent = md.replace(/\s/g, '').length;
    const sp = document.getElementById('statParas'); if (sp) sp.textContent = md.split('\n').filter((l) => l.trim()).length;
  }

  // ---------- editor rendering (markdown live-style + pagination + dimming + typewriter) ----------
  function restyle() {
    M.normalize(el.editor);
    const active = M.activeLine(el.editor);
    const pageWords = parseInt(el.pageWords.value, 10) || 0;
    let cumulativeWords = 0, pageNum = 1, nextPageAt = pageWords;

    Array.from(el.editor.children).forEach((line) => {
      const text = line.textContent || '';
      const cls = M.classForLine(text);
      line.classList.remove('page-break');
      line.className = 'line' + (cls ? ' ' + cls : '');
      line.classList.toggle('active-block', line === active);
      if (line !== active) {
        const rendered = M.inlineHtml(text) || '<br>';
        if (line.innerHTML !== rendered) line.innerHTML = rendered;
      }
      const lineWords = text.trim() ? text.trim().split(/\s+/).length : 0;
      if (pageWords > 0 && cumulativeWords > 0 && cumulativeWords >= nextPageAt) {
        pageNum += 1;
        nextPageAt += pageWords;
        line.classList.add('page-break');
        line.setAttribute('data-page', pageNum);
      }
      cumulativeWords += lineWords;
    });
    el.pageCount.textContent = pageWords > 0 ? (pageNum + (pageNum === 1 ? ' page' : ' pages')) : '1 page';

    const allLines = Array.from(el.editor.children);
    let group = []; const groups = [];
    allLines.forEach((line) => {
      if ((line.textContent || '').trim() === '') { if (group.length) groups.push(group); group = []; }
      else group.push(line);
    });
    if (group.length) groups.push(group);
    const activeGroup = groups.find((g) => g.includes(active)) || [];
    allLines.forEach((line) => line.classList.toggle('active-paragraph', activeGroup.includes(line)));

    if (active) el.styleSelect.value = M.classForLine(active.textContent || '') || 'normal';
    if (typewriterOn) requestAnimationFrame(typewriterScroll);
  }
  function typewriterScroll() {
    const active = el.editor.querySelector('.line.active-block');
    if (!active || !el.editorScroll) return;
    const lineRect = active.getBoundingClientRect();
    const containerRect = el.editorScroll.getBoundingClientRect();
    const delta = (lineRect.top + lineRect.height / 2) - (containerRect.top + containerRect.height / 2);
    el.editorScroll.scrollTop += delta;
  }
  function updateTypewriterPadding() {
    if (typewriterOn) {
      const half = Math.round(el.editorScroll.clientHeight / 2);
      el.editorColumn.style.paddingTop = half + 'px';
      el.editorColumn.style.paddingBottom = half + 'px';
    } else {
      el.editorColumn.style.paddingTop = '';
      el.editorColumn.style.paddingBottom = '';
    }
  }

  // ---------- menu helpers ----------
  function closeMenus(except) {
    [el.formatMenu, el.toolsMenu, el.themeMenu, el.tagPopover].forEach((m) => { if (m !== except) m.hidden = true; });
  }

  // ---------- sync ----------
  function setSyncStatus(label) { el.syncStatus.textContent = label; }
  function updateSyncStatusLabel() { setSyncStatus(MaSync.configured() ? 'connected' : 'offline'); }

  // ---------- wire everything ----------
  function wireEvents() {
    document.getElementById('newNotebookBtn').addEventListener('click', createNotebook);
    document.getElementById('newDocBtn').addEventListener('click', createDocument);
    el.docSearch.addEventListener('input', () => renderDocList(el.docSearch.value));
    el.docTitle.addEventListener('input', scheduleSave);
    el.editor.addEventListener('input', () => { restyle(); scheduleSave(); });
    el.editor.addEventListener('keyup', restyle);
    el.editor.addEventListener('click', restyle);
    el.editor.addEventListener('blur', restyle);

    document.getElementById('focusBtn').addEventListener('click', (e) => {
      document.body.classList.toggle('focus-mode');
      e.currentTarget.classList.toggle('active');
    });

    // format menu
    const formatBtn = document.getElementById('formatBtn');
    formatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = el.formatMenu.hidden;
      closeMenus(); el.formatMenu.hidden = !willShow;
    });
    el.styleSelect.addEventListener('change', async (e) => {
      const line = M.activeLine(el.editor);
      if (!line) return;
      const stripped = (line.textContent || '').replace(/^(#{1,3}|%|=)\s+/, '');
      const prefixes = { normal: '', title: '% ', subtitle: '= ', h1: '# ', h2: '## ', h3: '### ' };
      line.textContent = (prefixes[e.target.value] || '') + stripped;
      restyle(); scheduleSave(); el.editor.focus();
    });
    el.fontSelect.addEventListener('change', async (e) => {
      document.documentElement.style.setProperty('--editor-font', e.target.value);
      await MaDB.setMeta('font', e.target.value);
    });
    el.sizeRow.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-size]');
      if (!btn) return;
      document.querySelectorAll('#sizeRow button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.documentElement.style.setProperty('--editor-size', btn.dataset.size + 'px');
      await MaDB.setMeta('size', btn.dataset.size);
      if (typewriterOn) updateTypewriterPadding();
    });
    document.getElementById('boldBtn').addEventListener('click', () => { el.editor.focus(); document.execCommand('bold'); });
    document.getElementById('italicBtn').addEventListener('click', () => { el.editor.focus(); document.execCommand('italic'); });
    el.ruledToggle.addEventListener('change', async (e) => {
      el.editorColumn.classList.toggle('ruled', e.target.checked);
      await MaDB.setMeta('ruled', e.target.checked);
    });
    el.typewriterToggle.addEventListener('change', async (e) => {
      typewriterOn = e.target.checked;
      updateTypewriterPadding();
      if (typewriterOn) typewriterScroll();
      await MaDB.setMeta('typewriter', typewriterOn);
    });
    el.dimSelect.addEventListener('change', async (e) => {
      document.body.classList.remove('dim-line', 'dim-paragraph');
      if (e.target.value !== 'off') document.body.classList.add('dim-' + e.target.value);
      await MaDB.setMeta('dim', e.target.value);
    });
    el.pageWords.addEventListener('input', async () => { restyle(); await MaDB.setMeta('pageWords', el.pageWords.value); });

    // tools menu
    const toolsBtn = document.getElementById('toolsBtn');
    toolsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = el.toolsMenu.hidden;
      closeMenus(); el.toolsMenu.hidden = !willShow;
    });
    el.marksToggle.addEventListener('change', async (e) => {
      document.body.classList.toggle('show-marks', e.target.checked);
      await MaDB.setMeta('marks', e.target.checked);
    });
    document.getElementById('findNextBtn').addEventListener('click', () => {
      const term = document.getElementById('findInput').value;
      if (term && window.find) window.find(term);
    });
    document.getElementById('replaceAllBtn').addEventListener('click', () => {
      const term = document.getElementById('findInput').value;
      const replacement = document.getElementById('replaceInput').value;
      if (!term) return;
      Array.from(el.editor.children).forEach((line) => {
        if (line.textContent.includes(term)) line.textContent = line.textContent.split(term).join(replacement);
      });
      restyle(); scheduleSave();
    });

    // export
    function slugify(name) { return (name || 'untitled').trim().replace(/[\\/:*?"<>|]/g, '-') || 'untitled'; }
    function downloadText(filename, text) {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }
    document.getElementById('exportTabBtn').addEventListener('click', async () => {
      await saveCurrentTabContent();
      const doc = currentDoc(); const tab = currentTab();
      if (!doc || !tab) return;
      downloadText(slugify(doc.title || 'untitled') + '-' + slugify(tab.name) + '.md', tab.markdown || '');
    });
    document.getElementById('exportDocBtn').addEventListener('click', async () => {
      await saveCurrentTabContent();
      const doc = currentDoc();
      if (!doc) return;
      const combined = doc.tabs.map((t) => '# ' + t.name + '\n\n' + (t.markdown || '')).join('\n\n---\n\n');
      downloadText(slugify(doc.title || 'untitled') + '.md', combined);
    });

    // theme menu
    const themeBtn = document.getElementById('themeBtn');
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willShow = el.themeMenu.hidden;
      closeMenus(); el.themeMenu.hidden = !willShow;
    });
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const theme = btn.getAttribute('data-theme-choice');
        document.documentElement.setAttribute('data-theme', theme);
        document.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        el.themeMenu.hidden = true;
        try { await MaDB.setMeta('theme', theme); } catch (e) { console.warn('theme not persisted', e); }
      });
    });

    // tag popover
    const tagBtn = document.getElementById('tagBtn');
    tagBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      el.tagPopover.hidden = !el.tagPopover.hidden;
      if (!el.tagPopover.hidden) el.tagInput.focus();
    });
    el.tagInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const doc = currentDoc();
      if (!doc) return;
      const value = el.tagInput.value.trim();
      if (!value) return;
      doc.tags = doc.tags || [];
      if (!doc.tags.includes(value)) doc.tags.push(value);
      doc.dirty = true;
      await MaDB.putDocument(doc);
      el.tagInput.value = '';
      renderTagChips(doc);
      renderDocList(el.docSearch.value);
    });

    document.addEventListener('click', (e) => {
      if (!el.formatMenu.contains(e.target) && e.target !== formatBtn) el.formatMenu.hidden = true;
      if (!el.toolsMenu.contains(e.target) && e.target !== toolsBtn) el.toolsMenu.hidden = true;
      if (!el.themeMenu.contains(e.target) && e.target !== themeBtn) el.themeMenu.hidden = true;
      if (!el.tagPopover.contains(e.target) && e.target !== tagBtn) el.tagPopover.hidden = true;
    });

    // command palette
    el.cmdkInput.addEventListener('input', () => renderCommandResults(el.cmdkInput.value));
    el.cmdkInput.addEventListener('keydown', (e) => {
      const items = Array.from(el.cmdkResults.querySelectorAll('.cmdk-item'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!items.length) return;
        items[cmdkSelectedIndex]?.classList.remove('selected');
        cmdkSelectedIndex = Math.min(cmdkSelectedIndex + 1, items.length - 1);
        items[cmdkSelectedIndex].classList.add('selected');
        items[cmdkSelectedIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        items[cmdkSelectedIndex]?.classList.remove('selected');
        cmdkSelectedIndex = Math.max(cmdkSelectedIndex - 1, 0);
        items[cmdkSelectedIndex].classList.add('selected');
        items[cmdkSelectedIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[cmdkSelectedIndex]?.dispatchEvent(new Event('click'));
      } else if (e.key === 'Escape') {
        closeCommandPalette();
      }
    });
    el.cmdkOverlay.addEventListener('click', (e) => { if (e.target === el.cmdkOverlay) closeCommandPalette(); });

    // sync controls
    document.getElementById('connectBtn').addEventListener('click', async () => {
      let scriptUrl = MA_CONFIG.appsScriptUrl;
      if (!scriptUrl) {
        scriptUrl = prompt('Paste your Apps Script Web App URL (see apps-script/README.md):', '');
        if (!scriptUrl) return;
        MA_CONFIG.appsScriptUrl = scriptUrl.trim();
        await MaDB.setMeta('appsScriptUrl', MA_CONFIG.appsScriptUrl);
      }
      setSyncStatus('connecting…');
      try {
        await MaSync.ensureRootFolder();
        setSyncStatus('connected');
        await MaSync.syncAll(setSyncStatus);
        notebooks = await MaDB.listNotebooks();
        renderNotebooks();
        docs = await MaDB.listDocuments(activeNotebookId);
        renderDocList(el.docSearch.value);
        if (!autosyncTimer) autosyncTimer = setInterval(() => MaSync.syncAll(setSyncStatus), 45000);
      } catch (e) {
        console.error(e);
        setSyncStatus('connection failed');
      }
    });
    document.getElementById('syncNowBtn').addEventListener('click', async () => {
      await saveCurrentTabContent();
      await MaSync.syncAll(async (status) => {
        setSyncStatus(status);
        if (status === 'synced') {
          notebooks = await MaDB.listNotebooks();
          renderNotebooks();
          docs = await MaDB.listDocuments(activeNotebookId);
          renderDocList(el.docSearch.value);
        }
      });
    });

    // hotkeys
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (el.cmdkOverlay.hidden) openCommandPalette(); else closeCommandPalette();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault(); closeMenus(); el.formatMenu.hidden = false;
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault(); closeMenus(); el.toolsMenu.hidden = false;
        document.getElementById('findInput').focus();
      } else if (e.key === 'Escape') {
        closeMenus(); closeCommandPalette();
      }
    });
    window.addEventListener('resize', () => { if (typewriterOn) updateTypewriterPadding(); });
    window.addEventListener('beforeunload', () => { saveActiveDocument(); });
  }

  // ---------- command palette ----------
  function openCommandPalette() {
    closeMenus();
    el.cmdkOverlay.hidden = false;
    el.cmdkInput.value = '';
    renderCommandResults('');
    el.cmdkInput.focus();
  }
  function closeCommandPalette() { el.cmdkOverlay.hidden = true; }
  async function renderCommandResults(query) {
    const q = query.toLowerCase();
    const all = await MaDB.allDocuments();
    const results = all
      .filter((d) => !q || (d.title || 'untitled').toLowerCase().includes(q) || (d.tags || []).some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
    cmdkSelectedIndex = 0;
    el.cmdkResults.innerHTML = '';
    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmdk-empty';
      empty.textContent = 'No documents match.';
      el.cmdkResults.appendChild(empty);
      return;
    }
    results.forEach((doc, i) => {
      const item = document.createElement('div');
      item.className = 'cmdk-item' + (i === 0 ? ' selected' : '');
      const title = document.createElement('span');
      title.className = 'cmdk-item-title';
      title.textContent = doc.title || 'Untitled';
      const meta = document.createElement('span');
      meta.className = 'cmdk-item-meta';
      meta.textContent = notebookName(doc.notebookId);
      item.appendChild(title); item.appendChild(meta);
      item.addEventListener('click', () => jumpToDocument(doc));
      el.cmdkResults.appendChild(item);
    });
  }
  async function jumpToDocument(doc) {
    if (doc.notebookId !== activeNotebookId) {
      activeNotebookId = doc.notebookId;
      await MaDB.setMeta('activeNotebookId', activeNotebookId);
      renderNotebooks();
      docs = await MaDB.listDocuments(activeNotebookId);
    }
    openDocument(doc.id);
    closeCommandPalette();
  }

  init();
})();
