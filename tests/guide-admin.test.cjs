// code.gs의 작성요령 저장·비밀번호·되돌리기·지침 조립을 가짜 구글 서비스로 확인
// code.gs가 없으면(공개 저장소에서 받은 경우 등) 건너뜀
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.join(__dirname, '..', 'code.gs');
if (!fs.existsSync(file)) { console.log('code.gs 없음, 건너뜀'); process.exit(0); }

const store = { ADMIN_PASSWORD: 'pw', GEMINI_KEYS: 'k1, k2' };
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
});
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
const post = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });

// 읽기
const view = ctx.doGet({ parameter: { action: 'guide' } });
assert.ok(view.success && view.guide.order.behavior.length === 8);
assert.equal(view.guide.parts.style.edited, false);

// 비밀번호
assert.equal(post({ action: 'login', password: 'x' }).success, false);
assert.equal(post({ action: 'login', password: 'pw' }).success, true);
assert.equal(post({ action: 'saveGuide', password: 'x', parts: { style: 'a' } }).success, false);

// 저장 → 지침에 반영
const original = view.guide.parts.style.body;
let r = post({ action: 'saveGuide', password: 'pw', parts: { style: '새 문체 규칙' } });
assert.ok(r.success && r.guide.parts.style.edited);
assert.match(ctx.buildPrompt({ area: '동아리', charLimit: 100, sentenceCount: 3, cases: 'x' }), /새 문체 규칙/);
assert.equal(post({ action: 'saveGuide', password: 'pw', parts: { style: '  ' } }).success, false, '빈 내용 거부');
assert.equal(post({ action: 'saveGuide', password: 'pw', parts: { nope: 'a' } }).success, false, '없는 파트 거부');

// 한 단계 되돌리기 / 기본값
post({ action: 'saveGuide', password: 'pw', parts: { style: '두 번째' } });
r = post({ action: 'resetGuide', password: 'pw', mode: 'undo', keys: ['style'] });
assert.equal(r.guide.parts.style.body, '새 문체 규칙');
r = post({ action: 'resetGuide', password: 'pw', mode: 'default' });
assert.equal(r.guide.parts.style.body, original);
assert.equal(r.guide.parts.style.edited, false);

// 입력 속 {글자수}는 바뀌지 않음
assert.match(ctx.buildPrompt({ area: '행동특성', charLimit: 250, sentenceCount: 5, cases: '{글자수}' }), /\{글자수\}/);
console.log('Guide admin passed');
