const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'docs/guide-versions/v2.1.7.json'), 'utf8'));
const guide = snapshot.guide;
const store = { GUIDE_ORDER: JSON.stringify(guide.order) };
for (const [key, part] of Object.entries(guide.parts)) store['GUIDE_PART_' + key] = JSON.stringify(part);
const server = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperties: () => store }) } });
vm.runInContext(fs.readFileSync(path.join(root, 'code.gs'), 'utf8'), server);
for (const area of ['자율', '진로', '동아리', '과세특', '행동특성']) {
    const prompt = server.buildPrompt({ area, charLimit: 500, sentenceCount: 2, cases: '검증용 입력' });
    assert.match(prompt, /공백 포함 500자에 가깝게/);
    assert.match(prompt, /각 문단은 각각 공백 포함 500자에 가깝게/);
    assert.match(prompt, /425자 이상/);
    assert.match(prompt, /소폭 초과는 허용/);
    assert.match(prompt, /한 활동에 반드시 한 문장만 써야 하는 것은 아님/);
    assert.match(prompt, /글자 수 설명을 절대 붙이지 말 것/);
    assert.match(prompt, /검토 내용은 출력하지 말 것/);
    assert.ok(prompt.includes('검증용 입력'));
}
assert.ok(guide.order.general.indexOf('length') < guide.order.general.indexOf('core_general'));
assert.ok(guide.order.behavior.indexOf('length') < guide.order.behavior.indexOf('core_behavior'));
assert.match(guide.parts.check_behavior.body, /\(146자\), \(147자\) 같은 글자 수 설명/);
assert.match(guide.parts.forbidden.body, /가운뎃점은 유지/);
assert.match(guide.parts.length.body, /고정 문장 수나 활동당 제한이 아니라/);
// v2.1.7: 활동 시작은 활동명이 맨 첫 낱말, 이어받는 말은 같은 활동의 두 번째 문장부터, 끌어오기·묶음 마무리 금지
assert.match(guide.parts.core_general.body, /활동명이 문장의 맨 첫 낱말이 되게 쓸 것/);
assert.match(guide.parts.core_general.body, /활동명 앞에는 이어서, 이와 함께, 나아가, 또한/);
assert.match(guide.parts.core_general.body, /같은 활동의 두 번째 문장부터는 활동명을 문장 앞에 다시 쓰지 말 것/);
assert.match(guide.parts.core_general.body, /이어받는 말 뒤에 다른 활동명을 쓰지 말 것/);
assert.match(guide.parts.core_general.body, /여러 활동을 묶어 정리하는 마무리 문장을 쓰지 말고/);
assert.match(guide.parts.core_general.body, /이해를 넓힘\. 이 과정에서/);
assert.doesNotMatch(guide.parts.core_general.body, /자유롭게 써도 됨/);
assert.match(guide.parts.check_general.body, /활동명이 처음 나오는 문장마다 활동명 앞에 다른 낱말이 있는지/);
assert.match(guide.parts.check_general.body, /활동명이 문장 앞에 되풀이되지 않았는지/);
console.log('Unified length, activity starts, connectors and no count notes verified in final server prompts');
