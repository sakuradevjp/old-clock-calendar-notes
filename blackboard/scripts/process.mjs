/**
 * 黒板の整理スクリプト
 *
 * Apps Script に dump をリクエストして、表示用の posts.json を生成する。
 * GitHub Actions の cron から呼ばれる前提。
 *
 * 公開条件:
 *   - status === 'pending'  （'withdrawn' は除く。取り下げられたものは黒板に出ない）
 *   - now >= publishAt       （翌朝6時 JST まで隠す）
 *   - bads < 10              （よくないねが集まったものは静かに消す）
 */

import fs from 'node:fs/promises';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const DUMP_SECRET     = process.env.DUMP_SECRET;
const POSTS_PATH      = 'blackboard/posts.json';
const VOTE_REMOVAL_THRESHOLD = 3;

async function main() {
  if (!APPS_SCRIPT_URL || !DUMP_SECRET) {
    throw new Error('環境変数 APPS_SCRIPT_URL / DUMP_SECRET が必要です');
  }

  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dump', secret: DUMP_SECRET }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`dump失敗: HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`Apps Script: ${data.error}`);

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

  const output = {
    updatedAt: new Date().toISOString(),
    posts: visible,
  };

  await fs.writeFile(POSTS_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`書き出し完了: ${visible.length}件`);
}

main().catch(err => { console.error(err); process.exit(1); });
