import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// 브라우저 작업 스레드와 동일한 코드·WASM·실제 한국어 사전으로 오프라인 검사.
const replies = [];
globalThis.self = { postMessage: data => replies.push(data) };
globalThis.fetch = async url => ({ ok: true, text: () => readFile(url, 'utf8') });
await import('../js/record-spell-worker.mjs');
await self.onmessage({ data: { id: 1, words: ['학교', '참여함', '탐구함', '적극적으로', '깜빡햇다', '설겆이'] } });
assert.equal(replies[0].error, undefined);
assert.equal(replies[0].spellings['참여함'], undefined);
// 붙여 쓴 낱말은 나눠서 확인하고, 한 글자 꼬리로 오타가 통과하지 않음
await self.onmessage({ data: { id: 9, words: ['과학탐구반', '분리배출', '일차방정식', '점검표를', '역활을', '일일히', '금새'] } });
assert.deepEqual(Object.keys(replies.pop().spellings).sort(), ['금새', '역활을', '일일히'].sort());
assert.equal(replies[0].spellings['탐구함'], undefined);
assert.ok(replies[0].spellings['깜빡햇다'].includes('깜빡했다'));
assert.ok(replies[0].spellings['설겆이'].includes('설거지'));
await self.onmessage({ data: { id: 2, words: ['깜빡햇다'] } });
assert.equal(replies[1].id, 2);
assert.deepEqual(replies[1].spellings['깜빡햇다'], replies[0].spellings['깜빡햇다']);

const require = createRequire(import.meta.url);
// PDF 줄바꿈 자리: 사전에 그대로 있는 낱말만 돌려주고(나눠 맞추지 않음), 그걸로 붙일지 띄울지 정함
await self.onmessage({ data: { id: 3, words: ['설명하는', '생각과', '기억이', '생각과기억이'], exact: true } });
const wrapKnown = new Set(replies.pop().known);
assert.ok(wrapKnown.has('설명하는') && wrapKnown.has('생각과') && wrapKnown.has('기억이') && !wrapKnown.has('생각과기억이'));
{
    const { rcResolveWraps } = require('../js/record-check.js');
    const text = '활동에서 설⁤명하는 글을 씀. 생각과⁤기억이 채워짐. 인성관⁣을 탐구함.';
    assert.equal(rcResolveWraps([{ text }], wrapKnown)[0].text, '활동에서 설명하는 글을 씀. 생각과 기억이 채워짐. 인성관을 탐구함.');
    assert.equal(rcResolveWraps([{ text }], null)[0].text, '활동에서 설명하는 글을 씀. 생각과기억이 채워짐. 인성관 을 탐구함.', '사전 없으면 짐작대로');
}

const { rcCheckAll, rcHighlight, RC_DEFAULT_SETTINGS } = require('../js/record-check.js');
const settings = { ...RC_DEFAULT_SETTINGS, spellings: replies[0].spellings };
const records = [{ name: '검증용', area: '진로활동', subject: '', text: '학교 활동에 참여함. 준비물을 깜빡햇다.' }];
const checked = rcCheckAll(records, settings, text => Buffer.byteLength(text));
const spelling = checked[0].issues.filter(issue => issue.type === 'spell');
assert.equal(spelling.length, 1, '등록 규칙에 없는 오탈자를 실제 사전으로 찾음');
assert.equal(spelling[0].what, '깜빡햇다');
assert.match(spelling[0].why, /깜빡했다/);
assert.match(rcHighlight(records[0].text, spelling), /<mark[^>]*>깜빡햇다<\/mark>/);
const duplicate = rcCheckAll([{ ...records[0], text: '몇일' }], { ...settings, spellings: { '몇일': ['며칠'] } }, text => text.length);
assert.equal(duplicate[0].issues.filter(issue => issue.type === 'spell').length, 1, '등록 규칙과 사전 결과를 중복 안내하지 않음');
const disabled = rcCheckAll(records, { ...settings, off: ['spell'] }, text => text.length);
assert.ok(!disabled[0].issues.some(issue => issue.type === 'spell'));

// 제거한 기본 예시 26개가 모두 실제 사전에 의해 검출되는지 확인함.
const core = await readFile(new URL('../js/record-check.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(core, context);
const retired = vm.runInContext('RC_RETIRED_SPELL', context);
assert.equal(retired.length, 26);
await self.onmessage({ data: { id: 3, words: [...retired.map(row => row.wrong), '역활을'] } });
for (const row of retired) assert.ok(row.wrong in replies[2].spellings, row.wrong);

// 사전 미등록이나 그럴듯한 교정 후보만으로 정상적인 교육 활동명을 문제로 표시하지 않음.
const normal = '장애인식개선교육 프로그램에 참여함. 학교폭력예방교육에서 민주주의적 태도를 보임. 정·부반장 선거에 참여함.';
await self.onmessage({ data: { id: 4, words: ['장애인식개선교육', '학교폭력예방교육에서', '민주주의적', '반장선거에'] } });
const normalResult = rcCheckAll([{ ...records[0], text: normal }], { ...RC_DEFAULT_SETTINGS, spellings: replies[3].spellings }, text => Buffer.byteLength(text));
assert.equal(normalResult[0].issues.filter(issue => issue.type === 'spell').length, 0);
const badSuggestions = { 장애인식개선교육: [], 학교폭력예방교육에서: ['학교폭력예방 교육에서'], 민주주의적: ['민주주의 직'] };
assert.equal(rcCheckAll([{ ...records[0], text: normal }], { ...RC_DEFAULT_SETTINGS, spellings: badSuggestions }, text => Buffer.byteLength(text))[0].issues.filter(issue => issue.type === 'spell').length, 0);
const known = rcCheckAll([{ ...records[0], text: '역활을 맡음. 설겆이를 함.' }], { ...RC_DEFAULT_SETTINGS, spellings: replies[2].spellings }, text => Buffer.byteLength(text));
assert.ok(known[0].issues.some(issue => issue.type === 'spell' && issue.what === '역활을'));
console.log('Offline Hunspell dictionary and record integration passed');
