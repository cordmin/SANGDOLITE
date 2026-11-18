// ─────────────────────────────────────────────────────────────
// 생활기록부 보조 점검 화면
// 가운데 칸: 파일 올리기 + 점검 기준(접이식), 오른쪽 칸: 점검 결과
// 파일은 브라우저 안에서만 읽고, 점검 기준만 이 브라우저에 저장함 (학생 기록은 저장하지 않음)
// ─────────────────────────────────────────────────────────────
const RC_STORE = 'record_check_settings_2026'; // 2026 기재요령 기준으로 바꾸며 이름을 새로 함 (예전 저장값은 쓰지 않음)
let rcFiles = [];        // [{ name, records, isPdf }]
let rcResults = null;    // rcCheckAll 결과
let rcTab = 'all';
let rcQuery = '';

function rcLoadSettings() {
    const base = JSON.parse(JSON.stringify(RC_DEFAULT_SETTINGS));
    try {
        const saved = JSON.parse(localStorage.getItem(RC_STORE) || 'null');
        if (saved) return { ...base, ...saved, limits: base.limits }; // 글자 수는 기재요령 값 고정 (관리자 '생활기록부 점검 지침'에서 보기)
    } catch (e) {}
    return base;
}
let rcSettings = rcLoadSettings();

function openCheck(btn) {
    document.querySelectorAll('.area-btn').forEach(b => b.classList.remove('active-main'));
    btn.classList.add('active-main');
    ['work-main', 'work-result', 'guide-page'].forEach(id => document.getElementById(id).classList.add('hidden-element'));
    document.querySelectorAll('.check-part').forEach(el => el.classList.remove('hidden-element'));
    toggleDrawer(false);
    rcRenderSettings();
    rcRenderResults();
}

// ───────── 파일 올리기 ─────────
async function rcAddFiles(list) {
    const msg = document.getElementById('rc-file-msg');
    msg.textContent = '';
    for (const file of list) {
        const isPdf = /\.pdf$/i.test(file.name);
        if (!isPdf && !/\.xlsx?$/i.test(file.name)) { msg.textContent = `'${file.name}'은(는) 읽을 수 없는 파일이에요. 나이스에서 내려받은 엑셀(.xlsx, .xls)이나 PDF를 올려 주세요.`; continue; }
        if (rcFiles.some(f => f.name === file.name)) continue;
        try {
            let records;
            if (isPdf) {
                msg.textContent = `'${file.name}'을(를) 읽는 중이에요…`;
                records = rcParsePdfLines(await rcPdfLines(file), file.name);
                msg.textContent = '';
            } else {
                const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
                records = wb.SheetNames.flatMap(sn =>
                    rcParseRows(XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }), sn, file.name));
            }
            if (!records.length) {
                msg.textContent = isPdf
                    ? `'${file.name}'에서 학생 기록을 찾지 못했어요. 나이스에서 출력한 학교생활기록부 PDF인지 확인해 주세요. (글자를 고를 수 없는 사진 PDF는 읽을 수 없어요.)`
                    : `'${file.name}'에서 학생 기록을 찾지 못했어요. '성명' 칸이 있는 나이스 엑셀인지 확인해 주세요.`;
                continue;
            }
            rcFiles.push({ name: file.name, records, isPdf });
        } catch (e) {
            msg.textContent = `'${file.name}'을(를) 읽지 못했어요. (${e.message})`;
        }
    }
    rcRenderFiles();
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

// 쪽마다 글 조각을 같은 높이끼리 묶어 줄로 만듦
async function rcPdfLines(file) {
    await rcLoadPdfJs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
        const { items } = await (await pdf.getPage(p)).getTextContent();
        const rows = [];
        for (const it of items) {
            if (!it.str) continue;
            const y = it.transform[5], x = it.transform[4];
            let row = rows.find(r => Math.abs(r.y - y) < 2.5);
            if (!row) rows.push(row = { y, parts: [] });
            row.parts.push({ x, end: x + it.width, str: it.str });
        }
        rows.sort((a, b) => b.y - a.y);
        pages.push(rows.map(r => {
            r.parts.sort((a, b) => a.x - b.x);
            let line = '', end = null;
            for (const t of r.parts) {
                if (end !== null && t.x - end > 1.5 && !line.endsWith(' ') && !t.str.startsWith(' ')) line += ' ';
                line += t.str;
                end = t.end;
            }
            return line;
        }));
    }
    return pages;
}

function rcRemoveFile(i) {
    rcFiles.splice(i, 1);
    rcRenderFiles();
}

function rcReset() {
    rcFiles = [];
    rcResults = null;
    rcRenderFiles();
    rcRenderResults();
}

function rcRenderFiles() {
    const box = document.getElementById('rc-file-list');
    box.innerHTML = rcFiles.map((f, i) =>
        `<div class="rc-file"><span class="rc-file-name">${rcEscape(f.name)}</span><button type="button" onclick="rcRemoveFile(${i})" aria-label="${rcEscape(f.name)} 빼기">빼기</button></div>`
    ).join('') + (rcFiles.length > 1 ? '<button type="button" onclick="rcReset()" class="rc-clear">모두 빼기</button>' : '');
    document.getElementById('rc-run-btn').disabled = !rcFiles.length;
}

function rcRun() {
    if (!rcFiles.length) return;
    rcResults = rcCheckAll(rcFiles.flatMap(f => f.records), { ...rcSettings, limits: RC_DEFAULT_SETTINGS.limits }, getByteLength);
    rcTab = 'all';
    rcQuery = '';
    document.getElementById('rc-search').value = '';
    rcRenderResults();
}

// ───────── 결과 ─────────
const RC_FILLER = '<tr class="filler-row" style="height:100%"><td class="excel-num"></td><td></td><td></td><td></td><td class="excel-byte"></td></tr>';

function rcRenderResults() {
    const tbody = document.getElementById('rc-tbody');
    const off = new Set(rcSettings.off || []);
    const count = t => (rcResults || []).reduce((n, r) => n + r.issues.filter(i => t === 'all' || i.type === t).length, 0);
    const tabs = [['all', '전체'], ...Object.entries(RC_TYPES).filter(([t]) => !off.has(t))];
    if (!tabs.some(([t]) => t === rcTab)) rcTab = 'all';
    document.getElementById('rc-tabs').innerHTML = tabs.map(([t, label]) => {
        const n = count(t);
        return `<button type="button" class="${t === rcTab ? 'on' : ''}" onclick="rcTab='${t}';rcRenderResults()">${label}<span class="set-count ${n ? 'rc-has' : ''}">${n}</span></button>`;
    }).join('');
    document.getElementById('rc-export-btn').disabled = !rcResults;

    if (!rcResults) {
        tbody.innerHTML = `<tr class="filler-row" style="height:100%"><td colspan="5" class="rc-empty">파일을 올리고 '점검하기'를 눌러 주세요.</td></tr>`;
        return;
    }

    const q = rcQuery.trim();
    const rows = rcResults
        .map(r => ({ ...r, shown: r.issues.filter(i => rcTab === 'all' || i.type === rcTab) }))
        .filter(r => r.shown.length && (!q || rcWho(r.rec).includes(q) || r.rec.subject.includes(q) || r.rec.area.includes(q)));
    if (!rows.length) {
        tbody.innerHTML = `<tr class="filler-row" style="height:100%"><td colspan="5" class="rc-empty">${q ? '찾는 학생이 없어요.' : '이 항목에서 고칠 곳이 없어요.'}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map((r, i) => {
        const place = [r.rec.grade && r.rec.grade + '학년', r.rec.cls && r.rec.cls + '반', r.rec.num && r.rec.num + '번'].filter(Boolean).join(' ');
        const where = r.rec.subject ? `${rcEscape(r.rec.subject)} (${r.rec.area})` : r.rec.area;
        const fixes = r.shown.map(x => `<li class="rc-${x.level}"><span class="rc-tag">${RC_TYPES[x.type]}</span>${rcEscape(x.why)}</li>`).join('');
        return `<tr><td class="excel-num">${i + 1}</td><td class="rc-who"><b>${rcEscape(r.rec.name)}</b><small>${rcEscape(place)}</small><small class="rc-area">${where}</small></td>`
            + `<td class="result-cell rc-text">${rcHighlight(r.rec.text, r.shown) || '<span class="rc-blank">(비어 있음)</span>'}</td>`
            + `<td class="rc-fix"><ul>${fixes}</ul></td><td class="excel-byte">${getByteLength(r.rec.text)} Byte</td></tr>`;
    }).join('') + RC_FILLER;
}

function rcSearch(v) {
    rcQuery = v;
    rcRenderResults();
}

function rcExport() {
    if (!rcResults) return;
    const head = ['학년', '반', '번호', '성명', '영역', '과목', '점검 항목', '고칠 점', '해당 표현', '기록 내용', '글자 수(바이트)'];
    const body = [];
    for (const r of rcResults) for (const x of r.issues) {
        body.push([r.rec.grade, r.rec.cls, r.rec.num, r.rec.name, r.rec.area, r.rec.subject, RC_TYPES[x.type], x.why, x.what || '', r.rec.text, getByteLength(r.rec.text)]);
    }
    if (!body.length) { showModal('알림', '고칠 곳이 없어서 내려받을 내용이 없어요.', 'info'); return; }
    const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
    ws['!cols'] = [6, 5, 6, 10, 18, 14, 16, 50, 16, 80, 12].map(wch => ({ wch }));
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) for (let C = range.s.c; C <= range.e.c; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (!c) continue;
        const border = { style: 'thin', color: { auto: 1 } };
        c.s = { alignment: { vertical: 'center', horizontal: C >= 7 && C <= 9 && R ? 'left' : 'center', wrapText: true }, border: { top: border, bottom: border, left: border, right: border }, font: { sz: 11 } };
        if (R === 0) { c.s.fill = { fgColor: { rgb: 'FDE68A' } }; c.s.font = { bold: true, color: { rgb: '334155' }, sz: 12 }; }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '점검 결과');
    XLSX.writeFile(wb, '생기부_점검결과.xlsx');
}

// ───────── 점검 기준 (바꾸면 바로 저장하고, 결과가 있으면 다시 점검) ─────────
function rcSaveSettings() {
    const limits = { ...RC_DEFAULT_SETTINGS.limits };
    const repeatMin = Math.min(10, Math.max(2, parseInt(document.getElementById('rc-repeat-min').value, 10) || 3));
    const similarMin = Math.min(100, Math.max(30, parseInt(document.getElementById('rc-similar-min').value, 10) || 60)) / 100;
    const customWords = document.getElementById('rc-custom-words').value.split('\n').map(w => w.trim()).filter(Boolean);
    const off = [...document.querySelectorAll('[data-type]')].filter(i => !i.checked).map(i => i.dataset.type);
    rcSettings = { limits, repeatMin, similarMin, customWords, off };
    try { localStorage.setItem(RC_STORE, JSON.stringify(rcSettings)); } catch (e) {}
    if (rcResults) rcRun(); else rcRenderResults();
}

function rcResetSettings() {
    rcSettings = JSON.parse(JSON.stringify(RC_DEFAULT_SETTINGS));
    try { localStorage.removeItem(RC_STORE); } catch (e) {}
    rcRenderSettings();
    if (rcResults) rcRun(); else rcRenderResults();
}

// 끌어다 놓기 · 점검 기준 바뀜 감지
(function () {
    const dz = document.getElementById('rc-drop');
    const input = document.getElementById('rc-file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { rcAddFiles([...input.files]); input.value = ''; });
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => rcAddFiles([...e.dataTransfer.files]));
    // 숫자 칸은 다 고친 뒤(change), 글 칸도 칸을 벗어날 때 저장
    document.getElementById('check-main').addEventListener('change', e => { if (e.target.closest('.rc-acc')) rcSaveSettings(); });
})();

// ───────── 관리자 페이지 '생활기록부 점검 지침' (보기 · 수정) ─────────
// 지침은 서버(code.gs 금고)에 저장되고, 모든 사용자의 보조 점검과 생성 결과 점검에 쓰임
let rcGuideEditing = false;
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

const rcCard = (n, title, body) => `<div class="guide-card"><div class="guide-head"><span class="guide-num">${n}</span><span class="guide-title">${title}</span></div><div class="rc-guide-body">${body}</div></div>`;
const RC_FIXED_CHIPS = '<span>할수 있다 → 할 수 있다</span><span>띄어쓰기 두 번</span><span>마침표 앞 띄어쓰기</span><span>문단 앞 번호·기호</span><span>특수문자</span>';
const RC_LIMIT_FOOT = '<p class="rc-help mt-2">* 최대 글자수 기준은 학년 단위임.<br>※ 교육정보시스템에서 입력 글자의 단위는 Byte이며, 한글 1자는 3Byte, 영문·숫자 1자는 1Byte, 엔터(Enter)는 1Byte임.</p>';

function rcRenderCheckGuide() {
    const list = document.getElementById('guide-list');
    const g = rcGuideEditing ? rcDraft : RC_GUIDE;
    if (!rcGuideEditing) {
        const forbid = [['no', '기재 불가'], ['check', '확인 필요']].map(([lv, title]) =>
            `<div class="rc-rule-group rc-${lv}"><b>${title}</b><div class="rc-spell-list">${g.forbid.filter(r => (r.level === 'check' ? 'check' : 'no') === lv).map(r => `<span>${rcEscape(r.label)}</span>`).join('')}</div></div>`).join('');
        const spell = g.spell.map(r => `<span><s>${rcEscape(r.wrong)}</s> → ${rcEscape(r.right)}</span>`).join('') + RC_FIXED_CHIPS;
        const hasNote = g.limits.some(r => r.note);
        const limits = g.limits.map((r, i) => {
            const first = i === 0 || g.limits[i - 1].group !== r.group;
            let span = 1;
            while (first && g.limits[i + span] && g.limits[i + span].group === r.group) span++;
            return `<tr>${first ? `<th rowspan="${span}">${rcEscape(r.group)}</th>` : ''}<td>${rcEscape(r.item)}</td><td class="rc-num">${rcEscape(r.max)}</td>${hasNote ? `<td>${rcEscape(r.note)}</td>` : ''}</tr>`;
        }).join('');
        list.innerHTML = '<div class="rc-guide-cols"><div class="rc-guide-left">'
            + rcCard(1, '기재 점검 내용', `<div class="flex flex-col gap-3">${forbid}</div>`)
            + rcCard(2, '맞춤법 점검 내용', `<div class="rc-spell-list">${spell}</div>`)
            + '</div>' + rcCard(3, '영역별 입력 가능 최대 글자수', `<table class="rc-limit-table"><thead><tr><th>영역</th><th>세부항목</th><th>최대 글자수<br>(한글 기준)</th>${hasNote ? '<th>비고</th>' : ''}</tr></thead><tbody>${limits}</tbody></table>` + RC_LIMIT_FOOT) + '</div>';
        return;
    }
    const inp = (sec, i, f, v, ph = '') => `<input class="set-input rc-edit" data-sec="${sec}" data-i="${i}" data-f="${f}" value="${rcEscape(v)}" placeholder="${ph}">`;
    const del = (sec, i) => `<button type="button" class="rc-del" onclick="rcDraftRemove('${sec}', ${i})" aria-label="줄 빼기">빼기</button>`;
    const add = sec => `<button type="button" class="guide-btn mt-2" onclick="rcDraftAdd('${sec}')">+ 줄 더하기</button>`;
    const forbid = g.forbid.map((r, i) => `<tr><td><select class="set-input rc-edit" data-sec="forbid" data-i="${i}" data-f="level"><option value="no"${r.level === 'check' ? '' : ' selected'}>기재 불가</option><option value="check"${r.level === 'check' ? ' selected' : ''}>확인 필요</option></select></td>`
        + `<td>${inp('forbid', i, 'label', r.label, '이름')}</td><td class="rc-words">${inp('forbid', i, 'words', r.words, r.find ? '' : '예: 토익, 토플')}${r.find ? `<span class="rc-auto" tabindex="0" data-tip="${rcEscape(r.findNote || '낱말로 적을 수 없는 찾기 규칙이 함께 들어 있어요.')}">+ 자동 규칙</span>` : ''}</td><td>${inp('forbid', i, 'why', r.why, '고칠 점에 보일 문구')}</td><td>${del('forbid', i)}</td></tr>`).join('');
    const spell = g.spell.map((r, i) => `<tr><td>${inp('spell', i, 'wrong', r.wrong, '틀린 말')}</td><td class="rc-arrow">→</td><td>${inp('spell', i, 'right', r.right, '바른 말')}</td><td>${del('spell', i)}</td></tr>`).join('');
    const limits = g.limits.map((r, i) => `<tr><td>${inp('limits', i, 'group', r.group, '영역')}</td><td>${inp('limits', i, 'item', r.item, '세부항목')}</td><td>${inp('limits', i, 'max', r.max, '예: 500자')}</td><td>${inp('limits', i, 'note', r.note, '')}</td></tr>`).join('');
    list.innerHTML = rcCard(1, '기재 점검 내용', '<p class="rc-help mb-2">찾을 말은 쉼표로 이어 써요. 예: 토익, 토플, 텝스 · 낱말에 띄어쓰기를 넣으면 띄어 쓴 것과 붙여 쓴 것을 모두 찾아요. 예: 인터넷 강의<br><b>+ 자동 규칙</b>은 낱말로 적을 수 없는 찾기(예: 모든 대학 이름)가 함께 들어 있다는 뜻이에요. 마우스를 올리면 무엇을 찾는지 보여요.</p>'
            + `<table class="rc-edit-table"><thead><tr><th style="width:120px">구분</th><th style="width:160px">이름</th><th>찾을 말</th><th>고칠 점 문구</th><th style="width:60px"></th></tr></thead><tbody>${forbid}</tbody></table>${add('forbid')}`)
        + '<div class="rc-guide-pair">' + rcCard(2, '맞춤법 점검 내용', '<p class="rc-help mb-2">틀린 말이 여러 모양이면 쉼표로 이어 써요. 띄어쓰기를 넣으면 띄어 쓴 것과 붙여 쓴 것을 모두 찾아요. 예: 몇 일 → \'몇일\', \'몇 일\' 모두</p>' + `<table class="rc-edit-table"><thead><tr><th>틀린 말</th><th style="width:30px"></th><th>바른 말</th><th style="width:60px"></th></tr></thead><tbody>${spell}</tbody></table>${add('spell')}`
            + `<p class="rc-help mt-3">아래 표기 규칙은 늘 함께 살펴봐요.</p><div class="rc-spell-list mt-1">${RC_FIXED_CHIPS}</div>`)
        + rcCard(3, '영역별 입력 가능 최대 글자수', `<table class="rc-edit-table"><thead><tr><th>영역</th><th>세부항목</th><th style="width:120px">최대 글자수</th><th style="width:110px">비고</th></tr></thead><tbody>${limits}</tbody></table>` + RC_LIMIT_FOOT) + '</div>';
}

function rcCheckGuideActions(box) {
    box.innerHTML = rcGuideEditing
        ? '<button type="button" class="guide-btn" onclick="rcDraftDefault()">처음 지침 불러오기</button>'
          + '<button type="button" class="guide-btn" onclick="rcGuideEditing=false; renderGuide()">취소</button>'
          + '<button type="button" class="guide-btn dark" onclick="rcSaveCheckGuide()">저장</button>'
        : '<button type="button" class="guide-btn" onclick="rcDraft=JSON.parse(JSON.stringify(RC_GUIDE)); rcGuideEditing=true; renderGuide()">수정</button>';
}

function rcDraftAdd(sec) {
    rcDraft[sec].push(sec === 'forbid' ? { level: 'no', label: '', words: '', why: '' } : sec === 'spell' ? { wrong: '', right: '' } : { group: '', item: '', max: '', note: '' });
    rcRenderCheckGuide();
    const rows = document.querySelectorAll(`[data-sec="${sec}"]`);
    rows[rows.length - 1].closest('tr').querySelector('input').focus();
}
function rcDraftRemove(sec, i) {
    rcDraft[sec].splice(i, 1);
    rcRenderCheckGuide();
}
function rcDraftDefault() {
    rcDraft = JSON.parse(JSON.stringify(RC_DEFAULT_GUIDE));
    rcRenderCheckGuide();
    showModal('', '처음 지침으로 채웠어요.<br>살펴본 뒤 [저장]을 눌러 주세요.', 'info');
}

async function rcSaveCheckGuide() {
    const empty = rcDraft.forbid.some(r => !String(r.label || '').trim() || !(String(r.words || '').trim() || r.find))
        || rcDraft.spell.some(r => !String(r.wrong || '').trim() || !String(r.right || '').trim())
        || rcDraft.limits.some(r => !String(r.item || '').trim() || !String(r.max || '').trim());
    if (empty) return showModal('저장 실패', '빈 칸이 있어요. 줄을 채우거나 [빼기]로 지워 주세요.', 'error');
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
    if (t && rcDraft) rcDraft[t.dataset.sec][t.dataset.i][t.dataset.f] = t.value;
});
document.getElementById('guide-list').addEventListener('change', e => {
    const t = e.target.closest('select[data-sec]');
    if (t && rcDraft) rcDraft[t.dataset.sec][t.dataset.i][t.dataset.f] = t.value;
});

rcLoadCheckGuide();
