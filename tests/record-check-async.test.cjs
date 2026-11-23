const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'record-check-ui.js'), 'utf8');
const elements = {};
const pending = [];
const context = vm.createContext({
    rcFiles: [{ records: [{ text: '학교 활동에 참여함.' }] }],
    RC_DEFAULT_SETTINGS: { limits: {} },
    rcRunVersion: 0, rcChecking: false, rcResults: null, rcTab: 'all', rcQuery: '', toastTimer: null,
    document: { getElementById: id => elements[id] ||= { classList: { toggle() {}, remove() {} }, style: {} } },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, rcBarTimer: null,
    rcRenderFiles() {}, rcRenderResults() {}, getByteLength: text => text.length,
    rcCheckAll: (records, settings) => settings.spellings,
    rcCheckSpelling: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
});
for (const pattern of [/async function rcRun\([^)]*\) \{[\s\S]*?\n\}/, /function rcRemoveFile\(i\) \{[\s\S]*?\n\}/, /function rcLoading\([^)]*\) \{[\s\S]*?\n\}/, /function showToast\(text, type = ''\) \{[\s\S]*?\n\}/]) {
    vm.runInContext(source.match(pattern)[0], context);
}

(async () => {
    const first = context.rcRun();
    assert.equal(context.rcChecking, true);
    assert.equal(elements['rc-loading'].hidden, false, '점검 중에는 표 가운데 로딩 표시');
    const second = context.rcRun();
    pending[1].resolve({ latest: [] });
    await second;
    pending[0].resolve({ stale: [] });
    await first;
    assert.ok('latest' in context.rcResults, '이전 점검이 늦게 끝나도 최신 결과를 덮어쓰지 않음');
    assert.equal(context.rcChecking, false);
    assert.equal(elements['rc-loading'].hidden, true, '점검이 끝나면 로딩 표시를 숨김');

    const removed = context.rcRun();
    context.rcRemoveFile(0);
    pending[2].resolve({ removed: [] });
    await removed;
    assert.equal(context.rcResults, null, '파일을 뺀 뒤 점검 결과가 되살아나지 않음');
    assert.equal(elements['rc-loading'].hidden, true, '점검 중 파일을 빼도 로딩 표시가 남지 않음');

    context.rcFiles = [{ records: [{ text: '학교' }] }];
    const failed = context.rcRun();
    pending[3].reject(new Error('사전 읽기 실패'));
    await failed;
    assert.match(elements['toast'].textContent, /사전 읽기 실패/);
    assert.equal(context.rcChecking, false);
    assert.equal(context.rcResults, null);
    assert.equal(elements['rc-loading'].hidden, true);

    // 파일은 하나만: 여러 개를 고르면 첫 파일만, 이미 있으면 새 파일로 바꿈 (새 파일을 못 읽으면 그대로)
    vm.runInContext(source.match(/async function rcAddFiles\(list\) \{[\s\S]*?\n\}/)[0], context);
    vm.runInContext(source.match(/function rcFixRange\(ws\) \{[\s\S]*?\n\}/)[0], context);
    Object.assign(context, {
        XLSX: { read: () => ({ SheetNames: ['진로'], Sheets: { 진로: {} } }), utils: { sheet_to_json: () => [] } },
        rcParseRows: (rows, sheet, name) => [{ name, text: '기록' }],
    });
    const file = name => ({ name, arrayBuffer: async () => new ArrayBuffer(0) });
    context.rcFiles = [];
    await context.rcAddFiles([file('3반.xlsx'), file('4반.xlsx')]);
    assert.equal(context.rcFiles.map(f => f.name).join(), '3반.xlsx', elements['toast'].textContent);
    assert.match(elements['toast'].textContent, /하나만/);
    await context.rcAddFiles([file('5반.xlsx')]);
    assert.equal(context.rcFiles.map(f => f.name).join(), '5반.xlsx', '이미 불러온 파일이 있으면 새 파일로 바꿈');
    assert.match(elements['toast'].textContent, /바꿔 불러왔어요/);
    context.rcParseRows = () => [];
    context.rcLoadFail = () => {};
    await context.rcAddFiles([file('빈파일.xlsx')]);
    assert.equal(context.rcFiles.map(f => f.name).join(), '5반.xlsx', '새 파일을 못 읽으면 지금 파일 그대로');
    console.log('Async record checks, failure handling and stale results passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
