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
    confirm: text => { question = text; return answer; },
    showModal() {},
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/guide-default.js'), 'utf8'), context);
vm.runInContext(source.slice(source.indexOf('let guideData ='), source.indexOf('// 비밀번호 창 바깥')), context);
context.gasPost = async body => {
    requests.push(JSON.parse(JSON.stringify(body)));
    return failSave ? { success: false, error: '저장 실패' } : { success: true, guide: body.guide };
};
const run = code => vm.runInContext(code, context);

(async () => {
    run(`guideData = JSON.parse(JSON.stringify(GUIDE_DEFAULT));
        guideData.parts.style.body = '수정한 문체 규칙';
        guideData.parts.extra = { title: '추가 규칙', body: '이전 사용자 규칙' };
        guideData.order.behavior.push('extra');
        guideEditing = true;
        guideDrafts.style = '저장 전 수정';
        renderGuide();`);
    assert.match(elements['guide-actions'].innerHTML, /현재 버전 \[v2\.1\.0\] \/ 기본 버전 \[v2\.0\.0\]/);
    assert.ok(!elements['guide-list'].innerHTML.includes('guide-notice'));

    // 복원 확인을 취소하면 작성 중인 내용도 보존한다.
    run('fillDefaultGuide()');
    assert.match(question, /문장 생성 지침을 기본 버전 2\.0\.0으로 돌리시겠습니까/);
    assert.equal(run('guideDrafts.style'), '저장 전 수정');
    assert.equal(run('guideResetPending'), false);

    answer = true;
    run('fillDefaultGuide()');
    assert.equal(requests.length, 0, '확인만으로 서버에 저장하지 않음');
    assert.equal(run('guideData.parts.style.body'), '수정한 문체 규칙');
    run('cancelGuideEdit()');
    assert.equal(run('guideResetPending'), false);
    assert.ok(run('guideData.parts.extra'), '편집 취소 시 추가 규칙도 유지');

    // 저장 실패 시 복원 초안을 유지하고, 재시도 성공 시 전체 기본 지침을 저장한다.
    run('guideEditing = true; fillDefaultGuide()');
    failSave = true;
    await context.saveGuide();
    assert.equal(run('guideResetPending'), true);
    assert.equal(run('guideVersion(guideData)'), '2.1.0');
    failSave = false;
    await context.saveGuide();
    assert.equal(run('guideResetPending'), false);
    assert.equal(run('guideVersion(guideData)'), '2.0.0');
    assert.equal(requests.at(-1).guide.parts.extra, undefined);
    assert.ok(!requests.at(-1).guide.order.behavior.includes('extra'));
    assert.match(elements['guide-actions'].innerHTML, /현재 버전 \[v2\.0\.0\]/);

    // 기본값을 불러온 뒤 다시 고친 내용도 저장한다.
    run("guideEditing = true; fillDefaultGuide(); guideDrafts.style = '다시 수정한 문체';");
    await context.saveGuide();
    assert.equal(requests.at(-1).guide.parts.style.body, '다시 수정한 문체');
    assert.equal(run('guideVersion(guideData)'), '2.1.0');
    console.log('Guide version and restore passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
