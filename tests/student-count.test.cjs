const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const handler = source.match(/function validateStudentCount\(input, commit = false\) \{[\s\S]*?\n\}/);
assert.ok(handler, 'Count validator must exist');
const context = vm.createContext({});
vm.runInContext(handler[0], context);

for (const [value, expected] of [
    ['1', '1'], ['12', '12'], ['50', '50'], ['0', '1'], ['99', '50'],
    ['0007', '7'], ['1.5', '6'], ['-2', '6'], ['1e2', '6'],
    ['abc', '6'], ['한글', '6'], ['12abc', '6'],
]) {
    const input = { value, dataset: { validCount: '6' } };
    context.validateStudentCount(input);
    assert.equal(input.value, expected, value);
}
const empty = { value: '', dataset: { validCount: '6' } };
context.validateStudentCount(empty);
assert.equal(empty.value, '', 'Allow clearing while editing');
context.validateStudentCount(empty, true);
assert.equal(empty.value, '1', 'Empty value becomes 1 on blur or generation');
console.log('Student count validation passed');
