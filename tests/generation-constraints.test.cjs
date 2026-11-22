const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
const ctx = vm.createContext({});
for (const name of ['getByteLength', 'generationLines', 'requestGeneration']) {
    vm.runInContext(source.match(new RegExp('(?:async )?function ' + name + '\\([^]*?\\n\\}'))[0], ctx);
}
const payload = { area: '자율', charLimit: 500, sentenceCount: 1, cases: '정·부반장 선거', activities: ['정·부반장 선거'] };
const short = '정반장선거에 참여함. ' + '가'.repeat(300) + '.';
const good = '정반장선거에 참여함. ' + '가'.repeat(470) + '.';
const oversized = '정반장선거에 참여함. ' + '가'.repeat(520) + '.';
let requests;
const use = responses => {
    requests = [];
    ctx.sendGenerationRequest = async body => {
        requests.push(body);
        const response = responses.shift();
        assert.ok(response, '예상보다 많은 재요청');
        if (response instanceof Error) throw response;
        return response;
    };
};
(async () => {
    use([{ success: true, result: good }]);
    let result = await ctx.requestGeneration(payload);
    assert.equal(result.success, true);
    assert.equal(requests.length, 1);
    assert.match(result.result, /^정·부반장 선거에/);
    assert.ok(ctx.getByteLength(result.result) >= 1425 && ctx.getByteLength(result.result) <= 1500);
    assert.match(requests[0].cases, /약 1500byte/);
    assert.match(requests[0].cases, /조금 초과하는 것은 허용/);
    assert.equal(payload.cases, '정·부반장 선거', '사용자 원본을 변경하지 않음');

    use([{ success: true, result: oversized }]);
    result = await ctx.requestGeneration(payload);
    assert.equal(result.success, true);
    assert.equal(requests.length, 1, '초과해도 자동 재요청하지 않음');
    assert.ok(ctx.getByteLength(result.result) > 1500, '초과 결과를 잘라내지 않음');

    use([{ success: true, result: short }]);
    result = await ctx.requestGeneration(payload);
    assert.equal(result.success, true);
    assert.equal(requests.length, 1, '짧아도 사용자 API로 자동 재요청하지 않음');
    assert.ok(result.result, '생성된 원문 보관');

    use([new Error('네트워크 오류')]);
    await assert.rejects(ctx.requestGeneration(payload), /네트워크 오류/);
    assert.equal(requests.length, 1);

    // 활동명 누락을 이유로 자동 재요청하지 않음.
    use([{ success: true, result: '가'.repeat(480) + '.' }]);
    result = await ctx.requestGeneration(payload);
    assert.equal(result.success, true);
    assert.equal(requests.length, 1);
    assert.match(requests[0].cases, /빠짐없이 원래 표기대로/);

    // 생성 표에서는 점검·하이라이트를 호출하지 않고 원문을 안전하게 표시.
    let row;
    const table = { innerHTML: '', appendChild(value) { row = value; }, insertAdjacentHTML() {} };
    Object.assign(ctx, { document: { getElementById: () => table, createElement: () => ({}) }, FILLER_ROW: '', escapeHtml: text => text.replace(/</g, '&lt;').replace(/>/g, '&gt;'), rcCheckOne() { throw Error('자동 점검 금지'); } });
    vm.runInContext(source.match(/function renderTable\(items\) \{[^]*?\n\}/)[0], ctx);
    ctx.renderTable(['장애인식개선교육 <원문>.']);
    assert.match(row.innerHTML, /&lt;원문&gt;/);
    assert.ok(!row.innerHTML.includes('<mark') && !row.innerHTML.includes('gen-warn'));
    console.log('Single-request byte guidance, activity preservation, no retries or truncation, plain results passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
