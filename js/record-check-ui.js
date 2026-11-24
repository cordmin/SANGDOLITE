// ─────────────────────────────────────────────────────────────
// 생활기록부 보조 점검 화면
// 표에서 파일을 가져와 모든 점검 항목을 한 번에 점검함
// 파일은 브라우저 안에서만 읽고 저장하지 않음
// ─────────────────────────────────────────────────────────────
let rcFiles = [];        // [{ name, records, isPdf }]
let rcResults = null;    // rcCheckAll 결과
let rcTab = 'all';
let rcQuery = '';
let rcChecking = false;
let rcRunVersion = 0;

function openCheck(btn) {
    document.querySelectorAll('.area-btn').forEach(b => b.classList.remove('active-main'));
    btn.classList.add('active-main');
    ['work-main', 'work-result', 'guide-page'].forEach(id => document.getElementById(id).classList.add('hidden-element'));
    document.querySelectorAll('.check-part').forEach(el => el.classList.remove('hidden-element'));
    toggleDrawer(false);
    rcRenderResults();
}

// 화면 아래에 잠깐 뜨는 알림 (type: 'error'면 붉은색)
let toastTimer;
function showToast(text, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = text;
    toast.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// ───────── 파일 올리기 ─────────
// 파일은 한 번에 하나만 점검함. 여러 개를 고르면 처음 읽힌 파일 하나만 불러옴.
// 이미 불러온 파일이 있으면 새 파일을 다 읽은 뒤 그 파일로 바꿈 (새 파일을 못 읽으면 지금 파일 그대로)
async function rcAddFiles(list) {
    const before = rcFiles[0];
    let loaded = null;
    for (const file of list) {
        if (loaded) { showToast(`파일은 하나만 불러올 수 있어서 '${loaded.name}'만 불러왔어요.`); break; }
        const isPdf = /\.pdf$/i.test(file.name);
        if (!isPdf && !/\.xlsx?$/i.test(file.name)) { rcLoadFail(file.name, '엑셀(.xlsx, .xls)이나 PDF 파일만 읽을 수 있어요.\nNEIS(나이스)에서 내려받은 생활기록부 파일을 올려 주세요.'); continue; }
        try {
            let records;
            if (isPdf) {
                rcLoading('파일을 읽는 중이에요', file.name, 0, 50);
                try {
                    const pages = await rcPdfLines(file);
                    // 반 전체 표 모양 PDF는 엑셀처럼 표로 되살려 읽고, 아니면(학생 한 명씩) 줄 글로 읽음
                    const rows = rcPdfTable(pages);
                    records = rows ? rcParseRows(rows, '', file.name) : [];
                    if (!records.length) records = rcParsePdfLines(pages, file.name);
                    records = await rcFixWraps(records);
                } finally { rcLoading(null); }
            } else {
                const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
                records = wb.SheetNames.flatMap(sn => {
                    rcFixRange(wb.Sheets[sn]);
                    return rcParseRows(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }), sn, file.name);
                });
            }
            if (!records.length) {
                rcLoadFail(file.name, isPdf
                    ? 'NEIS(나이스)에서 출력한 생활기록부 PDF를 올려 주세요.'
                    : "'성명' 칸이 있는 NEIS(나이스) 생활기록부 엑셀을 올려 주세요.");
                continue;
            }
            loaded = { name: file.name, records, isPdf };
            rcFiles = [loaded];
            rcRunVersion++;
            rcChecking = false;
            rcResults = null;
            rcLoading(null);
        } catch (e) {
            rcLoadFail(file.name, `파일을 여는 중에 문제가 생겼어요.\nNEIS(나이스)에서 출력한 생활기록부 엑셀이나 PDF를 올려 주세요.\n${e.message}`);
        }
    }
    rcRenderFiles();
    rcRenderResults();
    if (!loaded) return;
    if (before && list.length === 1) showToast(`'${loaded.name}'(으)로 바꿔 불러왔어요.`);
    rcRun(loaded.isPdf ? rcBarP : 0); // 불러오면 바로 점검 (PDF는 읽기에서 멈춘 자리부터 이어서)
}

// PDF 줄바꿈 자리 띄어쓰기를 사전으로 정함. 사전을 못 쓰면 끝말 짐작대로
async function rcFixWraps(records) {
    const words = rcWrapWords(records);
    let known = null;
    if (words.length) try { known = await rcKnownWords(words); } catch { known = null; }
    return rcResolveWraps(records, known);
}

// 불러오기 실패 창: 어떤 파일인지와 무엇을 올리면 되는지 알려 줌
function rcLoadFail(name, msg) {
    document.getElementById('rc-fail-file').textContent = name;
    document.getElementById('rc-fail-msg').textContent = msg;
    const dialog = document.getElementById('rc-fail-dialog');
    if (!dialog.open) dialog.showModal();
}

// PDF 도구는 PDF를 처음 올릴 때만 불러옴 (도구만 받아 오고, 파일은 브라우저 안에서만 읽음)
const RC_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let rcPdfReady = null;
function rcLoadPdfJs() {
    rcPdfReady ||= new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = RC_PDFJS + 'pdf.min.js';
        s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = RC_PDFJS + 'pdf.worker.min.js'; ok(); };
        s.onerror = () => { rcPdfReady = null; fail(new Error('PDF 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
        document.head.appendChild(s);
    });
    return rcPdfReady;
}

// 나이스 엑셀은 표 범위 정보가 틀려서 아래쪽 줄이 빠지기도 함 → 실제 들어 있는 칸으로 범위를 다시 잡음
function rcFixRange(ws) {
    let s = null, e = null;
    for (const k of Object.keys(ws)) {
        if (k[0] === '!') continue;
        const c = XLSX.utils.decode_cell(k);
        if (!s) { s = { ...c }; e = { ...c }; continue; }
        s.r = Math.min(s.r, c.r); s.c = Math.min(s.c, c.c);
        e.r = Math.max(e.r, c.r); e.c = Math.max(e.c, c.c);
    }
    if (s) ws['!ref'] = XLSX.utils.encode_range({ s, e });
}

// 쪽마다 글 조각을 좌표와 함께 꺼내 줄로 묶음 (rcGroupLines)
async function rcPdfLines(file) {
    await rcLoadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const { items } = await page.getTextContent();
        const vp = page.getViewport({ scale: 1 });
        // pdf.js는 줄 끝 띄어쓰기를 버림 → 그리기 명령 원문에서 낱말 뒤 띄어쓰기를 되찾음
        let raw = '', ops = null;
        try {
            ops = await page.getOperatorList();
            ops.fnArray.forEach((fn, i) => {
                if (fn !== pdfjsLib.OPS.showText && fn !== pdfjsLib.OPS.showSpacedText) return;
                for (const g of ops.argsArray[i][0]) if (g && typeof g === 'object' && g.unicode) raw += g.unicode;
            });
        } catch { raw = ''; }
        let ptr = 0;
        const parts = [];
        for (const it of items) {
            if (!it.str) continue;
            const sp = !it.str.trim();
            let spAfter = null;
            if (!sp && raw) {
                const k = raw.indexOf(it.str, ptr);
                if (k >= 0 && k - ptr < 40) { ptr = k + it.str.length; spAfter = /\s/.test(raw[ptr] || ''); }
            }
            // 화면 기준 좌표로 바꿈: 90° 돌아간 쪽도 가로·세로가 바르게 잡힘
            const t = pdfjsLib.Util.transform(vp.transform, it.transform);
            parts.push({ s: it.str, x: t[4], y: vp.height - t[5], w: it.width || 0, h: Math.hypot(t[2], t[3]) || 10, sp, spAfter });
        }
        const lines = rcGroupLines(parts);
        // 표 칸(네모) 위치: 어느 줄이 어느 학생·영역 칸에 들었는지 정확히 가림 (못 읽으면 글 위치로 짐작)
        try { if (ops) lines.rects = rcPdfRects(ops, pdfjsLib, vp); } catch { /* 짐작으로 읽음 */ }
        pages.push(lines);
    }
    return pages;
}

function rcRemoveFile(i) {
    rcRunVersion++;
    rcChecking = false;
    rcFiles.splice(i, 1);
    rcResults = null;
    rcLoading(null);
    rcRenderFiles();
    rcRenderResults();
}

// 파일 닫기: 점검 결과도 사라지므로 먼저 물어봄
let rcClosing = null;
function rcAskClose(i) {
    rcClosing = rcFiles[i];
    document.getElementById('rc-close-description').textContent = `‘${rcClosing.name}’을(를) 닫으면\n이 파일의 점검 결과도 함께 사라져요.`;   // 이름이 길어도 '닫으면' 다음에서 줄을 바꿈
    document.getElementById('rc-close-dialog').showModal();
}

function rcConfirmClose() {
    const dialog = document.getElementById('rc-close-dialog');
    const i = rcFiles.indexOf(rcClosing);
    rcClosing = null;
    dialog.close();
    if (i >= 0) rcRemoveFile(i);
}

function rcRenderFiles() {
    const box = document.getElementById('rc-file-list');
    box.innerHTML = rcFiles.map((f, i) =>
        `<div class="rc-file ${f.isPdf ? 'is-pdf' : 'is-excel'}"><span class="rc-file-icon" aria-hidden="true"><i data-lucide="${f.isPdf ? 'file-text' : 'file-spreadsheet'}"></i></span>`
        + `<span class="rc-file-name" title="${rcEscape(f.name)}">${rcEscape(f.name)}</span><span class="rc-file-count">${f.records.length}건</span>`
        + `<button type="button" onclick="rcAskClose(${i})" aria-label="${rcEscape(f.name)} 닫기" title="닫기"><i data-lucide="x"></i></button></div>`
    ).join('');
    if (window.lucide) lucide.createIcons();
}

// 표 가운데 로딩 표시 (text가 없으면 숨김). from%에서 시작해 to%에 가까워짐
// PDF는 '읽기(0→50%)' 다음 '점검'을 읽기가 멈춘 자리부터 이어 감 (단계마다 0%로 돌아가지 않게)
// ponytail: 맞춤법 검사는 한 번에 끝나서 실제 진행률을 모름 → 처음엔 빠르게, 목표에 가까울수록 천천히 차게 함
let rcBarTimer = null, rcBarP = 0;   // rcBarP: 막대가 마지막으로 그린 진행률
function rcLoading(text, sub = '', from = 0, to = 90) {
    const box = document.getElementById('rc-loading');
    box.hidden = !text;
    document.getElementById('rc-drop').classList.toggle('loading', !!text);
    clearInterval(rcBarTimer);
    if (!text) return;
    let p = from;
    const draw = () => {
        rcBarP = p;
        document.getElementById('rc-bar-fill').style.width = p + '%';
        document.getElementById('rc-pencil').style.left = p + '%';
        document.getElementById('rc-bar-pct').style.left = p + '%';
        document.getElementById('rc-bar-pct').textContent = Math.round(p) + '%';
    };
    draw();
    rcBarTimer = setInterval(() => { p += (to - p) * 0.06; draw(); }, 150);
    document.getElementById('rc-loading-text').textContent = text;
    document.getElementById('rc-loading-sub').textContent = sub;
}

async function rcRun(barFrom = 0) {
    if (!rcFiles.length) return;
    const version = ++rcRunVersion;
    const files = [...rcFiles];
    const records = files.flatMap(f => f.records);
    rcChecking = true;
    rcRenderFiles();
    rcLoading('점검하는 중이에요', '', barFrom);
    try {
        const { spellings, loans } = (await rcCheckSpelling(records)) || {};
        if (version !== rcRunVersion || files.length !== rcFiles.length || files.some((file, i) => file !== rcFiles[i])) return;
        rcResults = rcCheckAll(records, { spellings, loans, limits: RC_DEFAULT_SETTINGS.limits }, getByteLength);
        rcTab = 'all';
        rcQuery = '';
        document.getElementById('rc-search').value = '';
        rcRenderResults();
    } catch (error) {
        if (version === rcRunVersion) showToast(`점검을 완료하지 못했어요. ${error.message}`, 'error');
    } finally {
        if (version === rcRunVersion) {
            rcChecking = false;
            rcLoading(null);
            rcRenderFiles();
        }
    }
}

// ───────── 결과 ─────────
const RC_FILLER = '<tr class="filler-row" style="height:100%"><td></td><td></td><td></td><td></td><td></td><td class="excel-byte"></td></tr>';

// 지금 화면에 보이는 줄 (필터·검색 반영). 화면과 '결과 내려받기'가 같이 씀
// withMarks: 화면에서는 사전 밑줄만 있는 학생도 보여 줌 (맞춤법 밑줄은 전체·맞춤법, 외래어 밑줄은 전체·외래어 보기에서). 엑셀에는 안 담음
function rcHasMarks(r, tab) {
    return ((tab === 'all' || tab === 'spell') && (r.marks || []).length > 0) || ((tab === 'all' || tab === 'loan') && (r.loanMarks || []).length > 0);
}
// types: 보여 줄 점검 영역 목록 (null이면 전체). 기본은 지금 고른 필터, 인쇄 창에서는 고른 영역들
function rcVisibleRows(withMarks = false, types = rcTab === 'all' ? null : [rcTab]) {
    const q = rcQuery.trim();
    const has = t => !types || types.includes(t);
    return (rcResults || [])
        .map(r => ({ ...r, shown: r.issues.filter(i => has(i.type)), dict: withMarks && has('spell') ? r.marks || [] : [], loan: withMarks && has('loan') ? r.loanMarks || [] : [] }))
        .filter(r => (r.shown.length || r.dict.length || r.loan.length) && (!q || rcWho(r.rec).includes(q) || r.rec.subject.includes(q) || r.rec.area.includes(q)));
}

// 학번: 1학년 3반 1번 → 10301 (숫자가 모자라면 있는 것만 이어 씀)
function rcStudentId({ grade, cls, num }) {
    return /^\d$/.test(grade) && /^\d{1,2}$/.test(cls) && /^\d{1,2}$/.test(num)
        ? grade + cls.padStart(2, '0') + num.padStart(2, '0')
        : [grade && grade + '학년', cls && cls + '반', num && num + '번'].filter(Boolean).join(' ');
}

// 항목: 좁은 칸에서 낱말 중간이 잘리지 않게 '및' 앞에서 줄을 나누고, 과목은 다음 줄에 (과목)
function rcWhereLines(rec) {
    const lines = rec.area.split(/ (?=및 )/);
    if (rec.subject) lines.push(`(${rec.subject})`);
    return lines;
}

function rcRenderResults() {
    const tbody = document.getElementById('rc-tbody');
    const tabs = [['all', '전체'], ...Object.entries(RC_TYPES)];
    const filter = document.getElementById('rc-type-filter');
    filter.innerHTML = '<button type="button"><selectedcontent></selectedcontent></button>' + tabs.map(([t, label]) => {
        // 표에 나올 학생 수 (검색어와 상관없이)
        const n = rcCount(t);
        const count = rcResults ? ` <span class="rc-filter-count${n ? '' : ' rc-zero'}" aria-label="${n}명">${n}</span>` : '';
        return `<option value="${t}"><span class="rc-filter-label">${label}</span>${count}</option>`;
    }).join('');
    filter.value = rcTab;
    ['rc-export-btn', 'rc-print-btn'].forEach(id => { document.getElementById(id).disabled = !rcResults; });
    document.getElementById('rc-import').hidden = !!(rcResults || rcFiles.length);

    if (!rcResults) {
        const ready = rcFiles.length ? `<td colspan="6" class="rc-empty"><span class="rc-empty-msg">점검 결과가 없어요. 파일을 닫고 다시 불러오면 다시 점검해요.</span></td>` : '<td colspan="6"></td>';
        tbody.innerHTML = `<tr class="filler-row" style="height:100%">${ready}</tr>`;
        return;
    }

    const q = rcQuery.trim();
    const rows = rcVisibleRows(true);
    if (!rows.length) {
        tbody.innerHTML = `<tr class="filler-row" style="height:100%"><td colspan="6" class="rc-empty"><span class="rc-empty-msg">${q ? '찾는 학생이 없어요.' : '충성! 보조 점검 결과 이상 없습니다!'}</span></td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(rcRowHtml).join('') + RC_FILLER;
}

// 점검 영역(t)에 걸린 학생 수 (검색어와 상관없이)
function rcCount(t) {
    return (rcResults || []).filter(r => r.issues.some(issue => t === 'all' || issue.type === t) || rcHasMarks(r, t)).length;
}

// 결과 표 한 줄 (화면과 인쇄가 같이 씀)
function rcRowHtml(r) {
        const where = rcWhereLines(r.rec).map(line => `<span>${rcEscape(line)}</span>`).join('');
        const fixes = rcMergeSimilar(r.shown).map(x => `<li class="rc-${x.level}"><span class="rc-tag">${RC_TYPES[x.type]}</span>${x.people
            ? `다른 학생 기록에도 동일한 문장이 있어요.<span class="rc-dup-list">${x.people.map(p =>
                `<span class="rc-dup-name" tabindex="0" aria-label="${rcEscape(p.who)}과(와) 같은 문장 ${p.passages.length}개" data-passages="${rcEscape(JSON.stringify(p.passages))}">${rcEscape(rcStudentId(p.rec))} ${rcEscape(p.rec.name)}</span>`).join('')}</span>`
            : rcEscape(x.why)}</li>`).join('');
        return `<tr><td class="rc-who"><b>${rcEscape(r.rec.name)}</b></td><td class="rc-id">${rcEscape(rcStudentId(r.rec))}</td><td class="rc-where">${where}</td>`
            + `<td class="result-cell rc-text">${rcHighlight(r.rec.text, r.shown, r.dict, r.loan) || '<span class="rc-blank">(비어 있음)</span>'}</td>`
            + `<td class="rc-fix"><ul>${fixes}</ul></td><td class="excel-byte">${getByteLength(r.rec.text)} Byte</td></tr>`;
}

// 똑같은 문장: 학생 이름에 커서를 올리거나 Tab으로 고르면, 그 학생과 같은 문장만 진하게 남기고 다른 똑같은 문장 표시는 잠깐 끔
function rcDupFocus(name, on) {
    const row = name.closest('tr');
    const mine = new Set(on ? JSON.parse(name.dataset.passages) : []);
    const all = new Set(on ? [...row.querySelectorAll('.rc-dup-name')].flatMap(n => JSON.parse(n.dataset.passages)) : []);
    row.querySelectorAll('.rc-text .rc-mark').forEach(mark => {
        mark.classList.toggle('rc-dup-on', mine.has(mark.textContent));
        mark.classList.toggle('rc-dup-off', all.has(mark.textContent) && !mine.has(mark.textContent));
    });
}
['mouseover', 'focusin'].forEach(ev => document.getElementById('rc-tbody').addEventListener(ev, e => { const n = e.target.closest('.rc-dup-name'); if (n) rcDupFocus(n, true); }));
['mouseout', 'focusout'].forEach(ev => document.getElementById('rc-tbody').addEventListener(ev, e => { const n = e.target.closest('.rc-dup-name'); if (n) rcDupFocus(n, false); }));

function rcSearch(v) {
    rcQuery = v;
    rcRenderResults();
}

// 결과 내려받기(PDF)·인쇄하기: 고른 점검 영역(types, 없으면 지금 필터 그대로)의 표를 화면과 같은 모양으로 숨은 틀에 옮겨 인쇄창을 띄움 → 'PDF로 저장' 또는 프린터
// ponytail: 브라우저 인쇄 기능을 씀. 사용자가 인쇄창에서 'PDF로 저장'을 골라야 함 (바로 파일로 떨어뜨리려면 PDF 라이브러리가 필요)
function rcExport(types) {
    if (!rcResults) return;
    const rows = types ? rcVisibleRows(true, types) : rcVisibleRows(true);
    if (!rows.length) { showModal('알림', '지금 화면에 내려받을 내용이 없어요.', 'info'); return; }
    const screen = document.querySelector('#check-result .rc-table');
    const table = `<table class="excel-table rc-table">${screen.querySelector('colgroup').outerHTML}${screen.querySelector('thead').outerHTML}<tbody>${rows.map(rcRowHtml).join('')}</tbody></table>`;
    const picked = types ? (types.length === Object.keys(RC_TYPES).filter(t => rcCount(t)).length ? [] : types) : rcTab === 'all' ? [] : [rcTab];
    const title = ['생기부_점검결과', ...picked.map(t => RC_TYPES[t])].join('_');
    const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join('');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${rcEscape(title)}</title>${css}<style>
        @page { size: A4 landscape; margin: 10mm; }
        body { margin: 0; font-family: Pretendard, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .rc-table { table-layout: fixed; width: 100%; border: 1px solid #334155; }
        .rc-table th { position: static; }
        .rc-table tr { break-inside: avoid; }
        .rc-table tr:last-child td { border-bottom: 1px solid #94a3b8; }
        .rc-fix ul { list-style: none; margin: 0; padding: 0; }
        .rc-dup-name { cursor: default; }
    </style></head><body>${table}</body></html>`);
    doc.close();
    frame.contentWindow.onafterprint = () => setTimeout(() => frame.remove());
    // 글꼴·스타일을 다 받은 뒤 인쇄 (안 그러면 밑줄·색 없이 찍힐 수 있음)
    const print = () => frame.contentWindow.print();
    frame.contentWindow.addEventListener('load', () => (doc.fonts ? doc.fonts.ready : Promise.resolve()).then(print), { once: true });
}

// 인쇄하기: 결과가 있는 점검 영역만 골라서 인쇄 (처음엔 모두 고름)
function rcAskPrint() {
    if (!rcResults) return;
    const types = Object.keys(RC_TYPES).filter(t => rcCount(t));
    if (!types.length) { showModal('알림', '인쇄할 점검 결과가 없어요.', 'info'); return; }
    document.getElementById('rc-print-list').innerHTML = `<label class="rc-print-all"><input type="checkbox" checked onchange="rcPrintPickAll(this.checked)"><span>전체</span><em>${rcCount('all')}명</em></label>`
        + types.map(t => `<label><input type="checkbox" name="rc-print-type" value="${t}" checked onchange="rcPrintSync()"><span>${RC_TYPES[t]}</span><em>${rcCount(t)}명</em></label>`).join('');
    rcPrintSync();
    document.getElementById('rc-print-dialog').showModal();
}
function rcPrintPicked() {
    return [...document.querySelectorAll('#rc-print-list input[name="rc-print-type"]:checked')].map(i => i.value);
}
function rcPrintPickAll(on) {
    document.querySelectorAll('#rc-print-list input[name="rc-print-type"]').forEach(i => { i.checked = on; });
    rcPrintSync();
}
function rcPrintSync() {
    const boxes = document.querySelectorAll('#rc-print-list input[name="rc-print-type"]');
    const n = rcPrintPicked().length;
    const all = document.querySelector('#rc-print-list .rc-print-all input');
    all.checked = n === boxes.length;
    all.indeterminate = n > 0 && n < boxes.length;
    document.getElementById('rc-print-go').disabled = !n;
}
function rcConfirmPrint() {
    const types = rcPrintPicked();
    document.getElementById('rc-print-dialog').close();
    if (types.length) rcExport(types);
}

// 끌어다 놓기
(function () {
    const dz = document.getElementById('rc-drop');
    const input = document.getElementById('rc-file-input');
    document.getElementById('rc-import-button').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { rcAddFiles([...input.files]); input.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => rcAddFiles([...e.dataTransfer.files]));
})();

// ───────── 관리자 페이지 '생활기록부 점검 지침' (보기 · 수정) ─────────
// 지침은 서버(code.gs 금고)에 저장되고, 모든 사용자의 보조 점검과 생성 결과 점검에 쓰임
let rcGuideEditing = false;
let rcPendingRemoval = null;
let rcDraft = null; // 수정 중인 지침 사본 { forbid, spell, limits }

// 서버에 저장된 점검 지침을 받아 끼움 (없거나 실패하면 처음 지침 그대로)
async function rcLoadCheckGuide() {
    try {
        const res = await gasGet({ action: 'checkGuide' });
        if (res.success && res.checkGuide) {
            rcApplyGuide(res.checkGuide);
            if (rcResults) rcRun();
        }
    } catch (e) {}
}

const rcCard = (n, title, body, flow = '', action = '') => `<div class="guide-card"><div class="guide-head${flow ? ' rc-guide-head-flow' : ''}"><span class="guide-label"><span class="guide-num">${n}</span><span class="guide-title">${title}</span></span>${action}${flow ? `<span class="rc-guide-flow">${flow}</span>` : ''}</div><div class="rc-guide-body">${body}</div></div>`;
const RC_FORBID_HELP = '<button type="button" class="rc-guide-info" aria-label="기재 점검 도움말" aria-haspopup="dialog" onclick="document.getElementById(&quot;rc-guide-help-dialog&quot;).showModal()"><span aria-hidden="true">i</span></button>';

const RC_SPELL_FLOW = '① Hunspell 검사 → ② 보완 규칙 점검';
const RC_LIMIT_FOOT = '<p class="rc-help mt-2">※ 모든 항목의 최대 글자 수는 학년 단위 기준입니다.<br>※ 한글 1자는 3Byte, 영문·숫자 1자는 1Byte, 엔터(Enter)는 1Byte임.</p>';

function rcRenderCheckGuide() {
    const list = document.getElementById('guide-list');
    const g = rcGuideEditing ? rcDraft : RC_GUIDE;
    if (!rcGuideEditing) {
        const forbid = [['no', '기재 불가'], ['check', '확인 필요']].map(([lv, title]) =>
            `<div class="rc-rule-group rc-${lv}"><b>${title}</b><div class="rc-spell-list">${g.forbid.filter(r => (r.level === 'check' ? 'check' : 'no') === lv).map(r => `<span>${rcEscape(r.label)}</span>`).join('')}</div></div>`).join('');
        const spell = g.spell.map(r => `<tr><td>${rcEscape(r.wrong)}</td><td>${rcEscape(r.right)}</td></tr>`).join('');
        const limits = g.limits.map((r, i) => {
            const first = i === 0 || g.limits[i - 1].group !== r.group;
            let span = 1;
            while (first && g.limits[i + span] && g.limits[i + span].group === r.group) span++;
            return `<tr>${first ? `<th rowspan="${span}">${rcEscape(r.group)}</th>` : ''}<td>${rcEscape(r.item)}</td><td class="rc-num">${rcEscape(r.max)}자</td></tr>`;
        }).join('');
        list.innerHTML = rcCard(1, '기재 점검 내용', `<div class="flex flex-col gap-3">${forbid}</div>`, '', RC_FORBID_HELP)
            + '<div class="rc-guide-pair">' + rcCard(2, '맞춤법 점검 내용', `<div class="rc-rounded-table"><table class="rc-limit-table rc-spell-table"><thead><tr><th>틀린 말</th><th>바른 말</th></tr></thead><tbody>${spell}</tbody></table></div>`, RC_SPELL_FLOW)
            + rcCard(3, '영역별 입력 가능 최대 글자수', `<div class="rc-rounded-table"><table class="rc-limit-table"><thead><tr><th>영역</th><th>세부항목</th><th>최대 글자수</th></tr></thead><tbody>${limits}</tbody></table></div>` + RC_LIMIT_FOOT) + '</div>';
        return;
    }
    const inp = (sec, i, f, v, ph = '') => `<input class="set-input rc-edit" data-sec="${sec}" data-i="${i}" data-f="${f}" value="${rcEscape(v)}" placeholder="${ph}">`;
    const del = (sec, i) => `<button type="button" class="rc-del" onclick="rcDraftRemove('${sec}', ${i})" aria-label="규칙 삭제">×</button>`;
    const forbid = g.forbid.map((r, i) => `<tr><td><select class="set-input rc-edit" data-sec="forbid" data-i="${i}" data-f="level"><option value="no"${r.level === 'check' ? '' : ' selected'}>기재 불가</option><option value="check"${r.level === 'check' ? ' selected' : ''}>확인 필요</option></select></td>`
        + `<td>${inp('forbid', i, 'label', r.label, '이름')}</td><td class="rc-words">${inp('forbid', i, 'words', r.words, r.find ? '' : '예: 토익, 토플')}${r.find ? `<span class="rc-auto" tabindex="0" data-tip="${rcEscape(r.findNote || '낱말로 적을 수 없는 찾기 규칙이 함께 들어 있어요.')}">+ 자동 규칙</span>` : ''}</td><td>${inp('forbid', i, 'why', r.why, '고칠 점에 보일 문구')}</td><td>${del('forbid', i)}</td></tr>`).join('');
    const spell = g.spell.map((r, i) => `<tr><td>${inp('spell', i, 'wrong', r.wrong, '틀린 말')}</td><td>${inp('spell', i, 'right', r.right, '바른 말')}</td><td><button type="button" class="rc-spell-delete" onclick="rcDraftRemove('spell', ${i})" aria-label="${rcEscape(r.wrong || '빈')} 규칙 삭제">×</button></td></tr>`).join('');
    const limits = g.limits.map((r, i) => {
        const first = i === 0 || g.limits[i - 1].group !== r.group;
        let span = 1;
        while (first && g.limits[i + span] && g.limits[i + span].group === r.group) span++;
        return `<tr>${first ? `<th scope="rowgroup" rowspan="${span}">${rcEscape(r.group)}</th>` : ''}<td>${rcEscape(r.item)}</td><td><span class="rc-limit-unit"><input type="text" inputmode="numeric" pattern="[0-9]+" class="set-input rc-edit rc-limit-input" data-sec="limits" data-i="${i}" data-f="max" data-valid-limit="${rcEscape(r.max)}" value="${rcEscape(r.max)}" aria-label="${rcEscape(r.item)} 최대 글자 수" onbeforeinput="if(event.data && /[^0-9]/.test(event.data)) event.preventDefault()" onblur="rcValidateLimitInput(this, true)"><span>자</span></span></td></tr>`;
    }).join('');
    list.innerHTML = rcCard(1, '기재 점검 내용',
            `<table class="rc-edit-table"><thead><tr><th style="width:120px">구분</th><th style="width:160px">이름</th><th>찾을 말</th><th>고칠 점 문구</th><th style="width:60px"></th></tr></thead><tbody>${forbid}</tbody></table>`, '', `<button type="button" class="rc-spell-add" onclick="rcDraftAdd('forbid')">+ 규칙 추가</button>` + RC_FORBID_HELP)
        + '<div class="rc-guide-pair">' + rcCard(2, '맞춤법 점검 내용', `<div class="rc-rounded-table"><table class="rc-edit-table rc-spell-editor" aria-label="맞춤법 보완 규칙"><colgroup><col><col><col style="width:40px"></colgroup><thead><tr><th>틀린 말</th><th>바른 말</th><th>삭제</th></tr></thead><tbody>${spell}</tbody></table></div>`, RC_SPELL_FLOW, `<button type="button" class="rc-spell-add" onclick="rcDraftAdd('spell')">+ 규칙 추가</button>`)
        + rcCard(3, '영역별 입력 가능 최대 글자수', `<div class="rc-rounded-table"><table class="rc-edit-table rc-limit-editor"><thead><tr><th>영역</th><th>세부항목</th><th style="width:100px">최대 글자수</th></tr></thead><tbody>${limits}</tbody></table></div>` + RC_LIMIT_FOOT) + '</div>';
}

function rcCheckGuideActions(box) {
    box.innerHTML = rcGuideEditing
        ? '<button type="button" class="guide-btn" onclick="rcDraftDefault()">기본값 불러오기</button>'
          + '<button type="button" class="guide-btn" onclick="rcGuideEditing=false; renderGuide()">취소</button>'
          + '<button type="button" class="guide-btn dark" onclick="rcSaveCheckGuide()">저장</button>'
        : '<button type="button" class="guide-btn" onclick="rcDraft=JSON.parse(JSON.stringify(RC_GUIDE)); rcGuideEditing=true; renderGuide()">수정</button>';
}

function rcDraftAdd(sec) {
    rcDraft[sec].push(sec === 'forbid' ? { level: 'no', label: '', words: '', why: '' } : sec === 'spell' ? { wrong: '', right: '' } : { group: '', item: '', max: '' });
    rcRenderCheckGuide();
    const rows = document.querySelectorAll(`[data-sec="${sec}"]`);
    rows[rows.length - 1].closest('tr').querySelector('input').focus();
}
function rcDraftRemove(sec, i) {
    const row = rcDraft[sec][i];
    rcPendingRemoval = { draft: rcDraft, sec, row };
    document.getElementById('rc-delete-description').textContent = `‘${row.label || row.wrong || '빈 규칙'}’ 규칙을 삭제합니다. 저장해야 최종 반영됩니다.`;
    document.getElementById('rc-delete-dialog').showModal();
}

function rcConfirmDraftRemoval() {
    const dialog = document.getElementById('rc-delete-dialog');
    if (!dialog.open || !rcPendingRemoval) return;
    const pending = rcPendingRemoval;
    rcPendingRemoval = null;
    dialog.close();
    if (rcDraft !== pending.draft) return;
    const index = rcDraft[pending.sec].indexOf(pending.row);
    if (index < 0) return;
    rcDraft[pending.sec].splice(index, 1);
    rcRenderCheckGuide();
}
function rcDraftDefault() {
    rcDraft = JSON.parse(JSON.stringify(RC_DEFAULT_GUIDE));
    rcRenderCheckGuide();
    showModal('', '기본값을 불러왔어요.<br>살펴본 뒤 [저장]을 눌러 주세요.', 'info');
}

function rcValidateLimitInput(input, commit = false) {
    if (!/^\d*$/.test(input.value) || (input.value && !Number.isSafeInteger(Number(input.value)))) input.value = input.dataset.validLimit;
    if (commit) input.value = String(Number(input.value) > 0 ? Number(input.value) : Number(input.dataset.validLimit));
    if (Number(input.value) > 0) input.dataset.validLimit = input.value;
    if (rcDraft) rcDraft.limits[input.dataset.i].max = input.value;
}

async function rcSaveCheckGuide() {
    const empty = rcDraft.forbid.some(r => !String(r.label || '').trim() || !(String(r.words || '').trim() || r.find))
        || rcDraft.spell.some(r => !String(r.wrong || '').trim() || !String(r.right || '').trim())
        || rcDraft.limits.some(r => !String(r.item || '').trim() || !String(r.max || '').trim());
    if (empty) return showModal('저장 실패', '빈 칸이 있어요. 줄을 채우거나 [빼기]로 지워 주세요.', 'error');
    if (rcDraft.limits.some(row => !/^[1-9]\d*$/.test(String(row.max)) || !Number.isSafeInteger(Number(row.max)))) return showModal('저장 실패', '최대 글자 수는 1 이상의 정수로 입력해 주세요.', 'error');
    try {
        const res = await gasPost({ action: 'saveCheckGuide', password: guidePw, checkGuide: rcDraft });
        if (!res.success) return showModal('저장 실패', rcEscape(res.error || '저장하지 못했어요.'), 'error');
        rcApplyGuide(res.checkGuide);
        rcGuideEditing = false;
        renderGuide();
        if (rcResults) rcRun();
        showModal('', '저장했어요.<br>지금부터 모든 사용자의 보조 점검에 적용돼요.', 'info');
    } catch (err) { guideServerError(err); }
}

// 수정 칸에 쓴 내용을 사본에 바로 담음
document.getElementById('guide-list').addEventListener('input', e => {
    const t = e.target.closest('[data-sec]');
    if (t && rcDraft) {
        if (t.matches('.rc-limit-input')) rcValidateLimitInput(t);
        else rcDraft[t.dataset.sec][t.dataset.i][t.dataset.f] = t.value;
    }
});
document.getElementById('guide-list').addEventListener('change', e => {
    const t = e.target.closest('select[data-sec]');
    if (t && rcDraft) {
        if (t.matches('.rc-limit-input')) rcValidateLimitInput(t);
        else rcDraft[t.dataset.sec][t.dataset.i][t.dataset.f] = t.value;
    }
});

rcLoadCheckGuide();
