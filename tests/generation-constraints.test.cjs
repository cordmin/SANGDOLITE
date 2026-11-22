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
    assert.equal(result.result, good, '활동명 등을 코드에서 몰래 교정하지 않음');
    assert.ok(ctx.getByteLength(result.result) >= 1425 && ctx.getByteLength(result.result) <= 1500);
    assert.equal(requests[0].charLimit, 500, '선택값을 바이트에서 역산해 바꾸지 않음');
    assert.equal(requests[0], payload, '입력에 작성 규칙을 주입하지 않고 그대로 전달');
    assert.equal(payload.cases, '정·부반장 선거', '사용자 원본을 변경하지 않음');

    // 모든 선택지에서 화면 선택값 → 요청 → 서버 조립 지침까지 글자 수를 동일하게 유지.
    const guideContext = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/guide-versions/v2.1.3.json'), 'utf8'));
    const store = { GUIDE_ORDER: JSON.stringify(guideContext.guide.order) };
    for (const [key, part] of Object.entries(guideContext.guide.parts)) store['GUIDE_PART_' + key] = JSON.stringify(part);
    const server = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperties: () => store }) } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'code.gs'), 'utf8'), server);
    for (const count of [150, 250, 300, 500]) {
        use([{ success: true, result: good }]);
        await ctx.requestGeneration({ ...payload, charLimit: count });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].charLimit, count);
        const prompt = server.buildPrompt(requests[0]);
        assert.match(prompt, new RegExp('공백 포함 ' + count + '자를 넘지'));
        assert.equal(requests[0].cases, payload.cases);
        assert.ok(!/95%|95~100|238~250|475~500/.test(requests[0].cases), '클라이언트가 별도의 분량 범위를 만들지 않음');
        assert.ok(!/313자|625자|2\.4|각 활동에 약 \d+byte/.test(prompt));
    }

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
    assert.equal(requests[0].cases, payload.cases);

    use([{ success: true, result: good }]);
    await ctx.requestGeneration({ ...payload, area: '진로', activities: ['직업인초청강연', '진로심리검사'], cases: '직업인초청강연, 진로심리검사' });
    assert.equal(requests.length, 1);
    const careerPrompt = server.buildPrompt(requests[0]);
    assert.equal(requests[0].cases, '직업인초청강연, 진로심리검사');
    assert.match(careerPrompt, /각 활동을 다루는 첫 문장은 반드시 선택한 활동명으로 시작/);
    assert.match(careerPrompt, /활동명 앞에 목적·배경·수식어를 붙이지 말 것/);
    assert.match(careerPrompt, /문단의 첫 문장뿐 아니라 다른 활동으로 바뀌는 문장에도 동일하게/);
    assert.match(careerPrompt, /이어서, 이후, 그리고, 또한, 이와 함께 같은 연결어를 붙이지 말고/);
    assert.match(careerPrompt, /직업인초청강연에 참여하여 …함\. 진로심리검사를 통해 …함\./);
    // 관리자에서 규칙을 고치면 코드가 과거 규칙을 다시 덧붙이지 않음.
    const edited = JSON.parse(store.GUIDE_PART_core_general);
    edited.body = edited.body.replace('활동명 앞에 목적·배경·수식어를 붙이지 말 것.', '관리자가 고친 활동 시작 기준을 적용할 것.');
    store.GUIDE_PART_core_general = JSON.stringify(edited);
    const editedPrompt = server.buildPrompt(requests[0]);
    assert.ok(!editedPrompt.includes('활동명 앞에 목적·배경·수식어를 붙이지 말 것.'));
    assert.match(editedPrompt, /관리자가 고친 활동 시작 기준/);

    // 생성 표에서는 점검·하이라이트를 호출하지 않고 원문을 안전하게 표시.
    let row;
    const table = { innerHTML: '', appendChild(value) { row = value; }, insertAdjacentHTML() {} };
    Object.assign(ctx, { document: { getElementById: () => table, createElement: () => ({ querySelector: () => ({ addEventListener() {} }) }) }, FILLER_ROW: '', escapeHtml: text => text.replace(/</g, '&lt;').replace(/>/g, '&gt;'), rcCheckOne() { throw Error('자동 점검 금지'); } });
    vm.runInContext(source.match(/function renderTable\(items\) \{[^]*?\n\}/)[0], ctx);
    ctx.renderTable(['장애인식개선교육 <원문>.']);
    assert.match(row.innerHTML, /&lt;원문&gt;/);
    assert.match(row.innerHTML, new RegExp(Array.from('장애인식개선교육 <원문>.').length + '자<br>'));
    assert.match(row.innerHTML, new RegExp('\\(' + ctx.getByteLength('장애인식개선교육 <원문>.') + 'byte\\)'));
    assert.ok(!row.innerHTML.includes('<mark') && !row.innerHTML.includes('gen-warn'));
    console.log('Single-request byte guidance, activity preservation, no retries or truncation, plain results passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
