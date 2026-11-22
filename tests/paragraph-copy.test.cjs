const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
let copied, fallback, removed, toast, reset;
const input = { setAttribute() {}, style: {}, select() {}, remove() { removed = true; } };
const context = vm.createContext({
    navigator: { clipboard: {} },
    document: { createElement: () => input, body: { appendChild() {} }, execCommand: () => { copied = input.value; return fallback; } },
    setTimeout: fn => { reset = fn; }, showToast: message => { toast = message; },
});
vm.runInContext(source.match(/async function copyGeneratedParagraph\(text, button\) \{[^]*?\n\}/)[0], context);
const makeButton = () => ({ innerHTML: '복사', disabled: false, focus() {} });
(async () => {
    const text = '정·부반장 선거에 참여함. <원문> & 공백 유지함.';
    context.navigator.clipboard.writeText = async value => { copied = value; };
    let button = makeButton();
    await context.copyGeneratedParagraph(text, button);
    assert.equal(copied, text);
    assert.match(button.innerHTML, /완료/);
    assert.equal(button.disabled, false);
    reset(); assert.match(button.innerHTML, /복사/);

    context.navigator.clipboard.writeText = async () => { throw new Error('권한 제한'); };
    fallback = true; button = makeButton();
    await context.copyGeneratedParagraph(text, button);
    assert.equal(copied, text);
    assert.equal(removed, true);
    assert.match(button.innerHTML, /완료/);

    fallback = false; button = makeButton();
    await context.copyGeneratedParagraph(text, button);
    assert.equal(button.innerHTML, '복사', '실패했는데 완료 표시하지 않음');
    assert.match(toast, /복사하지 못했어요/);
    assert.equal(button.disabled, false);
    console.log('Paragraph-only copy, fallback, failure feedback and restored button passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
