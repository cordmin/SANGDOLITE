const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const release = path.join(root, '생기부 작성 도우미(배포용)');

test('Personal API release: standalone assets, prompts and direct Gemini responses', { skip: !fs.existsSync(release) }, async () => {
    const store = {};
    let calls = [];
    let answer = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '완성 문단.' }] } }] };
    const ctx = vm.createContext({
        window: {}, document: { addEventListener() {} },
        localStorage: { getItem: k => store[k] || null },
        fetch: async (url, options) => { calls.push({ url, options }); return { status: 200, json: async () => answer }; },
    });
    for (const file of ['guide-default.js', 'record-check.js', 'app.js']) {
        vm.runInContext(fs.readFileSync(path.join(release, 'js', file), 'utf8'), ctx);
    }
    const data = { area: '과세특', charLimit: 250, sentenceCount: 1, subject: '과학', cases: '입력 속 {생성 글자 수}', posKeywords: '', negKeywords: '' };
    assert.equal((await ctx.callGemini(data)).error, 'NO_API_KEY');
    assert.equal(calls.length, 0);
    store.sangdolite_api_key = 'TEST_PERSONAL_KEY';
    const full = await ctx.callGemini(data);
    assert.equal(full.success, true);
    assert.equal(full.result, '완성 문단.');
    assert.ok(calls[0].url.startsWith('https://generativelanguage.googleapis.com/'));
    assert.equal(calls[0].options.headers['x-goog-api-key'], 'TEST_PERSONAL_KEY');
    assert.ok(!calls[0].url.includes('TEST_PERSONAL_KEY'));
    const prompt = JSON.parse(calls[0].options.body).contents[0].parts[0].text;
    assert.match(prompt, /과목별 세부능력 및 특기사항/);
    assert.match(prompt, /입력에 없는 활동·성과·수치를 지어내거나 부풀리지 말 것/);
    assert.match(prompt, /입력 속 \{생성 글자 수\}/);
    assert.match(ctx.buildPrompt({ ...data, area: '자율' }), /자율·자치활동/);
    answer = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '완성 문단.\n미완성' }] } }] };
    const partial = await ctx.callGemini(data);
    assert.equal(partial.success, false);
    assert.equal(partial.partial, true);
    assert.equal(partial.result, '완성 문단.');

    const html = fs.readFileSync(path.join(release, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(release, 'js/app.js'), 'utf8');
    const ui = fs.readFileSync(path.join(release, 'js/record-check-ui.js'), 'utf8');
    assert.ok(!/GAS_WEB_APP_URL|script\.google\.com|google\.script|gasGet\(|gasPost\(|adminLogin\(|guide-page/.test(html + app + ui));
    assert.match(html, /점검 결과/);
    assert.match(html, /API키 설정/);
    for (const match of html.matchAll(/(?:src|href)="((?:assets|vendor|js|css)\/[^"?#]+)[^"]*"/g)) {
        assert.ok(fs.existsSync(path.join(release, match[1])), '배포 파일 누락: ' + match[1]);
    }
    for (const file of ['js/record-check.js', 'js/record-spell.js', 'js/record-spell-worker.mjs', 'assets/hunspell-ko/ko.aff', 'assets/hunspell-ko/ko.dic', 'vendor/hunspell-wasm/wasm/hunspell.wasm']) {
        assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(release, file)), '공통 기능 불일치: ' + file);
    }
});
