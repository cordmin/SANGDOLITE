// ─────────────────────────────────────────────────────────────
// 스크립트 속성(비밀 금고)에 들어 있는 값  ※ 코드와 GitHub에는 절대 적지 않음
//   GEMINI_KEYS       : API 키들을 쉼표로 이어서  (예: 키1,키2,키3)   ← 관리자 페이지에서도 관리
//   GEMINI_MODEL      : 사용할 Gemini 모델 이름 (없으면 기본 모델)     ← 관리자 페이지에서 관리
//   ADMIN_PASSWORD    : 관리자 비밀번호                               ← 직접 넣음
//   GUIDE_ORDER       : 지침 파트 순서                              ← 관리자 페이지에서 저장
//   GUIDE_PART_<이름> : 지침 파트 하나 (제목·내용)                   ← 관리자 페이지에서 저장
//   CHECK_FORBID / CHECK_SPELL / CHECK_LIMITS : 생활기록부 점검 지침   ← 관리자 페이지에서 저장
// 생활기록부 지침(프롬프트)은 이 코드에 없음. 관리자 페이지에서만 고치고 금고에 저장됨.
// ─────────────────────────────────────────────────────────────
const PROPS = PropertiesService.getScriptProperties();
const GUIDE_MAX_LEN = 2500; // 파트 하나의 최대 글자 수 (속성 한 칸 9KB 한도 안쪽)
const NO_GUIDE_MSG = '지침이 아직 없어요. 관리자 페이지에서 지침을 저장해 주세요.';
const DEFAULT_MODEL = 'gemini-flash-lite-latest'; // 구글이 늘 최신 Flash-Lite로 연결해 주는 이름

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 화면이 프롬프트를 읽어 갈 때: ?action=guide  (아직 없으면 guide: null)
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'guide') {
    return jsonOut({ success: true, guide: loadGuide() });
  }
  if (e && e.parameter && e.parameter.action === 'checkGuide') {
    return jsonOut({ success: true, checkGuide: loadCheckGuide() });
  }
  return HtmlService.createHtmlOutput('스마트 생기부 작성기 API 서버가 정상 작동 중입니다.');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'login':     return jsonOut(checkPassword(data.password) ? { success: true } : { success: false, error: '비밀번호가 틀렸어요.' });
      case 'saveGuide': return jsonOut(saveGuide(data));
      case 'saveCheckGuide': return jsonOut(saveCheckGuide(data));
      case 'getSettings':  return jsonOut(getSettings(data));
      case 'saveSettings': return jsonOut(saveSettings(data));
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

// ── API 키·모델 설정 (키는 화면에 앞뒤 4글자만 보여 주고 전체는 절대 내보내지 않음)
function readKeys() {
  return (PROPS.getProperty('GEMINI_KEYS') || '').split(',').map(k => k.trim()).filter(Boolean);
}

function maskKey(key) {
  return key.length <= 10 ? '****' : key.slice(0, 4) + '…' + key.slice(-4);
}

function getSettings(data) {
  if (!checkPassword(data.password)) return { success: false, error: '비밀번호가 틀렸어요.' };
  return { success: true, model: PROPS.getProperty('GEMINI_MODEL') || '', defaultModel: DEFAULT_MODEL, keys: readKeys().map(maskKey) };
}

// keep: 남길 기존 키 번호들, add: 새로 넣을 키들, model: 모델 이름(빈칸이면 기본 모델)
function saveSettings(data) {
  if (!checkPassword(data.password)) return { success: false, error: '비밀번호가 틀렸어요.' };
  const old = readKeys();
  const keep = (data.keep || []).filter(i => Number.isInteger(i) && i >= 0 && i < old.length).map(i => old[i]);
  const add = (data.add || []).map(k => String(k).trim()).filter(Boolean);
  if (add.some(k => /[\s,]/.test(k) || k.length < 20 || k.length > 200)) return { success: false, error: '키 모양이 이상해요. 띄어쓰기나 쉼표 없이 키 전체를 넣어 주세요.' };
  const keys = [...new Set(keep.concat(add))];
  if (!keys.length) return { success: false, error: 'API 키가 하나는 있어야 해요.' };
  const model = String(data.model || '').trim();
  if (model && !/^[A-Za-z0-9._\-]{3,80}$/.test(model)) return { success: false, error: '모델 이름이 올바르지 않아요.' };
  PROPS.setProperty('GEMINI_KEYS', keys.join(','));
  if (model) PROPS.setProperty('GEMINI_MODEL', model); else PROPS.deleteProperty('GEMINI_MODEL');
  return getSettings(data);
}

// ── 생활기록부 점검 지침 (보조 점검의 기재 점검·맞춤법·최대 글자수). 학생 기록은 오가지 않음
const CHECK_FIELDS = {
  forbid: { prop: 'CHECK_FORBID', keys: ['level', 'label', 'words', 'find', 'findNote', 'why', 'allowIn', 'skip'], need: ['label'] },
  spell:  { prop: 'CHECK_SPELL',  keys: ['wrong', 'find', 'right'], need: ['wrong', 'right'] },
  limits: { prop: 'CHECK_LIMITS', keys: ['group', 'item', 'max', 'note', 'key'], need: ['item', 'max'] }
};

function loadCheckGuide() {
  const saved = PROPS.getProperties();
  if (!saved.CHECK_FORBID) return null;
  const out = {};
  Object.keys(CHECK_FIELDS).forEach(k => { out[k] = JSON.parse(saved[CHECK_FIELDS[k].prop] || '[]'); });
  return out;
}

function saveCheckGuide(data) {
  if (!checkPassword(data.password)) return { success: false, error: '비밀번호가 틀렸어요.' };
  const g = data.checkGuide || {};
  const toSave = {};
  for (const k of Object.keys(CHECK_FIELDS)) {
    const f = CHECK_FIELDS[k];
    if (!Array.isArray(g[k])) return { success: false, error: '점검 지침 모양이 올바르지 않아요.' };
    const rows = [];
    for (const row of g[k]) {
      const clean = {};
      f.keys.forEach(key => {
        const v = row && row[key];
        if (key === 'allowIn') { if (Array.isArray(v) && v.length) clean.allowIn = v.map(String).slice(0, 10); }
        else if (v !== undefined && v !== null && String(v).trim() !== '') clean[key] = String(v).trim().slice(0, 600);
      });
      if (f.need.some(key => !clean[key]) || (k === 'forbid' && !clean.words && !clean.find)) return { success: false, error: '빈 칸이 있어요. 줄을 채우거나 지워 주세요.' };
      if (k === 'limits' && (!/^[1-9]\d*$/.test(clean.max) || !Number.isSafeInteger(Number(clean.max)))) return { success: false, error: '최대 글자 수는 1 이상의 정수로 입력해 주세요.' };
      if (k === 'forbid' && clean.level !== 'check') clean.level = 'no';
      for (const key of (k === 'limits' ? [] : ['find', 'skip'])) {
        if (clean[key]) { try { new RegExp(clean[key]); } catch (err) { return { success: false, error: `'${clean[key]}'은(는) 찾을 말로 쓸 수 없어요.` }; } }
      }
      rows.push(clean);
    }
    const text = JSON.stringify(rows);
    if (text.length > 8500) return { success: false, error: '점검 지침이 너무 길어요. 줄을 조금 줄여 주세요.' };
    toSave[f.prop] = text;
  }
  PROPS.setProperties(toSave);
  return { success: true, checkGuide: loadCheckGuide() };
}

// 금고에서 지침 전체를 꺼냄. 없으면 null
function loadGuide() {
  const saved = PROPS.getProperties();
  if (!saved.GUIDE_ORDER) return null;
  const order = JSON.parse(saved.GUIDE_ORDER);
  const parts = {};
  Object.keys(saved).forEach(k => {
    if (k.indexOf('GUIDE_PART_') === 0) parts[k.slice('GUIDE_PART_'.length)] = JSON.parse(saved[k]);
  });
  return { parts, order };
}

// 관리자 페이지가 보낸 지침 전체를 검사한 뒤 금고에 통째로 저장 (예전 지침 칸은 지움)
function saveGuide(data) {
  if (!checkPassword(data.password)) return { success: false, error: '비밀번호가 틀렸어요.' };
  const guide = data.guide || {};
  const parts = guide.parts || {};
  const order = guide.order || {};
  if (!Array.isArray(order.behavior) || !Array.isArray(order.general) || !order.behavior.length || !order.general.length) {
    return { success: false, error: '지침 순서가 올바르지 않아요.' };
  }
  const used = order.behavior.concat(order.general);
  for (const key of used) {
    const part = parts[key];
    if (!/^[a-z_]{1,40}$/.test(key) || !part) return { success: false, error: '알 수 없는 파트: ' + key };
    const title = String(part.title || '').trim();
    const body = String(part.body || '').trim();
    if (!title || !body) return { success: false, error: `'${title || key}' 내용이 비어 있어요.` };
    if (body.length > GUIDE_MAX_LEN) return { success: false, error: `'${title}'이 너무 길어요. (${GUIDE_MAX_LEN}자 이하)` };
    parts[key] = { title, body };
  }
  const toSave = { GUIDE_ORDER: JSON.stringify({ behavior: order.behavior, general: order.general }) };
  used.forEach(key => { toSave['GUIDE_PART_' + key] = JSON.stringify(parts[key]); });
  Object.keys(PROPS.getProperties()).forEach(k => {
    if (k.indexOf('GUIDE_') === 0 && !(k in toSave)) PROPS.deleteProperty(k);
  });
  PROPS.setProperties(toSave);
  return { success: true, guide: loadGuide() };
}

const AREA_NAMES = { '자율': '자율·자치활동', '진로': '진로활동', '동아리': '동아리활동', '과세특': '과목별 세부능력 및 특기사항', '행동특성': '행동특성 및 종합의견' };

// 금고의 지침에 학생 자료를 채워 AI에게 보낼 글을 만든다. 지침이 없으면 null
function buildPrompt(data) {
  const guide = loadGuide();
  if (!guide) return null;
  const P = guide.parts;
  const order = guide.order[data.area === '행동특성' ? 'behavior' : 'general'];
  const [introKey, ...ruleKeys] = order;
  const rules = ruleKeys.map((key, i) => `${i + 1}. ${P[key].title}\n${P[key].body}`).join('\n\n');
  const text = `${P[introKey].body}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[작성 규칙] 번호가 앞설수록 중요하며, 규칙이 서로 부딪히면 앞 번호를 따를 것.

${rules}`;
  const vals = {
    '생성 문단 개수': data.sentenceCount,
    '생성 글자 수': data.charLimit,
    '최소 글자 수': Math.round(data.charLimit * 0.85), // 생성 글자 수의 85%
    '영역': AREA_NAMES[data.area] || data.area, // 2026 기재요령 용어로
    '과목': data.subject || '해당 없음',
    '좋은태도': (data.posKeywords !== undefined ? data.posKeywords : data.keywords) || '없음',
    '아쉬운태도': data.negKeywords || '없음',
    '입력내용': data.cases
  };
  // 입력 내용 속 중괄호는 건드리지 않도록 지침 쪽 빈칸만 한 번에 바꿈
  return text.replace(/\{(생성 문단 개수|생성 글자 수|최소 글자 수|영역|과목|좋은태도|아쉬운태도|입력내용)\}/g, (_, k) => String(vals[k]));
}


function generateRecordFromAI(data) {
  // API 키는 스크립트 속성 GEMINI_KEYS 에서 읽음 (쉼표로 구분)
  const validApiKeys = readKeys();

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
  if (!systemPrompt) return { success: false, error: NO_GUIDE_MSG };

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

  // 모델: 관리자 페이지에서 정한 모델 → 없으면 기본 모델. 정한 모델이 사라졌으면 기본 모델로 한 번 다시 시도
  let modelName = PROPS.getProperty('GEMINI_MODEL') || DEFAULT_MODEL;

  // Failover Loop: 사용 가능한 키 개수만큼 시도
  let lastError = "";
  for (let i = 0; i < validApiKeys.length; i++) {
    const currentIndex = (startIndex + i) % validApiKeys.length;
    const selectedApiKey = validApiKeys[currentIndex];

    // 헤더 및 API URL 설정 (공식 권장 x-goog-api-key 헤더 적용)
    options.headers = {
      "x-goog-api-key": selectedApiKey
    };
    let apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent"; // 키는 머리글로만 보냄

    try {
      console.log(`Gemini API 호출 시도 - Model: ${modelName}, API Key Index: ${currentIndex}`);
      let response = UrlFetchApp.fetch(apiUrl, options);
      let responseCode = response.getResponseCode();
      let contentText = response.getContentText();
      let json = JSON.parse(contentText);

      // 모델 지원 종료 또는 404 감지 시 안정 대체 모델로 1회 즉시 재시도
      const errMsg = (json.error && json.error.message) || '';
      if (responseCode === 404 || errMsg.includes("no longer available") || errMsg.includes("not found")) {
        if (modelName !== DEFAULT_MODEL) {
          console.warn(`모델(${modelName}) 지원 불가 감지됨. 기본 모델(${DEFAULT_MODEL})로 전환하여 재시도합니다.`);
          modelName = DEFAULT_MODEL;
          apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent";
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
