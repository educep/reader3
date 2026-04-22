// Constants set by reader.html template
const bookId = window.READER3_BOOK_ID;
const chapterIndex = window.READER3_CHAPTER_INDEX;

// State
let messages = [];
let currentSelection = '';
let streamController = null;

// DOM refs (resolved after DOMContentLoaded)
let panel, toolbar, messageList, chatInput, selectionQuote, selectionQuoteText;

document.addEventListener('DOMContentLoaded', () => {
  panel = document.getElementById('sidePanel');
  toolbar = document.getElementById('selectionToolbar');
  messageList = document.getElementById('messageList');
  chatInput = document.getElementById('chatInput');
  selectionQuote = document.getElementById('selectionQuote');
  selectionQuoteText = document.getElementById('selectionQuoteText');

  // Check health and disable actions if no key
  fetch('/chat/health').then(r => r.json()).then(h => {
    if (!h.has_key) {
      document.querySelectorAll('.sel-action').forEach(btn => {
        btn.disabled = true;
        btn.title = 'Set ANTHROPIC_API_KEY to enable chat';
      });
    }
  }).catch(() => {});

  // Selection toolbar
  document.getElementById('chapterBody').addEventListener('mouseup', () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) { hideToolbar(); return; }
    currentSelection = text;
    positionToolbar(sel);
  });

  document.querySelectorAll('.sel-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      hideToolbar();
      openChatWithAction(currentSelection, action);
    });
  });

  document.getElementById('spCloseBtn').addEventListener('click', closePanel);
  document.getElementById('clearQuoteBtn').addEventListener('click', () => {
    selectionQuote.classList.add('sp-quote--hidden');
    currentSelection = '';
  });
  document.getElementById('newConversationBtn').addEventListener('click', resetConversation);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitUserMessage();
    }
  });
  document.getElementById('chatSubmit').addEventListener('click', submitUserMessage);

  document.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { hideToolbar(); return; }
    if (meta && e.key === 'l') { e.preventDefault(); openPanel(); chatInput.focus(); }
    if (meta && e.key === '\\') { e.preventDefault(); togglePanel(); }
  });
});

function positionToolbar(sel) {
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  toolbar.style.top = (rect.bottom + window.scrollY + 8) + 'px';
  toolbar.style.left = Math.max(0, rect.left + window.scrollX) + 'px';
  toolbar.classList.remove('sel-toolbar--hidden');
}

function hideToolbar() { toolbar.classList.add('sel-toolbar--hidden'); }
function openPanel() { panel.classList.remove('side-panel--closed'); }
function closePanel() { panel.classList.add('side-panel--closed'); }
function togglePanel() { panel.classList.toggle('side-panel--closed'); }

function openChatWithAction(selection, action) {
  openPanel();
  if (selection) {
    selectionQuoteText.textContent = selection;
    selectionQuote.classList.remove('sp-quote--hidden');
  }
  streamResponse(action, selection);
}

function resetConversation() {
  messages = [];
  messageList.innerHTML = '';
  selectionQuote.classList.add('sp-quote--hidden');
  currentSelection = '';
}

function submitUserMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  appendMessage('user', text);
  messages.push({ role: 'user', content: text });
  streamResponse('free', null);
}

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = role === 'user' ? 'msg-user' : 'msg-assistant';
  div.textContent = text;
  messageList.appendChild(div);
  messageList.scrollTop = messageList.scrollHeight;
  return div;
}

async function streamResponse(action, selection) {
  if (streamController) streamController.abort();
  streamController = new AbortController();

  const bubble = appendMessage('assistant', '');
  bubble.classList.add('msg-streaming');
  let rawText = '';

  const body = JSON.stringify({
    book_id: bookId,
    chapter_index: chapterIndex,
    selection: selection || undefined,
    action: action,
    messages: messages,
  });

  try {
    const resp = await fetch('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: streamController.signal,
    });

    if (!resp.ok) {
      bubble.textContent = 'Error: ' + resp.status;
      bubble.classList.remove('msg-streaming');
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let payload;
        try { payload = JSON.parse(line.slice(6)); } catch { continue; }
        if (payload.token) {
          rawText += payload.token;
          bubble.textContent = rawText; // safe: textContent during streaming
        }
        if (payload.done) {
          // Render markdown safely
          const html = DOMPurify.sanitize(marked.parse(rawText));
          bubble.innerHTML = html;
          bubble.classList.remove('msg-streaming');
          messages.push({ role: 'assistant', content: rawText });
          // Store raw text and append Save to Notebook button
          bubble.dataset.raw = rawText;
          const saveBtn = document.createElement('button');
          saveBtn.className = 'msg-save-nb';
          saveBtn.textContent = 'Save to Notebook';
          saveBtn.addEventListener('click', () => {
            window.openNotebookComposerWithText && window.openNotebookComposerWithText(rawText);
          });
          bubble.appendChild(saveBtn);
        }
        if (payload.error) {
          bubble.textContent = 'Error: ' + payload.error;
          bubble.classList.remove('msg-streaming');
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      bubble.textContent = 'Connection error. Please try again.';
      bubble.classList.remove('msg-streaming');
    }
  }
}
