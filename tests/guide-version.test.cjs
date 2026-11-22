const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const elements = {
    'guide-actions': { innerHTML: '' },
    'guide-list': { innerHTML: '', appendChild() {} },
};
let answer = false;
let question = '';
let requests = [];
let failSave = false;
const context = vm.createContext({
    document: {
        getElementById: id => elements[id],
        querySelectorAll: () => [],
        createElement: () => ({ appendChild() {} }),
    },
    showConfirm: async (title, text) => { question = text; return answer; },
    showModal() {},
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/guide-default.js'), 'utf8'), context);
vm.runInContext(source.slice(source.indexOf('let guideData ='), source.indexOf('// 비밀번호 창 바깥')), context);
context.gasPost = async body => {
    requests.push(JSON.parse(JSON.stringify(body)));
    return failSave ? { success: false, error: '저장 실패' } : { success: true, guide: body.guide };
};
const run = code => vm.runInContext(code, context);
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'docs/guide-versions/v2.1.0.json'), 'utf8'));
assert.deepEqual(JSON.parse(run('JSON.stringify(GUIDE_DEFAULT)')), snapshot, '확정된 기본 지침 스냅샷을 그대로 유지');
const currentSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'docs/guide-versions/v2.1.5.json'), 'utf8'));
assert.equal(run('GUIDE_CURRENT_VERSION'), currentSnapshot.version);
assert.equal(run('GUIDE_DEFAULT_VERSION'), currentSnapshot.baseVersion);
assert.equal(source.match(/async function requestGeneration\(payload\) \{[\s\S]*?\n\}/)[0].replace(/\r\n/g, '\n'), currentSnapshot.requestPolicySource, '작성 규칙을 주입하지 않는 전달 함수 유지');
context.releaseGuide = currentSnapshot.guide;
run('guideReleaseData = releaseGuide');
assert.equal(run('guideVersion(guideReleaseData)'), '2.1.5');
assert.equal(run('guideVersion(GUIDE_DEFAULT)'), '2.1.0');

(async () => {
    run(`guideData = JSON.parse(JSON.stringify(GUIDE_DEFAULT));
        guideData.parts.style.body = '수정한 문체 규칙';
        guideData.parts.extra = { title: '추가 규칙', body: '이전 사용자 규칙' };
        guideData.order.behavior.push('extra');
        guideEditing = true;
        guideDrafts.style = '저장 전 수정';
        renderGuide();`);
    assert.match(elements['guide-actions'].innerHTML, /version-badge current.*현재 버전.*v2.1.5/);
    assert.match(elements['guide-actions'].innerHTML, /version-badge baseline.*기본 버전.*v2\.1\.0/);
    assert.ok(!elements['guide-list'].innerHTML.includes('guide-notice'));

    // 복원 확인을 취소하면 작성 중인 내용도 보존한다.
    await context.fillDefaultGuide();
    assert.match(question, /문장 생성 지침을 기본 버전 2\.1\.0으로 돌리시겠습니까/);
    assert.ok(!question.includes('추가 요청 규칙'));
    assert.equal(run('guideDrafts.style'), '저장 전 수정');
    assert.equal(run('guideResetPending'), false);

    answer = true;
    await context.fillDefaultGuide();
    assert.equal(requests.length, 0, '확인만으로 서버에 저장하지 않음');
    assert.equal(run('guideData.parts.style.body'), '수정한 문체 규칙');
    await context.cancelGuideEdit();
    assert.equal(run('guideResetPending'), false);
    assert.ok(run('guideData.parts.extra'), '편집 취소 시 추가 규칙도 유지');

    // 저장 실패 시 복원 초안을 유지하고, 재시도 성공 시 전체 기본 지침을 저장한다.
    run('guideEditing = true');
    await context.fillDefaultGuide();
    failSave = true;
    await context.saveGuide();
    assert.equal(run('guideResetPending'), true);
    assert.equal(run('guideVersion(guideData)'), '2.1.5 · 수정됨');
    failSave = false;
    await context.saveGuide();
    assert.equal(run('guideResetPending'), false);
    assert.equal(run('guideVersion(guideData)'), '2.1.0');
    assert.equal(requests.at(-1).guide.parts.extra, undefined);
    assert.ok(!requests.at(-1).guide.order.behavior.includes('extra'));
    assert.match(elements['guide-actions'].innerHTML, /version-badge current.*v2\.1\.0/);

    // 기본값을 불러온 뒤 다시 고친 내용도 저장한다.
    run('guideEditing = true');
    await context.fillDefaultGuide();
    run("guideDrafts.style = '다시 수정한 문체'");
    await context.saveGuide();
    assert.equal(requests.at(-1).guide.parts.style.body, '다시 수정한 문체');
    assert.equal(run('guideVersion(guideData)'), '2.1.5 · 수정됨');
    console.log('Guide version and restore passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
