// ─────────────────────────────────────────────────────────────
// 생활기록부 보조 점검 (규칙·계산)
// 나이스에서 내려받은 엑셀·PDF를 읽어 「2026학년도 학교생활기록부 기재요령(중학교)」에 맞는지 살펴봄.
// 모든 계산은 브라우저 안에서만 하고, 어디로도 보내지 않음.
// 글자 수(바이트)는 app.js의 getByteLength를 그대로 씀 (한글 3, 영문·숫자·띄어쓰기 1, 엔터 1바이트).
// ─────────────────────────────────────────────────────────────

const RC_SETUK = '과목별 세부능력 및 특기사항';
const RC_PERSONAL = '개인별 세부능력 및 특기사항';
const RC_JAYUL = '자율·자치활동';
const RC_CLUB = '동아리활동';
const RC_CAREER = '진로활동';
const RC_FREE = '자유학기활동';
const RC_HAENG = '행동특성 및 종합의견';

// 영역별 최대 글자 수(바이트) — 2026 기재요령(중학교) '영역별 입력 가능 최대 글자수' 표 (학년 단위)
const RC_DEFAULT_SETTINGS = {
    limits: { [RC_SETUK]: 1500, [RC_PERSONAL]: 1500, [RC_JAYUL]: 1500, [RC_CLUB]: 1500, [RC_CAREER]: 1500, [RC_FREE]: 3000, [RC_HAENG]: 900, '기타': 1500 },
    off: []            // 끈 점검 항목 (RC_TYPES 열쇠)
};

// 점검 종류 (화면 탭 순서)
const RC_TYPES = {
    forbid: '기재 요령',
    length: '최대 글자수',
    spell: '맞춤법',
    ending: '종결 어미',
    similar: '똑같은 문장',
    empty: '미입력 항목'
};

// ───────── 점검 지침 (관리자 페이지 '생활기록부 점검 지침'에서 고치면 서버에 저장되고 모두에게 적용) ─────────
// 아래는 처음 지침. 서버에 저장된 지침이 있으면 rcApplyGuide()로 바꿔 끼움.
// words·wrong: 찾을 낱말을 쉼표로 이어 씀. 낱말 속 띄어쓰기는 '띄어 써도 붙여 써도 찾음'. 관리자가 고치는 칸
// find: 낱말로 나타낼 수 없는 '자동 규칙'(정규식). 관리자 화면에는 findNote(쉬운 설명)만 보이고 그대로 지켜짐
// level: 'no' = 기재 불가, 'check' = 확인 필요. allowIn: 이 영역에서는 넘어감, skip: 찾은 말이 이 낱말이면 넘어감

// 기재 점검 내용 (2026 기재요령 '학교생활기록부 작성 시 유의사항'·영역별 기재요령)
const RC_DEFAULT_FORBID = [
    { level: "no", label: "대회", words: "대회, 경진, 경시, 올림피아드, 공모전", why: "'대회'라는 말과 대회 참가·준비 사실은 수상경력 말고는 쓸 수 없어요. 행사로 이름만 바꿔 써도 안 돼요." },
    { level: "no", label: "수상 사실", words: "입상, 표창, 감사장, 공로상, 최우수상, 우수상, 장려상, 금상, 은상", find: "수상(?!자|스키|하)", findNote: "'수상'이라는 말도 찾아요. 단, '수상자', '수상스키', '수상하다'는 빼요.", why: "상을 받은 사실은 수상경력에만 써요." },
    { level: "no", label: "교외상", words: "대통령 상, 국무총리 상, 장관 상, 교육감 상, 도지사 상, 시장 상, 군수 상, 구청장 상, 국회의원 상, 이사장 상, 회장 상", why: "교외 기관·단체에서 받은 상은 쓸 수 없어요." },
    { level: "no", label: "공인어학시험", words: "토익, 토플, 텝스, 오픽, TOEIC, TOEFL, TEPS, IELTS, OPIc, HSK, JLPT, JPT, DELF, DALF, TestDaF, TORFL, DELE, 상공회의소 한자, 한자 능력 검정, 실용 한자, 한자 급수, 상무 한검, 한자 자격 검정", find: "\\bZD\\b|\\bDSH\\b|\\bDSD\\b", findNote: "독일어 시험 ZD·DSH·DSD도 찾아요. 다른 영어 낱말 속에 섞인 글자는 빼요.", why: "공인어학시험 참여 사실과 성적은 쓸 수 없어요." },
    { level: "no", label: "인증시험", words: "인증 시험, 검정 시험, 급수 시험, 급수 취득", find: "\\d\\s*급\\s*(?:취득|합격)", findNote: "'3급 취득', '2급 합격'처럼 숫자 + 급 + 취득·합격도 찾아요.", why: "교내외 인증시험 참여 사실이나 성적은 쓸 수 없어요." },
    { level: "no", label: "자격증", words: "자격증, 컴퓨터 활용 능력, 한국사 능력 검정, 워드 프로세서", find: "[가-힣]+기능사|\\bITQ\\b|\\bGTQ\\b|\\bMOS\\b", findNote: "'제빵기능사', '조리기능사'처럼 '기능사'로 끝나는 모든 자격증과 ITQ·GTQ·MOS도 찾아요.", why: "자격증 이름과 취득 사실은 쓸 수 없어요." },
    { level: "no", label: "해외 활동", words: "어학 연수, 해외 연수, 해외 봉사, 해외 탐방, 해외 캠프, 해외 활동", why: "어학연수·봉사 같은 해외 활동은 쓸 수 없어요." },
    { level: "no", label: "사교육", words: "과외, 인터넷 강의, 인강", find: "(?<!대)학원", findNote: "'학원'도 찾아요. 단, '대학원'은 빼요.", why: "사교육과 관련된 내용은 쓸 수 없어요." },
    { level: "no", label: "특허·지식재산권", words: "특허, 실용신안, 지식 재산권, 상표 출원, 상표 등록, 디자인 출원, 디자인 등록", why: "특허·실용신안·상표·디자인 출원이나 등록 사실은 쓸 수 없어요." },
    { level: "no", label: "도서 출간", words: "저서, 책 출간, 책을 출간, 책 출판, 책을 출판, 도서 출간, 도서 출판, 시집 발간, 소설 출간, 출간함, 출간했, 출간하여", why: "책을 펴낸 사실은 쓸 수 없어요." },
    { level: "no", label: "논문·학회 발표", words: "학회지, 학회 발표, 학회에서 발표, 학술지 게재, 학술지에 게재, 논문 게재, 논문 투고, 논문 등재", why: "논문 투고·등재, 학회 발표 사실은 쓸 수 없어요." },
    { level: "no", label: "부모·친인척 지위", words: "", find: "(?:아버지|어머니|부모님?|아빠|엄마|부친|모친|친척|삼촌|외삼촌|이모|고모|큰아버지|작은아버지|할아버지|할머니)[가-힣\\s]{0,10}?(?:의사|변호사|판사|검사|교수|대표|사장|회장|임원|국회의원|CEO|공무원|교사|회사|기업|병원|직장|근무|운영|직업|직위)", findNote: "아버지·어머니·부모님·삼촌 같은 가족 낱말 뒤 10글자 안에 의사·변호사·교수·대표·공무원·회사·병원·근무·직업 같은 말이 오면 찾아요.", why: "부모·친인척의 직업·직장·직위를 짐작할 수 있는 내용은 쓸 수 없어요." },
    { level: "no", label: "장학생·장학금", words: "장학금, 장학생", why: "장학생·장학금 관련 내용은 쓸 수 없어요." },
    { level: "no", label: "대학 이름", words: "", find: "[가-힣]{2,}대학교|[가-힣]{2,}대(?:학)?\\s*(?:교수|병원|부설)", findNote: "'서울대학교'처럼 '대학교'로 끝나는 모든 대학 이름과, '○○대 교수', '○○대 병원', '○○대 부설'을 찾아요. '○○대학교'처럼 이름을 가린 건 빼요.", why: "구체적인 대학 이름은 쓸 수 없어요." },
    { level: "no", label: "K-MOOC·KOCW", words: "K-MOOC, KMOOC, MOOC, KOCW, 무크", why: "K-MOOC·MOOC·KOCW 관련 내용은 쓸 수 없어요." },
    { level: "no", label: "방과후학교", words: "방과 후 학교, 방과 후 수업, 방과 후 교실, 방과 후 활동, 방과 후 프로그램", why: "방과후학교 활동은 쓸 수 없어요." },
    { level: "no", label: "소논문·연구보고서", words: "소논문, 연구 보고서, R&E", why: "소논문·연구보고서의 제목·주제·참여 인원 같은 실적은 쓸 수 없어요. 세특에는 작성 관련 사항도 쓸 수 없어요." },
    { level: "check", label: "기관·단체·상호명", words: "", find: "[가-힣A-Za-z]{2,}(?:재단|협회|연구원|연구소|박물관|미술관|과학관|기념관|센터|주식회사|생태원|수목원|식물원|천문대)|㈜", findNote: "'○○재단', '○○협회', '○○연구소', '○○박물관', '○○과학관', '○○센터', '○○생태원', '○○수목원'처럼 끝나는 모든 기관 이름과 '㈜'를 찾아요.", why: "구체적인 기관·단체·상호 이름은 쓸 수 없어요. 교육부·교육청 같은 교육관련기관은 써도 돼요." },
    { level: "check", label: "강사 이름", words: "", find: "(?<![가-힣])[가-힣]{2,4}\\s*(?:강사|작가|박사|교수)(?:님)?(?:의|을|를|와|과|에게|이|가)?\\s*(?:강연|특강|강의|초청)", findNote: "'홍길동 강사의 특강', '김○○ 작가 초청 강연'처럼 이름(2~4글자) + 강사·작가·박사·교수 + 강연·특강·강의·초청을 찾아요.", why: "강의를 한 강사의 이름은 쓸 수 없어요." },
    { level: "no", label: "영재교육기관 이름", words: "", find: "[가-힣]{2,}(?:교육청|교육지원청|대학교|대학|중학교|초등학교|고등학교)\\s*(?:부설\\s*)?[가-힣]{0,4}영재\\s*(?:교육원|학급|학교)", findNote: "'천안교육지원청 영재교육원', '○○대학교 부설 과학영재교육원'처럼 기관 이름이 붙은 영재교육원·영재학급을 찾아요.", why: "영재교육 이수내용에도 기관 이름은 쓰지 않아요. '영재교육원', '영재학급'처럼만 쓰세요." },
    { level: "no", label: "영재교육(세특 제외)", words: "영재 교육원, 영재 학급, 영재 학교, 영재 교육", why: "영재교육 내용은 과목별 세특의 '영재교육 기록사항'에만 쓸 수 있어요.", allowIn: [RC_SETUK, RC_PERSONAL] },
    { level: "check", label: "성적·등급·석차", words: "모의고사, 모의평가, 내신 등급, 석차, 백분위", find: "[1-9]\\s*등급|전교\\s*\\d+\\s*등", findNote: "'1등급'~'9등급', '전교 3등'처럼 숫자가 들어간 등급·등수도 찾아요.", why: "시험 성적·등급·석차는 특기사항에 쓰지 않아요. (학생건강체력평가 1등급은 체육 세특에 쓸 수 있어요.)" },
    { level: "check", label: "영어 낱말", words: "", find: "\\b[A-Za-z][A-Za-z]+\\b", findNote: "영어로 된 모든 낱말을 찾아요. 단, CEO·PD·UCC·IT·POP·CF·TV·PAPS·SNS·PPT·AI는 빼요.", why: "문자는 한글로 써요. 외국인 이름, 책 이름 같은 고유명사나 CEO·SNS·AI 같은 일반화된 말은 써도 돼요.", skip: "CEO|PD|UCC|IT|POP|CF|TV|PAPS|SNS|PPT|AI" }
];

// 맞춤법 점검 내용 (자주 틀리는 말 → 바른 말)
// 사전이 놓치는 띄어쓰기·문맥 표현과 짧은 어절만 보완 규칙으로 유지함.
const RC_DEFAULT_SPELL = [
    {
        "wrong": "몇 일",
        "right": "며칠"
    },
    {
        "wrong": "됬",
        "right": "됐"
    },
    {
        "wrong": "구지",
        "right": "굳이"
    },
    {
        "wrong": "문안하",
        "right": "무난하"
    },
    {
        "wrong": "할께",
        "right": "할게"
    },
    {
        "wrong": "않 하",
        "right": "안 하"
    },
    {
        "wrong": "않 되",
        "right": "안 되"
    },
    {
        "wrong": "바램",
        "right": "바람"
    }
];

// 예전 저장 지침에 남은 동일한 기본 예시만 정리함. 수정한 교정안과 새 규칙은 유지함.
const RC_RETIRED_SPELL = [{"wrong":"금새","right":"금세"},{"wrong":"역활","right":"역할"},{"wrong":"희안","right":"희한"},{"wrong":"오랫만","right":"오랜만"},{"wrong":"일일히","right":"일일이"},{"wrong":"깨끗히","right":"깨끗이"},{"wrong":"곰곰히","right":"곰곰이"},{"wrong":"틈틈히","right":"틈틈이"},{"wrong":"꼼꼼이","right":"꼼꼼히"},{"wrong":"솔직이","right":"솔직히"},{"wrong":"일찌기","right":"일찍이"},{"wrong":"더우기","right":"더욱이"},{"wrong":"갯수","right":"개수"},{"wrong":"촛점","right":"초점"},{"wrong":"댓가","right":"대가"},{"wrong":"어의없","right":"어이없"},{"wrong":"내노라","right":"내로라"},{"wrong":"설겆이","right":"설거지"},{"wrong":"뵈요","right":"봬요"},{"wrong":"왠만","right":"웬만"},{"wrong":"웬지","right":"왠지"},{"wrong":"어떻해","right":"어떡해"},{"wrong":"할려고","right":"하려고"},{"wrong":"넓따","right":"널따"},{"wrong":"짧다랗","right":"짤따랗"},{"wrong":"가르켜","right":"가르쳐"}];

// 늘 살펴보는 표기 규칙 (관리자 지침과 상관없이 고정)
const RC_SPELL_FIXED = [
    [/([을할볼될갈올알줄낼칠쓸])수\s?있/g, '$1 수 있'],
    [/ {2,}/g, '띄어쓰기 한 번'], [/ +([.,])/g, '$1'],
    // 기재요령: 서술형 항목에 특수문자·문단 구분 기호(번호)는 쓰지 않음
    [/^[ \t]*(?:\d{1,2}[.)](?!\d)|[①-⑳]|[-•▪](?=\s))[ \t]*/gm, '번호·기호'], // ★ 같은 특수문자는 아래 규칙에서 한 번만 잡음
    [/[★☆♥♡◆◇■□▶▷◀◁※♣♠◎]/g, '특수문자']
];
// 바로 고쳐 줄 수 없는 것(설명만 보여 줌)
const RC_SPELL_NOTE = {
    '띄어쓰기 한 번': '띄어쓰기가 두 번 이상 들어갔어요.',
    '번호·기호': '문단 앞 번호나 기호는 쓰지 않아요.',
    '특수문자': '서술형 항목에는 특수문자를 쓰지 않아요.'
};

// 영역별 입력 가능 최대 글자수 (2026 기재요령 중학교 162쪽 중 보조 점검이 실제로 살펴보는 영역만). key 영역의 글자 수로 점검함
const RC_DEFAULT_LIMITS = [
    { group: '창의적 체험활동상황', item: '자율·자치활동 특기사항', max: '500', key: RC_JAYUL },
    { group: '창의적 체험활동상황', item: '동아리활동 특기사항', max: '500', key: RC_CLUB },
    { group: '창의적 체험활동상황', item: '진로활동 특기사항', max: '500', key: RC_CAREER },
    { group: '자유학기활동상황', item: '진로탐색활동 특기사항', max: '1000', key: RC_FREE },
    { group: '자유학기활동상황', item: '주제선택활동 특기사항', max: '1000', key: RC_FREE },
    { group: '자유학기활동상황', item: '예술·체육활동 특기사항', max: '1000', key: RC_FREE },
    { group: '자유학기활동상황', item: '동아리활동 특기사항', max: '1000', key: RC_FREE },
    { group: '교과학습발달상황', item: '과목별 세부능력 및 특기사항', max: '500', key: RC_SETUK },
    { group: '교과학습발달상황', item: '개인별 세부능력 및 특기사항', max: '500', key: RC_PERSONAL },
    { group: '행동특성 및 종합의견', item: '행동특성 및 종합의견', max: '300', key: RC_HAENG }
];

const RC_DEFAULT_GUIDE = { forbid: RC_DEFAULT_FORBID, spell: RC_DEFAULT_SPELL, limits: RC_DEFAULT_LIMITS };
let RC_GUIDE = RC_DEFAULT_GUIDE;   // 지금 쓰는 지침
let RC_FORBID_RULES = [];          // 지침을 정규식으로 바꾼 것
let RC_SPELL_RULES = [];

// 쉼표 낱말 목록 + 자동 규칙 → 찾기 규칙 하나로 (낱말 속 기호는 글자 그대로, 띄어쓰기는 '띄어 써도 붙여 써도')
function rcPattern(words, find) {
    const list = String(words || '').split(',').map(w => w.trim()).filter(Boolean)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'));
    return [find, ...list].filter(Boolean).join('|');
}

// 지침(자료)을 점검에 쓰는 모양으로 바꿈. 잘못된 찾을 말은 건너뜀
function rcLimitNumber(value) {
    const text = String(value ?? '').trim();
    // 예전 저장값(500자, 1,000자, 과목별 500자)을 숫자로 이관함.
    const match = text.match(/^(?:과목별\s*)?([0-9]+(?:,[0-9]{3})*)\s*자?$/);
    const n = match ? Number(match[1].replace(/,/g, '')) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? String(n) : '';
}

function rcApplyGuide(guide) {
    const original = guide && Array.isArray(guide.forbid) ? guide : RC_DEFAULT_GUIDE;
    const savedLimits = original.limits || [];
    const fixedLimits = RC_DEFAULT_LIMITS.map(base => {
        const sameArea = savedLimits.filter(row => row.key === base.key);
        const saved = sameArea.find(row => row.item === base.item) || (sameArea.length === 1 ? sameArea[0] : null);
        return { ...base, max: rcLimitNumber(saved?.max) || base.max };
    });
    const g = { ...original, limits: fixedLimits, spell: (original.spell || []).filter(row => row.find || !RC_RETIRED_SPELL.some(old => old.wrong === row.wrong && old.right === row.right)) };
    const re = (s, flags) => { try { return s ? new RegExp(s, flags) : null; } catch (e) { return null; } };
    RC_GUIDE = g;
    RC_FORBID_RULES = g.forbid.map(r => ({ ...r, re: re(rcPattern(r.words, r.find), 'gi'), skip: r.skip ? re('^(?:' + r.skip + ')$', 'i') : null })).filter(r => r.re);
    RC_SPELL_RULES = (g.spell || []).map(r => [re(rcPattern(r.wrong, r.find), 'g'), r.right]).filter(([r]) => r).concat(RC_SPELL_FIXED);
    // 한글 글자 수 × 3바이트. 자유학기는 세부 활동별 기준도 각각 적용함.
    const limits = { ...RC_BASE_LIMITS }, got = {};
    for (const row of g.limits || []) {
        const n = parseInt(String(row.max || '').replace(/[^0-9]/g, ''), 10);
        if (row.key && n) {
            got[row.key] = limits[row.key] = Math.max(got[row.key] || 0, n * 3);
            if (row.key === RC_FREE) limits[row.key + '|' + row.item.replace(/\s*특기사항.*$/, '')] = n * 3;
        }
    }
    RC_DEFAULT_SETTINGS.limits = limits;
}
const RC_BASE_LIMITS = { ...RC_DEFAULT_SETTINGS.limits };
rcApplyGuide(RC_DEFAULT_GUIDE);

function rcEscape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ───────── 엑셀 읽기 ─────────
// 나이스 엑셀은 위쪽에 제목 줄이 몇 줄 있고, 그 아래 '성명' 같은 머리글 줄이 있음.
// 긴 글은 여러 줄로 나뉘어 있기도 해서, 이름 없이 글만 있는 줄은 바로 위 학생 글에 이어 붙임.
const RC_HEAD = {
    grade: /^학\s*년$/, cls: /^반$/, num: /^번\s*호?$/, name: /성\s*명|^이\s*름$/,
    subject: /과\s*목/, part: /영\s*역|활\s*동\s*명|^구\s*분$/,
    text: /특\s*기\s*사\s*항|종\s*합\s*의\s*견|세\s*부\s*능\s*력|활\s*동\s*내\s*용|^내\s*용$/
};

function rcGuessArea(...hints) {
    const s = hints.filter(Boolean).join(' ');
    if (/행동|행특|종합\s*의견/.test(s)) return RC_HAENG;
    if (/자유\s*학기|진로\s*탐색|주제\s*선택|예술\s*[·･]?\s*체육/.test(s)) return RC_FREE;
    if (/개인별/.test(s)) return RC_PERSONAL;
    if (/자율|자치/.test(s)) return RC_JAYUL;
    if (/동아리|스포츠/.test(s)) return RC_CLUB;
    if (/진로/.test(s)) return RC_CAREER;
    if (/세특|세부|교과|과목/.test(s)) return RC_SETUK;
    return null;
}

function rcParseRows(rows, sheetName = '', fileName = '') {
    const cell = (r, c) => (c == null || !r ? '' : String(r[c] ?? '').trim());
    let headRow = -1, col = {};
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const r = rows[i] || [];
        const found = {};
        r.forEach((v, c) => {
            const t = String(v ?? '').trim();
            for (const [k, re] of Object.entries(RC_HEAD)) if (found[k] == null && re.test(t)) found[k] = c;
        });
        if (found.name != null) { headRow = i; col = found; break; }
    }
    const data = rows.slice(headRow + 1);

    // 글 칸: 머리글로 못 찾았으면 글이 가장 긴 칸
    if (col.text == null) {
        const total = {};
        data.forEach(r => (r || []).forEach((v, c) => { if (c !== col.name) total[c] = (total[c] || 0) + String(v ?? '').length; }));
        const best = Object.entries(total).sort((a, b) => b[1] - a[1])[0];
        if (best) col.text = Number(best[0]);
    }
    if (col.name == null) {
        const hits = {};
        data.forEach(r => (r || []).forEach((v, c) => { if (/^[가-힣]{2,4}$/.test(String(v ?? '').trim())) hits[c] = (hits[c] || 0) + 1; }));
        const best = Object.entries(hits).filter(([c]) => Number(c) !== col.text).sort((a, b) => b[1] - a[1])[0];
        if (best) col.name = Number(best[0]);
    }
    if (col.text == null) return [];

    const headText = headRow >= 0 ? (rows[headRow] || []).join(' ') : '';
    const sheetArea = rcGuessArea(headText.match(RC_HEAD.text)?.[0], sheetName, fileName);
    const out = [];
    let last = null, carry = {};
    for (const r of data) {
        const text = cell(r, col.text);
        // 합쳐진 칸 때문에 비어 보이는 학년·반·번호·이름·과목은 위 줄 값을 이어 씀
        const newKind = !!(cell(r, col.subject) || cell(r, col.part)); // 같은 학생의 다른 과목·영역 줄
        for (const k of ['grade', 'cls', 'num', 'name', 'subject', 'part']) { const v = cell(r, col[k]); if (v) carry[k] = v; }
        let name = cell(r, col.name);
        if (!name) {
            if (!newKind || !carry.name) {
                if (text && last) last.text += text;
                continue;
            }
            name = carry.name;
        }
        if (RC_HEAD.name.test(name)) continue; // 중간에 다시 나오는 머리글 줄
        last = {
            grade: carry.grade || '', cls: carry.cls || '', num: cell(r, col.name) ? cell(r, col.num) : carry.num || '', name,
            subject: col.subject != null ? carry.subject || '' : '',
            area: rcGuessArea(col.part != null ? carry.part : '') || sheetArea || (col.subject != null ? RC_SETUK : '기타'),
            text
        };
        if (col.part != null && carry.part && !rcGuessArea(carry.part)) last.subject = last.subject || carry.part;
        out.push(last);
    }
    return out;
}

// ───────── PDF 읽기 ─────────
// 나이스 학교생활기록부 PDF에서 뽑은 글 줄(쪽마다 줄 배열)을 학생·영역별 기록으로 나눔.
// 표 모양이 쪽마다 조금씩 달라서, 칸 제목과 줄 머리(자율활동, '국어:' 등)를 보고 짐작함.
const RC_PDF_SKIP_SECTION = /인적\s*·?\s*학적|학적\s*사항|출결\s*상황|수상\s*경력|자격증|봉사\s*활동\s*실적|독서\s*활동|교과\s*학습\s*발달\s*상황\s*$/;
const RC_PDF_NOISE = /^\s*(?:-?\s*\d+\s*-?|\d+\s*\/\s*\d+|\d+\s*쪽)\s*$|출력일|발급|본\s*(?:문서|증명서)|^\s*학교생활기록부\s*$|^\s*(?:학년|과\s*목|영\s*역|시\s*간|특\s*기\s*사\s*항|\s)+$/;
const RC_PDF_ACT = /^(?:([1-3])\s+)?(자율(?:\s*[·･]\s*자치)?|동아리|진로)\s*활동\s*(?:\d+\s*(?:시간)?)?\s*(.*)$/;
const RC_PDF_FREE = /^(?:([1-3])\s+)?(?:[12]\s*학기\s+)?(진로\s*탐색|주제\s*선택|예술\s*[·･]?\s*체육|동아리)\s*활동\s*(?:\d+\s*(?:시간)?)?\s*(.*)$/;
const RC_PDF_SUBJ = /^(?:\(\s*[12]\s*학기\s*\)\s*)?([가-힣A-Za-z][가-힣A-Za-z0-9ⅠⅡⅢ·\s]{0,14}?)\s*[:：]\s*(.*)$/;

function rcParsePdfLines(pages, fileName = '') {
    const out = [];
    let who = { grade: '', cls: '', num: '', name: '' };
    let section = null, last = null;
    const start = (area, subject, text, grade) => {
        if (!who.name) return null;
        last = { grade: grade || who.grade, cls: who.cls, num: who.num, name: who.name, subject: subject || '', area, text: text || '' };
        out.push(last);
        return last;
    };
    const append = t => { if (last && t) last.text += (last.text ? ' ' : '') + t; };

    for (const lines of pages) {
        for (const raw of lines) {
            const line = raw.replace(/\s+/g, ' ').trim();
            if (!line) continue;

            // 학생 바뀜: '1학년 3반 12번', '성명 홍길동'
            const g = line.match(/([1-3])\s*학년\s*(\d{1,2})\s*반\s*(\d{1,2})\s*번/);
            const n = line.match(/성\s*명\s*[:：]?\s*([가-힣]{2,5})(?![가-힣])/);
            if (g || n) {
                const next = { grade: g ? g[1] : who.grade, cls: g ? g[2] : who.cls, num: g ? g[3] : who.num, name: n ? n[1] : who.name };
                if (next.name !== who.name || next.num !== who.num) { last = null; section = null; }
                who = next;
                continue;
            }

            // 영역 제목
            if (/행동\s*특성\s*및\s*종합\s*의견/.test(line)) { section = 'haeng'; last = null; continue; }
            if (/세부\s*능력\s*및\s*특기\s*사항/.test(line)) { section = 'setuk'; last = null; continue; }
            if (/창의적\s*체험\s*활동/.test(line)) { section = 'cc'; last = null; continue; }
            if (/자유\s*학기\s*활동/.test(line)) { section = 'free'; last = null; continue; }
            if (RC_PDF_SKIP_SECTION.test(line)) { section = 'skip'; last = null; continue; }
            if (RC_PDF_NOISE.test(line) || section === 'skip' || !section) continue;

            if (section === 'free') {
                const m = line.match(RC_PDF_FREE);
                if (m) { start(RC_FREE, m[2].replace(/\s+/g, '') + '활동', m[3], m[1]); continue; }
                append(line);
            } else if (section === 'cc') {
                const m = line.match(RC_PDF_ACT);
                if (m) { start(rcGuessArea(m[2]), '', m[3], m[1]); continue; }
                append(line);
            } else if (section === 'setuk') {
                const m = line.match(RC_PDF_SUBJ);
                if (m) { start(RC_SETUK, m[1].trim(), m[2]); continue; }
                append(line);
            } else if (section === 'haeng') {
                const m = line.match(/^([1-3])\s+(.+)$/);
                if (m || !last) { start(RC_HAENG, '', m ? m[2] : line, m ? m[1] : ''); continue; }
                append(line);
            }
        }
    }
    return out;
}

// ───────── 점검 ─────────
function rcSpellWords(text) {
    // 사전이 '교수님의'처럼 '님'이 붙은 말을 몰라서 '님' 앞부분만 확인함
    return [...new Set((text.normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [])
        .map(word => word.replace(/(?<=^[가-힣]{2,})님[가-힣]{0,3}$/, ''))
        .filter(word => /^[가-힣]{2,}$/.test(word)))];
}

function rcCheckOne(rec, settings, byteLen) {
    const issues = [];
    const text = rec.text.replace(/\r\n?/g, '\n');
    const add = (type, level, what, why, fix) => issues.push({ type, level, what, why, fix });

    if (!text.trim()) {
        add('empty', 'no', '', '기록이 비어 있어요.');
        return issues;
    }

    const bytes = byteLen(text);
    const limit = settings.limits[rec.area + '|' + rec.subject] || settings.limits[rec.area] || settings.limits['기타'];
    if (bytes > limit) add('length', 'no', '', `글자 수가 ${bytes - limit}바이트 넘쳐요. (지금 ${bytes} / 최대 ${limit}바이트)`);

    for (const rule of RC_FORBID_RULES) {
        if (rule.allowIn && rule.allowIn.includes(rec.area)) continue;
        let prev = null; // '경진대회'처럼 같은 규칙 낱말이 바로 붙어 나오면 하나로 합침
        for (const m of text.matchAll(rule.re)) {
            if (rule.skip && rule.skip.test(m[0])) continue;
            if (prev && prev.end === m.index) { prev.issue.what += m[0]; prev.end += m[0].length; continue; }
            add('forbid', rule.level, m[0], rule.why);
            prev = { issue: issues[issues.length - 1], end: m.index + m[0].length };
        }
    }

    for (const [re, right] of RC_SPELL_RULES) {
        for (const m of text.matchAll(re)) {
            const fix = m[0].replace(re, right);
            add('spell', 'check', m[0], RC_SPELL_NOTE[right] || `'${m[0].trim()}' → '${fix.trim()}'`, RC_SPELL_NOTE[right] ? null : fix);
        }
    }

    if (!(settings.off || []).includes('spell')) for (const word of rcSpellWords(text)) {
        const suggestions = settings.spellings?.[word];
        if (!suggestions || issues.some(issue => (issue.type === 'spell' || issue.type === 'forbid') && (word.includes(issue.what) || issue.what.includes(word)))) continue; // 이미 잡힌 말은 한 번만
        const hint = suggestions.length ? ` 교정 후보: ${suggestions.map(s => `'${s}'`).join(', ')}.` : '';
        add('spell', 'check', word, `'${word}'은(는) 한국어 사전에서 확인되지 않아요.${hint} 전문어·이름이면 원문을 확인해 주세요.`);
    }

    // 문장 끝맺음: 특기사항은 '~함.', '~임.'처럼 명사형으로 끝내고 마침표를 찍음
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
    sentences.forEach((s, i) => {
        const tail = s.slice(-12);
        if (/[다요]\.?$/.test(s)) add('ending', 'check', tail, "'~다.'로 끝났어요. '~함.', '~임.'처럼 끝맺어 주세요.");
        else if (/[!?]$/.test(s)) add('ending', 'check', tail, '느낌표·물음표 대신 마침표로 끝맺어 주세요.');
        else if (i === sentences.length - 1 && !/\.$/.test(s)) add('ending', 'check', tail, '마지막 문장에 마침표가 빠졌어요.');
    });

    return issues;
}

// 문단과 문장을 원문 그대로 비교함. 양끝 공백과 줄바꿈 형식만 정리함.
function rcExactPassages(text) {
    const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n+/).map(s => s.trim()).filter(Boolean);
    const sentences = paragraphs.flatMap(p => p.split(/(?<=[.!?])(?=\s|[가-힣])/).map(s => s.trim()).filter(Boolean));
    // '1.', '★'처럼 글자가 거의 없는 조각은 비교하지 않음 (번호만 같아도 똑같은 문장으로 잡히던 문제)
    return new Set([...paragraphs, ...sentences].filter(p => (p.match(/[가-힣A-Za-z]/g) || []).length >= 5));
}

function rcCheckAll(records, settings, byteLen) {
    const off = new Set(settings.off || []);
    const results = records.map(rec => ({ rec, issues: rcCheckOne(rec, settings, byteLen).filter(i => !off.has(i.type)) }));
    if (off.has('similar')) return results;
    // 같은 영역·과목의 다른 학생끼리 비교. ponytail: 수천 명이면 문장 색인으로 바꿀 것
    const groups = new Map();
    results.forEach(r => {
        if (!r.rec.text.trim()) return;
        const k = r.rec.area + '|' + r.rec.subject;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ ...r, passages: rcExactPassages(r.rec.text) });
    });
    for (const list of groups.values()) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            if (['grade', 'cls', 'num', 'name'].every(key => (a.rec[key] || '') === (b.rec[key] || ''))) continue;
            const shared = [...a.passages].filter(p => b.passages.has(p)).sort((x, y) => y.length - x.length);
            const matches = shared.filter((p, index) => !shared.slice(0, index).some(longer => longer.includes(p)));
            for (const passage of matches) {
                a.issues.push({ type: 'similar', level: 'check', what: passage, why: `${rcWho(b.rec)} 기록에 100% 동일한 문장 또는 문단이 있어요.` });
                b.issues.push({ type: 'similar', level: 'check', what: passage, why: `${rcWho(a.rec)} 기록에 100% 동일한 문장 또는 문단이 있어요.` });
            }
        }
    }
    return results;
}

function rcWho(rec) {
    const where = [rec.grade && rec.grade + '학년', rec.cls && rec.cls + '반', rec.num && rec.num + '번'].filter(Boolean).join(' ');
    return (where ? where + ' ' : '') + rec.name;
}

// 기록 글에 문제 부분을 표시한 HTML
function rcHighlight(text, issues) {
    const marks = [...new Set(issues.map(i => i.what).filter(w => w && w.trim()))].sort((a, b) => b.length - a.length);
    let html = rcEscape(text);
    if (!marks.length) return html.replace(/\n/g, '<br>');
    const levelOf = w => (issues.some(i => i.what === w && i.level === 'no') ? 'no' : 'check');
    const re = new RegExp(marks.map(w => rcEscape(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const raw = new Map(marks.map(w => [rcEscape(w), w]));
    return html.replace(re, m => `<mark class="rc-mark rc-${levelOf(raw.get(m))}">${m}</mark>`).replace(/\n/g, '<br>');
}

if (typeof module !== 'undefined') module.exports = { RC_DEFAULT_SETTINGS, RC_DEFAULT_GUIDE, rcApplyGuide, rcPattern, RC_TYPES, rcParseRows, rcParsePdfLines, rcCheckOne, rcCheckAll, rcHighlight, rcGuessArea };
