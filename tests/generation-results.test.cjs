const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const runAI = source.match(/async function runAI\(\) \{[\s\S]*?\n\}/)[0];

async function generate(count, responses, variant = 'gas') {
    const elements = {
        'case-inp': { value: '관찰 내용' }, 'subj-inp': { value: '과학' },
        'run-btn': {}, 'loading-bar': { style: {} }, 'loading-percent': {},
        'student-count': { value: String(count) },
    };
    const messages = [];
    let rendered = [], calls = 0;
    const context = vm.createContext({
        area: '동아리', charLimit: 250, GAS_WEB_APP_URL: 'https://example.test',
        selectedKeywords: new Map(), rawGeneratedText: '',
        LS_KEY: 'test-key', lsGet: () => 'test-key',
        callGemini: async () => { const response = responses[calls++]; assert.ok(response); return response; },
        document: { getElementById: id => elements[id] },
        validateStudentCount() {}, pickKeywords: () => '',
        setInterval: fn => { fn(); return 1; }, clearInterval() {}, setTimeout: fn => fn(),
        fetch: async () => { const response = responses[calls++]; assert.ok(response, '예상하지 않은 추가 요청'); return { json: async () => response }; },
        renderTable: rows => { rendered = Array.from(rows); },
        rcCheckSpelling: async () => ({}),
        showModal: (title, message) => messages.push({ title, message }),
        translateError: String, escapeHtml: String,
    });
    const releaseSource = variant === 'release' ? fs.readFileSync(path.join(__dirname, '..', '생기부 작성 도우미(배포용)', 'js', 'app.js'), 'utf8') : '';
    vm.runInContext(variant === 'release' ? releaseSource.match(/async function runAI\(\) \{[\s\S]*?\n\}/)[0] : runAI, context);
    await context.runAI();
    assert.equal(elements['run-btn'].disabled, false);
    return { rendered, messages, progress: elements['loading-percent'].innerText, raw: context.rawGeneratedText, calls };
}

(async () => {
    const variants = fs.existsSync(path.join(__dirname, '..', '생기부 작성 도우미(배포용)', 'js', 'app.js')) ? ['gas', 'release'] : ['gas'];
    for (const variant of variants) {
        const run = (count, responses) => generate(count, responses, variant);
        for (const response of [
            { success: true, result: '1. 완성 하나.\n2. 완성 둘.' }, // 예전 서버가 성공으로 돌려준 부족한 결과
            { success: false, partial: true, result: '완성 하나.\n완성 둘.', error: '출력 한도' },
        ]) {
            const result = await run(5, [response]);
            assert.equal(result.progress, '40%');
            assert.deepEqual(result.rendered, ['완성 하나.', '완성 둘.']);
            assert.match(result.raw, /2\. 완성 둘\./);
            assert.match(result.messages[0].message, /5개 중 2개/);
        }
        const full = '하나.\n둘.\n셋.\n넷.\n다섯.';
        const failedLater = await run(7, [{ success: true, result: full }, { success: false, error: '통신 오류' }]);
        assert.equal(failedLater.progress, '71%');
        assert.equal(failedLater.rendered.length, 5);
        assert.equal(failedLater.calls, 2);
        assert.match(failedLater.messages[0].message, /7개 중 5개/);
        const empty = await run(5, [{ success: true, result: '' }]);
        assert.equal(empty.progress, '0%');
        assert.equal(empty.rendered.length, 0);
        assert.match(empty.messages[0].message, /5개 중 0개/);
        const complete = await run(7, [{ success: true, result: full }, { success: true, result: '여섯.\n일곱.' }]);
        assert.equal(complete.progress, '100%');
        assert.equal(complete.rendered.length, 7);
        assert.equal(complete.messages.length, 0);
    }
    console.log('Generation counts, partial responses and preserved results passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
