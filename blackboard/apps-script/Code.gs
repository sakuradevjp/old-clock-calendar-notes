/**
 * 黒板（Blackboard）— Apps Script Web App
 *
 * 役割:
 *  - 訪問者からの POST を受け取って、紐づけスプレッドシートに記録する
 *  - 投稿者本人だけが触れる編集・取り下げを処理する
 *  - うなずき / よくないね を集計する
 *  - GitHub Actions が dump を呼んで、表示用 posts.json を生成する
 *
 * デプロイ:
 *  1. このファイルを script.google.com で新規プロジェクトに貼る
 *  2. SpreadsheetApp.create() で作ったSheet（または既存）にバインドする
 *  3. スクリプトプロパティに DUMP_SECRET を設定（GitHub Secretsと同じ値）
 *  4. デプロイ → ウェブアプリ → 実行ユーザー: 自分 / アクセス: 全員
 *  5. 発行された /exec URLを HTML と GitHub Secrets に貼る
 */

const SHEET_NAME = 'posts';
const VOTES_SHEET = 'votes';
const PUBLISH_HOUR_JST = 6;          // 翌朝6時に公開
const VOTE_REMOVAL_THRESHOLD = 3;    // この件数のよくないねで非表示（3年保持・即応の方針）
const MAX_BODY_CHARS = 60;

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    switch (data.action) {
      case 'place':     return json(handlePlace(data));
      case 'mine':      return json(handleMine(data));
      case 'mine-list': return json(handleMineList(data));
      case 'edit':      return json(handleEdit(data));
      case 'withdraw':  return json(handleWithdraw(data));
      case 'nod':       return json(handleNod(data));
      case 'bad':       return json(handleBad(data));
      case 'dump':      return json(handleDump(data));
      default:         return json({ error: 'unknown_action' });
    }
  } catch (err) {
    return json({ error: 'bad_request', message: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      s.appendRow(['id','createdAt','publishAt','body','editToken','status','nods','bads','withdrawnAt','voterId']);
    } else if (name === VOTES_SHEET) {
      s.appendRow(['postId','voterId','voteType','createdAt']);
    }
  }
  return s;
}

function nextMorning6JST_iso() {
  // 現在時刻のJST（UTC+9）における翌朝6時を求めて、UTCのISO文字列で返す
  const nowMs = Date.now();
  const jst = new Date(nowMs + 9 * 3600 * 1000);
  const target = new Date(Date.UTC(
    jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(),
    PUBLISH_HOUR_JST, 0, 0
  ));
  // target は今JSTの「今日6時」を「UTCタイムスタンプとして」表現したもの。
  // JSTで6時を過ぎていたら翌日へ進める。
  const jstNowSeconds = jst.getUTCHours() * 3600 + jst.getUTCMinutes() * 60 + jst.getUTCSeconds();
  if (jstNowSeconds >= PUBLISH_HOUR_JST * 3600) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  // target の絶対UTCに戻す（JST→UTCで -9時間）
  return new Date(target.getTime() - 9 * 3600 * 1000).toISOString();
}

function findRow(sheet, id) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return { rowIndex: i + 1, values: rows[i] };
  }
  return null;
}

function handlePlace(data) {
  const body = String(data.body || '').trim();
  if (!body) return { error: 'empty' };
  if (body.length > MAX_BODY_CHARS) return { error: 'too_long' };
  const voterId = String(data.voterId || '').slice(0, 64);
  const id = Utilities.getUuid();
  const editToken = Utilities.getUuid().replace(/-/g, '');
  const createdAt = new Date().toISOString();
  const publishAt = nextMorning6JST_iso();
  const sheet = getSheet(SHEET_NAME);
  sheet.appendRow([id, createdAt, publishAt, body, editToken, 'pending', 0, 0, '', voterId]);
  return { id, editToken, publishAt };
}

function handleMineList(data) {
  // 同じ端末（=同じvoterId）が過去に置いた投稿を返す。editTokenは外す。
  const voterId = String(data.voterId || '');
  if (!voterId) return { posts: [] };
  const sheet = getSheet(SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const idx = name => headers.indexOf(name);
  const posts = rows
    .filter(r => r[idx('voterId')] === voterId && r[idx('status')] === 'pending')
    .map(r => ({
      id: r[idx('id')],
      body: r[idx('body')],
      publishAt: r[idx('publishAt')],
      createdAt: r[idx('createdAt')],
      nods: r[idx('nods')],
    }));
  return { posts };
}

function handleMine(data) {
  const sheet = getSheet(SHEET_NAME);
  const f = findRow(sheet, data.id);
  if (!f) return { error: 'not_found' };
  const [id, , publishAt, body, editToken, status] = f.values;
  if (editToken !== data.token) return { error: 'forbidden' };
  if (status !== 'pending') return { error: 'gone' };
  return { id, body, publishAt };
}

function handleEdit(data) {
  const sheet = getSheet(SHEET_NAME);
  const f = findRow(sheet, data.id);
  if (!f) return { error: 'not_found' };
  const [, , , , editToken, status] = f.values;
  if (editToken !== data.token) return { error: 'forbidden' };
  if (status !== 'pending') return { error: 'gone' };
  const body = String(data.body || '').trim();
  if (!body || body.length > MAX_BODY_CHARS) return { error: 'invalid_body' };
  sheet.getRange(f.rowIndex, 4).setValue(body);
  return { ok: true };
}

function handleWithdraw(data) {
  const sheet = getSheet(SHEET_NAME);
  const f = findRow(sheet, data.id);
  if (!f) return { error: 'not_found' };
  const [, , , , editToken, status] = f.values;
  if (editToken !== data.token) return { error: 'forbidden' };
  if (status !== 'pending') return { error: 'gone' };
  sheet.getRange(f.rowIndex, 6).setValue('withdrawn');
  sheet.getRange(f.rowIndex, 9).setValue(new Date().toISOString());
  return { ok: true };
}

function alreadyVoted(postId, voterId, voteType) {
  const v = getSheet(VOTES_SHEET);
  const rows = v.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === postId && rows[i][1] === voterId && rows[i][2] === voteType) return true;
  }
  return false;
}

function bump(postId, columnIndex /* 7 nods, 8 bads */) {
  const sheet = getSheet(SHEET_NAME);
  const f = findRow(sheet, postId);
  if (!f) return false;
  const cell = sheet.getRange(f.rowIndex, columnIndex);
  cell.setValue((Number(cell.getValue()) || 0) + 1);
  return true;
}

function handleNod(data) {
  if (!data.postId || !data.voterId) return { error: 'invalid' };
  if (alreadyVoted(data.postId, data.voterId, 'nod')) return { ok: true, dup: true };
  getSheet(VOTES_SHEET).appendRow([data.postId, data.voterId, 'nod', new Date().toISOString()]);
  bump(data.postId, 7);
  return { ok: true };
}

function handleBad(data) {
  if (!data.postId || !data.voterId) return { error: 'invalid' };
  if (alreadyVoted(data.postId, data.voterId, 'bad')) return { ok: true, dup: true };
  getSheet(VOTES_SHEET).appendRow([data.postId, data.voterId, 'bad', new Date().toISOString()]);
  bump(data.postId, 8);
  // 閾値を超えたか確認 → 押した人だけ即座に画面から外す（"hidden"=表示上隠れただけ。
  // データは消えない。書いた本人の過去ビューには残り続ける。本人が "withdraw" した時だけ消える）
  const sheet = getSheet(SHEET_NAME);
  const f = findRow(sheet, data.postId);
  const hidden = f && (Number(f.values[7]) || 0) >= VOTE_REMOVAL_THRESHOLD;
  return { ok: true, hidden };
}

function handleDump(data) {
  const expected = PropertiesService.getScriptProperties().getProperty('DUMP_SECRET');
  if (!expected || data.secret !== expected) return { error: 'forbidden' };
  const sheet = getSheet(SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  const headers = rows.shift();
  const posts = rows.map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = r[i]; });
    delete o.editToken; // editTokenは外部に出さない
    return o;
  });
  return { posts };
}
