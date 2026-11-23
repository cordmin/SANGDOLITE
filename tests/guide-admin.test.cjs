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
    Utilities: { newBlob: text => ({ getBytes: () => Buffer.from(text, 'utf8') }) },
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
assert.match(built, /250자에 가깝게/);
assert.match(built, /213자 이상을 기준으로/);
assert.match(built, /문단 5개/);
assert.match(built, /\{생성 글자 수\}/);
// AI에게는 기재요령 영역 이름으로 넘어감
assert.match(ctx.buildPrompt({ area: '과세특', charLimit: 250, sentenceCount: 1, cases: 'x' }), /'과목별 세부능력 및 특기사항' 영역/);
// 생활기록부 점검 지침: 처음엔 없음 → 비밀번호 있어야 저장, 빈 칸·잘못된 찾을 말 거부, 저장하면 읽힘
assert.equal(ctx.doGet({ parameter: { action: 'checkGuide' } }).checkGuide, null);
const cg = { forbid: [{ level: 'no', label: '대회', words: '대회, 경진', why: '쓸 수 없어요.', allowIn: ['과목별 세부능력 및 특기사항'] }], spell: [{ wrong: '몇일, 몇 일', right: '며칠' }], limits: [{ group: '9. 행동특성', item: '행동특성 및 종합의견', max: '300', key: '행동특성 및 종합의견' }] };
assert.equal(post({ action: 'saveCheckGuide', password: 'x', checkGuide: cg }).success, false, '비밀번호');
assert.equal(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: { ...cg, spell: [{ wrong: '', right: 'a' }] } }).success, false, '빈 칸 거부');
assert.equal(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: { ...cg, forbid: [{ label: 'x', find: '(' }] } }).success, false, '잘못된 찾을 말 거부');
assert.ok(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: cg }).success);
for (const max of ['300자', '1,000', '1.5', '-1', '0', '9007199254740992']) {
    assert.equal(post({ action: 'saveCheckGuide', password: 'pw', checkGuide: { ...cg, limits: [{ ...cg.limits[0], max }] } }).success, false, max);
}
const cgBack = ctx.doGet({ parameter: { action: 'checkGuide' } }).checkGuide;
assert.equal(cgBack.forbid[0].words, '대회, 경진');
assert.equal(cgBack.limits[0].key, '행동특성 및 종합의견');
assert.ok(store.GUIDE_ORDER, '점검 지침 저장이 생성 지침을 지우면 안 됨');

// 한글은 UTF-8 바이트로 제한하고, 초과 시 기존 지침 전체를 보존한다.
assert.equal(ctx.propertyFits('가'.repeat(2833)), true);
assert.equal(ctx.propertyFits('가'.repeat(2834)), false);
const longWords = clone(cg);
longWords.forbid[0].words = '가'.repeat(601) + ',토익';
r = post({ action: 'saveCheckGuide', password: 'pw', checkGuide: longWords });
assert.ok(r.success);
assert.equal(r.checkGuide.forbid[0].words, longWords.forbid[0].words, '600자 이후 낱말도 보존');
const beforeOversize = JSON.stringify(store);
const oversized = clone(cg);
oversized.forbid = Array.from({ length: 8 }, (_, i) => ({ label: '규칙' + i, words: '가'.repeat(400), why: '나'.repeat(400) }));
r = post({ action: 'saveCheckGuide', password: 'pw', checkGuide: oversized });
assert.equal(r.success, false);
assert.match(r.error, /저장 용량/);
assert.equal(JSON.stringify(store), beforeOversize);
const hugeTitle = clone(ctx.GUIDE_DEFAULT);
hugeTitle.parts.style.title = '가'.repeat(3000);
assert.equal(post({ action: 'saveGuide', password: 'pw', guide: hugeTitle }).success, false);
assert.equal(JSON.stringify(store), beforeOversize, '생성 지침도 용량 검사 전에 삭제하지 않음');

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

// 출력 한도로 중단된 요청은 부분 결과와 실패를 반환한다.
ctx.UrlFetchApp = { fetch: () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '완성 하나.\n완성 둘.\n미완성' }] } }] }),
}) };
r = post({ area: '동아리', charLimit: 250, sentenceCount: 5, cases: '관찰 내용' });
assert.equal(r.success, false);
assert.equal(r.partial, true);
assert.equal(r.result, '완성 하나.\n완성 둘.');
ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '미완성' }] } }] }) });
assert.equal(post({ area: '동아리', charLimit: 250, sentenceCount: 1, cases: '관찰 내용' }).result, '');
console.log('Guide admin passed');
