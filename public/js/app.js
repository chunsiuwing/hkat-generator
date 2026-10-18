// HKAT 閱讀理解生成器 — front-end logic
'use strict';

/* ------------------------- state ------------------------- */
const state = {
  meta: null,          // { questionTypes, levels, ai, providers, modes }
  samples: [],
  stats: null,
  papers: [],          // papers from the last generation (1 or 3)
  paperIndex: 0,
  paper: null,         // currently displayed paper
  answersVisible: true,
  genBusy: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeById = (id) => state.meta?.questionTypes.find((t) => t.id === id);
const levelById = (id) => state.meta?.levels.find((l) => l.id === id);

/* ------------------------- tabs ------------------------- */
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'analysis') loadAnalysis();
    if (btn.dataset.tab === 'samples') loadSamples();
  });
});
const gotoTab = (name) => $$('.tab').find((b) => b.dataset.tab === name)?.click();

/* ------------------------- AI badge ------------------------- */
function renderAiBadge(ai) {
  const badge = $('#ai-badge');
  if (!ai) return;
  if (ai.mock) {
    badge.textContent = 'AI：模擬模式 Mock';
    badge.className = 'ai-badge warn';
    badge.title = 'MOCK_AI=1 — 只顯示模擬內容，未連接真實 AI';
  } else if (ai.configured) {
    badge.textContent = `AI：${ai.model}`;
    badge.className = 'ai-badge ok';
    badge.title = `${ai.baseUrl}\nKey: ${ai.keyMasked || '(from .env)'}`;
  } else {
    badge.textContent = 'AI：未設定 Not set';
    badge.className = 'ai-badge warn';
    badge.title = '按右上角「⚙️ 設定」貼上 API Key';
  }
}

/* ------------------------- samples ------------------------- */
async function loadSamples() {
  try {
    const data = await API.get('/api/samples');
    state.samples = data.samples;
    state.stats = data.stats;
    renderAiBadge(data.ai);
    renderSamples(data.stale);
    $('#tab-count-samples').textContent = data.samples.length ? `(${data.samples.length})` : '';
    $('#tab-stale-dot').classList.toggle('hidden', !data.stale);
    const busy = data.samples.filter((s) => ['queued', 'extracting', 'structuring', 'processing'].includes(s.status));
    if (busy.length) setTimeout(loadSamples, 2500); // keep polling while work runs
  } catch (err) {
    $('#samples-list').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function statusBadge(s) {
  if (s.status === 'processed') return `<span class="badge">✅ 已處理</span>`;
  if (s.status === 'failed') return `<span class="badge err" title="${esc(s.error || '')}">❌ 失敗</span>`;
  if (s.status === 'pending') return `<span class="badge pending" title="${esc(s.error || '')}">⏸ 待處理</span>`;
  return `<span class="badge pending"><span class="spinner"></span> ${esc(s.status)}…</span>`;
}

function renderSamples(stale) {
  const list = $('#samples-list');
  const st = state.stats;
  $('#sample-summary').textContent = st ? `（共 ${st.total} 份已處理）` : '';
  if (!state.samples.length) {
    list.innerHTML = `<p class="muted">資料庫還是空的。上載第一份 HKAT comprehension PDF 開始吧！</p>`;
    return;
  }
  const staleNote = stale
    ? `<div class="info-box">⚠️ 資料庫有新樣本，建議重新<a href="#" id="link-analyse">分析資料庫</a>，令生成風格更準確。</div>`
    : '';
  list.innerHTML = staleNote + state.samples.map((s) => {
    const types = (s.question_types || []).map((t) => `<span class="badge type">${esc(typeById(t)?.zh || t)}</span>`).join('');
    return `<div class="sample-row">
      <div class="sample-main">
        <div class="sample-title">${esc(s.title || s.filename)} ${statusBadge(s)}</div>
        <div class="sample-meta">
          <span>📁 ${esc(s.filename)}</span>
          ${s.language !== 'unknown' ? `<span class="badge ${s.language}">${s.language === 'zh' ? '中文' : 'English'}</span>` : ''}
          ${s.level !== 'unknown' ? `<span class="badge level">${esc(levelById(s.level)?.zh || s.level)}</span>` : ''}
          <span>📝 ${s.word_count || 0} 字</span>
          <span>❓ ${s.question_count || 0} 題</span>
          ${s.error ? `<span class="badge err">${esc(s.error)}</span>` : ''}
        </div>
        <div style="margin-top:4px">${types}</div>
      </div>
      <div class="sample-actions">
        <button class="btn btn-mini" data-act="view" data-id="${s.id}">👁 預覽</button>
        <button class="btn btn-mini" data-act="reprocess" data-id="${s.id}">🔁 重新處理</button>
        <button class="btn btn-mini btn-danger" data-act="delete" data-id="${s.id}">🗑</button>
      </div>
    </div>`;
  }).join('');

  $('#link-analyse')?.addEventListener('click', (e) => { e.preventDefault(); gotoTab('analysis'); runAnalysis(); });
}

$('#samples-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'delete') {
    if (!confirm('確定刪除這個樣本？(Delete this sample?)')) return;
    await API.del(`/api/samples/${id}`);
    loadSamples();
  } else if (btn.dataset.act === 'reprocess') {
    btn.disabled = true;
    try { await API.post(`/api/samples/${id}/reprocess`); loadSamples(); }
    catch (err) { alert(err.message); btn.disabled = false; }
  } else if (btn.dataset.act === 'view') {
    const { sample, raw } = await API.get(`/api/samples/${id}`);
    const qs = (sample.questions || []).map((q) =>
      `<li><strong>${q.no}. [${esc(typeById(q.type)?.zh || q.type)}] ${esc(q.stem)}</b></strong>${q.options?.length ? `<br>選項：${q.options.map(esc).join(' / ')}` : ''}<br>答案：${esc(q.answer)}</li>`
    ).join('');
    openInfoModal(
      `${sample.title || sample.filename}`,
      `<div class="paper-meta">
         <span class="badge ${sample.language}">${sample.language === 'zh' ? '中文' : 'English'}</span>
         <span class="badge level">${esc(levelById(sample.level)?.zh || sample.level)}</span>
         <span class="badge">${sample.word_count} 字</span><span class="badge">${sample.question_count} 題</span>
       </div>
       <div class="passage-box">${esc(sample.passage_text)}</div>
       <ol style="padding-left:20px">${qs || '<li class="muted">沒有題目資料</li>'}</ol>
       ${sample.style_notes ? `<p class="paper-notes">AI 風格備註：${esc(sample.style_notes)}</p>` : ''}
       <details><summary class="muted">顯示 PDF 原始文字</summary><pre style="white-space:pre-wrap;font-size:.8rem">${esc(raw)}</pre></details>`
    );
  }
});

/* ------------------------- upload ------------------------- */
const dropzone = $('#dropzone');
const fileInput = $('#file-input');
$('#btn-choose').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files.length) doUpload(fileInput.files); fileInput.value = ''; });

['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files); });

async function doUpload(files) {
  const box = $('#upload-result');
  box.innerHTML = `<span class="spinner"></span> 上載中…（AI 正在整理，請稍候）`;
  try {
    const res = await API.upload('/api/samples/upload', files);
    const parts = [];
    if (res.added.length) parts.push(`<span class="ok">✅ 已加入 ${res.added.length} 份，AI 正在整理…</span>`);
    if (res.duplicates.length) parts.push(`<span class="warn">⚠️ ${res.duplicates.length} 份已在資料庫（重複），已跳過。</span>`);
    box.innerHTML = parts.join('<br>') || '沒有新增檔案。';
    loadSamples();
  } catch (err) {
    box.innerHTML = `<span class="error-box">${esc(err.message)}</span>`;
  }
}

$('#btn-paste-add').addEventListener('click', async () => {
  const text = $('#paste-text').value.trim();
  if (!text) return alert('請先貼上文字。');
  try {
    await API.post('/api/samples/text', { text });
    $('#paste-text').value = '';
    $('#upload-result').innerHTML = `<span class="ok">✅ 已加入，AI 正在整理…</span>`;
    loadSamples();
  } catch (err) { alert(err.message); }
});

$('#btn-refresh-samples').addEventListener('click', loadSamples);
$('#btn-analyse-top').addEventListener('click', () => { gotoTab('analysis'); runAnalysis(); });

/* ------------------------- analysis ------------------------- */
async function loadAnalysis() {
  try {
    const data = await API.get('/api/analysis');
    renderStats(data.stats);
    renderAnalysisMeta(data);
    renderProfile(data.analysis);
    $('#tab-stale-dot').classList.toggle('hidden', !data.stale);
  } catch (err) {
    $('#analysis-profile').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function renderAnalysisMeta(data) {
  const a = data.analysis;
  $('#analysis-meta').innerHTML = a
    ? `<div class="info-box">上次分析：${esc(a.generated_at)}（涵蓋 ${a.sample_count} 份樣本，語言：${(a.languages || []).join(' / ') || '-'}）${data.stale ? ' — <strong>⚠️ 資料庫已更新，建議重新分析</strong>' : ''}</div>`
    : `<div class="info-box">尚未分析資料庫。上載樣本後按「分析資料庫」，AI 會建立你的風格檔。</div>`;
}

function barBlock(title, obj, labelMap) {
  const entries = Object.entries(obj || {}).filter(([, v]) => v > 0);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `<div class="stat-box"><h3>${title}</h3>${
    entries.length ? entries.map(([k, v]) =>
      `<div class="bar-row"><span>${esc(labelMap?.[k] || k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%"></div></div><span>${v}</span></div>`
    ).join('') : '<p class="muted small">—</p>'}</div>`;
}

function renderStats(stats) {
  if (!stats) return;
  const levelMap = { p4: '小四 P4', p5: '小五 P5', p6: '小六 P6', unknown: '未定' };
  const typeMap = {};
  for (const t of state.meta?.questionTypes || []) typeMap[t.id] = t.zh;
  $('#stats-charts').innerHTML = [
    barBlock('程度分佈 Level', stats.byLevel, levelMap),
    barBlock('語言 Language', stats.byLanguage, { en: 'English', zh: '中文' }),
    barBlock('題型比例 Question types', stats.byType, typeMap),
  ].join('');
}

async function runAnalysis() {
  const btn = $('#btn-analyse');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 分析中…`;
  try {
    await API.post('/api/analysis/run', {});
    await loadAnalysis();
    $('#tab-stale-dot').classList.add('hidden');
  } catch (err) {
    $('#analysis-profile').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '分析資料庫 Analyse database';
  }
}
$('#btn-analyse').addEventListener('click', runAnalysis);

function renderProfile(analysis) {
  const box = $('#analysis-profile');
  if (!analysis?.profile) { box.innerHTML = ''; return; }
  const p = analysis.profile;
  let html = `<div class="profile-summary"><strong>📋 風格檔摘要</strong><br>${esc(p.summary || '')}</div>`;
  const langs = Object.entries(p.by_language || {});
  html += langs.map(([lang, L]) => {
    const levelCards = Object.entries(L.levels || {}).map(([lv, info]) =>
      `<div class="pattern-card">
         <h4>${esc(levelById(lv)?.zh || lv)} · ${esc(levelById(lv)?.en || '')}</h4>
         <div>${esc(info.passage_features || '')}</div>
         ${info.sentence_length_guide ? `<div class="muted small">句子：${esc(info.sentence_length_guide)}</div>` : ''}
         ${info.vocabulary_range?.length ? `<div class="muted small">詞彙：${info.vocabulary_range.map(esc).join(', ')}</div>` : ''}
       </div>`).join('');
    const patternCards = Object.entries(L.question_patterns || {}).map(([type, pat]) => {
      const t = typeById(type);
      return `<div class="pattern-card">
        <h4>${esc(t?.zh || type)} / ${esc(t?.en || '')} ${pat.share ? `<span class="badge">${esc(pat.share)}</span>` : ''}</h4>
        <div class="muted small">${esc(pat.notes || '')}</div>
        ${pat.sample_stems?.length ? `<ul>${pat.sample_stems.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        ${pat.answer_format ? `<div class="muted small">答案格式：${esc(pat.answer_format)}</div>` : ''}
      </div>`;
    }).join('');
    return `<h3 style="margin-top:18px">${lang === 'zh' ? '中文' : 'English'}</h3>
      ${L.passage_guidance ? `<p>${esc(L.passage_guidance)}</p>` : ''}
      ${L.conventions ? `<p class="muted small">格式慣例：${esc(L.conventions)}</p>` : ''}
      <div class="pattern-grid">${levelCards}</div>
      <div class="pattern-grid" style="margin-top:12px">${patternCards}</div>`;
  }).join('');
  box.innerHTML = html;
}

/* ------------------------- generate form ------------------------- */
function buildTypeGrid() {
  const grid = $('#type-grid');
  grid.innerHTML = (state.meta?.questionTypes || []).map((t) => `
    <label class="type-item on" data-type="${t.id}">
      <input type="checkbox" checked value="${t.id}">
      <span><span class="t-zh">${esc(t.zh)}</span> / ${esc(t.en)}<span class="t-desc">${esc(t.descZh)}</span></span>
    </label>`).join('');
  grid.addEventListener('change', (e) => {
    e.target.closest('.type-item').classList.toggle('on', e.target.checked);
  });
}
$('#btn-types-all').addEventListener('click', () => { $$('#type-grid input').forEach((i) => { i.checked = true; i.closest('.type-item').classList.add('on'); }); });
$('#btn-types-none').addEventListener('click', () => { $$('#type-grid input').forEach((i) => { i.checked = false; i.closest('.type-item').classList.remove('on'); }); });

function bindSegmented(id) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    $$(id + ' .seg').forEach((b) => b.classList.toggle('active', b === btn));
  });
}
const segValue = (id) => $(id + ' .seg.active')?.dataset.value;

bindSegmented('#lang-seg');
bindSegmented('#level-seg');
bindSegmented('#mode-seg');

const MODE_NOTES = {
  single: '生成一份練習。',
  variants: '一次過生成 3 份完全不同故事的練習（用同一組參數）。注意：會用 3 份 AI 額度。',
  levels: '同一個故事，分別寫成小四／小五／小六程度（適合程度差異大的班）。注意：會用 3 份 AI 額度。',
};
$('#mode-seg').addEventListener('click', () => {
  $('#mode-note').textContent = MODE_NOTES[segValue('#mode-seg')] || '';
});

// keep number inputs and sliders in sync
const sync = (a, b) => {
  $(a).addEventListener('input', () => { $(b).value = $(a).value; });
  $(b).addEventListener('input', () => { $(a).value = $(b).value; });
};
sync('#f-words', '#f-words-range');
sync('#f-questions', '#f-questions-range');

$('#gen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.genBusy) return;
  const types = $$('#type-grid input:checked').map((i) => i.value);
  const mode = segValue('#mode-seg');
  const params = {
    language: segValue('#lang-seg'),
    level: segValue('#level-seg'),
    mode,
    selfCheck: $('#f-selfcheck').checked,
    topic: $('#f-topic').value,
    theme: $('#f-theme').value,
    wordLength: Number($('#f-words').value),
    questionCount: Number($('#f-questions').value),
    types,
    extra: $('#f-extra').value,
  };
  if (!types.length) return alert('請至少選擇一種題型。');

  const count = mode === 'single' ? 1 : 3;
  state.genBusy = true;
  const btn = $('#btn-generate');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 生成中… ${count > 1 ? `(約 ${count * 45}–${count * 90} 秒)` : '（約 30–90 秒）'}`;
  $('#gen-status').innerHTML = `<div class="busy"><span class="spinner"></span><div>AI 正在撰寫${count > 1 ? `${count} 份` : ''}文章及題目${params.selfCheck ? '，之後會自動檢查答案' : ''}…<br><span class="muted small">Writing${count > 1 ? ` ${count} papers` : ' the passage and questions'} in your database's style…</span></div></div>`;
  $('#gen-hint').textContent = '';
  try {
    const result = await API.post('/api/generate', params);
    state.papers = result.papers || [];
    state.paperIndex = 0;
    state.paper = state.papers[0] || null;
    state.answersVisible = true;
    $('#gen-status').innerHTML = '';
    renderVariantTabs();
    if (state.paper) renderPaper(state.paper);
  } catch (err) {
    $('#gen-status').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  } finally {
    state.genBusy = false;
    btn.disabled = false;
    btn.innerHTML = '🚀 生成練習 Generate';
  }
});

/* ------------------------- variant tabs ------------------------- */
function renderVariantTabs() {
  const box = $('#variant-tabs');
  if (state.papers.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = state.papers.map((p, i) => {
    const badge = qualityBadge(p.quality);
    return `<button type="button" class="variant-tab${i === state.paperIndex ? ' on' : ''}" data-v="${i}">${esc(p.variantLabel || `第 ${i + 1} 份`)} ${badge}</button>`;
  }).join('');
}
$('#variant-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-v]');
  if (!btn) return;
  state.paperIndex = Number(btn.dataset.v);
  state.paper = state.papers[state.paperIndex];
  state.answersVisible = true;
  renderVariantTabs();
  renderPaper(state.paper);
});

function qualityBadge(quality) {
  if (!quality) return '';
  if (quality.error) return `<span class="q-badge q-warn" title="${esc(quality.error)}">檢查失敗</span>`;
  const s = Number(quality.score);
  const cls = s >= 90 ? 'q-good' : s >= 75 ? 'q-warn' : 'q-bad';
  const issues = (quality.issues || []).length ? `\n問題：${quality.issues.join('\n')}` : '';
  return `<span class="q-badge ${cls}" title="${esc(`AI 質量分 ${s}/100${issues}`)}">質量 ${s}</span>`;
}

/* ------------------------- paper rendering ------------------------- */
function renderPaper(paper) {
  const lang = paper.language || paper.params?.language || 'en';
  const level = paper.params?.level;
  const types = [...new Set((paper.questions || []).map((q) => q.type))];
  const totalMarks = (paper.questions || []).reduce((s, q) => s + (q.marks || 1), 0);

  let lastInstruction = '';
  const questionsHtml = (paper.questions || []).map((q) => {
    const t = typeById(q.type);
    let head = '';
    if (q.instruction && q.instruction !== lastInstruction) {
      lastInstruction = q.instruction;
      head = `<div class="q-group-title">${esc(q.instruction)}</div>`;
    }
    const options = q.options?.length
      ? `<ul class="q-options">${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`
      : '';
    return `${head}<div class="question">
      <div class="q-head"><span class="q-no">${q.no}.</span> <span class="badge type">${esc(t?.zh || q.type)}</span> <span class="badge">${q.marks || 1} 分</span></div>
      <p class="q-stem">${esc(q.stem)}</p>
      ${options}
      <div class="answer"><strong>答案 Answer：</strong>${esc(q.answer)}${q.explanation ? `<span class="exp">說明：${esc(q.explanation)}</span>` : ''}</div>
    </div>`;
  }).join('');

  $('#gen-result').innerHTML = `
    <div class="paper" id="current-paper">
      <h3>${esc(paper.title || 'Reading Comprehension')}</h3>
      <div class="paper-meta">
        <span class="badge ${lang}">${lang === 'zh' ? '中文' : 'English'}</span>
        <span class="badge level">${esc(levelById(level)?.zh || level || '')}</span>
        <span class="badge">約 ${paper.wordCount} 字</span>
        <span class="badge">${(paper.questions || []).length} 題 · ${totalMarks} 分</span>
        ${types.map((t) => `<span class="badge type">${esc(typeById(t)?.zh || t)}</span>`).join('')}
        ${qualityBadge(paper.quality)}
      </div>
      ${paper.quality?.issues?.length
        ? `<ul class="q-issues">${paper.quality.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : ''}
      ${paper.quality?.fixesApplied ? `<p class="muted small">AI 自動修正了 ${paper.quality.fixesApplied} 個答案/題目。</p>` : ''}
      <div class="passage-box">${esc(paper.passage)}</div>
      ${questionsHtml}
      ${paper.notes ? `<div class="paper-notes">💡 ${esc(paper.notes)}</div>` : ''}
    </div>`;
  updateAnswerToggle();
}

/* ------------------------- export / share / results ------------------------- */
const currentPaperId = () => state.paper?.id;

for (const [sel, version] of [['#btn-docx-student', 'student'], ['#btn-docx-teacher', 'teacher']]) {
  $(sel).addEventListener('click', () => {
    if (!currentPaperId()) return alert('請先生成練習。');
    window.open(`/api/papers/${currentPaperId()}/docx?version=${version}`, '_blank');
  });
}

$('#btn-share').addEventListener('click', async (e) => {
  const id = currentPaperId();
  if (!id) return alert('請先生成練習。');
  const btn = e.currentTarget;
  try {
    const { url } = await API.post(`/api/papers/${id}/share`, {});
    const full = location.origin + url;
    await navigator.clipboard.writeText(full);
    btn.textContent = '✅ 已複製連結';
    setTimeout(() => (btn.textContent = '🧑‍🎓 學生連結'), 2000);
  } catch (err) { alert(err.message); }
});

$('#btn-results').addEventListener('click', async () => {
  const id = currentPaperId();
  if (!id) return alert('請先生成練習。');
  const { submissions } = await API.get(`/api/papers/${id}/submissions`);
  if (!submissions.length) {
    return openInfoModal('📊 學生成績', `<p class="muted">還沒有學生交卷。<br>按「🧑‍🎓 學生連結」複製連結發給學生，他們交卷後成績會即時顯示在這裡。</p>`);
  }
  const rows = submissions.map((s) => {
    const pct = s.maxScore ? Math.round((s.score / s.maxScore) * 100) : 0;
    return `<div class="history-row">
      <div><strong>${esc(s.student || '匿名')}</strong>
        <div class="sample-meta"><span>${s.score} / ${s.maxScore} 分（${pct}%）</span><span>${esc(s.createdAt)}</span></div>
      </div>
      <div>${(s.marking?.perQuestion || []).map((q) => `<span class="badge ${q.correct ? 'type' : 'err'}">${q.no}</span>`).join('')}</div>
    </div>`;
  }).join('');
  openInfoModal('📊 學生成績', `<p class="muted small">共 ${submissions.length} 人交卷</p>${rows}`);
});

function updateAnswerToggle() {
  $('#current-paper')?.classList.toggle('hide-answers', !state.answersVisible);
  $('#btn-toggle-answers').textContent = state.answersVisible ? '🙈 隱藏答案' : '🙈 顯示答案';
}
$('#btn-toggle-answers').addEventListener('click', () => { state.answersVisible = !state.answersVisible; updateAnswerToggle(); });

function paperToMarkdown(paper) {
  const lang = paper.language || paper.params?.language || 'en';
  const totalMarks = (paper.questions || []).reduce((s, q) => s + (q.marks || 1), 0);
  let lastInstruction = '';
  const lines = [`# ${paper.title || 'Reading Comprehension'}`, '',
    `語言：${lang === 'zh' ? '中文' : 'English'} · 程度：${levelById(paper.params?.level)?.zh || '-'} · 約 ${paper.wordCount} 字 · ${(paper.questions || []).length} 題（${totalMarks} 分）`, '',
    paper.passage, '', '---', ''];
  for (const q of paper.questions || []) {
    if (q.instruction && q.instruction !== lastInstruction) { lastInstruction = q.instruction; lines.push(`**${q.instruction}**`, ''); }
    lines.push(`**${q.no}.** ${q.stem}  \`[${q.marks || 1} 分]\``);
    if (q.options?.length) q.options.forEach((o) => lines.push(`   - ${o}`));
    lines.push(`   **答案：** ${q.answer}${q.explanation ? `（${q.explanation}）` : ''}`, '');
  }
  if (paper.notes) lines.push('---', `💡 ${paper.notes}`);
  return lines.join('\n');
}

$('#btn-copy').addEventListener('click', async () => {
  if (!state.paper) return;
  await navigator.clipboard.writeText(paperToMarkdown(state.paper));
  const b = $('#btn-copy'); b.textContent = '✅ 已複製'; setTimeout(() => (b.textContent = '📋 複製'), 1500);
});

$('#btn-md').addEventListener('click', () => {
  if (!state.paper) return;
  const blob = new Blob([paperToMarkdown(state.paper)], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.paper.title || 'comprehension').replace(/[\\/:*?"<>|]+/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#btn-print').addEventListener('click', () => {
  if (!state.paper) return;
  printElement($('#current-paper'));
});

function printElement(el) {
  if (!el) return;
  const prevId = el.id;
  el.id = 'print-area';
  const restore = () => { el.id = prevId || ''; window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
  setTimeout(restore, 1500);
}

/* ------------------------- history ------------------------- */
async function loadHistory() {
  try {
    const { items } = await API.get('/api/history');
    const box = $('#history-list');
    if (!items.length) { box.innerHTML = '<p class="muted">還沒有生成過練習。</p>'; return; }
    box.innerHTML = items.map((h) => {
      const level = levelById(h.params?.level)?.zh || '';
      return `
      <div class="history-row">
        <div>
          <strong>${esc(h.title || '無標題')}</strong>
          ${h.setId ? `<span class="badge">${h.variantNo > 1 ? `第 ${h.variantNo} 份` : '套裝 set'}</span>` : ''}
          ${qualityBadge(h.quality)}
          <div class="sample-meta">
            <span class="badge ${h.language}">${h.language === 'zh' ? '中文' : 'English'}</span>
            ${level ? `<span class="badge level">${esc(level)}</span>` : ''}
            <span>約 ${h.wordCount} 字</span><span>${h.questionCount} 題</span><span>${esc(h.createdAt)}</span>
            ${h.submissions ? `<span class="badge type">🧑‍🎓 ${h.submissions} 人交卷</span>` : ''}
            ${h.shareToken ? `<span class="badge">🔗 已分享</span>` : ''}
          </div>
        </div>
        <div class="sample-actions">
          <button class="btn btn-mini" data-hact="open" data-id="${h.id}">👁 開啟</button>
          <button class="btn btn-mini" data-hact="docx" data-id="${h.id}">⬇️ Word</button>
          <button class="btn btn-mini" data-hact="share" data-id="${h.id}">🔗 連結</button>
          <button class="btn btn-mini" data-hact="results" data-id="${h.id}">📊 成績</button>
          <button class="btn btn-mini" data-hact="print" data-id="${h.id}">🖨️</button>
          <button class="btn btn-mini btn-danger" data-hact="delete" data-id="${h.id}">🗑</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    $('#history-list').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

$('#btn-refresh-history').addEventListener('click', loadHistory);

$('#history-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-hact]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.hact;

  if (act === 'delete') {
    if (!confirm('確定刪除？')) return;
    await API.del(`/api/history/${id}`);
    loadHistory();
  } else if (act === 'docx') {
    window.open(`/api/papers/${id}/docx?version=teacher`, '_blank');
  } else if (act === 'share') {
    try {
      const { url } = await API.post(`/api/papers/${id}/share`, {});
      await navigator.clipboard.writeText(location.origin + url);
      btn.textContent = '✅ 已複製';
      setTimeout(() => (btn.textContent = '🔗 連結'), 1500);
      loadHistory();
    } catch (err) { alert(err.message); }
  } else if (act === 'results') {
    const { submissions } = await API.get(`/api/papers/${id}/submissions`);
    openInfoModal('📊 學生成績', submissions.length
      ? `<p class="muted small">共 ${submissions.length} 人交卷</p>` + submissions.map((s) => `
          <div class="history-row"><div><strong>${esc(s.student || '匿名')}</strong>
          <div class="sample-meta"><span>${s.score} / ${s.maxScore} 分</span><span>${esc(s.createdAt)}</span></div></div>
          <div>${(s.marking?.perQuestion || []).map((q) => `<span class="badge ${q.correct ? 'type' : 'err'}">${q.no}</span>`).join('')}</div></div>`).join('')
      : '<p class="muted">還沒有學生交卷。</p>');
  } else if (act === 'print') {
    const { paper } = await API.get(`/api/history/${id}`);
    paper.params = paper.params || {};
    state.papers = [paper]; state.paperIndex = 0; state.paper = paper; state.answersVisible = true;
    renderPaper(paper);
    printElement($('#current-paper'));
  } else {
    const { paper } = await API.get(`/api/history/${id}`);
    paper.params = paper.params || {};
    state.papers = [paper];
    state.paperIndex = 0;
    state.paper = paper;
    state.answersVisible = true;
    renderVariantTabs();
    renderPaper(paper);
    gotoTab('generate');
  }
});

/* ------------------------- settings modal ------------------------- */
const modal = $('#settings-modal');

function renderProviderChips(matchUrl = '') {
  const box = $('#provider-chips');
  const providers = state.meta?.providers || [];
  box.innerHTML = providers
    .map((p) => `<button type="button" class="provider-chip${matchUrl && p.baseUrl === matchUrl ? ' on' : ''}" data-provider="${p.id}">${esc(p.label)}</button>`)
    .join('');
}

function applyProvider(id) {
  const p = (state.meta?.providers || []).find((x) => x.id === id);
  if (!p) return;
  $('#s-base').value = p.baseUrl;
  $('#s-model').value = p.model;
  $('#provider-note').textContent = p.note;
  renderProviderChips(p.baseUrl);
  $('#test-result').innerHTML = '';
}

$('#provider-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-provider]');
  if (btn) applyProvider(btn.dataset.provider);
});
$('#s-base').addEventListener('input', () => renderProviderChips($('#s-base').value.trim()));

$('#btn-settings').addEventListener('click', async () => {
  const cfg = await API.get('/api/config');
  $('#s-base').value = cfg.baseUrl || '';
  $('#s-model').value = cfg.model || '';
  $('#s-key').value = '';
  $('#s-key').placeholder = cfg.keyMasked ? `已設定（${cfg.keyMasked}）— 輸入以取代` : 'sk-…';
  $('#settings-status').textContent = '';
  $('#test-result').innerHTML = '';
  renderProviderChips((cfg.baseUrl || '').replace(/\/+$/, ''));
  modal.classList.remove('hidden');
});
$('#btn-close-settings').addEventListener('click', () => modal.classList.add('hidden'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

function settingsPayload() {
  const body = { baseUrl: $('#s-base').value.trim(), model: $('#s-model').value.trim() };
  const key = $('#s-key').value.trim();
  if (key) body.apiKey = key;
  return body;
}

$('#btn-save-settings').addEventListener('click', async () => {
  try {
    const cfg = await API.post('/api/config', settingsPayload());
    renderAiBadge(cfg);
    $('#settings-status').textContent = '✅ 已儲存';
    setTimeout(() => modal.classList.add('hidden'), 700);
  } catch (err) {
    $('#settings-status').textContent = `❌ ${err.message}`;
  }
});

// Real connection test with whatever is in the form right now (saved or not).
$('#btn-test-settings').addEventListener('click', async () => {
  const btn = $('#btn-test-settings');
  const out = $('#test-result');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 測試中…`;
  out.innerHTML = '';
  try {
    const r = await API.post('/api/config/test', settingsPayload());
    out.innerHTML = r.ok
      ? `<div class="test-ok">✅ 連接成功！模型 <strong>${esc(r.model)}</strong> 回覆：${esc(r.sample || 'OK')}<br>按「💾 儲存」正式生效。</div>`
      : `<div class="test-fail">❌ 測試失敗${r.status ? `（HTTP ${r.status}）` : ''}<br>${esc(r.hint || '')}</div>`;
  } catch (err) {
    out.innerHTML = `<div class="test-fail">❌ ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔌 測試連接 Test';
  }
});

/* ------------------------- info modal ------------------------- */
function openInfoModal(title, html) {
  let box = $('#info-modal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'info-modal';
    box.className = 'modal';
    box.innerHTML = `<div class="modal-box"><div class="card-head"><h2 id="info-title"></h2><button class="btn btn-ghost" id="info-close">✕</button></div><div id="info-body"></div></div>`;
    document.body.appendChild(box);
    box.querySelector('#info-close').addEventListener('click', () => box.classList.add('hidden'));
    box.addEventListener('click', (e) => { if (e.target === box) box.classList.add('hidden'); });
  }
  box.querySelector('#info-title').textContent = title;
  box.querySelector('#info-body').innerHTML = html;
  box.classList.remove('hidden');
}

/* ------------------------- init ------------------------- */
const autoBox = $('#auto-analyse');
autoBox.addEventListener('change', async () => {
  try { await API.post('/api/config', { autoAnalyse: autoBox.checked }); } catch { /* ignore */ }
});
async function loadAutoSetting() {
  try { const cfg = await API.get('/api/config'); autoBox.checked = cfg.autoAnalyse !== false; } catch { /* ignore */ }
}

function loadOcrSetting() {
  const sel = $('#ocr-lang');
  if (!sel) return;
  sel.innerHTML = (state.meta.ocrLanguages || []).map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join('');
  sel.value = state.meta.ocrLanguage || 'eng+chi_tra';
  sel.addEventListener('change', async () => {
    try { await API.post('/api/config/ocr', { language: sel.value }); } catch { /* ignore */ }
  });
}

async function init() {
  try {
    state.meta = await API.get('/api/meta');
    renderAiBadge(state.meta.ai);
    buildTypeGrid();
  } catch (err) {
    $('#samples-list').innerHTML = `<div class="error-box">無法連接本地伺服器：${esc(err.message)}</div>`;
    return;
  }
  loadSamples();
  loadAnalysis();
  loadHistory();
  loadAutoSetting();
  loadOcrSetting();
  if (!state.meta.ai.configured) {
    $('#gen-hint').textContent = '提示：尚未設定 AI API Key，請按右上角「⚙️ 設定」。';
  }
}
init();
