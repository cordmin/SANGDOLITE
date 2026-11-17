// Google Apps Script 웹 앱 배포 URL을 입력하세요.
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyULttIY_4Lrtsh50cI2LFtTeSlaiZ81U06SH5jyxn0-6d0s-KzUswl13VVxADWigcu/exec";

const keywordDB = {
    '행동특성': { 
        pos: {
            '학교생활': ['규칙준수', '근면성실', '책임감'],
            '교우관계': ['친화력', '배려심', '리더십'],
            '인성태도': ['차분함', '인내심', '겸손함']
        },
        neg: {
            '학교생활': ['무질서', '비성실', '잦은지각'],
            '교우관계': ['소극적', '이기적', '수동적'],
            '인성태도': ['예민함', '끈기부족', '고집센']
        }
    }
};

const FILLER_ROW = '<tr class="filler-row" style="height: 100%;"><td class="excel-num"></td><td></td><td class="excel-byte"></td></tr>';

let area = '자율';
let charLimit = 125; 
const selectedKeywords = new Map(); // 단어 → 'pos'(좋은 태도) | 'neg'(아쉬운 태도)
let rawGeneratedText = ""; 

// 메뉴별 입력·결과를 따로 기억 (메뉴를 오가도 내용 유지)
const tabStates = { '자율': {}, '진로': {}, '동아리': {}, '과세특': {}, '행동특성': {} };

let selectedAutonomyBadges = [];

const presetsByArea = {
    '자율': [
        '정부반장선거', '학급자치활동', '학교폭력예방교육', '장애인식개선교육', '체육한마당',
        '흡연예방교육', '생명존중교육', '다문화이해교육'
    ],
    '진로': [
        '진로심리검사', '진로적성검사', '직업인초청강연', '직업인과의만남',
        '진로융합체험', '현장직업체험', '진로체험의날', '나의꿈발표대회'
    ]
};

function validateStudentCount(input, commit = false) {
    if (input.value === '' && !commit) return;
    input.value = /^\d+$/.test(input.value)
        ? String(Math.min(50, Math.max(1, Number(input.value))))
        : (input.value === '' ? '1' : (input.dataset.validCount || '1'));
    input.dataset.validCount = input.value;
}

window.onload = function() { 
    lucide.createIcons();
    renderAutonomyPresets();
    renderSelectedAutonomyBadges();
    selArea('자율', document.querySelector('.area-btn')); 
};

function renderAutonomyPresets() {
    const container = document.getElementById('preset-group-container');
    if (!container) return;
    document.querySelector('main').classList.toggle('autonomy-layout', area in presetsByArea);
    container.innerHTML = '';
    (presetsByArea[area] || []).forEach(text => {
        const btn = document.createElement('button');
        const isSelected = selectedAutonomyBadges.some(b => b.text === text);
        btn.className = `w-full py-1.5 px-1 text-center rounded-lg text-[12px] font-bold transition-all border shrink-0 truncate ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'}`;
        btn.innerText = text;
        btn.onclick = () => togglePresetAutonomyBadge(text);
        container.appendChild(btn);
    });
}

function togglePresetAutonomyBadge(text) {
    const existingIndex = selectedAutonomyBadges.findIndex(b => b.text === text);
    if (existingIndex > -1) {
        selectedAutonomyBadges.splice(existingIndex, 1);
    } else {
        selectedAutonomyBadges.push({ id: Date.now() + Math.random(), text: text });
    }
    renderSelectedAutonomyBadges();
    renderAutonomyPresets();
}

function addCustomAutonomyBadge() {
    const input = document.getElementById('custom-autonomy-input');
    const val = input.value.trim();
    if (!val) return;
    selectedAutonomyBadges.push({ id: Date.now() + Math.random(), text: val });
    input.value = '';
    renderSelectedAutonomyBadges();
    renderAutonomyPresets();
}

function updateAutonomyBadgeText(id, newText) {
    const badge = selectedAutonomyBadges.find(b => b.id === id);
    if (badge) {
        badge.text = newText.trim() || '자율활동';
    }
    renderAutonomyPresets();
}

function removeAutonomyBadge(id) {
    selectedAutonomyBadges = selectedAutonomyBadges.filter(b => b.id !== id);
    renderSelectedAutonomyBadges();
    renderAutonomyPresets();
}

function renderSelectedAutonomyBadges() {
    const container = document.getElementById('selected-autonomy-badges');
    if (!container) return;
    container.dataset.emptyMessage = `${area} 활동 내용을 위에서 선택하거나 직접 추가해주세요`;
    container.innerHTML = '';

    selectedAutonomyBadges.forEach(b => {
        const chip = document.createElement('div');
        chip.className = "relative min-w-0";

        const textBox = document.createElement('span');
        textBox.className = "block w-full min-h-[32px] px-1 py-1.5 rounded-lg bg-white border border-slate-300 text-[12px] text-center font-bold text-slate-800 cursor-text whitespace-pre-wrap break-words";
        textBox.contentEditable = "true";
        textBox.spellcheck = false;
        textBox.innerText = b.text;
        textBox.onblur = (e) => updateAutonomyBadgeText(b.id, e.target.innerText.trim());

        const closeBtn = document.createElement('button');
        closeBtn.className = "absolute -top-0.5 -right-1.5 w-3 h-3 rounded-full bg-red-500 text-white text-[7px] leading-none flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm";
        closeBtn.innerText = "✕";
        closeBtn.onclick = () => removeAutonomyBadge(b.id);

        chip.appendChild(textBox);
        chip.appendChild(closeBtn);
        container.appendChild(chip);
    });
}

function showModal(title, msg, type = 'info') {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-desc').innerHTML = msg;
    // 오류 창만 그림과 제목을 보여주고, 안내 창은 문구만 보여줌
    document.getElementById('modal-icon').classList.toggle('hidden-element', type !== 'error');
    document.getElementById('modal-title').classList.toggle('hidden-element', type !== 'error');
    document.getElementById('custom-modal').classList.remove('hidden-element');
}
function closeModal() { document.getElementById('custom-modal').classList.add('hidden-element'); }

function translateError(errStr) {
    const err = errStr.toLowerCase();
    if(err.includes("quota") || err.includes("429")) return "일일 AI 사용량을 초과했거나 요청이 너무 많습니다.<br>잠시 후 다시 시도해주세요.";
    if(err.includes("network") || err.includes("통신 실패") || err.includes("fetch") || err.includes("failed to fetch")) return "GAS API 통신에 실패했습니다.<br>GAS 웹앱 URL 설정 및 네트워크 상태를 확인해주세요.";
    if(err.includes("safety") || err.includes("blocked")) return "입력하신 내용 중에 AI 안전 필터(욕설, 폭력성 등)에 걸리는 단어가 포함된 것 같습니다.<br>내용을 순화하여 다시 작성해주세요.";
    if(err.includes("api key")) return "AI 시스템 인증에 문제가 발생했습니다.<br>관리자에게 문의해주세요.";
    return `알 수 없는 오류가 발생했습니다.<br><span class="text-xs text-slate-400 mt-2 block">(${errStr})</span>`;
}

function selArea(v, el) { 
    if (area) {
        tabStates[area] = {
            case: document.getElementById('case-inp').value,
            subj: document.getElementById('subj-inp').value,
            autonomyBadges: [...selectedAutonomyBadges],
            resultHtml: document.getElementById('result-tbody').innerHTML,
            resultText: rawGeneratedText
        };
    }

    area = v; 
    document.querySelectorAll('.area-btn').forEach(b => b.classList.remove('active-main'));
    el.classList.add('active-main');

    const keySec = document.getElementById('keyword-section');
    const caseGrp = document.getElementById('case-group');
    const autoBadgeSec = document.getElementById('autonomy-badge-section');

    const caseLabel = document.getElementById('case-label');
    const caseInp = document.getElementById('case-inp');
    const subjInp = document.getElementById('subj-inp');

    rawGeneratedText = tabStates[area].resultText || "";
    document.getElementById('result-tbody').innerHTML = tabStates[area].resultHtml || FILLER_ROW;

    document.getElementById('student-count').value = 1;
    document.getElementById('student-count').dataset.validCount = '1';

    if (area === '자율' || area === '진로') {
        autoBadgeSec.classList.remove('hidden-element');
        caseGrp.classList.add('hidden-element');
        caseGrp.classList.remove('merged');
        keySec.classList.add('hidden-element');

        document.getElementById('autonomy-label').innerText = (area === '자율') ? '자율활동 내용 선택' : '진로활동 내용 선택';
        selectedAutonomyBadges = tabStates[area].autonomyBadges || [];
        renderSelectedAutonomyBadges();
        renderAutonomyPresets();
    } else if (area === '행동특성') {
        autoBadgeSec.classList.add('hidden-element');
        caseGrp.classList.remove('hidden-element');
        caseGrp.classList.remove('merged');
        keySec.classList.remove('hidden-element');

        caseLabel.innerText = '학생 관찰 기록 (필수)';
        caseInp.placeholder = '예시: 매사에 성실함, 책임감이 강함, 수업 시간에 산만함, 운동 좋아함';
    } else {
        autoBadgeSec.classList.add('hidden-element');
        caseGrp.classList.remove('hidden-element');
        keySec.classList.add('hidden-element');

        // 동아리·과세특: 이름 칸 + 활동 내용 칸을 한 상자로 보여줌
        const isClub = area === '동아리';
        caseGrp.classList.add('merged');
        document.getElementById('merge-name-cell').innerText = isClub ? '동아리 이름' : '과목 이름';
        document.getElementById('merge-body-title').innerText = isClub ? '동아리 활동 내용' : '교과 학습 및 활동 내용';
        caseLabel.innerText = isClub ? '스포츠 & 동아리 정보 입력' : '교과 정보 입력';
        subjInp.placeholder = isClub ? '예시: 과학영화 감상반, 농구반, 건강 걷기반' : '예시: 국어, 영어, 수학, 과학';
        caseInp.placeholder = isClub ? '예시: 또래 상담 멘토링, 영화 감상문 발표, 점자책 만들기' : '예시: 밀도, 순물질과 혼합물, 거울과 렌즈 (키워드로만 입력해도 OK)';
    }

    document.getElementById('case-inp').value = tabStates[area].case || '';
    document.getElementById('subj-inp').value = tabStates[area].subj || '';

    updateKeywords();
}

function selChar(v) {
    charLimit = v;
}

function updateKeywords() {
    selectedKeywords.clear();
    const box = document.getElementById('keyword-pairs');
    box.innerHTML = '';
    if (!keywordDB[area]) return;
    const pos = keywordDB[area].pos || {};
    const neg = keywordDB[area].neg || {};
    // 같은 분류의 같은 순서 단어끼리 짝 (예: 규칙준수 ↔ 무질서)
    for (const category of Object.keys(pos)) {
        (pos[category] || []).forEach((p, i) => {
            const n = (neg[category] || [])[i];
            if (n) box.appendChild(makeKeywordPair(p, n));
        });
    }
}

function pickKeywords(side) {
    return [...selectedKeywords].filter(([, s]) => s === side).map(([kw]) => kw).join(', ');
}

function makeKeywordPair(p, n) {
    const pair = document.createElement('div');
    pair.className = 'kw-pair';
    pair.innerHTML = '<span class="kw-slide"></span>';
    [['pos', p], ['neg', n]].forEach(([side, kw]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = kw;
        btn.onclick = () => {
            const off = pair.dataset.pick === side; // 이미 고른 쪽을 다시 누르면 취소
            selectedKeywords.delete(p); selectedKeywords.delete(n);
            if (off) { delete pair.dataset.pick; return; }
            pair.classList.toggle('kw-instant', !pair.dataset.pick);
            void pair.offsetWidth;
            pair.dataset.pick = side; pair.dataset.side = side;
            selectedKeywords.set(kw, side);
        };
        pair.appendChild(btn);
    });
    return pair;
}

async function runAI() {
    let cases = "";
    if (area === '자율' || area === '진로') {
        if (selectedAutonomyBadges.length === 0) {
            showModal('입력 확인', `${area} 활동 내용을 최소 1개 이상 선택하거나<br>직접 입력해 주세요.`, 'info');
            return;
        }
        cases = selectedAutonomyBadges.map(b => b.text.trim()).filter(t => t.length > 0).join(', ');
    } else {
        cases = document.getElementById('case-inp').value.trim();
        if(!cases) {
            showModal('입력 확인', '활동 내용이나 관찰 기록을<br>먼저 입력해 주세요.', 'info');
            return;
        }
    }

    const btn = document.getElementById('run-btn');
    const loadBar = document.getElementById('loading-bar');
    const loadPercent = document.getElementById('loading-percent');

    btn.disabled = true;

    loadBar.style.width = '6%';
    loadPercent.innerText = '0%';

    const countInput = document.getElementById('student-count');
    validateStudentCount(countInput, true);
    const sentenceCount = Number(countInput.value);

    const chunkSize = 5;
    const chunks = [];

    // 입력 칸 전체가 한 덩어리 재료(가르친 활동 전체 / 한 학생의 여러 행동)이므로
    // 줄 수와 상관없이 모든 요청에 전체 내용을 그대로 보냄. 5문장씩 나눠 요청.
    for (let i = 0; i < sentenceCount; i += chunkSize) {
        chunks.push({ sentenceCount: Math.min(chunkSize, sentenceCount - i), cases });
    }

    const totalChunks = chunks.length;
    let completedCount = 0;
    let allResults = [];
    let accumulatedText = "";

    for (let i = 0; i < totalChunks; i++) {
        const chunk = chunks[i];

        const startPercent = Math.round((completedCount / sentenceCount) * 100);
        const targetPercent = Math.round(((completedCount + chunk.sentenceCount) / sentenceCount) * 100);
        const maxSimulated = startPercent + Math.round((targetPercent - startPercent) * 0.88);

        let currentDisplay = Math.max(startPercent, 6);
        loadBar.style.width = currentDisplay + '%';
        loadPercent.innerText = currentDisplay + '%';

        const progressInterval = setInterval(() => {
            if (currentDisplay < maxSimulated) {
                const step = Math.max(1, Math.ceil((maxSimulated - currentDisplay) * 0.08));
                currentDisplay = Math.min(maxSimulated, currentDisplay + step);
                loadBar.style.width = currentDisplay + '%';
                loadPercent.innerText = currentDisplay + '%';
            }
        }, 220);

        const payload = {
            area: area,
            charLimit: charLimit,
            sentenceCount: chunk.sentenceCount,
            subject: document.getElementById('subj-inp').value,
            cases: chunk.cases,
            posKeywords: pickKeywords('pos'),
            negKeywords: pickKeywords('neg'),
            keywords: Array.from(selectedKeywords.keys()).join(', ') // 예전 서버 호환용
        };

        try {
            let res;
            if (typeof google !== 'undefined' && google.script && google.script.run) {
                res = await new Promise((resolve, reject) => {
                    google.script.run
                        .withSuccessHandler(resolve)
                        .withFailureHandler(err => reject(new Error(err && err.message ? err.message : String(err))))
                        .generateRecordFromAI(payload);
                });
            } else {
                if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes("YOUR_GAS_WEB_APP_URL_HERE")) {
                    throw new Error("GAS 웹 앱 배포 URL이 설정되지 않았습니다. index.html 파일의 GAS_WEB_APP_URL 변수에 배포된 URL을 입력하세요.");
                }
                const response = await fetch(GAS_WEB_APP_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "text/plain;charset=utf-8"
                    },
                    body: JSON.stringify(payload)
                });
                res = await response.json();
            }

            clearInterval(progressInterval);

            if (res.success) {
                completedCount += chunk.sentenceCount;
                const currentProgress = Math.round((completedCount / sentenceCount) * 100);
                loadBar.style.width = currentProgress + '%';
                loadPercent.innerText = currentProgress + '%';

                const rawLines = res.result.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                const cleanItems = rawLines.map(line => line.replace(/^(?:\d+[\.\)\-]*\s*)+/, '').trim()).filter(l => l.length > 0);

                if (cleanItems.length === 0) {
                    const cleanRes = res.result.replace(/^(?:\d+[\.\)\-]*\s*)+/, '').trim();
                    allResults.push(cleanRes);
                    accumulatedText += `${completedCount - chunk.sentenceCount + 1}. ${cleanRes}\n`;
                } else {
                    cleanItems.forEach((item, idx) => {
                        const cleanText = item.replace(/^(?:\d+[\.\)\-]*\s*)+/, '').trim();
                        allResults.push(cleanText);
                        const seqNum = completedCount - chunk.sentenceCount + idx + 1;
                        accumulatedText += `${seqNum}. ${cleanText}\n`;
                    });
                }
            } else {
                throw new Error(res.error || "AI 생성 오류가 발생했습니다.");
            }
        } catch (err) {
            clearInterval(progressInterval);
            btn.disabled = false;
            showModal('생성 실패', `생성 진행 중 오류가 발생했습니다.<br>완료된 부분까지만 보관하거나 다시 시도해주세요.<br><br>오류내용: ${translateError(err.toString())}`, 'error');
            return;
        }
    }

    loadBar.style.width = '100%';
    loadPercent.innerText = '100%';

    setTimeout(() => {
        btn.disabled = false;

        rawGeneratedText = accumulatedText.trim();
        renderTable(allResults);
    }, 500);
}

function getByteLength(text) {
    if (!text) return 0;
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (text[i] === '\r') {
            if (i + 1 < text.length && text[i + 1] === '\n') {
                i++;
            }
            bytes += 2;
        } else if (text[i] === '\n') {
            bytes += 2;
        } else if (code <= 0x007f) {
            bytes += 1;
        } else {
            if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
                const nextCode = text.charCodeAt(i + 1);
                if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
                    i++;
                }
            }
            bytes += 3;
        }
    }
    return bytes;
}

function renderTable(items) {
    const tbody = document.getElementById('result-tbody');
    tbody.innerHTML = '';
    items.forEach((item, index) => {
        const cleanText = item.trim().replace(/^(?:\d+[\.\)\-]*\s*)+/, '').trim();
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="excel-num">${index + 1}</td><td class="result-cell">${cleanText.replace(/\n/g, '<br>')}</td><td class="excel-byte">${getByteLength(cleanText)} Byte</td>`;
        tbody.appendChild(tr);
    });
    tbody.insertAdjacentHTML('beforeend', FILLER_ROW); // 표 아래 빈 공간 채우기
}

function exportExcel(tableId, fileName) {
    try {
        const bodyTable = document.getElementById(tableId);
        if (!bodyTable.querySelector('tbody tr:not(.filler-row)')) {
            showModal('알림', '다운로드할 문장이 없습니다.', 'info');
            return;
        }

        const table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>순</th><th>특기사항</th><th>글자 수</th></tr></thead>';
        const clonedBody = bodyTable.tBodies[0].cloneNode(true);
        clonedBody.querySelectorAll('.filler-row').forEach(r => r.remove());
        table.appendChild(clonedBody);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.table_to_sheet(table);

        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

        ws['!cols'] = [
            { wch: 8 }, 
            { wch: 100 },
            { wch: 14 }
        ];

        const range = XLSX.utils.decode_range(ws['!ref']);
        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cell_ref = XLSX.utils.encode_cell({ c: C, r: R });

                if (!ws[cell_ref]) continue;

                ws[cell_ref].s = {
                    alignment: { vertical: "center", horizontal: "center", wrapText: true },
                    border: {
                        top: { style: "thin", color: { auto: 1 } }, 
                        bottom: { style: "thin", color: { auto: 1 } },
                        left: { style: "thin", color: { auto: 1 } }, 
                        right: { style: "thin", color: { auto: 1 } }
                    }
                };

                if (R === 0) {
                    ws[cell_ref].s.fill = { fgColor: { rgb: "FDE68A" } }; 
                    ws[cell_ref].s.font = { bold: true, color: { rgb: "334155" }, sz: 12 };
                } else {
                    ws[cell_ref].s.font = { sz: 11 };
                    if (C === 1) ws[cell_ref].s.alignment.horizontal = "left"; 
                    else ws[cell_ref].s.alignment.horizontal = "center";
                }
            }
        }

        XLSX.writeFile(wb, fileName + ".xlsx");

    } catch (err) {
        showModal('오류', '엑셀 파일을 생성하는 중 문제가 발생했습니다.<br>' + err.message, 'error');
    }
}
