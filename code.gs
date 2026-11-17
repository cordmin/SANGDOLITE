// ─────────────────────────────────────────────────────────────
// 스크립트 속성(비밀 금고)에 넣어 둘 값  ※ 코드와 GitHub에는 절대 적지 않음
//   GEMINI_KEYS     : API 키들을 쉼표로 이어서  (예: 키1,키2,키3)
//   ADMIN_PASSWORD  : 작성요령 수정용 관리자 비밀번호
//   GUIDE_<파트이름> : 관리자가 고친 지침 (자동 저장됨, 직접 넣을 필요 없음)
// ─────────────────────────────────────────────────────────────
const PROPS = PropertiesService.getScriptProperties();
const GUIDE_MAX_LEN = 3000; // 파트 하나의 최대 글자 수 (속성 한 칸 9KB 한도 안쪽)

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 화면이 작성요령을 읽어 갈 때: ?action=guide
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'guide') {
    return jsonOut({ success: true, guide: guideForView() });
  }
  return HtmlService.createHtmlOutput('스마트 생기부 작성기 API 서버가 정상 작동 중입니다.');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'login':     return jsonOut(checkPassword(data.password) ? { success: true } : { success: false, error: '비밀번호가 틀렸어요.' });
      case 'saveGuide': return jsonOut(saveGuide(data));
      case 'resetGuide': return jsonOut(resetGuide(data));
      default:          return jsonOut(generateRecordFromAI(data));
    }
  } catch (error) {
    return jsonOut({ success: false, error: error.toString() });
  }
}

function checkPassword(pw) {
  const real = PROPS.getProperty('ADMIN_PASSWORD');
  return !!real && pw === real;
}

// 기본 지침 위에 관리자가 고친 내용을 덮어씌운 현재 지침
function currentParts() {
  const saved = PROPS.getProperties();
  const parts = {};
  Object.keys(GUIDE_PARTS).forEach(key => {
    const custom = saved['GUIDE_' + key];
    parts[key] = { title: GUIDE_PARTS[key].title, body: custom || GUIDE_PARTS[key].body, edited: !!custom };
  });
  return parts;
}

function guideForView() {
  return { parts: currentParts(), order: GUIDE_ORDER };
}

// 바뀐 파트만 저장. 저장 직전 내용은 GUIDE_PREV_ 로 남겨 '한 단계 되돌리기'에 씀
function saveGuide(data) {
  if (!checkPassword(data.password)) return { success: false, error: '비밀번호가 틀렸어요.' };
  const changes = data.parts || {};
  const now = currentParts();
  const toSave = {};
  for (const key of Object.keys(changes)) {
    if (!GUIDE_PARTS[key]) return { success: false, error: '알 수 없는 파트: ' + key };
    const body = String(changes[key]).trim();
    if (!body) return { success: false, error: `'${GUIDE_PARTS[key].title}' 내용이 비어 있어요.` };
    if (body.length > GUIDE_MAX_LEN) return { success: false, error: `'${GUIDE_PARTS[key].title}'이 너무 길어요. (${GUIDE_MAX_LEN}자 이하)` };
    if (body === now[key].body) continue;
    toSave['GUIDE_PREV_' + key] = now[key].body;
    toSave['GUIDE_' + key] = body;
  }
  PROPS.setProperties(toSave);
  return { success: true, guide: guideForView() };
}

// mode: 'default' = 처음 기본 지침으로 / 'undo' = 바로 전 저장 내용으로
function resetGuide(data) {
  if (!checkPassword(data.password)) return { success: false, error: '비밀번호가 틀렸어요.' };
  const keys = (data.keys && data.keys.length) ? data.keys : Object.keys(GUIDE_PARTS);
  keys.forEach(key => {
    if (!GUIDE_PARTS[key]) return;
    if (data.mode === 'undo') {
      const prev = PROPS.getProperty('GUIDE_PREV_' + key);
      if (prev) PROPS.setProperty('GUIDE_' + key, prev);
    } else {
      PROPS.deleteProperty('GUIDE_' + key);
    }
  });
  return { success: true, guide: guideForView() };
}

// ─────────────────────────────────────────────────────────────
// 생활기록부 작성요령 (AI에게 보내는 지침)
// - 지침은 '행동특성용'과 '공용(자율·진로·동아리·과세특)' 두 가지
// - 각 지침은 파트 목록이며, 위에 있는 파트일수록 중요함 (규칙이 부딪히면 앞 번호 우선)
// - {중괄호} 자리는 생성할 때 실제 값으로 바뀜
// ─────────────────────────────────────────────────────────────
const GUIDE_PARTS = {
  intro_behavior: {
    title: '작업 설명 (행동특성)',
    body: `대한민국 중학교 학교생활기록부에 들어갈 문장을 작성하는 작업입니다.
2026학년도 학교생활기록부 기재요령에 맞게, 아래 자료를 바탕으로 '행동특성 및 종합의견' 문장 예시 {문장개수}개를 작성하세요.

[학생 자료]
- 좋은 태도(강조할 점): {좋은태도}
- 아쉬운 태도(드러내되 순화할 점): {아쉬운태도}
- 교사 관찰 메모(한 학생에 대한 여러 관찰):
{입력내용}`
  },
  intro_general: {
    title: '작업 설명 (자율·진로·동아리·과세특)',
    body: `대한민국 중학교 학교생활기록부에 들어갈 문장을 작성하는 작업입니다.
2026학년도 학교생활기록부 기재요령에 맞게, 아래 자료를 바탕으로 '{영역}' 영역에 바로 복사해서 쓸 수 있는 서로 다른 특기사항 예시 {문장개수}개를 작성하세요.

[입력 자료]
- 영역: {영역}
- 과목 및 동아리명: {과목}
- 교사가 진행한 활동 및 학습 내용 전체:
{입력내용}`
  },
  forbidden: {
    title: '기재 금지',
    body: `어기면 쓸 수 없는 문장이 되므로 가장 먼저 지킬 것.
- 학생 이름, 1인칭(나, 저), 가족·친인척 관련 내용, 부모의 사회경제적 지위
- 학교명, 학교 별칭, 특정 대학명, 기관명, 상호명, 강사명, 재단명, 축제명
- 대회명, 수상 실적, 자격증, 논문, 어학·인증시험 점수, 모의고사·전국연합학력평가 성적, 해외활동
- 도서 출간, 특허, 장학생·장학금, 방과후학교 활동
- 특수기호(★, ▶, ■ 등), 괄호, 따옴표, 마크다운 기호
- 불필요한 영어 약칭과 무분별한 외래어`
  },
  core_behavior: {
    title: '태도 반영 (행동특성 핵심)',
    body: `- 좋은 태도는 관찰 메모 속 구체적인 행동과 연결하여 강조할 것.
- 아쉬운 태도가 주어지면 숨기지 말고 드러낼 것. 다만 단어를 낙인처럼 그대로 쓰지 말고, 실제 모습과 나아지려는 노력의 과정으로 표현한 뒤 앞으로의 발전 기대로 마무리할 것.
- 예: 소극적 → 처음에는 발표를 망설였으나 점차 자기 생각을 말하려 노력하며, 자신감을 키워 간다면 더 큰 성장이 기대됨.
- 아쉬운 태도는 모든 문장에 넣지 말고 일부 문장에만 자연스럽게 반영할 것.`
  },
  core_general: {
    title: '활동 분리 (자율·진로·동아리·과세특 핵심)',
    body: `- 서로 다른 활동은 한 문장 안에 엮지 말고, 각각 독립된 문장으로 나란히 쓸 것. 분량이 모자라도 엮지 말 것.
- 활동을 이어서, 이후, 그리고, 또한 같은 연결어로 잇지 말 것.
- 활동이 여러 개면 각 활동에 비슷한 분량을 나눌 것.
- 같은 활동이라도 학업 역량, 협력·소통, 진로 연계, 문제 해결, 성실성 등 서로 다른 태도와 배운 점을 담아 예시마다 다르게 쓰고, 모든 예시가 첫 번째 활동부터 시작하지 않게 할 것.
- 좋은 예 (활동 2개, 구조만 참고하고 분량은 분량 규칙을 따를 것):
  학급 회장 선거에 입후보하여 공약을 준비하고 발표하는 과정에서 뛰어난 소통 능력과 책임감을 보임. 생명존중교육에 진지한 태도로 참여하여 배운 점을 일상에서 실천하려는 모습이 돋보임.
- 나쁜 예 1, 한 문장에 섞음: 정부반장선거에 참여하여 소통 능력을 보였으며 생명존중교육에도 성실히 참여함.
- 나쁜 예 2, 연결어로 이음: 정부반장선거에 참여하여 소통 능력을 보임. 이어 생명존중교육에도 성실히 참여함.
- 나쁜 예 3, 지나치게 쪼갬: 정부반장선거에 입후보함. 공약을 발표함. 투표의 소중함을 일깨움. 생명존중교육에 참여함.`
  },
  style: {
    title: '문체',
    body: `- 문장 끝은 명사형 현재(~함, ~임, ~됨, ~보임, ~나타냄)로 맺을 것.
- 문장 끝을 과거형(~했음, ~하였음, ~였음, ~했다)이나 ~합니다로 맺지 말 것. 문장 중간의 과거형(~했으며, ~했고, ~였으나)은 자연스러우면 써도 됨.
- 문장을 '학생은', '이 학생은', '본 학생은'으로 시작하지 말고 곧바로 행동이나 특성으로 시작할 것.
- 문장을 중간에 끊지 말고 마침표(.)로 끝나는 완결된 문장으로 쓸 것.`
  },
  content: {
    title: '내용 원칙',
    body: `- 실제 관찰 가능한 행동과 사실 중심으로 쓸 것. 탁월한, 훌륭한, 완벽한 같은 과도한 꾸밈말은 피하되 뛰어난, 돋보임 정도는 써도 됨.
- 활동을 나열하지 말고 참여도, 맡은 역할, 협력 모습 등 학생만의 특성이 드러나게 쓸 것.
- 입력에 횟수나 시간 같은 수치가 있으면 구체적인 수치로 쓸 것.
- 결과만 적지 말고 과정에서 보인 행동의 변화와 성장의 흐름을 담을 것.
- 학생을 깎아내리는 단정은 하지 말 것.
- 교사가 직접 관찰하고 쓴 것처럼 자연스럽고 생생하게 쓰고, 관료적인 표현은 피할 것.`
  },
  length: {
    title: '분량',
    body: `- 각 문장은 공백 포함 {글자수}자를 넘지 않되 {최소글자수}자 이상 채울 것. {글자수}자는 넘으면 안 되는 한도임.
- 여러 문장의 합이 아니라 문장 하나하나의 분량임. 모자라면 구체적 행동·맥락·역할·수치·성장 과정을 더 자세히 쓸 것.
- 단, 분량보다 위의 규칙이 우선임.`
  },
  format: {
    title: '출력 형식',
    body: `- 1번부터 {문장개수}번까지 "1. ", "2. "처럼 숫자, 마침표, 띄어쓰기로 시작하여 서로 다른 문장 정확히 {문장개수}개를 출력할 것.
- 번호 붙은 문장 외에 다른 말은 출력하지 말 것.`
  },
  check_behavior: {
    title: '마지막 점검 (행동특성)',
    body: `가장 자주 틀리는 부분이니 출력 전에 반드시 다시 확인할 것.
- 문장 끝이 ~했음, ~하였음, ~였음처럼 과거형이면 ~함, ~임처럼 현재형으로 고칠 것.`
  },
  check_general: {
    title: '마지막 점검 (자율·진로·동아리·과세특)',
    body: `가장 자주 틀리는 부분이니 출력 전에 반드시 다시 확인할 것.
- 문장 끝이 ~했음, ~하였음, ~였음처럼 과거형이면 ~함, ~임처럼 현재형으로 고칠 것.
- 서로 다른 활동 두 개가 한 문장 안에 엮여 있으면 두 문장으로 나눌 것.`
  }
};

// 지침별 파트 순서 (작업 설명 다음부터 중요한 순서)
const GUIDE_ORDER = {
  behavior: ['intro_behavior', 'forbidden', 'core_behavior', 'style', 'content', 'length', 'format', 'check_behavior'],
  general:  ['intro_general',  'forbidden', 'core_general',  'style', 'content', 'length', 'format', 'check_general']
};

// 학생 자료로 {빈칸}을 채워 AI에게 보낼 지침 글을 만든다
function buildPrompt(data) {
  const P = currentParts();
  const isBehavior = data.area === '행동특성';
  const order = GUIDE_ORDER[isBehavior ? 'behavior' : 'general'];
  const [introKey, ...ruleKeys] = order;
  const rules = ruleKeys.map((key, i) => `${i + 1}. ${P[key].title}\n${P[key].body}`).join('\n\n');
  const text = `${P[introKey].body}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[작성 규칙] 번호가 앞설수록 중요하며, 규칙이 서로 부딪히면 앞 번호를 따를 것.

${rules}`;
  const vals = {
    '문장개수': data.sentenceCount,
    '글자수': data.charLimit,
    '최소글자수': Math.round(data.charLimit * 0.85),
    '영역': data.area,
    '과목': data.subject || '해당 없음',
    '좋은태도': (data.posKeywords !== undefined ? data.posKeywords : data.keywords) || '없음',
    '아쉬운태도': data.negKeywords || '없음',
    '입력내용': data.cases
  };
  // 입력 내용 속 중괄호는 건드리지 않도록 지침 쪽 빈칸만 한 번에 바꿈
  return text.replace(/\{(문장개수|글자수|최소글자수|영역|과목|좋은태도|아쉬운태도|입력내용)\}/g, (_, k) => String(vals[k]));
}


function generateRecordFromAI(data) {
  // API 키는 스크립트 속성 GEMINI_KEYS 에서 읽음 (쉼표로 구분)
  const validApiKeys = (PROPS.getProperty('GEMINI_KEYS') || '').split(',').map(k => k.trim()).filter(Boolean);

  if (validApiKeys.length === 0) {
    return { success: false, error: "등록된 API 키가 없습니다. 스크립트 속성 GEMINI_KEYS를 확인하세요." };
  }

  // Round-Robin 방식으로 시작 인덱스 결정
  const cache = CacheService.getScriptCache();
  let lastKeyIndex = cache.get("last_api_key_index");
  let startIndex = 0;
  if (lastKeyIndex !== null) {
    startIndex = (parseInt(lastKeyIndex) + 1) % validApiKeys.length;
  } else {
    startIndex = Math.floor(Math.random() * validApiKeys.length);
  }
  cache.put("last_api_key_index", startIndex.toString(), 21600); // 6시간 캐싱

  const systemPrompt = buildPrompt(data);

  const payload = {
    "contents": [{
      "parts": [{ "text": systemPrompt }]
    }],
    "generationConfig": {
      "maxOutputTokens": 8192,
      "temperature": 0.7,
      "topP": 0.95
    },
    "safetySettings": [
      { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
      { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
    ]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // 요청 모델 결정: 클라이언트 지정 모델 -> gemini-flash-lite-latest(영구 최신 유지) -> gemini-3.5-flash-lite
  let modelName = (data && data.model) ? data.model : "gemini-flash-lite-latest";

  // Failover Loop: 사용 가능한 키 개수만큼 시도
  let lastError = "";
  for (let i = 0; i < validApiKeys.length; i++) {
    const currentIndex = (startIndex + i) % validApiKeys.length;
    const selectedApiKey = validApiKeys[currentIndex];

    // 헤더 및 API URL 설정 (공식 권장 x-goog-api-key 헤더 적용)
    options.headers = {
      "x-goog-api-key": selectedApiKey
    };
    let apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + selectedApiKey;

    try {
      console.log(`Gemini API 호출 시도 - Model: ${modelName}, API Key Index: ${currentIndex}`);
      let response = UrlFetchApp.fetch(apiUrl, options);
      let responseCode = response.getResponseCode();
      let contentText = response.getContentText();
      let json = JSON.parse(contentText);

      // 모델 지원 종료 또는 404 감지 시 안정 대체 모델로 1회 즉시 재시도
      if (responseCode === 404 || (json.error && (json.error.message.includes("no longer available") || json.error.message.includes("not found")))) {
        const fallbackModel = (modelName !== "gemini-flash-lite-latest") ? "gemini-flash-lite-latest" : "gemini-3.5-flash-lite";
        if (modelName !== fallbackModel) {
          console.warn(`모델(${modelName}) 지원 불가 감지됨. 대체 모델(${fallbackModel})로 전환하여 재시도합니다.`);
          modelName = fallbackModel;
          apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + selectedApiKey;
          response = UrlFetchApp.fetch(apiUrl, options);
          responseCode = response.getResponseCode();
          contentText = response.getContentText();
          json = JSON.parse(contentText);
        }
      }

      const parts = json.candidates?.[0]?.content?.parts;
      if (responseCode === 200 && parts && parts.length > 0 && parts[0].text) {
        // 성공 시 다음 요청을 위해 캐시 업데이트
        cache.put("last_api_key_index", currentIndex.toString(), 21600);
        let resultText = parts.map(p => p.text || '').join('').trim();
        // 길이 제한으로 중간에 멈췄으면 마지막(끊긴) 문장은 빼고 멀쩡한 문장만 돌려줌
        if (json.candidates[0].finishReason === 'MAX_TOKENS') {
          const lines = resultText.split('\n');
          lines.pop();
          resultText = lines.join('\n').trim();
          if (!resultText) return { success: false, error: '생성 미완료(MAX_TOKENS)' };
        }
        return {
          success: true,
          result: resultText,
          apiKeyIndex: currentIndex,
          modelUsed: modelName
        };
      } else {
        const blockReason = json.promptFeedback?.blockReason;
        const finishReason = json.candidates?.[0]?.finishReason;
        const errorMsg = json.error?.message
          || (blockReason ? `요청 차단(${blockReason})` : null)
          || (finishReason ? `생성 미완료(${finishReason})` : null)
          || `HTTP ${responseCode}`;
        console.warn(`API 키 인덱스 ${currentIndex} 호출 실패: ${errorMsg}`);
        lastError = errorMsg;
      }
    } catch (e) {
      console.error(`API 키 인덱스 ${currentIndex} 통신 오류: ${e.toString()}`);
      lastError = e.toString();
    }
  }

  // 모든 API 키가 실패했을 경우
  return { success: false, error: `모든 API 키 호출에 실패했습니다. 마지막 오류: ${lastError}` };
}