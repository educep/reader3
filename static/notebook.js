// notebook.js — Notebook tab logic for reader3
// Depends on: window.READER3_BOOK_ID, window.READER3_CHAPTER_INDEX, DOMPurify, marked, mermaid

(function () {
  'use strict';

  const bookId = window.READER3_BOOK_ID;
  const chapterIndex = window.READER3_CHAPTER_INDEX;

  // Composer state
  let composerOrigin = 'human';

  // ── Mermaid init ────────────────────────────────────────────────────────────
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false });
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────
  function qs(sel) { return document.querySelector(sel); }

  // Strip a ```mermaid ... ``` fence (or any fenced block) so the inner diagram
  // source is what mermaid actually renders. Legacy entries saved before this
  // stripping was in place still render correctly.
  function extractMermaidSource(body) {
    if (!body) return '';
    const fenced = body.match(/```mermaid\s*\r?\n([\s\S]*?)```/i)
                || body.match(/```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)```/);
    return (fenced ? fenced[1] : body).trim();
  }

  // ── Tab switching (Chat ↔ Notebook) ─────────────────────────────────────────
  function activateTab(tabId) {
    const tabChat     = document.getElementById('tabChat');
    const tabNotebook = document.getElementById('tabNotebook');
    const chatPane    = document.getElementById('chatPane');
    const notebookPane = document.getElementById('notebookPane');

    if (tabId === 'notebook') {
      tabChat.classList.remove('sp-tab--active');
      tabChat.setAttribute('aria-selected', 'false');
      tabNotebook.classList.add('sp-tab--active');
      tabNotebook.setAttribute('aria-selected', 'true');
      chatPane.classList.add('sp-pane--hidden');
      notebookPane.classList.remove('sp-pane--hidden');
    } else {
      tabNotebook.classList.remove('sp-tab--active');
      tabNotebook.setAttribute('aria-selected', 'false');
      tabChat.classList.add('sp-tab--active');
      tabChat.setAttribute('aria-selected', 'true');
      notebookPane.classList.add('sp-pane--hidden');
      chatPane.classList.remove('sp-pane--hidden');
    }
  }

  // ── Sub-view switching (scope ↔ index) ──────────────────────────────────────
  function activateSubView(viewName) {
    const scopeView = document.getElementById('nbViewScope');
    const indexView = document.getElementById('nbViewIndex');
    document.querySelectorAll('.nb-subview-btn').forEach(btn => {
      btn.classList.toggle('nb-subview-btn--active', btn.dataset.view === viewName);
    });
    if (viewName === 'scope') {
      scopeView.classList.remove('nb-view--hidden');
      indexView.classList.add('nb-view--hidden');
    } else if (viewName === 'index') {
      scopeView.classList.add('nb-view--hidden');
      indexView.classList.remove('nb-view--hidden');
      loadIndexEntries();
    }
  }

  // ── Render entries into a container ─────────────────────────────────────────
  function renderEntries(entries, container) {
    container.innerHTML = '';
    if (!entries || entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'nb-empty';
      empty.textContent = 'No entries yet.';
      container.appendChild(empty);
      return;
    }

    entries.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'nb-entry-card';
      card.id = 'nb-entry-' + entry.id;

      // Type badge
      const badge = document.createElement('span');
      badge.className = 'nb-entry-type';
      badge.textContent = entry.type || 'note';
      card.appendChild(badge);

      // Meta line
      const meta = document.createElement('div');
      meta.className = 'nb-entry-meta';
      const originText = entry.origin ? ' · ' + entry.origin : '';
      const dateText = entry.created_at ? ' · ' + new Date(entry.created_at).toLocaleDateString() : '';
      meta.textContent = (entry.scope && entry.scope.level ? entry.scope.level : '') + originText + dateText;
      card.appendChild(meta);

      // Body
      const body = document.createElement('div');
      body.className = 'nb-entry-body';
      if (entry.type === 'diagram') {
        const pre = document.createElement('pre');
        pre.className = 'mermaid';
        const source = extractMermaidSource(entry.body);
        pre.textContent = source;
        body.appendChild(pre);
        card.appendChild(body);
        // Render mermaid after the card is in the DOM. Use mermaid.render +
        // innerHTML (same path as chat/digest) to avoid mermaid.run's
        // data-processed short-circuit and to surface parse errors clearly.
        setTimeout(async () => {
          if (typeof mermaid === 'undefined') return;
          try {
            const { svg } = await mermaid.render(
              'mmd-nb-' + Math.random().toString(36).slice(2),
              source,
            );
            pre.innerHTML = svg;
          } catch (e) {
            pre.textContent = 'Diagram error: ' + (e && e.message ? e.message : e);
          }
        }, 0);
      } else {
        const rawBody = entry.body || '';
        const safeHtml = DOMPurify.sanitize(marked.parse(rawBody));
        body.innerHTML = safeHtml;
        card.appendChild(body);
      }

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'nb-entry-delete';
      delBtn.textContent = '×';
      delBtn.setAttribute('aria-label', 'Delete entry');
      delBtn.addEventListener('click', () => deleteEntry(entry.id));
      card.appendChild(delBtn);

      container.appendChild(card);
    });
  }

  // ── Margin marks ────────────────────────────────────────────────────────────
  function renderMarginMarks(entries) {
    // Remove existing marks
    document.querySelectorAll('.margin-mark').forEach(el => el.remove());

    const chapterBodyWrapper = qs('.content-container');
    if (!chapterBodyWrapper) return;

    const selectionEntries = (entries || []).filter(e =>
      e.scope && e.scope.level === 'selection' && e.scope.chapter_index === chapterIndex
    );

    selectionEntries.forEach(entry => {
      const mark = document.createElement('span');
      mark.className = 'margin-mark';
      mark.dataset.entryId = entry.id;
      mark.textContent = '❦';
      mark.setAttribute('title', 'Notebook entry: ' + (entry.type || 'note'));
      mark.addEventListener('click', () => {
        // Open panel + notebook tab
        document.getElementById('sidePanel').classList.remove('side-panel--closed');
        activateTab('notebook');
        activateSubView('scope');
        // Scroll to the entry card
        const card = document.getElementById('nb-entry-' + entry.id);
        if (card) {
          setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
        }
      });
      chapterBodyWrapper.appendChild(mark);
    });
  }

  // ── API: load scope entries ──────────────────────────────────────────────────
  async function loadScopeEntries() {
    if (!bookId) return;
    try {
      const resp = await fetch('/notebook/' + bookId + '/entries?chapter_index=' + chapterIndex);
      if (!resp.ok) return;
      const data = await resp.json();
      const entries = data.entries || data || [];
      renderEntries(entries, document.getElementById('nbEntryList'));
      renderMarginMarks(entries);
      updateBreadcrumb();
    } catch (err) { console.error('loadScopeEntries failed', err); }
  }

  // ── API: load index entries ──────────────────────────────────────────────────
  async function loadIndexEntries() {
    if (!bookId) return;
    const typeFilter   = (qs('#nbTypeFilter')   || {}).value || '';
    const originFilter = (qs('#nbOriginFilter') || {}).value || '';
    let url = '/notebook/' + bookId + '/entries';
    const params = [];
    if (typeFilter)   params.push('type='   + encodeURIComponent(typeFilter));
    if (originFilter) params.push('origin=' + encodeURIComponent(originFilter));
    if (params.length) url += '?' + params.join('&');
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const entries = data.entries || data || [];
      renderEntries(entries, document.getElementById('nbIndexList'));
    } catch (err) { console.error('loadIndexEntries failed', err); }
  }

  // ── API: create entry ────────────────────────────────────────────────────────
  async function createEntry(entryData) {
    if (!bookId) return;
    try {
      const resp = await fetch('/notebook/' + bookId + '/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entryData),
      });
      if (!resp.ok) return;
      await loadScopeEntries();
    } catch (err) { console.error('createEntry failed', err); }
  }

  // ── API: delete entry ────────────────────────────────────────────────────────
  async function deleteEntry(id) {
    if (!bookId) return;
    try {
      await fetch('/notebook/' + bookId + '/entries/' + id, { method: 'DELETE' });
      // Remove card from DOM immediately
      const card = document.getElementById('nb-entry-' + id);
      if (card) card.remove();
      // Remove margin mark
      document.querySelectorAll('.margin-mark[data-entry-id="' + id + '"]')
        .forEach(el => el.remove());
    } catch (err) { console.error('deleteEntry failed', err); }
  }

  // ── Breadcrumb ───────────────────────────────────────────────────────────────
  function updateBreadcrumb() {
    const bc = document.getElementById('nbScopeBreadcrumb');
    if (!bc) return;
    bc.textContent = 'Section ' + (chapterIndex + 1);
  }

  // ── Composer ─────────────────────────────────────────────────────────────────
  function showComposer() {
    const composer = document.getElementById('nbComposer');
    if (composer) composer.classList.remove('nb-composer--hidden');
  }

  function hideComposer() {
    const composer = document.getElementById('nbComposer');
    if (composer) {
      composer.classList.add('nb-composer--hidden');
      const bodyInput = document.getElementById('nbBodyInput');
      if (bodyInput) bodyInput.value = '';
      const typeSelect = document.getElementById('nbTypeSelect');
      if (typeSelect) typeSelect.value = 'note';
      composerOrigin = 'human';
    }
  }

  // ── Public: open composer pre-filled with LLM text ──────────────────────────
  window.openNotebookComposerWithText = function (text) {
    document.getElementById('sidePanel').classList.remove('side-panel--closed');
    activateTab('notebook');
    activateSubView('scope');
    composerOrigin = 'llm';
    const typeSelect = document.getElementById('nbTypeSelect');
    if (typeSelect) typeSelect.value = 'summary';
    const bodyInput = document.getElementById('nbBodyInput');
    if (bodyInput) bodyInput.value = text || '';
    showComposer();
  };

  // ── DOMContentLoaded wiring ──────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Set digest link
    const digestLink = document.getElementById('digestLink');
    if (digestLink && bookId) {
      digestLink.href = '/notebook/' + bookId;
    }

    // Tab switching
    const tabChat     = document.getElementById('tabChat');
    const tabNotebook = document.getElementById('tabNotebook');
    if (tabChat) {
      tabChat.addEventListener('click', () => activateTab('chat'));
    }
    if (tabNotebook) {
      tabNotebook.addEventListener('click', () => activateTab('notebook'));
    }

    // Sub-view switching
    document.querySelectorAll('.nb-subview-btn[data-view]').forEach(btn => {
      btn.addEventListener('click', () => activateSubView(btn.dataset.view));
    });

    // Add entry button
    const addBtn = document.getElementById('nbAddBtn');
    if (addBtn) addBtn.addEventListener('click', showComposer);

    // Cancel composer
    const cancelBtn = document.getElementById('nbCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', hideComposer);

    // Save composer
    const saveBtn = document.getElementById('nbSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const typeSelect = document.getElementById('nbTypeSelect');
        const bodyInput  = document.getElementById('nbBodyInput');
        const type = (typeSelect ? typeSelect.value : 'note') || 'note';
        let body = (bodyInput ? bodyInput.value.trim() : '');
        if (!body) return;
        if (type === 'diagram') body = extractMermaidSource(body);

        await createEntry({
          scope: { level: 'chapter', chapter_index: chapterIndex },
          type,
          body,
          origin: composerOrigin,
          tags: [],
        });
        hideComposer();
      });
    }

    // Index filters
    const typeFilter   = document.getElementById('nbTypeFilter');
    const originFilter = document.getElementById('nbOriginFilter');
    if (typeFilter)   typeFilter.addEventListener('change', loadIndexEntries);
    if (originFilter) originFilter.addEventListener('change', loadIndexEntries);

    // Initial load
    loadScopeEntries();
  });
})();
