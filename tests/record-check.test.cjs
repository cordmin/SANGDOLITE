// 생활기록부 점검: 엑셀 줄 읽기와 점검 규칙 확인
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(app.match(/function getByteLength\(text\) \{[\s\S]*?\n\}/)[0], ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'record-check.js'), 'utf8') + ';this.S = RC_DEFAULT_SETTINGS; this.RC_DEFAULT_GUIDE = RC_DEFAULT_GUIDE;', ctx);
const { rcParseRows, rcCheckAll, rcHighlight, getByteLength, S } = ctx;

// 위에 제목 줄, 합쳐진 칸, 두 줄로 나뉜 긴 글
const rows = [
    ['교과학습발달상황 세부능력 및 특기사항'], [],
    ['학년', '반', '번호', '성명', '과목', '세부능력 및 특기사항'],
    ['1', '3', '1', '김하나', '국어', '토익 900점을 받음. 시를 읽고 감상문을 씀.'],
    ['', '', '', '', '', '발표를 잘함'],
    ['', '', '2', '이두리', '', '시를 읽고 감상문을 씀. 몇일 동안 조사함.'],
    ['', '', '3', '박세나', '', ''],
];
const recs = rcParseRows(rows, 'Sheet1', '세특.xlsx');
assert.equal(recs.length, 3);
assert.equal(recs[0].text, '토익 900점을 받음. 시를 읽고 감상문을 씀.발표를 잘함');
assert.equal(recs[1].subject, '국어');
assert.equal(recs[1].cls, '3');
assert.equal(recs[0].area, '과목별 세부능력 및 특기사항');

// 창체: 한 학생 이름 칸이 합쳐져 영역 줄만 바뀜
const cc = rcParseRows([
    ['학년', '반', '번호', '성명', '영역', '특기사항'],
    ['2', '1', '1', '김하나', '자율활동', '학급 회의를 이끎.'],
    ['', '', '', '', '진로활동', '진로 탐색을 함.'],
    ['', '', '', '', '', '이어지는 글.'],
    ['', '', '2', '이두리', '자율활동', '친구를 도움.'],
]);
assert.equal(cc.length, 3);
assert.equal(cc[1].name, '김하나');
assert.equal(cc[1].area, '진로활동');
assert.equal(cc[1].text, '진로 탐색을 함.이어지는 글.');
assert.equal(cc[2].num, '2');

const res = rcCheckAll(recs, S, getByteLength);
const types = i => res[i].issues.map(x => x.type);
assert.ok(types(0).includes('forbid'), '공인어학시험');
assert.ok(types(0).includes('ending'), '마침표 빠짐');
assert.ok(types(1).includes('spell'), '몇일 → 며칠');
assert.equal(types(2).join(), 'empty');

// '~다.' 끝맺음, 반복 표현, 글자 수 넘침
const one = rcCheckAll([{ area: '행동특성 및 종합의견', subject: '', name: '가', text: '성실한 태도로 성실하게 참여함. 성실함이 돋보였다.' }],
    { ...S, limits: { ...S.limits, '행동특성 및 종합의견': 30 } }, getByteLength)[0].issues;
assert.ok(one.some(x => x.type === 'ending'));
assert.ok(one.some(x => x.type === 'repeat'));
assert.ok(one.some(x => x.type === 'length'));

// 대학원은 학원으로 잡지 않음
const ok = rcCheckAll([{ area: '진로활동', subject: '', name: '가', text: '대학원 진학을 꿈꾸며 탐구함.' }], S, getByteLength)[0].issues;
assert.ok(!ok.some(x => x.what === '학원'));

// 비슷한 문장
const sim = rcCheckAll([
    { area: '자율·자치활동', subject: '', name: '가', text: '학급 회의에서 의견을 조리 있게 말하고 친구들의 생각을 존중함.' },
    { area: '자율·자치활동', subject: '', name: '나', text: '학급 회의에서 의견을 조리 있게 말하고 친구들의 생각을 존중함.' },
], S, getByteLength);
assert.ok(sim[0].issues.some(x => x.type === 'similar'));

// 표시할 때 HTML은 안전하게 바꿈
assert.match(rcHighlight('<b>토익</b>', [{ what: '토익', level: 'no' }]), /&lt;b&gt;<mark class="rc-mark rc-no">토익<\/mark>/);
console.log('Record check passed');

// PDF: 학생 머리글, 창체 영역 줄, 세특 '과목:' 줄, 행특, 쪽 번호 무시, 다른 쪽으로 이어짐
const { rcParsePdfLines } = ctx;
const pdf = rcParsePdfLines([
    ['학교생활기록부', '1학년 3반 12번 성명 김하나', '7. 창의적 체험활동상황', '학년 영역 시간 특기사항',
     '1 자율활동 34 학급 회의를 이끌며', '의견을 모음.', '동아리활동 34 과학 실험을 함.', '- 1 -'],
    ['진로활동 20 진로 탐색을 함.', '수상경력', '교내 과학상', '8. 교과학습발달상황', '세부능력 및 특기사항',
     '국어: 시를 읽고 감상문을 씀.', '발표를 잘함.', '(2학기)수학: 함수를 탐구함.', '행동특성 및 종합의견', '1 성실하고 책임감이 강함.'],
    ['2학년 1반 3번 성명 이두리', '행동특성 및 종합의견', '1 친구를 잘 도움.'],
]);
const brief = pdf.map(r => [r.name, r.area, r.subject, r.text].join('|'));
assert.deepEqual([...brief], [
    '김하나|자율·자치활동||학급 회의를 이끌며 의견을 모음.',
    '김하나|동아리활동||과학 실험을 함.',
    '김하나|진로활동||진로 탐색을 함.',
    '김하나|과목별 세부능력 및 특기사항|국어|시를 읽고 감상문을 씀. 발표를 잘함.',
    '김하나|과목별 세부능력 및 특기사항|수학|함수를 탐구함.',
    '김하나|행동특성 및 종합의견||성실하고 책임감이 강함.',
    '이두리|행동특성 및 종합의견||친구를 잘 도움.',
]);
assert.equal(pdf[0].num, '12');
assert.equal(pdf[6].cls, '1');
console.log('PDF record parse passed');

// 2026 기재요령(중학교) 반영
const iss = (area, text) => rcCheckAll([{ area, subject: '', name: '가', text }], S, getByteLength)[0].issues;
assert.ok(iss('자율·자치활동', '교내 토론대회에 참가함.').some(x => x.what === '대회' && x.level === 'no'), '대회는 기재 불가');
assert.ok(iss('자율·자치활동', '한자능력검정 3급을 취득함.').some(x => x.level === 'no'), '한자능력검정');
assert.ok(!iss('자율·자치활동', 'SNS와 AI 윤리를 탐구함.').some(x => x.type === 'forbid'), 'SNS·AI는 써도 됨');
assert.ok(iss('자율·자치활동', 'Python으로 코딩함.').some(x => x.what === 'Python'), '일반 영어 낱말은 확인');
assert.ok(iss('자율·자치활동', '1. 학급 회의를 이끎.').some(x => x.type === 'spell' && /번호/.test(x.why)), '번호 기호');
assert.ok(!iss('자율·자치활동', '○○대학교와 연계한 활동에 참여함.').some(x => x.type === 'spell'), '○○ 자리표시는 괜찮음');
assert.equal(getByteLength('가\n나'), 7, '엔터는 1바이트');
assert.equal(getByteLength('가\r\n나'), 7, 'CRLF도 1바이트');
assert.equal(S.limits['행동특성 및 종합의견'], 900);
assert.equal(S.limits['진로활동'], 1500);

// PDF 자유학기활동
const fr = rcParsePdfLines([['1학년 2반 5번 성명 박세나', '자유학기활동상황', '1 1학기 주제선택활동 34 생태 탐구를 함.', '예술·체육활동 20 합창을 함.']]);
assert.equal(fr.map(r => r.area + '|' + r.subject + '|' + r.text).join(), '자유학기활동|주제선택활동|생태 탐구를 함.,자유학기활동|예술·체육활동|합창을 함.');
// 영재교육: 세특에서는 넘어가고, 행동특성에서는 기재 불가
assert.ok(!iss('과목별 세부능력 및 특기사항', '영재교육원에서 수학 탐구 과정을 수료함.').some(x => x.type === 'forbid'), '세특 영재교육은 괜찮음');
assert.ok(iss('행동특성 및 종합의견', '영재교육원에서 수학 탐구 과정을 수료함.').some(x => x.type === 'forbid' && x.level === 'no'), '행특 영재교육은 기재 불가');
assert.ok(iss('과목별 세부능력 및 특기사항', '천안교육지원청 영재교육원에서 정보 영역 110시간을 이수함.').some(x => x.level === 'no'), '세특이라도 영재교육기관 이름은 기재 불가');
assert.ok(iss('과목별 세부능력 및 특기사항', '충남대학교 부설 과학영재교육원에서 이수함.').some(x => x.level === 'no'), '대학 부설 영재교육원 이름');
// 관리자가 고친 점검 지침이 바로 적용됨 (기재 점검·맞춤법·글자 수)
const { rcApplyGuide, RC_DEFAULT_GUIDE } = ctx;
rcApplyGuide({ forbid: [{ level: 'no', label: '테스트', words: '사과, 배', why: '과일 금지' }], spell: [{ wrong: '바나나', right: '바나나우유' }], limits: [{ group: 'g', item: 'i', max: '10자', key: '진로활동' }] });
const custom = iss('진로활동', '사과를 먹었음. 바나나를 먹었음. 대회에 나감.');
assert.ok(custom.some(x => x.why === '과일 금지'), '새 기재 점검');
assert.ok(custom.some(x => x.type === 'spell' && /바나나우유/.test(x.why)), '새 맞춤법');
assert.ok(!custom.some(x => x.what === '대회'), '지운 규칙은 안 봄');
assert.ok(rcCheckAll([{ area: '진로활동', subject: '', name: '가', text: '가나다라마바사아자차카' }], S, getByteLength)[0].issues.some(x => x.type === 'length'), '새 글자 수(10자=30바이트)');
rcApplyGuide({ forbid: [{ level: 'no', label: '깨짐', find: '(', why: 'x' }], spell: [], limits: [] });
assert.ok(!iss('진로활동', '(').some(x => x.why === 'x'), '잘못된 찾을 말은 건너뜀');
rcApplyGuide(RC_DEFAULT_GUIDE);
console.log('2026 guide rules passed');
