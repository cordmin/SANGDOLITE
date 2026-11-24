const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'record-check-ui.js'), 'utf8');
const elements = {};
const context = vm.createContext({
    document: { getElementById: id => elements[id] ||= {}, querySelectorAll: () => [] },
    rcResults: null,
    rcFiles: [],
    rcChecking: false,
    rcRenderResults() {},
});
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'record-check.js'), 'utf8'), context);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// 점검 항목은 고르지 않고 항상 모두 점검함.
assert.ok(!/rc-check-options|rc-types|rcSaveSettings|rcSettings/.test(html + source));
assert.ok(!/rc-repeat-min|rc-similar-min|반복 표현|rc-custom-words/.test(html));
console.log('Record check settings passed');

// 표 머리글의 선택값으로 결과·검색을 함께 필터링함.
context.RC_FILLER = '';
context.getByteLength = text => text.length;
for (const name of ['rcHasMarks', 'rcVisibleRows', 'rcStudentId', 'rcWhereLines', 'rcRenderResults', 'rcCount', 'rcRowHtml']) {
    vm.runInContext(source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0], context);
}
// 좁은 항목 칸: '및' 앞에서 줄을 나누고 과목은 다음 줄 괄호 안에
assert.equal(context.rcWhereLines({ area: '과목별 세부능력 및 특기사항', subject: '정보' }).join('|'), '과목별 세부능력|및 특기사항|(정보)');
assert.equal(context.rcWhereLines({ area: '행동특성 및 종합의견', subject: '' }).join('|'), '행동특성|및 종합의견');
assert.equal(context.rcStudentId({ grade: '1', cls: '3', num: '2' }), '10302');
vm.runInContext("let rcTab = 'all'; let rcQuery = ''; rcRenderResults();", context);
assert.equal(elements['rc-type-filter'].value, 'all');
assert.match(elements['rc-type-filter'].innerHTML, /value="all"><span class="rc-filter-label">전체<\/span><\/option>/);
assert.ok(!elements['rc-type-filter'].innerHTML.includes('rc-filter-count'));
assert.equal(elements['rc-import'].hidden, false);
context.rcResults = [
    { rec: { name: '김하나', area: '진로활동', subject: '', text: '하나의 기록.' }, issues: [{ type: 'forbid', level: 'no', why: '기재 확인', what: '' }] },
    { rec: { name: '이두리', area: '진로활동', subject: '', text: '두리의 기록.' }, issues: [{ type: 'length', level: 'no', why: '글자 수 확인', what: '' }] },
];
vm.runInContext('rcRenderResults();', context);
assert.equal(elements['rc-import'].hidden, true);
// 항목마다 표에 나올 학생 수를 숫자로 보여 주고, 0은 흐리게 표시함.
assert.match(elements['rc-type-filter'].innerHTML, /value="all"><span class="rc-filter-label">전체<\/span> <span class="rc-filter-count" aria-label="2명">2<\/span>/);
assert.match(elements['rc-type-filter'].innerHTML, /value="forbid"><span class="rc-filter-label">기재 요령<\/span> <span class="rc-filter-count" aria-label="1명">1<\/span>/);
assert.match(elements['rc-type-filter'].innerHTML, /value="similar"><span class="rc-filter-label">똑같은 문장<\/span> <span class="rc-filter-count rc-zero" aria-label="0명">0<\/span>/);
assert.match(elements['rc-tbody'].innerHTML, /김하나/);
assert.match(elements['rc-tbody'].innerHTML, /이두리/);
vm.runInContext("rcTab = 'forbid'; rcRenderResults();", context);
assert.equal(elements['rc-type-filter'].value, 'forbid');
assert.match(elements['rc-tbody'].innerHTML, /김하나/);
assert.ok(!elements['rc-tbody'].innerHTML.includes('이두리'));
vm.runInContext("rcQuery = '이두리'; rcRenderResults();", context);
assert.match(elements['rc-tbody'].innerHTML, /찾는 학생이 없어요/);
assert.ok(!html.includes('id="rc-tabs"'));
console.log('Record check result filter passed');

context.rcDraft = { limits: [{ max: '500' }] };
vm.runInContext(source.match(/function rcValidateLimitInput\(input, commit = false\) \{[\s\S]*?\n\}/)[0], context);
for (const value of ['500자', '1.5', '-10', '9007199254740992']) {
    const input = { value, dataset: { validLimit: '500', i: '0' } };
    context.rcValidateLimitInput(input);
    assert.equal(input.value, '500', value);
}
const countInput = { value: '', dataset: { validLimit: '500', i: '0' } };
context.rcValidateLimitInput(countInput);
assert.equal(countInput.value, '', '입력 중에는 빈 칸 허용');
context.rcValidateLimitInput(countInput, true);
assert.equal(countInput.value, '500', '빈 칸을 벗어나면 이전 값 복원');
countInput.value = '200';
context.rcValidateLimitInput(countInput, true);
assert.equal(context.rcDraft.limits[0].max, '200');
countInput.value = '0';
context.rcValidateLimitInput(countInput, true);
assert.equal(countInput.value, '200', '0은 이전 정상값으로 복원');
console.log('Character limit input validation passed');

// 삭제 버튼은 모달만 열고, 취소하면 유지하며 확인할 때만 지침 사본에서 지움.
context.rcDraft = { forbid: [{ label: '첫 규칙' }, { label: '둘째 규칙' }] };
context.rcPendingRemoval = null;
context.rcRenderCheckGuide = () => {};
elements['rc-delete-dialog'] = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
for (const name of ['rcDraftRemove', 'rcConfirmDraftRemoval']) {
    vm.runInContext(source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0], context);
}
context.rcDraftRemove('forbid', 0);
assert.equal(context.rcDraft.forbid.length, 2);
elements['rc-delete-dialog'].close();
context.rcConfirmDraftRemoval();
assert.equal(context.rcDraft.forbid.length, 2);
context.rcDraftRemove('forbid', 0);
context.rcConfirmDraftRemoval();
assert.equal(context.rcDraft.forbid.length, 1);
assert.equal(context.rcDraft.forbid[0].label, '둘째 규칙');
console.log('Rule deletion confirmation passed');
