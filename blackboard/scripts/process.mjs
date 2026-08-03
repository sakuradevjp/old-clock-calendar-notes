/**
 * 黒板の整理スクリプト
 *
 * Apps Script に dump をリクエストして、表示用の posts.json を生成する。
 * GitHub Actions の cron から呼ばれる前提。
 *
 * 公開条件:
 *   - status === 'pending'  （'withdrawn' は除く。取り下げられたものは黒板に出ない）
 *   - now >= publishAt       （翌朝6時 JST まで隠す）
 *   - bads < 3               （よくないねが集まったものは静かに消す）
 */

import fs from 'node:fs/promises';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const DUMP_SECRET     = process.env.DUMP_SECRET;
const POSTS_PATH      = 'blackboard/posts.json';
const VOTE_REMOVAL_THRESHOLD = 3;

const DUMP_ATTEMPTS   = 3;
const RETRY_BASE_MS   = 5000;
const DUMP_TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Apps Script はごくたまに応答を落とす。一度の不調がそのまま失敗通知になるので、
 * 間を空けて数回試す。合言葉違いのように何度試しても同じものは、すぐあきらめる。
 */
async function fetchDump() {
  let lastErr;
  for (let attempt = 1; attempt <= DUMP_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dump', secret: DUMP_SECRET }),
        redirect: 'follow',
        signal: AbortSignal.timeout(DUMP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error === 'forbidden') {
        throw Object.assign(
          new Error('Apps Script: forbidden（DUMP_SECRET が合っていない）'),
          { fatal: true }
        );
      }
      if (data.error) throw new Error(`Apps Script: ${data.error}`);
      return data;
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err;
      if (attempt < DUMP_ATTEMPTS) {
        const wait = RETRY_BASE_MS * attempt;
        console.log(`dump ${attempt}回目が失敗（${err.message}）。${wait / 1000}秒待って試し直す`);
        await sleep(wait);
      }
    }
  }
  throw new Error(`dump失敗（${DUMP_ATTEMPTS}回試した）: ${lastErr.message}`);
}

/** いま黒板に出ているひと言。まだ無い / 壊れている時は null（＝書き直す） */
async function readCurrentPosts() {
  try {
    const parsed = JSON.parse(await fs.readFile(POSTS_PATH, 'utf8'));
    return Array.isArray(parsed.posts) ? parsed.posts : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!APPS_SCRIPT_URL || !DUMP_SECRET) {
    throw new Error('環境変数 APPS_SCRIPT_URL / DUMP_SECRET が必要です');
  }

  const data = await fetchDump();

  const all = Array.isArray(data.posts) ? data.posts : [];
  const now = Date.now();

  const visible = all
    .filter(p => p.status === 'pending')
    .filter(p => (Number(p.bads) || 0) < VOTE_REMOVAL_THRESHOLD)
    .filter(p => {
      const t = new Date(p.publishAt).getTime();
      return Number.isFinite(t) && now >= t;
    })
    .map(p => ({
      id: String(p.id),
      body: String(p.body),
      publishAt: new Date(p.publishAt).toISOString(),
      nods: Number(p.nods) || 0,
    }));

  // UUIDで安定的なシャッフル順（最新が偉くない）
  visible.sort((a, b) => a.id.localeCompare(b.id));

  // ひと言の中身が変わった時だけ書き直す。updatedAt の時刻だけが動いた commit を
  // 積み続けると、履歴が「黒板に何がいつ現れて、いつ消えたか」の記録として読めなくなる。
  const current = await readCurrentPosts();
  if (current && JSON.stringify(current) === JSON.stringify(visible)) {
    console.log(`黒板に変化なし（${visible.length}件）。posts.json はそのまま`);
    return;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    posts: visible,
  };

  await fs.writeFile(POSTS_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`書き出し完了: ${visible.length}件`);
}

main().catch(err => { console.error(err); process.exit(1); });
