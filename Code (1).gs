/**
 * 班級生活儀表板 — Google Apps Script 後端 API
 * 葳中第18屆902班
 *
 * ── 試算表結構 ──────────────────────────────────────────────────────────
 * 帳密試算表（ACCOUNT_SHEET_ID）分頁「學生資料」：
 *   A: 座號 | B: 學號 | C: 姓名 | D: 生日(M/D) | E: 身分證號 | F: 家長信箱 | G: 學生密碼 | H: 家長密碼
 *
 * 儀表板資料試算表（DATA_SHEET_ID）分頁「工作表1」：
 *   A: 座號 | B: 缺曠狀況 | C: 獎懲記錄 | D: 消過進度 | E: 到校交通狀況 |
 *   F: 學校費用繳交狀況 | G: 班級作業繳交狀況 | H: 考試表現狀況 |
 *   I: 生活常規表現 | J: 學習輔導建議 | K: 升學進路輔導建議
 *
 * ── 指令碼屬性（必填）────────────────────────────────────────────────────
 * ACCOUNT_SHEET_ID  → 1MRr7wlsTC92m63qOnYBbul3_rNUdlM_reUhpWj8-IP8
 * DATA_SHEET_ID     → 1IBLXOa-cL4DFkw41AxSazc8kgOyTSxZSYysvZhkUC6g
 * TEACHER_ACCOUNT   → 自訂導師帳號（例如 teacher902）
 * TEACHER_PASSWORD  → 自訂導師密碼
 *
 * ── 部署方式 ────────────────────────────────────────────────────────────
 * 部署 → 新增部署作業 → 網頁應用程式
 * 執行身分：我（登入的 Google 帳號）
 * 存取權：所有人
 */

// ── CORS 處理 ─────────────────────────────────────────────────────────────
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function addCors(output) {
  return output;
}

// ── 主入口 ────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;

    if (action === 'login') {
      result = handleLogin(body);
    } else if (action === 'getData') {
      result = handleGetData(body);
    } else {
      result = { success: false, error: '未知的操作' };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: '儀表板 API 運作中' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 讀取指令碼屬性 ────────────────────────────────────────────────────────
function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// ── 取得試算表分頁 ────────────────────────────────────────────────────────
function getAccountSheet() {
  return SpreadsheetApp
    .openById(getProp('ACCOUNT_SHEET_ID'))
    .getSheetByName('學生資料');
}

function getDataSheet() {
  return SpreadsheetApp
    .openById(getProp('DATA_SHEET_ID'))
    .getSheetByName('工作表1');
}

// ── 讀取所有帳密資料（跳過標題列）────────────────────────────────────────
function getAllAccountRows() {
  const sheet = getAccountSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  // [座號, 學號, 姓名, 生日(M/D), 身分證號, 家長信箱, 學生密碼, 家長密碼]
}

// ── 讀取所有儀表板資料（動態欄位，依標題列對應）─────────────────────────
function getAllDataRows() {
  const sheet   = getDataSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { headers: [], rows: [] };

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
                       .map(h => String(h).trim());
  const rows    = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return { headers, rows };
}

// ── 生日格式轉換：M/D → MMDD ─────────────────────────────────────────────
// 試算表格式為 8/16，需轉換為 0816
function birthdayToMMDD(raw) {
  if (!raw) return '';
  // 如果是 Date 物件（Sheets 自動轉型），直接取月日
  if (raw instanceof Date) {
    const mm = String(raw.getMonth() + 1).padStart(2, '0');
    const dd = String(raw.getDate()).padStart(2, '0');
    return mm + dd;
  }
  const str = String(raw).trim();
  const match = str.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (!match) return str.replace(/\D/g, '').slice(-4);
  const mm = String(match[1]).padStart(2, '0');
  const dd = String(match[2]).padStart(2, '0');
  return mm + dd;
}

// ── 登入處理 ──────────────────────────────────────────────────────────────
function handleLogin(body) {
  const role     = body.role;
  const account  = String(body.account || '').trim();
  const password = String(body.password || '').trim();

  // 導師登入
  if (role === 'teacher') {
    if (account === getProp('TEACHER_ACCOUNT') &&
        password === getProp('TEACHER_PASSWORD')) {
      return { success: true, role: 'teacher', name: '導師' };
    }
    return { success: false, error: '帳號或密碼錯誤' };
  }

  // 學生 / 家長登入（帳號 = 學號）
  if (role === 'student' || role === 'parent') {
    const rows  = getAllAccountRows();
    const found = rows.find(r => String(r[1]).trim() === account);
    if (!found) return { success: false, error: '查無此學號，請確認後再試' };

    const seatNo        = Number(found[0]);
    const studentId     = String(found[1]).trim();
    const name          = String(found[2]).trim();
    const studentPw     = String(found[6] || '').trim();
    const parentPw      = String(found[7] || '').trim();

    if (role === 'student') {
      if (password !== studentPw) {
        return { success: false, error: '密碼錯誤（請輸入學生密碼）' };
      }
      return { success: true, role: 'student', name, seatNo, studentId };
    }

    if (role === 'parent') {
      if (password !== parentPw) {
        return { success: false, error: '密碼錯誤（請輸入家長密碼）' };
      }
      return { success: true, role: 'parent', name, seatNo, studentId };
    }
  }

  return { success: false, error: '請選擇身分後再登入' };
}

// ── 取得儀表板資料 ─────────────────────────────────────────────────────────
function handleGetData(body) {
  const role   = body.role;
  const seatNo = Number(body.seatNo);

  // 將一列資料依標題轉成物件，固定加入 seat
  function rowToObj(headers, r) {
    const obj = {};
    headers.forEach(function(h, i) {
      obj[h] = r[i] !== undefined ? r[i] : '';
    });
    // 確保 seat 欄位永遠存在（以「座號」欄為準，找不到就取第一欄）
    const seatKey = headers.indexOf('座號') >= 0 ? '座號' : headers[0];
    obj.seat = Number(obj[seatKey]);
    return obj;
  }

  const { headers, rows } = getAllDataRows();
  const seatColIdx = headers.indexOf('座號') >= 0 ? headers.indexOf('座號') : 0;

  // 導師：回傳全班 + 學生姓名
  if (role === 'teacher') {
    const accountRows = getAllAccountRows();

    const students = rows
      .filter(r => r[seatColIdx] !== '' && r[seatColIdx] !== null)
      .map(r => {
        const seat = Number(r[seatColIdx]);
        const acct = accountRows.find(a => Number(a[0]) === seat);
        const obj  = rowToObj(headers, r);
        obj.name      = acct ? String(acct[2]).trim() : '';
        obj.studentId = acct ? String(acct[1]).trim() : '';
        return obj;
      });

    return { success: true, role: 'teacher', students, headers };
  }

  // 學生 / 家長：回傳單筆
  if (role === 'student' || role === 'parent') {
    const row = rows.find(r => Number(r[seatColIdx]) === seatNo);
    if (!row) return { success: false, error: '目前尚無此座號的資料' };
    return { success: true, role, data: rowToObj(headers, row), headers };
  }

  return { success: false, error: '未知身分' };
}
