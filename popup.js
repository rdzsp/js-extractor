// popup.js — Full UI logic for JS Extractor

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  groups: [],
  activeGroupId: null,
  results: [],
  notes: [],
  editingGroupId: null,
  editingPatternId: null,
  pendingDeleteType: null,
  pendingDeleteId: null,
  pendingDeleteParentId: null,
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadStorage();
  setupTabs();
  setupHeaderButtons();
  setupGroupModal();
  setupPatternModal();
  setupDeleteModal();
  setupExtractButton();
  setupResultsButtons();
  setupNotesButtons();
  setupModalClose();
  render();
});

// ─── Storage ──────────────────────────────────────────────────────────────────
async function loadStorage() {
  const data = await browser.storage.local.get(['groups', 'activeGroupId', 'results', 'notes']);
  state.groups = data.groups || [];
  state.activeGroupId = data.activeGroupId || (state.groups[0]?.id ?? null);
  state.results = data.results || [];
  state.notes = data.notes || [];
}

async function saveStorage() {
  await browser.storage.local.set({
    groups: state.groups,
    activeGroupId: state.activeGroupId,
    results: state.results,
    notes: state.notes,
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  renderGroups();
  renderPatterns();
  renderResults();
  renderNotes();
  updateResultsTabBadge();
  updateNotesTabBadge();
}

function renderGroups() {
  const container = document.getElementById('group-selector');
  if (state.groups.length === 0) {
    container.innerHTML = `<span class="no-groups-hint">No groups yet. Click + to create one.</span>`;
    return;
  }
  container.innerHTML = state.groups.map(g => {
    const isActive = g.id === state.activeGroupId;
    return `
      <div class="group-chip ${isActive ? 'active' : ''}" data-id="${g.id}" role="button">
        <span class="group-chip-dot"></span>
        <span>${escHtml(g.name)}</span>
        <span class="group-chip-actions">
          <button class="chip-action-btn" data-action="edit-group" data-id="${g.id}" title="Rename">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="chip-action-btn del" data-action="delete-group" data-id="${g.id}" title="Delete">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </span>
      </div>
    `;
  }).join('');

  // Chip click: select active group
  container.querySelectorAll('.group-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.chip-action-btn')) return;
      const id = chip.dataset.id;
      state.activeGroupId = id;
      saveStorage();
      renderGroups();
      renderPatterns();
    });
  });

  // Edit / Delete group buttons
  container.querySelectorAll('[data-action="edit-group"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = state.groups.find(g => g.id === btn.dataset.id);
      if (!group) return;
      openGroupModal('edit', group);
    });
  });

  container.querySelectorAll('[data-action="delete-group"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteModal('group', btn.dataset.id, null);
    });
  });
}

function renderPatterns() {
  const list = document.getElementById('patterns-list');
  const empty = document.getElementById('patterns-empty');
  const group = activeGroup();

  if (!group) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    empty.querySelector('span').textContent = 'Select or create a group first.';
    return;
  }

  if (group.patterns.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    empty.querySelector('span').textContent = 'No patterns in this group. Add one above.';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = group.patterns.map(p => `
    <div class="pattern-card" data-id="${p.id}">
      <div class="pattern-accent-bar"></div>
      <div class="pattern-body">
        <div class="pattern-regex">${escHtml(p.regex)}</div>
        <div class="pattern-desc">${escHtml(p.description || 'No description')}</div>
      </div>
      <div class="pattern-actions">
        <button class="pat-action-btn" data-action="edit-pattern" data-id="${p.id}" title="Edit">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M8.5 1.5l2 2L4 10H2V8L8.5 1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="pat-action-btn del" data-action="delete-pattern" data-id="${p.id}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="edit-pattern"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = activeGroup();
      const pat = g?.patterns.find(p => p.id === btn.dataset.id);
      if (pat) openPatternModal('edit', pat);
    });
  });

  list.querySelectorAll('[data-action="delete-pattern"]').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteModal('pattern', btn.dataset.id, activeGroup()?.id);
    });
  });
}

// Track which groups are collapsed: Set of patternIds
const collapsedGroups = new Set();
// Current search query
let searchQuery = '';
let searchQueryNotes = '';
// Pagination: how many matches to show per pattern group
const BATCH_SIZE = 50;
const displayLimits = {};  // patternId → number of matches shown
let notesDisplayLimit = BATCH_SIZE;
// Flag to ensure delegated listener is attached only once
let resultsDelegated = false;
let notesDelegated = false;

function renderResults() {
  const list = document.getElementById('results-list');
  const toolbar = document.getElementById('results-toolbar');
  const countEl = document.getElementById('results-count');

  if (!state.results || state.results.length === 0) {
    toolbar.style.display = 'none';
    list.innerHTML = `
      <div class="empty-state results-empty">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.3">
          <rect x="4" y="4" width="24" height="24" rx="6" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10 12l4 4-4 4M18 20h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>No results yet. Run extraction from the Groups tab.</span>
      </div>`;
    return;
  }

  toolbar.style.display = 'flex';

  const q = searchQuery.toLowerCase().trim();

  // Filter matches per result group by search query
  const filtered = state.results.map(r => {
    if (r.error) return { ...r, filteredMatches: [] };
    const matches = r.matches || [];
    const filteredMatches = q
      ? matches.filter(m => {
          const val = (m.captured !== null ? m.captured : m.value).toLowerCase();
          const src = m.source.toLowerCase();
          return val.includes(q) || src.includes(q);
        })
      : matches;
    return { ...r, filteredMatches };
  });

  const totalVisible = filtered.reduce((a, r) => a + (r.filteredMatches?.length || 0), 0);
  const totalAll = state.results.reduce((a, r) => a + (r.matches?.length || 0), 0);
  countEl.textContent = q
    ? `${totalVisible} of ${totalAll} match${totalAll !== 1 ? 'es' : ''}`
    : `${totalAll} match${totalAll !== 1 ? 'es' : ''} · ${state.results.length} pattern${state.results.length !== 1 ? 's' : ''}`;

  list.innerHTML = filtered.map(r => {
    if (r.error) {
      return `
        <div class="result-group">
          <div class="result-group-header error">
            <span class="rg-chevron">▾</span>
            <span class="rg-regex">${escHtml(r.patternRegex)}</span>
            <span class="rg-desc">${escHtml(r.description)}</span>
            <span class="rg-count zero">err</span>
          </div>
          <div class="rg-body"><div class="no-matches">${escHtml(r.error)}</div></div>
        </div>`;
    }

    const totalCount = r.matches?.length || 0;
    const visibleCount = r.filteredMatches.length;
    const isCollapsed = collapsedGroups.has(r.patternId);

    // Pagination: only render up to the current limit
    const limit = displayLimits[r.patternId] || BATCH_SIZE;
    const paginated = r.filteredMatches.slice(0, limit);
    const remaining = visibleCount - limit;

    let matchRows;
    if (visibleCount > 0) {
      matchRows = paginated.map(m => {
          const srcLabel = formatSourceLabel(m.source);
          const displayVal = m.captured !== null ? m.captured : m.value;
          const isInline = m.source.startsWith('inline-script');
          const highlighted = q ? highlightMatch(displayVal, q) : escHtml(displayVal);
          return `
            <div class="match-row">
              <span class="match-value" title="${escHtml(displayVal)}">${highlighted}</span>
              <button class="match-source-btn ${isInline ? 'is-inline' : ''}" data-copy-src="${escHtml(m.source)}" title="${escHtml(m.source)}">
                <span class="match-source-label">${escHtml(srcLabel)}</span>
                <svg class="src-copy-icon" width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="match-copy-btn save-note-btn" data-val="${escHtml(displayVal)}" data-src="${escHtml(m.source)}" data-regex="${escHtml(r.patternRegex)}" data-desc="${escHtml(r.description)}" title="Save to Notes">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 10.5l3.5-2 3.5 2V2a1 1 0 00-1-1h-5a1 1 0 00-1 1v8.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="match-copy-btn" data-copy="${escHtml(displayVal)}" title="Copy value">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                  <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>`;
        }).join('');
      // Add "Show more" button if there are remaining matches
      if (remaining > 0) {
        matchRows += `
          <button class="show-more-btn" data-pattern-id="${escHtml(r.patternId)}">
            Show more (${remaining} remaining)
          </button>`;
      }
    } else {
      matchRows = q
        ? `<div class="no-matches">No matches for "${escHtml(q)}"</div>`
        : `<div class="no-matches">No matches</div>`;
    }

    return `
      <div class="result-group ${isCollapsed ? 'collapsed' : ''}" data-pattern-id="${escHtml(r.patternId)}">
        <div class="result-group-header" role="button">
          <span class="rg-chevron">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          <span class="rg-regex">${escHtml(r.patternRegex)}</span>
          <span class="rg-desc">${escHtml(r.description)}</span>
          <span class="rg-count ${totalCount === 0 ? 'zero' : ''}">${q && visibleCount !== totalCount ? `${visibleCount}/${totalCount}` : totalCount}</span>
        </div>
        <div class="rg-body">${matchRows}</div>
      </div>`;
  }).join('');

  // Attach a single delegated event listener (once)
  if (!resultsDelegated) {
    resultsDelegated = true;
    list.addEventListener('click', handleResultsClick);
  }
}

// Single delegated click handler for all results interactions
function handleResultsClick(e) {
  // --- Show more button ---
  const showMoreBtn = e.target.closest('.show-more-btn');
  if (showMoreBtn) {
    const pid = showMoreBtn.dataset.patternId;
    displayLimits[pid] = (displayLimits[pid] || BATCH_SIZE) + BATCH_SIZE;
    renderResults();
    return;
  }

  // --- Save note button ---
  const saveNoteBtn = e.target.closest('.save-note-btn');
  if (saveNoteBtn) {
    e.stopPropagation();
    const note = {
      id: 'n-' + Date.now(),
      value: saveNoteBtn.dataset.val,
      source: saveNoteBtn.dataset.src,
      regex: saveNoteBtn.dataset.regex,
      desc: saveNoteBtn.dataset.desc,
      timestamp: Date.now()
    };
    state.notes.unshift(note);
    saveStorage();
    showToast('Saved to Notes!', 'success');
    renderNotes();
    updateNotesTabBadge();
    return;
  }

  // --- Copy match value ---
  const copyBtn = e.target.closest('.match-copy-btn');
  if (copyBtn) {
    e.stopPropagation();
    navigator.clipboard.writeText(copyBtn.dataset.copy);
    showToast('Value copied!', 'success');
    return;
  }

  // --- Copy source URL ---
  const srcBtn = e.target.closest('.match-source-btn');
  if (srcBtn) {
    e.stopPropagation();
    if (srcBtn.classList.contains('is-inline')) {
      showToast('Inline script — no URL', 'error');
      return;
    }
    navigator.clipboard.writeText(srcBtn.dataset.copySrc);
    showToast('Source URL copied!', 'success');
    return;
  }

  // --- Toggle collapse ---
  const header = e.target.closest('.result-group-header');
  if (header) {
    const group = header.closest('.result-group');
    const pid = group.dataset.patternId;
    if (collapsedGroups.has(pid)) {
      collapsedGroups.delete(pid);
      group.classList.remove('collapsed');
    } else {
      collapsedGroups.add(pid);
      group.classList.add('collapsed');
    }
    return;
  }
}

function highlightMatch(text, query) {
  const escaped = escHtml(text);
  if (!query) return escaped;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escaped;
  const before = escHtml(text.slice(0, idx));
  const match  = escHtml(text.slice(idx, idx + query.length));
  const after  = escHtml(text.slice(idx + query.length));
  return `${before}<mark class="search-highlight">${match}</mark>${after}`;
}

function updateResultsTabBadge() {
  const tab = document.querySelector('[data-tab="results"]');
  const total = state.results.reduce((a, r) => a + (r.matches?.length || 0), 0);
  const existing = tab.querySelector('.badge');
  if (existing) existing.remove();
  if (total > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = total > 99 ? '99+' : total;
    tab.appendChild(badge);
  }
}

function updateNotesTabBadge() {
  const tab = document.querySelector('[data-tab="notes"]');
  if (!tab) return;
  const total = state.notes.length;
  const existing = tab.querySelector('.badge');
  if (existing) existing.remove();
  if (total > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = total > 99 ? '99+' : total;
    tab.appendChild(badge);
  }
}

function renderNotes() {
  const list = document.getElementById('notes-list');
  const toolbar = document.getElementById('notes-toolbar');
  const countEl = document.getElementById('notes-count');

  if (!state.notes || state.notes.length === 0) {
    toolbar.style.display = 'none';
    list.innerHTML = `
      <div class="empty-state results-empty">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.3">
          <path d="M4 6h24v20H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M10 12h12M10 16h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span>No notes saved. Click the bookmark icon in Results to save.</span>
      </div>`;
    return;
  }

  toolbar.style.display = 'flex';

  const q = searchQueryNotes.toLowerCase().trim();

  // Filter notes
  const filteredNotes = q ? state.notes.filter(n => {
    return (n.value || '').toLowerCase().includes(q) || 
           (n.source || '').toLowerCase().includes(q) ||
           (n.desc || '').toLowerCase().includes(q) ||
           (n.regex || '').toLowerCase().includes(q);
  }) : state.notes;

  countEl.textContent = q
    ? `${filteredNotes.length} of ${state.notes.length} note${state.notes.length !== 1 ? 's' : ''}`
    : `${state.notes.length} note${state.notes.length !== 1 ? 's' : ''}`;

  const visibleCount = filteredNotes.length;
  const limit = notesDisplayLimit || BATCH_SIZE;
  const paginated = filteredNotes.slice(0, limit);
  const remaining = visibleCount - limit;

  let contentRows;
  if (visibleCount > 0) {
    contentRows = paginated.map(n => {
      const srcLabel = formatSourceLabel(n.source);
      const isInline = n.source.startsWith('inline-script');
      const highlightedVal = q ? highlightMatch(n.value, q) : escHtml(n.value);
      return `
        <div class="note-card" data-id="${n.id}">
          <div class="note-header">
             <span class="note-regex" title="${escHtml(n.regex)}">${escHtml(n.regex)}</span>
             <span class="note-desc" title="${escHtml(n.desc)}">${escHtml(n.desc)}</span>
          </div>
          <div class="match-row standalone">
            <span class="match-value" title="${escHtml(n.value)}">${highlightedVal}</span>
            <button class="match-source-btn ${isInline ? 'is-inline' : ''}" data-copy-src="${escHtml(n.source)}" title="${escHtml(n.source)}">
              <span class="match-source-label">${escHtml(srcLabel)}</span>
              <svg class="src-copy-icon" width="10" height="10" viewBox="0 0 12 12" fill="none">
                <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </button>
            <!-- copy button -->
            <button class="match-copy-btn" data-copy="${escHtml(n.value)}" title="Copy value">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </button>
            <!-- delete button -->
            <button class="note-del-btn" data-id="${n.id}" title="Delete note">
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                <path d="M2 3h8M5 3V2h2v1M4 3v6h4V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>`;
    }).join('');
    
    if (remaining > 0) {
      contentRows += `
        <button class="show-more-notes-btn">
          Show more (${remaining} remaining)
        </button>`;
    }
  } else {
    contentRows = `<div class="no-matches">No notes for "${escHtml(q)}"</div>`;
  }

  list.innerHTML = contentRows;

  if (!notesDelegated) {
    notesDelegated = true;
    list.addEventListener('click', handleNotesClick);
  }
}

function handleNotesClick(e) {
  // --- Show more ---
  const showMoreBtn = e.target.closest('.show-more-notes-btn');
  if (showMoreBtn) {
    notesDisplayLimit += BATCH_SIZE;
    renderNotes();
    return;
  }

  // --- Copy match value ---
  const copyBtn = e.target.closest('.match-copy-btn');
  if (copyBtn) {
    e.stopPropagation();
    navigator.clipboard.writeText(copyBtn.dataset.copy);
    showToast('Value copied!', 'success');
    return;
  }

  // --- Copy source URL ---
  const srcBtn = e.target.closest('.match-source-btn');
  if (srcBtn) {
    e.stopPropagation();
    if (srcBtn.classList.contains('is-inline')) {
      showToast('Inline script — no URL', 'error');
      return;
    }
    navigator.clipboard.writeText(srcBtn.dataset.copySrc);
    showToast('Source URL copied!', 'success');
    return;
  }
  
  // --- Delete note ---
  const delBtn = e.target.closest('.note-del-btn');
  if (delBtn) {
    e.stopPropagation();
    openDeleteModal('note', delBtn.dataset.id, null);
    return;
  }
}

function setupNotesButtons() {
  const searchInput = document.getElementById('notes-search');
  const searchClear = document.getElementById('notes-search-clear');

  searchInput.addEventListener('input', () => {
    searchQueryNotes = searchInput.value;
    searchClear.style.display = searchQueryNotes ? 'flex' : 'none';
    notesDisplayLimit = BATCH_SIZE;
    renderNotes();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQueryNotes = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    renderNotes();
  });

  document.getElementById('btn-copy-all-notes').addEventListener('click', () => {
    const q = searchQueryNotes.toLowerCase().trim();
    const filtered = q ? state.notes.filter(n => {
      return (n.value || '').toLowerCase().includes(q) || 
             (n.source || '').toLowerCase().includes(q) ||
             (n.desc || '').toLowerCase().includes(q) ||
             (n.regex || '').toLowerCase().includes(q);
    }) : state.notes;
    
    if (!filtered.length) { showToast('Nothing to copy', 'error'); return; }
    
    const lines = filtered.map(n => `[${n.regex} - ${n.desc}] ${n.value} (${n.source})`);
    navigator.clipboard.writeText(lines.join('\n'));
    showToast('Copied all notes!', 'success');
  });

  document.getElementById('btn-clear-notes').addEventListener('click', () => {
    if (state.notes.length === 0) return;
    openDeleteModal('all-notes', null, null);
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');
    });
  });
}

// ─── Header ───────────────────────────────────────────────────────────────────
function setupHeaderButtons() {
  document.getElementById('btn-import-group').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', handleImportGroup);
  document.getElementById('btn-export-group').addEventListener('click', handleExportGroup);

  document.getElementById('btn-new-group').addEventListener('click', () => {
    openGroupModal('create', null);
  });
  document.getElementById('btn-add-pattern').addEventListener('click', () => {
    if (!activeGroup()) { showToast('Select a group first', 'error'); return; }
    openPatternModal('create', null);
  });
}

function handleExportGroup() {
  const g = activeGroup();
  if (!g) { 
    showToast('Select a group to export', 'error'); 
    return; 
  }
  
  if (g.patterns.length === 0) {
    showToast('Group has no patterns', 'error');
    return;
  }
  
  const exportData = {
    'js-extractor': {
      name: g.name,
      patterns: g.patterns.map(p => ({
        regex: p.regex,
        description: p.description || ''
      }))
    }
  };
  
  try {
    const yamlStr = jsyaml.dump(exportData);
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${g.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'group'}.yml`;
    a.click();
    
    URL.revokeObjectURL(url);
    showToast('Export successful', 'success');
  } catch (err) {
    showToast('Export failed', 'error');
    console.error(err);
  }
}

function handleImportGroup(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const text = event.target.result;
      const data = jsyaml.load(text);
      
      if (!data || !data['js-extractor'] || !data['js-extractor'].name || !Array.isArray(data['js-extractor'].patterns)) {
        throw new Error('Invalid YAML schema');
      }
      
      const newGroupData = data['js-extractor'];
      const newGroup = { 
        id: 'g-' + Date.now(), 
        name: newGroupData.name, 
        patterns: newGroupData.patterns.map(p => ({
          id: 'p-' + Math.random().toString(36).substr(2, 9),
          regex: p.regex,
          description: p.description || ''
        }))
      };
      
      state.groups.push(newGroup);
      state.activeGroupId = newGroup.id;
      
      saveStorage();
      renderGroups();
      renderPatterns();
      showToast('Group imported successfully', 'success');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
      console.error(err);
    } finally {
      e.target.value = ''; // Reset input for future imports
    }
  };
  reader.readAsText(file);
}

// ─── Group Modal ──────────────────────────────────────────────────────────────
function openGroupModal(mode, group) {
  state.editingGroupId = mode === 'edit' ? group.id : null;
  document.getElementById('modal-group-title').textContent = mode === 'edit' ? 'Rename group' : 'New group';
  document.getElementById('input-group-name').value = mode === 'edit' ? group.name : '';
  showModal('modal-group');
  setTimeout(() => document.getElementById('input-group-name').focus(), 80);
}

function setupGroupModal() {
  document.getElementById('btn-save-group').addEventListener('click', saveGroup);
  document.getElementById('input-group-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveGroup();
  });
}

function saveGroup() {
  const name = document.getElementById('input-group-name').value.trim();
  if (!name) return;

  if (state.editingGroupId) {
    const g = state.groups.find(g => g.id === state.editingGroupId);
    if (g) g.name = name;
  } else {
    const newGroup = { id: 'g-' + Date.now(), name, patterns: [] };
    state.groups.push(newGroup);
    state.activeGroupId = newGroup.id;
  }

  saveStorage();
  closeModal('modal-group');
  renderGroups();
  renderPatterns();
  showToast(state.editingGroupId ? 'Group renamed' : 'Group created', 'success');
}

// ─── Pattern Modal ────────────────────────────────────────────────────────────
function openPatternModal(mode, pattern) {
  state.editingPatternId = mode === 'edit' ? pattern.id : null;
  document.getElementById('modal-pattern-title').textContent = mode === 'edit' ? 'Edit pattern' : 'New pattern';
  document.getElementById('input-pattern-regex').value = mode === 'edit' ? pattern.regex : '';
  document.getElementById('input-pattern-desc').value = mode === 'edit' ? (pattern.description || '') : '';
  document.getElementById('regex-error').textContent = '';
  showModal('modal-pattern');
  setTimeout(() => document.getElementById('input-pattern-regex').focus(), 80);
}

function setupPatternModal() {
  document.getElementById('btn-save-pattern').addEventListener('click', savePattern);
  document.getElementById('input-pattern-regex').addEventListener('input', validateRegexInput);
  document.getElementById('input-pattern-desc').addEventListener('keydown', e => {
    if (e.key === 'Enter') savePattern();
  });
}

function validateRegexInput() {
  const val = document.getElementById('input-pattern-regex').value.trim();
  const errEl = document.getElementById('regex-error');
  if (!val) { errEl.textContent = ''; return true; }
  try {
    new RegExp(val, 'gm');
    errEl.textContent = '';
    return true;
  } catch(e) {
    errEl.textContent = e.message;
    return false;
  }
}

function savePattern() {
  const regex = document.getElementById('input-pattern-regex').value.trim();
  const desc = document.getElementById('input-pattern-desc').value.trim();
  if (!regex) return;
  if (!validateRegexInput()) return;

  const g = activeGroup();
  if (!g) return;

  if (state.editingPatternId) {
    const p = g.patterns.find(p => p.id === state.editingPatternId);
    if (p) { p.regex = regex; p.description = desc; }
  } else {
    g.patterns.push({ id: 'p-' + Date.now(), regex, description: desc });
  }

  saveStorage();
  closeModal('modal-pattern');
  renderPatterns();
  showToast(state.editingPatternId ? 'Pattern updated' : 'Pattern added', 'success');
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function openDeleteModal(type, id, parentId) {
  state.pendingDeleteType = type;
  state.pendingDeleteId = id;
  state.pendingDeleteParentId = parentId;

  if (type === 'group') {
    const g = state.groups.find(g => g.id === id);
    document.getElementById('modal-delete-title').textContent = 'Delete group?';
    document.getElementById('modal-delete-desc').textContent =
      `"${g?.name}" and all its patterns will be permanently removed.`;
  } else if (type === 'pattern') {
    const g = activeGroup();
    const p = g?.patterns.find(p => p.id === id);
    document.getElementById('modal-delete-title').textContent = 'Delete pattern?';
    document.getElementById('modal-delete-desc').textContent =
      `The pattern "${p?.regex}" will be permanently removed.`;
  } else if (type === 'note') {
    document.getElementById('modal-delete-title').textContent = 'Delete note?';
    document.getElementById('modal-delete-desc').textContent =
      `This note will be permanently removed.`;
  } else if (type === 'all-notes') {
    document.getElementById('modal-delete-title').textContent = 'Clear all notes?';
    document.getElementById('modal-delete-desc').textContent =
      `All saved notes will be permanently removed.`;
  }
  showModal('modal-delete');
}

function setupDeleteModal() {
  document.getElementById('btn-confirm-delete').addEventListener('click', () => {
    if (state.pendingDeleteType === 'group') {
      state.groups = state.groups.filter(g => g.id !== state.pendingDeleteId);
      if (state.activeGroupId === state.pendingDeleteId) {
        state.activeGroupId = state.groups[0]?.id ?? null;
      }
    } else if (state.pendingDeleteType === 'pattern') {
      const g = state.groups.find(g => g.id === state.pendingDeleteParentId);
      if (g) g.patterns = g.patterns.filter(p => p.id !== state.pendingDeleteId);
    } else if (state.pendingDeleteType === 'note') {
      state.notes = state.notes.filter(n => n.id !== state.pendingDeleteId);
    } else if (state.pendingDeleteType === 'all-notes') {
      state.notes = [];
      searchQueryNotes = '';
      document.getElementById('notes-search').value = '';
      document.getElementById('notes-search-clear').style.display = 'none';
      notesDisplayLimit = BATCH_SIZE;
    }
    saveStorage();
    closeModal('modal-delete');
    render();
    showToast('Deleted', 'success');
  });
}

// ─── Extract ──────────────────────────────────────────────────────────────────
function setupExtractButton() {
  document.getElementById('btn-extract').addEventListener('click', async () => {
    const g = activeGroup();
    if (!g) { showToast('Select a group first', 'error'); return; }
    if (g.patterns.length === 0) { showToast('Add patterns to this group first', 'error'); return; }

    const btn = document.getElementById('btn-extract');
    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const response = await browser.tabs.sendMessage(tab.id, {
        action: 'extract',
        patterns: g.patterns
      });

      if (!response.success) throw new Error(response.error);

      state.results = response.results;
      await saveStorage();
      render();

      // Switch to results tab
      document.querySelector('[data-tab="results"]').click();
      showToast('Extraction complete!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed: ' + (err.message || 'Could not connect to page'), 'error');
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

// ─── Results Toolbar ──────────────────────────────────────────────────────────
function setupResultsButtons() {
  // Search input
  const searchInput = document.getElementById('results-search');
  const searchClear = document.getElementById('search-clear');

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchClear.style.display = searchQuery ? 'flex' : 'none';
    // Reset pagination when search changes
    Object.keys(displayLimits).forEach(k => delete displayLimits[k]);
    renderResults();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.style.display = 'none';
    searchInput.focus();
    renderResults();
  });

  // Copy all (respects current search filter)
  document.getElementById('btn-copy-all').addEventListener('click', () => {
    const allMatches = [];
    const q = searchQuery.toLowerCase().trim();
    state.results.forEach(r => {
      const matches = (r.matches || []).filter(m => {
        if (!q) return true;
        const val = (m.captured !== null ? m.captured : m.value).toLowerCase();
        return val.includes(q) || m.source.toLowerCase().includes(q);
      });
      if (matches.length) {
        allMatches.push(`## ${r.patternRegex} — ${r.description}`);
        matches.forEach(m => {
          const val = m.captured !== null ? m.captured : m.value;
          allMatches.push(`${val}  (${m.source})`);
        });
        allMatches.push('');
      }
    });
    if (!allMatches.length) { showToast('Nothing to copy', 'error'); return; }
    navigator.clipboard.writeText(allMatches.join('\n'));
    showToast('Copied!', 'success');
  });

  document.getElementById('btn-clear-results').addEventListener('click', () => {
    state.results = [];
    searchQuery = '';
    searchInput.value = '';
    searchClear.style.display = 'none';
    // Reset pagination limits
    Object.keys(displayLimits).forEach(k => delete displayLimits[k]);
    saveStorage();
    renderResults();
    updateResultsTabBadge();
  });
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────
function setupModalClose() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(m => {
        if (m.style.display !== 'none') closeModal(m.id);
      });
    }
  });
}

function showModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function activeGroup() {
  return state.groups.find(g => g.id === state.activeGroupId) || null;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSourceLabel(src) {
  if (src.startsWith('inline-script')) return src;
  try {
    const url = new URL(src);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || url.hostname;
  } catch {
    return src.length > 30 ? src.slice(-30) : src;
  }
}
