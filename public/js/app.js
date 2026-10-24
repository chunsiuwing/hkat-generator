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
  typeCounts: {},     // per-type question counts for the active language: { typeId: n }
  editMode: false,    // inline editing of the current paper
  bank: { items: [], page: 1, total: 0, pageSize: 50, selected: [] },
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeById = (id) => state.meta?.questionTypes.find((t) => t.id === id);

// Label for ANY category id across both taxonomies (samples may use Chinese ids).
function typeLabelAny(id) {
  const cats = state.meta?.categories;
  if (cats) {
    const en = (cats.en || []).find((t) => t.id === id);
    if (en) return en.zh;
    for (const g of cats.zh || []) {
      const zh = (g.items || []).find((t) => t.id === id);
      if (zh) return zh.zh;
    }
  }
  return typeById(id)?.zh || id;
}
const levelById = (id) => state.meta?.levels.find((l) => l.id === id);

/* ------------------------- tabs ------------------------- */
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'bank') { bankTypeOptions(); loadBank(); }
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
    const types = (s.question_types || []).map((t) => `<span class="badge type">${esc(typeLabelAny(t))}</span>`).join('');
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
      `<li><strong>${q.no}. [${esc(typeLabelAny(q.type))}] ${esc(q.stem)}</b></strong>${q.options?.length ? `<br>選項：${q.options.map(esc).join(' / ')}` : ''}<br>答案：${esc(q.answer)}</li>`
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
    camLog('upload-failed', err.message);
    box.innerHTML = `<span class="error-box">${esc(err.message)}</span>`;
  }
}

/* ------------------------- camera capture (OCR) ------------------------- */
const camModal = $('#camera-modal');
const camVideo = $('#camera-video');
const camCanvas = $('#camera-canvas');
let camStream = null;

/* Diagnostic beacon: report every camera milestone/error to the server so the
   teacher's failures can be diagnosed remotely (read via GET /api/camera-log). */
function camLog(step, detail) {
  try {
    fetch('/api/camera-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step, detail: String(detail || '').slice(0, 300), ua: navigator.userAgent.slice(0, 160) }),
    }).catch(() => {});
  } catch { /* never break the UI for logging */ }
}

/* Sample a tiny frame and check whether it is (near) uniformly black — the
   classic "camera covered / held by another app" symptom. */
function frameLooksBlack(video) {
  try {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 18;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, 32, 18);
    const d = ctx.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    const avg = sum / ((d.length / 4) * 3);
    return avg < 12;
  } catch { return false; }
}

/* The browser can refuse the camera for a few different reasons, and each
   needs a different message / fallback. */
function cameraErrorInfo(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      title: '相機權限被拒絕 Camera permission denied',
      body: '瀏覽器之前拒絕咗呢個網站攞相機，所以而家唔會再彈提示，直接封鎖。\n\n點樣解鎖（兩邊都要檢查）：\n【瀏覽器】\n1. 撳網址列左邊嘅「🔒」或「👁」圖示\n2. 揀「相機 Camera」→ 改做「允許 Allow」\n3. 按「🔁 重試」再試一次\n\n【Windows 私隱設定】（如果上面都冇用）\n設定 → 私隱 → 相機 → 開啟「允許應用程式存取相機」同「允許桌面應用程式存取相機」',
      recoverable: true,
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return {
      title: '搵唔到相機 No camera found',
      body: '呢部電腦／裝置似乎冇接駁相機，或者相機俾其他程式佔用緊。',
      recoverable: false,
    };
  }
  return {
    title: '開唔到相機 Could not open the camera',
    body: err?.message || '未知錯誤 unknown error',
    recoverable: false,
  };
}

/* No usable webcam in-browser → let the teacher use the phone's camera app
   (capture attribute) or just pick an existing photo file. */
function fallbackToFilePicker() {
  const fb = $('#camera-fallback');
  if (fb) { fb.classList.remove('hidden'); return; }
  alert('開唔到瀏覽器相機。你可以改用「選擇檔案」上載相片，或用手機瀏覽器直接影相。');
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    camLog('no-mediaDevices', navigator.userAgent);
    fallbackToFilePicker();
    return;
  }
  camModal.classList.remove('hidden');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    camLog('stream-opened', `tracks=${camStream.getTracks().length}`);
    camVideo.srcObject = camStream;
    camVideo.classList.remove('hidden');
    $('#camera-error')?.classList.add('hidden');
    $('#camera-fallback')?.classList.add('hidden');

    // If the device dies right after opening (busy/occupied), tell the teacher
    // immediately instead of showing a frozen/black preview.
    const track = camStream.getVideoTracks()[0];
    if (track) track.addEventListener('ended', () => {
      camLog('track-ended', `${track.label || 'video'} readyState=${track.readyState}`);
      camVideo.classList.add('hidden');
      const box = $('#camera-error');
      if (box) {
        box.innerHTML = '<strong>相機訊號中斷 Camera track ended</strong>\n鏡頭開咗但訊號即刻斷咗——通常係俾另一個程式佔用緊（例如另一個開住 webcam 的分頁／視像程式）。關掉嗰邊再撳「🔁 重試」。';
        box.classList.remove('hidden');
      }
      $('#camera-fallback')?.classList.remove('hidden');
    });

    // Watchdog: stream granted but no frames (or only black frames) → surface it.
    setTimeout(() => {
      if (!camStream || camVideo.srcObject !== camStream) return;
      const box = $('#camera-error');
      if (!camVideo.videoWidth) {
        camLog('no-frames', `readyState=${camVideo.readyState} trackState=${track?.readyState}`);
        if (box) {
          box.innerHTML = '<strong>相機開咗但冇畫面 No video frames</strong>\n權限正常，但鏡頭冇送畫面上嚟（可能被其他程式佔用，或驅動暫時無回應）。試下關閉其他用相機的程式，再撳「🔁 重試」。';
          box.classList.remove('hidden');
        }
        $('#camera-fallback')?.classList.remove('hidden');
        return;
      }
      if (frameLooksBlack(camVideo)) {
        camLog('black-frame', `w=${camVideo.videoWidth} h=${camVideo.videoHeight}`);
        if (box) {
          box.innerHTML = '<strong>鏡頭有訊號但畫面全黑 Camera shows a black frame</strong>\n最常見原因：鏡頭被遮住（laptop 隱私滑蓋／貼紙）、或俾另一個程式霸住咗鏡頭。\n① 開 Windows「相機」App 睇吓有冇畫面 ② 閂晒其他用緊相機的分頁／程式 ③ 再撳「🔁 重試」。';
          box.classList.remove('hidden');
        }
        $('#camera-fallback')?.classList.remove('hidden');
      }
    }, 3000);
  } catch (err) {
    camLog('getusermedia-failed', `${err?.name}: ${err?.message}`);
    // Stop any partial stream but KEEP the modal open so the teacher can read
    // the fix instructions (closing it would hide the message).
    if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
    camVideo.srcObject = null;
    camVideo.classList.add('hidden');
    const info = cameraErrorInfo(err);
    const box = $('#camera-error');
    if (box) {
      box.innerHTML = `<strong>${esc(info.title)}</strong>\n${esc(info.body)}${
        info.recoverable
          ? '\n\n改好權限後撳「🔁 重試」再試一次。'
          : '\n\n你可以改用下面嘅「選擇已影嘅相」上載相片。'
      }`;
      box.classList.remove('hidden');
      $('#camera-fallback')?.classList.remove('hidden');
    } else {
      closeCamera();
      alert(`${info.title}\n${info.body}`);
    }
  }
}

function closeCamera() {
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  camVideo.srcObject = null;
  $('#camera-error')?.classList.add('hidden');
  $('#camera-fallback')?.classList.add('hidden');
  camModal.classList.add('hidden');
}

function capturePhoto() {
  const w = camVideo.videoWidth, h = camVideo.videoHeight;
  if (!w || !h) {
    camLog('capture-no-frames', `readyState=${camVideo.readyState}`);
    return alert('相機仲未准备好，請再試一次。');
  }
  if (frameLooksBlack(camVideo)) {
    camLog('capture-black', `${w}x${h}`);
    const go = confirm('畫面睇落係全黑——相片可能冇任何內容（鏡頭被遮？），上傳咗都抽唔到文字。\n\n仍然要上傳嗎？\n（撳「取消」→ 推開鏡頭遮擋／閂其他用相機的程式 → 🔁 重試）');
    if (!go) return;
  }
  camCanvas.width = w; camCanvas.height = h;
  camCanvas.getContext('2d').drawImage(camVideo, 0, 0, w, h);
  camCanvas.toBlob((blob) => {
    if (!blob) {
      camLog('capture-blob-failed', `${w}x${h}`);
      return alert('影相失敗，請再試一次。');
    }
    camLog('captured', `${w}x${h} bytes=${blob.size}`);
    closeCamera();
    doUpload([new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
  }, 'image/jpeg', 0.9);
}

$('#btn-camera').addEventListener('click', () => {
  $('#camera-error')?.classList.add('hidden');
  openCamera();
});
$('#btn-camera-cancel').addEventListener('click', closeCamera);
$('#btn-capture').addEventListener('click', capturePhoto);
$('#btn-camera-retry').addEventListener('click', () => {
  $('#camera-error')?.classList.add('hidden');
  $('#camera-fallback')?.classList.add('hidden');
  openCamera();
});
$('#camera-mobile-input').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  closeCamera();
  doUpload([f]);
});
$('#btn-camera-fallback-choose')?.addEventListener('click', () => {
  $('#camera-fallback')?.classList.add('hidden');
  $('#file-input')?.click();
});

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
  const cats = state.meta?.categories || { en: [], zh: [] };
  const enMap = {};
  for (const c of cats.en || []) enMap[c.id] = c.zh;
  const zhMap = {};
  for (const g of cats.zh || []) for (const c of g.items || []) zhMap[c.id] = c.zh;
  // byType is now { en: {...}, zh: {...} } — one block per language's own taxonomy.
  const byType = stats.byType || {};
  const blocks = [
    barBlock('程度分佈 Level', stats.byLevel, levelMap),
    barBlock('語言 Language', stats.byLanguage, { en: 'English', zh: '中文' }),
  ];
  if (byType.en && Object.values(byType.en).some((v) => v > 0)) {
    blocks.push(barBlock('英文題型分佈 English question types', byType.en, enMap));
  }
  if (byType.zh && Object.values(byType.zh).some((v) => v > 0)) {
    blocks.push(barBlock('中文題型分佈 Chinese question types', byType.zh, zhMap));
  }
  $('#stats-charts').innerHTML = blocks.join('');
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
  // Label lookup within ONE language's own taxonomy.
  const catLabel = (lang, id) => {
    const cats = state.meta?.categories || {};
    const list = lang === 'zh' ? (cats.zh || []).flatMap((g) => g.items || []) : (cats.en || []);
    const c = list.find((x) => x.id === id);
    return c ? `${c.zh}${c.en ? ' / ' + c.en : ''}` : id;
  };
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
    const patternCards = Object.entries(L.question_patterns || {}).map(([type, pat]) =>
      `<div class="pattern-card">
        <h4>${esc(catLabel(lang, type))} ${pat.share ? `<span class="badge">${esc(pat.share)}</span>` : ''}</h4>
        <div class="muted small">${esc(pat.notes || '')}</div>
        ${pat.sample_stems?.length ? `<ul>${pat.sample_stems.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        ${pat.answer_format ? `<div class="muted small">答案格式：${esc(pat.answer_format)}</div>` : ''}
      </div>`).join('');
    return `<h3 style="margin-top:18px">${lang === 'zh' ? '中文' : 'English'}</h3>
      ${L.passage_guidance ? `<p>${esc(L.passage_guidance)}</p>` : ''}
      ${L.conventions ? `<p class="muted small">格式慣例：${esc(L.conventions)}</p>` : ''}
      <div class="pattern-grid">${levelCards}</div>
      <div class="pattern-grid" style="margin-top:12px">${patternCards}</div>`;
  }).join('');
  box.innerHTML = html;
}

/* ------------------------- generate form ------------------------- */
// Per-language taxonomy: English → 11 flat categories, Chinese → 12 in 4 groups.
// Each type gets a count stepper (0 = not included). Total is the auto-sum.
function currentLanguage() { return segValue('#lang-seg') || 'en'; }

// Flatten the active language's categories into [{id, zh, en, descZh, group}]
function activeCategories(lang) {
  const cats = state.meta?.categories;
  if (!cats) return (state.meta?.questionTypes || []).map((t) => ({ ...t, group: null }));
  if (lang === 'zh') {
    return (cats.zh || []).flatMap((g) => (g.items || []).map((it) => ({ ...it, group: g.zh })));
  }
  return (cats.en || []).map((it) => ({ ...it, group: null }));
}

function typeRow(c, count) {
  const on = count > 0 ? 'on' : '';
  return `<label class="type-item ${on}" data-type="${c.id}">
    <input type="checkbox" ${count > 0 ? 'checked' : ''} value="${c.id}">
    <span class="type-text">
      <span class="t-zh">${esc(c.zh)}</span>${c.en ? ` / ${esc(c.en)}` : ''}
      ${c.descZh ? `<span class="t-desc">${esc(c.descZh)}</span>` : ''}
    </span>
    <span class="count-stepper">
      <button type="button" class="step" data-dir="-1" aria-label="減少">−</button>
      <input type="number" class="t-count" min="0" max="10" value="${count}" data-id="${c.id}">
      <button type="button" class="step" data-dir="1" aria-label="增加">＋</button>
    </span>
  </label>`;
}

function renderTypeGrid() {
  const grid = $('#type-grid');
  const lang = currentLanguage();
  const list = activeCategories(lang);
  const counts = state.typeCounts || {};
  let html = '';
  let lastGroup = Symbol();
  for (const c of list) {
    if (c.group && c.group !== lastGroup) {
      lastGroup = c.group;
      html += `<div class="type-group-head">${esc(c.group)}</div>`;
    }
    html += typeRow(c, counts[c.id] || 0);
  }
  grid.innerHTML = html;
  syncTotal();
}

function readTypeCounts() {
  const counts = {};
  $$('#type-grid .t-count').forEach((inp) => {
    const n = Math.max(0, Math.min(10, Math.round(Number(inp.value) || 0)));
    if (n > 0) counts[inp.dataset.id] = n;
  });
  return counts;
}

function syncTotal() {
  const total = Object.values(readTypeCounts()).reduce((a, b) => a + b, 0);
  $('#f-total').textContent = total;
  $('#f-total').classList.toggle('zero', total === 0);
  return total;
}

// Grid interactions: checkbox toggles 0↔1, steppers adjust, typing updates.
$('#type-grid').addEventListener('change', (e) => {
  const item = e.target.closest('.type-item');
  if (!item) return;
  if (e.target.matches('.t-count')) {
    const n = Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0)));
    e.target.value = n;
    item.classList.toggle('on', n > 0);
    item.querySelector('input[type=checkbox]').checked = n > 0;
  } else if (e.target.matches('input[type=checkbox]')) {
    item.classList.toggle('on', e.target.checked);
    const inp = item.querySelector('.t-count');
    inp.value = e.target.checked ? (Number(inp.value) > 0 ? inp.value : 1) : 0;
  }
  syncTotal();
});

$('#type-grid').addEventListener('click', (e) => {
  const step = e.target.closest('.step');
  if (!step) return;
  e.preventDefault();
  const item = step.closest('.type-item');
  const inp = item.querySelector('.t-count');
  const n = Math.max(0, Math.min(10, (Number(inp.value) || 0) + Number(step.dataset.dir)));
  inp.value = n;
  item.classList.toggle('on', n > 0);
  item.querySelector('input[type=checkbox]').checked = n > 0;
  syncTotal();
});

$('#btn-types-all').addEventListener('click', () => {
  $$('#type-grid .type-item').forEach((item) => {
    const inp = item.querySelector('.t-count');
    inp.value = 1;
    item.classList.add('on');
    item.querySelector('input[type=checkbox]').checked = true;
  });
  syncTotal();
});
$('#btn-types-none').addEventListener('click', () => {
  $$('#type-grid .type-item').forEach((item) => {
    item.querySelector('.t-count').value = 0;
    item.classList.remove('on');
    item.querySelector('input[type=checkbox]').checked = false;
  });
  syncTotal();
});

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

// keep the words slider/number in sync (total questions is auto-summed, not editable)
const sync = (a, b) => {
  $(a).addEventListener('input', () => { $(b).value = $(a).value; });
  $(b).addEventListener('input', () => { $(a).value = $(b).value; });
};
sync('#f-words', '#f-words-range');

// switching language swaps the taxonomy; reset counts for the new set
$('#lang-seg').addEventListener('click', () => { state.typeCounts = {}; renderTypeGrid(); });

// passage source: AI-written vs teacher-supplied (questions only)
function currentSource() { return segValue('#src-seg') || 'ai'; }
bindSegmented('#src-seg');
$('#src-seg').addEventListener('click', () => {
  const own = currentSource() === 'own';
  $('#own-passage-box').classList.toggle('hidden', !own);
  $('#ai-only-fields').classList.toggle('hidden', own);
});

$('#gen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.genBusy) return;
  const typeCounts = readTypeCounts();
  const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
  if (!total) return alert('請至少為一種題型設定題數（≥1）。');
  const mode = segValue('#mode-seg');
  const ownPassage = currentSource() === 'own';
  const passage = $('#f-passage').value.trim();
  if (ownPassage && passage.replace(/\s/g, '').length < 80) return alert('請先貼上文章（至少約 80 字）。');
  const params = {
    language: segValue('#lang-seg'),
    level: segValue('#level-seg'),
    mode,
    selfCheck: $('#f-selfcheck').checked,
    topic: ownPassage ? '' : $('#f-topic').value,
    theme: ownPassage ? '' : $('#f-theme').value,
    wordLength: Number($('#f-words').value),
    typeCounts,
    extra: $('#f-extra').value,
    ...(ownPassage ? { passage } : {}),
  };

  const count = mode === 'single' ? 1 : 3;
  state.genBusy = true;
  const btn = $('#btn-generate');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 生成中… ${count > 1 ? `(約 ${count * 45}–${count * 90} 秒)` : '（約 30–90 秒）'}`;
  $('#gen-status').innerHTML = `<div class="busy"><span class="spinner"></span><div>AI 正在為你嘅文章撰寫${count > 1 ? `${count} 份` : ''}題目${params.selfCheck ? '，之後會自動檢查答案' : ''}…<br><span class="muted small">${ownPassage ? 'Writing questions for YOUR passage' : 'Writing the passage and questions'}${count > 1 ? ` (${count} papers)` : ''} in your database's style…</span></div></div>`;
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
function renderPaper(paper, { edit = false } = {}) {
  const lang = paper.language || paper.params?.language || 'en';
  const level = paper.params?.level;
  // count questions per type so the badges can show e.g. "主旨歸納 ×3"
  const typeCounts = (paper.questions || []).reduce((m, q) => { m[q.type] = (m[q.type] || 0) + 1; return m; }, {});
  const types = Object.keys(typeCounts);
  const totalMarks = (paper.questions || []).reduce((s, q) => s + (q.marks || 1), 0);

  let lastInstruction = '';
  const questionsHtml = (paper.questions || []).map((q, idx) => {
    if (edit) {
      return `<div class="question editing" data-idx="${idx}">
        <div class="q-head">
          <span class="q-no">${idx + 1}.</span> <span class="badge type">${esc(typeLabelAny(q.type))}</span>
          <label class="edit-marks">分數 <input type="number" class="e-marks" min="1" max="5" value="${q.marks || 1}"></label>
          <span class="edit-tools">
            <button type="button" class="btn btn-mini e-up" title="上移 move up">▲</button>
            <button type="button" class="btn btn-mini e-down" title="下移 move down">▼</button>
            <button type="button" class="btn btn-mini e-del" title="刪除 delete">🗑</button>
          </span>
        </div>
        <label class="edit-label">組別指示 Instruction（同上一題相同可留空）<input type="text" class="e-inst" value="${esc(q.instruction)}"></label>
        <label class="edit-label">題目 Stem<textarea class="e-stem" rows="2">${esc(q.stem)}</textarea></label>
        ${q.options?.length || !q.answer ? `<label class="edit-label">選項 Options（每行一個 / one per line）<textarea class="e-opts" rows="${Math.max(2, (q.options || []).length)}">${esc((q.options || []).join('\n'))}</textarea></label>` : ''}
        <label class="edit-label">答案 Answer<input type="text" class="e-ans" value="${esc(q.answer)}"></label>
        <label class="edit-label">說明 Explanation<em class="opt">(選填)</em><input type="text" class="e-exp" value="${esc(q.explanation || '')}"></label>
      </div>`;
    }
    let head = '';
    if (q.instruction && q.instruction !== lastInstruction) {
      lastInstruction = q.instruction;
      head = `<div class="q-group-title">${esc(q.instruction)}</div>`;
    }
    const options = q.options?.length
      ? `<ul class="q-options">${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`
      : '';
    return `${head}<div class="question">
      <div class="q-head"><span class="q-no">${q.no}.</span> <span class="badge type">${esc(typeLabelAny(q.type))}</span> <span class="badge">${q.marks || 1} 分</span></div>
      <p class="q-stem">${esc(q.stem)}</p>
      ${options}
      <div class="answer"><strong>答案 Answer：</strong>${esc(q.answer)}${q.explanation ? `<span class="exp">說明：${esc(q.explanation)}</span>` : ''}</div>
    </div>`;
  }).join('');

  const titleHtml = edit
    ? `<input type="text" id="edit-title" class="edit-title" value="${esc(paper.title || '')}">`
    : `<h3>${esc(paper.title || 'Reading Comprehension')}</h3>`;
  const passageHtml = edit
    ? `<textarea id="edit-passage" class="edit-passage" rows="8">${esc(paper.passage || '')}</textarea>
       <p class="muted small">混合練習可以留空文章欄。改動會即時儲存到資料庫，之後匯出 Word／列印都會用改咗嘅版本。</p>`
    : `<div class="passage-box">${esc(paper.passage || '')}</div>`;

  $('#gen-result').innerHTML = `
    <div class="paper ${edit ? 'editing' : ''}" id="current-paper">
      ${titleHtml}
      <div class="paper-meta">
        <span class="badge ${lang}">${lang === 'zh' ? '中文' : 'English'}</span>
        <span class="badge level">${esc(levelById(level)?.zh || level || '')}</span>
        <span class="badge">約 ${paper.wordCount} 字</span>
        <span class="badge">${(paper.questions || []).length} 題 · ${totalMarks} 分</span>
        ${types.map((t) => `<span class="badge type">${esc(typeLabelAny(t))} ×${typeCounts[t]}</span>`).join('')}
        ${edit ? '' : qualityBadge(paper.quality)}
      </div>
      ${!edit && paper.quality?.issues?.length
        ? `<ul class="q-issues">${paper.quality.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
        : ''}
      ${!edit && paper.quality?.fixesApplied ? `<p class="muted small">AI 自動修正了 ${paper.quality.fixesApplied} 個答案/題目。</p>` : ''}
      ${passageHtml}
      ${questionsHtml}
      ${!edit && paper.notes ? `<div class="paper-notes">💡 ${esc(paper.notes)}</div>` : ''}
    </div>`;
  updateAnswerToggle();
}

/* ------------------------- edit mode ------------------------- */
function inEdit() { return !!state.editMode; }

function setEditBtn() {
  const btn = $('#btn-edit');
  btn.textContent = state.editMode ? '💾 儲存 Save' : '✏️ 編輯 Edit';
  btn.classList.toggle('btn-primary', !!state.editMode);
}

$('#btn-edit').addEventListener('click', async () => {
  const paper = state.paper;
  if (!paper || !paper.id) return alert('請先生成或開啟一份練習。');
  if (state.editMode) {
    // save edits
    const questions = $$('#current-paper .question.editing').map((el, i) => ({
      no: i + 1,
      type: paper.questions[Number(el.dataset.idx)]?.type || 'keywords',
      marks: Number(el.querySelector('.e-marks').value) || 1,
      instruction: el.querySelector('.e-inst')?.value || '',
      stem: el.querySelector('.e-stem')?.value || '',
      options: (el.querySelector('.e-opts')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean),
      answer: el.querySelector('.e-ans')?.value || '',
      explanation: el.querySelector('.e-exp')?.value || '',
    }));
    try {
      const { paper: saved } = await API.request(`/api/papers/${paper.id}`, {
        method: 'PATCH', body: {
          title: $('#edit-title')?.value || paper.title,
          passage: $('#edit-passage')?.value ?? paper.passage,
          questions,
        },
      });
      // keep the in-memory copy in sync (variants keep their slot)
      if (saved) {
        state.papers[state.paperIndex] = saved;
        state.paper = saved;
      }
      state.editMode = false;
      setEditBtn();
      renderPaper(state.paper);
    } catch (err) { alert('儲存失敗：' + err.message); }
  } else {
    state.editMode = true;
    setEditBtn();
    renderPaper(paper, { edit: true });
  }
});

// edit-mode question tools: reorder / delete (mutate draft, re-render edit view)
$('#gen-result').addEventListener('click', (e) => {
  if (!state.editMode) return;
  const btn = e.target.closest('.e-up, .e-down, .e-del');
  if (!btn) return;
  const el = btn.closest('.question.editing');
  const idx = Number(el.dataset.idx);
  const qs = state.paper.questions;
  if (btn.classList.contains('e-del')) {
    if (!confirm(`確定刪除第 ${idx + 1} 題？`)) return;
    qs.splice(idx, 1);
  } else if (btn.classList.contains('e-up') && idx > 0) {
    [qs[idx - 1], qs[idx]] = [qs[idx], qs[idx - 1]];
  } else if (btn.classList.contains('e-down') && idx < qs.length - 1) {
    [qs[idx + 1], qs[idx]] = [qs[idx], qs[idx + 1]];
  } else return;
  // re-key the draft order so data-idx matches display order
  qs.forEach((q, i) => { q.no = i + 1; });
  renderPaper(state.paper, { edit: true });
});

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

// Print: options popover → open the A4 print view in a new tab.
$('#btn-print').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentPaperId()) return alert('請先生成或開啟一份練習。');
  $('#print-pop').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.print-wrap')) $('#print-pop')?.classList.add('hidden');
});
$('#btn-print-open').addEventListener('click', () => {
  const id = currentPaperId();
  if (!id) return;
  const qs = new URLSearchParams({ version: $('#pr-version').value, lines: $('#pr-lines').value, font: $('#pr-font').value });
  $('#print-pop').classList.add('hidden');
  window.open(`/api/papers/${id}/print?${qs}`, '_blank');
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

/* ------------------------- question bank ------------------------- */
function bankTypeOptions() {
  const sel = $('#bank-type');
  const cats = state.meta?.categories;
  if (!cats || sel.options.length > 1) return;
  const opts = [
    ...(cats.en || []).map((c) => ({ id: c.id, zh: c.zh })),
    ...(cats.zh || []).flatMap((g) => (g.items || []).map((c) => ({ id: c.id, zh: c.zh }))),
  ];
  const seen = new Set();
  sel.innerHTML = '<option value="">全部題型</option>' + opts
    .filter((o) => !seen.has(o.id) && seen.add(o.id))
    .map((o) => `<option value="${o.id}">${esc(o.zh)}</option>`).join('');
}

async function loadBank() {
  const b = state.bank;
  try {
    const qs = new URLSearchParams({
      page: b.page, pageSize: b.pageSize,
      language: $('#bank-lang').value, level: $('#bank-level').value,
      q: $('#bank-q').value.trim(), types: $('#bank-type').value,
    });
    const data = await API.get(`/api/bank?${qs}`);
    b.items = data.items || []; b.total = data.total || 0; b.page = data.page || 1;
    renderBank();
  } catch (err) {
    $('#bank-list').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

const bankSelected = (id) => state.bank.selected.some((s) => s.id === id);

function renderBank() {
  const b = state.bank;
  const box = $('#bank-list');
  $('#bank-total').textContent = `共 ${b.total} 條題目`;
  $('#tab-count-bank').textContent = b.total ? String(b.total) : '';
  const pages = Math.max(1, Math.ceil(b.total / b.pageSize));
  $('#bank-page').textContent = `第 ${b.page} / ${pages} 頁`;
  $('#bank-prev').disabled = b.page <= 1;
  $('#bank-next').disabled = b.page >= pages;
  if (!b.items.length) {
    box.innerHTML = '<p class="muted">冇符合條件嘅題目。生成練習之後，題目會自動存入題庫。</p>';
  } else {
    box.innerHTML = b.items.map((it) => `
      <div class="bank-item ${bankSelected(it.id) ? 'on' : ''}" data-id="${it.id}">
        <input type="checkbox" class="bank-check" ${bankSelected(it.id) ? 'checked' : ''}>
        <div class="bank-item-main">
          <div class="bank-item-head">
            <span class="badge type">${esc(typeLabelAny(it.type))}</span>
            <span class="badge">${it.marks} 分</span>
            <span class="badge ${it.language}">${it.language === 'zh' ? '中文' : 'EN'}</span>
            <span class="badge level">${esc(levelById(it.level)?.zh || '')}</span>
            <span class="muted small">${esc(it.sourceTitle || '')}</span>
            <button type="button" class="btn btn-mini bank-del" title="從題庫刪除">🗑</button>
          </div>
          <div class="bank-stem">${esc(it.stem)}</div>
          ${it.options?.length ? `<div class="muted small">選項：${it.options.map(esc).join(' / ')}</div>` : ''}
          <div class="bank-ans">答案：${esc(it.answer)}</div>
        </div>
      </div>`).join('');
  }
  renderComposeTray();
}

function renderComposeTray() {
  const sel = state.bank.selected;
  $('#compose-count').textContent = sel.length ? `已選 ${sel.length} 題` : '';
  $('#btn-compose').disabled = !sel.length;
  $('#compose-list').innerHTML = sel.map((it, i) => `
    <div class="compose-item" data-id="${it.id}">
      <span class="badge type">${esc(typeLabelAny(it.type))}</span>
      <span class="compose-stem">${esc(it.stem.slice(0, 60))}${it.stem.length > 60 ? '…' : ''}</span>
      <span class="edit-tools">
        <button type="button" class="btn btn-mini c-up" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn btn-mini c-down" ${i === sel.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="btn btn-mini c-del">✕</button>
      </span>
    </div>`).join('');
}

$('#btn-bank-search').addEventListener('click', () => { state.bank.page = 1; loadBank(); });
$('#bank-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.bank.page = 1; loadBank(); } });
['#bank-lang', '#bank-level', '#bank-type'].forEach((sel) => $(sel).addEventListener('change', () => { state.bank.page = 1; loadBank(); }));
$('#bank-prev').addEventListener('click', () => { state.bank.page = Math.max(1, state.bank.page - 1); loadBank(); });
$('#bank-next').addEventListener('click', () => { state.bank.page += 1; loadBank(); });

$('#bank-list').addEventListener('change', (e) => {
  if (!e.target.matches('.bank-check')) return;
  const item = e.target.closest('.bank-item');
  const id = Number(item.dataset.id);
  const it = state.bank.items.find((x) => x.id === id);
  if (!it) return;
  if (e.target.checked) { if (!bankSelected(id)) state.bank.selected.push(it); }
  else state.bank.selected = state.bank.selected.filter((s) => s.id !== id);
  item.classList.toggle('on', e.target.checked);
  renderComposeTray();
});

$('#bank-list').addEventListener('click', async (e) => {
  const del = e.target.closest('.bank-del');
  if (!del) return;
  e.preventDefault();
  const item = del.closest('.bank-item');
  const id = Number(item.dataset.id);
  if (!confirm('由題庫刪除呢條題目？（唔會影響原卷）')) return;
  await API.del(`/api/bank/${id}`);
  state.bank.selected = state.bank.selected.filter((s) => s.id !== id);
  loadBank();
});

$('#compose-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.c-up, .c-down, .c-del');
  if (!btn) return;
  const id = Number(btn.closest('.compose-item').dataset.id);
  const sel = state.bank.selected;
  const i = sel.findIndex((s) => s.id === id);
  if (i < 0) return;
  if (btn.classList.contains('c-del')) sel.splice(i, 1);
  else if (btn.classList.contains('c-up') && i > 0) { [sel[i - 1], sel[i]] = [sel[i], sel[i - 1]]; }
  else if (btn.classList.contains('c-down') && i < sel.length - 1) { [sel[i + 1], sel[i]] = [sel[i], sel[i + 1]]; }
  renderComposeTray();
  // keep the checkbox state in sync
  $$('#bank-list .bank-item').forEach((el) => {
    const on = bankSelected(Number(el.dataset.id));
    el.classList.toggle('on', on);
    const cb = el.querySelector('.bank-check');
    if (cb) cb.checked = on;
  });
});

$('#btn-compose').addEventListener('click', async () => {
  const sel = state.bank.selected;
  if (!sel.length) return;
  const btn = $('#btn-compose');
  btn.disabled = true;
  try {
    const { paper } = await API.post('/api/bank/compose', {
      title: $('#compose-title').value.trim(),
      items: sel.map((s) => ({ id: s.id })),
    });
    paper.params = paper.params || {};
    state.papers = [paper]; state.paperIndex = 0; state.paper = paper; state.answersVisible = true;
    state.bank.selected = [];
    renderComposeTray();
    renderBank();
    renderVariantTabs();
    renderPaper(paper);
    gotoTab('generate');
  } catch (err) { alert('拼卷失敗：' + err.message); }
  finally { btn.disabled = false; }
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
    state.typeCounts = {};
    renderTypeGrid();
    setEditBtn();
    bankTypeOptions();
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
