// 표 모양 PDF(반 전체 출력)를 엑셀 줄로 되살리기
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'record-check.js'), 'utf8'), ctx);
const { rcGroupLines, rcPdfTable, rcParseRows, rcParsePdfLines } = ctx;
const w = (s, x, y, spAfter = null) => ({ s, x, y, w: s.length * 10, h: 10, sp: false, spAfter });
const brief = recs => [...recs].map(r => [r.grade, r.cls, r.num, r.name, r.area, r.text].join('|'));

// 세특: 번호는 학생 칸의 세로 가운데, 학생 사이는 줄 간격이 넓음, 다음 쪽은 앞 학생이 이어짐
const setuk = [
    rcGroupLines([
        w('일반계 1학년 3반', 20, 800),
        w('번호', 20, 780), w('성명', 60, 780), w('학년', 100, 780), w('세부능력 및 특기사항', 200, 780),
        w('시를 읽고 감상문을', 200, 760, true),
        w('1', 20, 748), w('김하나', 60, 748), w('1', 100, 748), w('씀. 발표를 잘', 200, 748, false),
        w('함.', 200, 736),
        w('친구를 도움.', 200, 716),
        w('2', 20, 710), w('이두리', 60, 710), w('1', 100, 710),
        w('성실함.', 200, 704),
        w('1 / 2', 300, 40),
    ]),
    rcGroupLines([w('이어지는 글.', 200, 780), w('2 / 2', 300, 40)]),
];
const rows = rcPdfTable(setuk);
assert.deepEqual(brief(rcParseRows(rows, '', '세특.pdf')), [
    '1|3|1|김하나|과목별 세부능력 및 특기사항|시를 읽고 감상문을 씀. 발표를 잘함.',
    '1|3|2|이두리|과목별 세부능력 및 특기사항|친구를 도움. 성실함. 이어지는 글.',
]);

// 창체: 2단 머리글, 영역 칸은 영역 글의 가운데, 학생 칸은 그 학생 영역들의 가운데
const cc = [rcGroupLines([
    w('1학년 2반', 20, 800),
    w('번호', 20, 780), w('성명', 60, 780), w('학년', 100, 780),
    w('영역', 150, 768), w('시간', 200, 768), w('특기사항', 300, 768),
    w('학급 회의를', 250, 750, true),
    w('자율활동', 150, 744), w('34', 200, 744),
    w('1', 20, 738), w('김하나', 60, 738), w('1', 100, 738), w('이끎.', 250, 738),
    w('진로활동', 150, 726), w('20', 200, 726), w('진로를 탐색함.', 250, 726),
    w('2', 20, 706), w('이두리', 60, 706), w('1', 100, 706), w('자율활동', 150, 706), w('34', 200, 706), w('친구를 도움.', 250, 706),
])];
assert.deepEqual(brief(rcParseRows(rcPdfTable(cc), '', '창체.pdf')), [
    '1|2|1|김하나|자율·자치활동|학급 회의를 이끎.',
    '1|2|1|김하나|진로활동|진로를 탐색함.',
    '1|2|2|이두리|자율·자치활동|친구를 도움.',
]);

// 학생 한 명씩 나온 생기부 PDF는 표로 보지 않음 (학적사항 '번호 담임성명' 머리글)
const personal = [rcGroupLines([w('학년 반 번호 담임성명', 20, 800), w('1 3 12 박선생', 20, 788), w('1학년 3반 12번 성명 김하나', 20, 770)])];
assert.equal(rcPdfTable(personal), null);
// 줄 글 방식에서도 줄 끝 띄어쓰기 정보를 씀: 낱말 중간에서 줄이 바뀌면 붙임
const txt = rcParsePdfLines([[
    { text: '1학년 3반 12번 성명 김하나' }, { text: '행동특성 및 종합의견' },
    { text: '1 책임감이 강하고 꼼꼼', endSp: false }, { text: '하게 일을 처리함.' },
]]);
assert.equal(txt[0].text, '책임감이 강하고 꼼꼼하게 일을 처리함.');

// 표 칸(네모)이 있으면 번호 위치와 상관없이 칸 위아래 끝으로 학생을 가름. '학년 학기'처럼 붙은 머리글은 따로 읽음
{
    const L = (y, ...ws) => ws.map(([s, x]) => w(s, x, y));
    const page = rcGroupLines([
        ...L(780, ['번호', 10], ['성명', 60], ['학년', 100], ['학기', 122], ['행동특성 및 종합의견', 200]),
        ...L(755, ['가나다라', 200]), ...L(742, ['마바사', 200]),
        ...L(748, ['1', 20], ['김하나', 60], ['1', 104], ['1', 126]),
        ...L(729, ['아자차', 200]), ...L(716, ['카타파', 200]), ...L(703, ['하.', 200]),
        ...L(690, ['2', 20], ['이두리', 60], ['1', 104], ['2', 126], ['둘째', 200]),
        ...L(677, ['학생', 200]), ...L(664, ['글', 200]), ...L(651, ['임.', 200]),
    ]);
    page.rects = [{ x0: 5, x1: 50, y0: 700, y1: 762 }, { x0: 5, x1: 50, y0: 640, y1: 700 }, { x0: 190, x1: 400, y0: 640, y1: 762 }];
    const recs = [...rcParseRows(rcPdfTable([page]), '', '행특.pdf')];
    assert.deepEqual(recs.map(r => [r.num, r.name, r.grade, r.text.replace(/s/g, '')].join('|')), ['1|김하나|1|가나다라마바사아자차카타파하.', '2|이두리|1|둘째학생글임.']);
}
console.log('PDF table parse passed');
