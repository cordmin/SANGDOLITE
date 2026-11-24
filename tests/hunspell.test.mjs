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
// '금새'는 표준국어대사전에 있는 낱말(물건값)이라 사전으로는 통과함
assert.deepEqual(Object.keys(replies.pop().spellings).sort(), ['역활을', '일일히'].sort());
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
    const text = '활동에서 설\u2064명하는 글을 씀. 생각과\u2064기억이 채워짐. 인성관\u2063을 탐구함.';
    // 줄 끝에 한 글자만 남은 자리('활|동지에')는 붙이고, 혼자 쓰는 한 글자('네|컷')는 띄움
    await self.onmessage({ data: { id: 4, words: ['활', '동지에', '활동지에', '네', '컷', '네컷'], exact: true } });
    const oneKnown = new Set(replies.pop().known);
    assert.equal(rcResolveWraps([{ text: '활\u2064동지에 정리함. 네\u2064컷 만화를 그림.' }], oneKnown)[0].text, '활동지에 정리함. 네 컷 만화를 그림.');
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
for (const row of retired) if (row.wrong !== '금새') assert.ok(row.wrong in replies[2].spellings, row.wrong);

// 사전 미등록이나 그럴듯한 교정 후보만으로 정상적인 교육 활동명을 문제로 표시하지 않음.
const normal = '장애인식개선교육 프로그램에 참여함. 학교폭력예방교육에서 민주주의적 태도를 보임. 정·부반장 선거에 참여함.';
await self.onmessage({ data: { id: 4, words: ['장애인식개선교육', '학교폭력예방교육에서', '민주주의적', '반장선거에'] } });
const normalResult = rcCheckAll([{ ...records[0], text: normal }], { ...RC_DEFAULT_SETTINGS, spellings: replies[3].spellings }, text => Buffer.byteLength(text));
assert.equal(normalResult[0].issues.filter(issue => issue.type === 'spell').length, 0);
const badSuggestions = { 장애인식개선교육: [], 학교폭력예방교육에서: ['학교폭력예방 교육에서'], 민주주의적: ['민주주의 직'] };
assert.equal(rcCheckAll([{ ...records[0], text: normal }], { ...RC_DEFAULT_SETTINGS, spellings: badSuggestions }, text => Buffer.byteLength(text))[0].issues.filter(issue => issue.type === 'spell').length, 0);
const known = rcCheckAll([{ ...records[0], text: '역활을 맡음. 설겆이를 함.' }], { ...RC_DEFAULT_SETTINGS, spellings: replies[2].spellings }, text => Buffer.byteLength(text));
assert.ok(known[0].issues.some(issue => issue.type === 'spell' && issue.what === '역활을'));
assert.ok(!known[0].marks.includes('역활을'), '고칠 점으로 잡힌 말은 밑줄로 또 긋지 않음');

// 사전이 모르는 낱말은 고칠 점·문구 없이 밑줄만 (낱말 중간에는 안 그음)
const typo = '학고 구칙을 준수할 것으로 기대됌. 과학고등학교에 감.';
await self.onmessage({ data: { id: 5, words: ['학고', '구칙을', '준수할', '것으로', '기대됌', '과학고등학교에', '감'] } });
const typoResult = rcCheckAll([{ ...records[0], text: typo }], { ...RC_DEFAULT_SETTINGS, spellings: replies.pop().spellings }, text => Buffer.byteLength(text))[0];
assert.ok(!typoResult.issues.some(issue => issue.type === 'spell'));
for (const word of ['학고', '구칙을', '기대됌']) assert.ok(typoResult.marks.includes(word), word);
// 나이스 동아리 머리말 속 이름은 밑줄 없음. 날짜가 붙은 활동명과 오타는 밑줄
{
    const text = '(힐링컬러링반)(18시간) 색칠함. 생명존중및자살예방교육(2026.08.12.)에 참여함. 학고 규칙을 지킴.\n(노래가사감상반) 가사를 감상함.';
    const marks = rcCheckAll([{ ...records[0], text }], { ...RC_DEFAULT_SETTINGS, spellings: { 힐링컬러링반: [], 생명존중및자살예방교육: [], 노래가사감상반: [], 학고: [] } }, text => text.length)[0].marks;
    assert.deepEqual([...marks], ['생명존중및자살예방교육', '학고']);
}
const typoHtml = rcHighlight(typo, typoResult.issues, typoResult.marks);
assert.match(typoHtml, /<mark class="rc-mark rc-dict">학고<\/mark> <mark class="rc-mark rc-dict">구칙을<\/mark>/);
assert.match(typoHtml, /과학고등학교/);
assert.ok(!rcCheckAll([{ ...records[0], text: typo }], { ...RC_DEFAULT_SETTINGS, off: ['spell'], spellings: { 학고: [] } }, text => text.length)[0].marks.length, '맞춤법 점검을 끄면 밑줄도 없음');

// 국립국어원 명사 목록(조사 떼고·'~함' 꼴)과 '~진→~지다'로 바른 말은 통과, 오타는 계속 밑줄
await self.onmessage({ data: { id: 6, words: ['마찰력', '마찰력을', '탄성력을', '전기력', '자기력을', '역학적', '정해진', '만들어진',
    '혈구', '융해', '숲속의', '기보', '운지', '조형', '음역', '가창함', '조형하였다',
    '학고', '구칙을', '기대됌', '역활을', '일일히', '깜빡햇다', '설겆이', '설레임', '염두해', '역활함'] } });
assert.deepEqual(Object.keys(replies.pop().spellings).sort(), ['학고', '구칙을', '기대됌', '역활을', '일일히', '깜빡햇다', '설겆이', '설레임', '염두해', '역활함'].sort());

// 보완 규칙이 낱말 가운데에 걸려도, 사전이 아는 낱말('탐구지에')이면 넘어가고 모르는 낱말('안됬다')은 잡음
{
    const text = '핵의 위치를 탐구지에 기록함. 구지 선택함. 준비가 안됬다.';
    await self.onmessage({ data: { id: 7, words: ['탐구지에', '구지', '안됬다'] } });
    const found = rcCheckAll([{ ...records[0], text }], { ...RC_DEFAULT_SETTINGS, spellings: replies.pop().spellings }, text => text.length)[0]
        .issues.filter(issue => issue.type === 'spell').map(issue => issue.what).sort();
    assert.deepEqual(found, ['구지', '됬'].sort());
}
console.log('Offline Hunspell dictionary and record integration passed');
