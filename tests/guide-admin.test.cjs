// code.gs의 지침 저장·비밀번호·지침 조립을 가짜 구글 서비스로 확인
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const store = { ADMIN_PASSWORD: 'pw', GEMINI_KEYS: 'k1', GUIDE_style: '예전 방식 칸' };
const props = {
    getProperty: k => (k in store ? store[k] : null),
    getProperties: () => ({ ...store }),
    setProperty: (k, v) => { store[k] = v; },
    setProperties: o => Object.assign(store, o),
    deleteProperty: k => { delete store[k]; },
};
const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => props },
    ContentService: { createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }), MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: t => t },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
});
vm.runInContext(fs.readFileSync(path.join(root, 'code.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'guide-default.js'), 'utf8') + ';this.GUIDE_DEFAULT = GUIDE_DEFAULT;', ctx);
const post = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
const clone = o => JSON.parse(JSON.stringify(o));

// 처음: 지침 없음 → 읽기는 null, 생성은 안내 오류
assert.equal(ctx.doGet({ parameter: { action: 'guide' } }).guide, null);
assert.match(post({ area: '자율', charLimit: 125, sentenceCount: 1, cases: 'x' }).error, /지침이 아직 없어요/);

// 비밀번호
assert.equal(post({ action: 'login', password: 'x' }).success, false);
assert.equal(post({ action: 'login', password: 'pw' }).success, true);
assert.equal(post({ action: 'saveGuide', password: 'x', guide: ctx.GUIDE_DEFAULT }).success, false);

// 잘못된 지침 거부
const bad = clone(ctx.GUIDE_DEFAULT); bad.parts.style.body = '  ';
assert.equal(post({ action: 'saveGuide', password: 'pw', guide: bad }).success, false, '빈 내용 거부');
const bad2 = clone(ctx.GUIDE_DEFAULT); bad2.order.general.push('nope');
assert.equal(post({ action: 'saveGuide', password: 'pw', guide: bad2 }).success, false, '없는 파트 거부');

// 처음 지침 저장 → 예전 방식 칸은 지워지고 지침이 생김
let r = post({ action: 'saveGuide', password: 'pw', guide: ctx.GUIDE_DEFAULT });
assert.ok(r.success);
assert.equal(store.GUIDE_style, undefined);
assert.deepEqual(Object.keys(r.guide.parts).sort(), Object.keys(ctx.GUIDE_DEFAULT.parts).sort());

// 고쳐 저장 → 지침 조립에 반영
const edited = clone(r.guide); edited.parts.style.body = '새 문체 규칙';
r = post({ action: 'saveGuide', password: 'pw', guide: edited });
assert.match(ctx.buildPrompt({ area: '동아리', charLimit: 100, sentenceCount: 3, cases: 'x' }), /새 문체 규칙/);

// 빈칸이 실제 값으로 채워지고, 입력 속 {생성 글자 수}는 바뀌지 않음
const built = ctx.buildPrompt({ area: '행동특성', charLimit: 250, sentenceCount: 5, cases: '{생성 글자 수}' });
assert.match(built, /250자를 넘지 않되 213자 이상/);
assert.match(built, /문단 5개/);
assert.match(built, /\{생성 글자 수\}/);
// AI에게는 기재요령 영역 이름으로 넘어감
assert.match(ctx.buildPrompt({ area: '과세특', charLimit: 250, sentenceCount: 1, cases: 'x' }), /'과목별 세부능력 및 특기사항' 영역/);
// 생활기록부 점검 지침: 처음엔 없음 → 비밀번호 있어야 저장, 빈 칸·잘못된 찾을 말 거부, 저장하면 읽힘
assert.equal(ctx.doGet({ parameter: { action: 'checkGuide' } }).checkGuide, null);
const cg = { forbid: [{ level: 'no', label: '대회', words: '대회, 경진', why: '쓸 수 없어요.', allowIn: ['과목별 세부능력 및 특기사항'] }], spell: [{ wrong: '몇일, 몇 일', right: '며칠' }], limits: [{ group: '9. 행동특성', item: '행동특성 및 종합의견', max: '300자', key: '행동특성 및 종합의견' }] };
assert.equal(post({ action: 'saveCheckGuide', password: 'x', checkGuide: cg }).success, false, '비밀번호');
assert.equal(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: { ...cg, spell: [{ wrong: '', right: 'a' }] } }).success, false, '빈 칸 거부');
assert.equal(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: { ...cg, forbid: [{ label: 'x', find: '(' }] } }).success, false, '잘못된 찾을 말 거부');
assert.ok(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: cg }).success);
const cgBack = ctx.doGet({ parameter: { action: 'checkGuide' } }).checkGuide;
assert.equal(cgBack.forbid[0].words, '대회, 경진');
assert.equal(cgBack.limits[0].key, '행동특성 및 종합의견');
assert.ok(store.GUIDE_ORDER, '점검 지침 저장이 생성 지침을 지우면 안 됨');

// API 설정: 키는 가려서만 보이고, 남기기·추가·지우기와 모델 저장이 됨
store.GEMINI_KEYS = 'TESTFIRSTKEY000000000001,TESTSECONDKEY00000000002';
assert.equal(post({ action: 'getSettings', password: 'x' }).success, false);
let s = post({ action: 'getSettings', password: 'pw' });
assert.deepEqual(s.keys, ['TEST…0001', 'TEST…0002']);
assert.ok(!JSON.stringify(s).includes('FIRSTKEY'), '키 전체가 밖으로 나가면 안 됨');
assert.equal(s.model, '');
s = post({ action: 'saveSettings', password: 'pw', keep: [1], add: ['NEWFORMATKEY_abcdefghij123'], model: 'gemini-3.5-flash' });
assert.ok(s.success);
assert.equal(store.GEMINI_KEYS, 'TESTSECONDKEY00000000002,NEWFORMATKEY_abcdefghij123');
assert.equal(store.GEMINI_MODEL, 'gemini-3.5-flash');
assert.equal(post({ action: 'saveSettings', password: 'pw', keep: [], add: [] }).success, false, '키가 하나도 없으면 거부');
assert.equal(post({ action: 'saveSettings', password: 'pw', keep: [0], add: ['short'] }).success, false, '이상한 키 거부');
assert.equal(post({ action: 'saveSettings', password: 'pw', keep: [0], add: [], model: 'bad model!' }).success, false, '이상한 모델 이름 거부');
post({ action: 'saveSettings', password: 'pw', keep: [0, 1], add: [], model: '' });
assert.equal(store.GEMINI_MODEL, undefined, '모델을 비우면 기본 모델');
console.log('Guide admin passed');
