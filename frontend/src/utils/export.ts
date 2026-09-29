import { db, SCHEMA_VERSION } from './db';
import { buildBirdFromEvents, normalizeRingNo } from './birds';
import type { BirdProfile, RingRecord } from '../types/ring-record';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  birds: unknown[];
  rings: unknown[];
  morphs: unknown[];
  sites: unknown[];
  sessions: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [birds, rings, morphs, sites, sessions] = await Promise.all([
    db.birds.toArray(),
    db.rings.toArray(),
    db.morphs.toArray(),
    db.sites.toArray(),
    db.sessions.toArray(),
  ]);
  return {
    app: 'gbbirdring',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    birds,
    rings,
    morphs,
    sites,
    sessions,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（环志汇总表打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `﻿${header}\n${body}`, 'text/csv');
}

/**
 * 由事件按环号归组补建个体主档，并回填 birdId。
 * 兼容 v2 及更早的备份（没有 birds 表 / 事件没有 birdId）。
 */
function ensureBirdChains(rings: RingRecord[]): { birds: BirdProfile[]; rings: RingRecord[] } {
  const byId = new Map<string, BirdProfile>();
  const groups = new Map<string, RingRecord[]>();

  rings.forEach((event) => {
    if (typeof event.colorRing !== 'string' || !event.colorRing) event.colorRing = '无';
    const key = normalizeRingNo(event.ringNo);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  });

  const birds: BirdProfile[] = [];
  groups.forEach((events) => {
    const bird = buildBirdFromEvents(events);
    birds.push(bird);
    byId.set(bird.ringNo, bird);
    events.forEach((event) => {
      event.birdId = bird.id;
    });
  });
  return { birds, rings };
}

/** 恢复 JSON 备份；旧版备份（无 birds）自动按环号归组建立个体链 */
export async function importBackup(text: string): Promise<{ birds: number; rings: number; morphs: number; sites: number; sessions: number }> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbbirdring') {
    throw new Error('备份文件格式不匹配（缺少 app=gbbirdring 标记）');
  }

  let birds = (payload.birds ?? []) as BirdProfile[];
  let rings = (payload.rings ?? []) as RingRecord[];

  // 旧备份没有主档表：由事件自动归组建档；个别事件缺 birdId 时同样补齐
  const hasBirdLinks = birds.length > 0 && rings.every((event) => event.birdId);
  if (!hasBirdLinks && rings.length > 0) {
    const chains = ensureBirdChains(rings);
    birds = chains.birds;
    rings = chains.rings;
  }

  const counts = {
    birds: birds.length,
    rings: rings.length,
    morphs: payload.morphs?.length ?? 0,
    sites: payload.sites?.length ?? 0,
    sessions: payload.sessions?.length ?? 0,
  };
  await db.transaction('rw', db.rings, db.morphs, db.sites, db.sessions, db.birds, async () => {
    await Promise.all([db.rings.clear(), db.morphs.clear(), db.sites.clear(), db.sessions.clear(), db.birds.clear()]);
    if (birds.length) await db.birds.bulkPut(birds as never[]);
    if (rings.length) await db.rings.bulkPut(rings as never[]);
    if (payload.morphs?.length) await db.morphs.bulkPut(payload.morphs as never[]);
    if (payload.sites?.length) await db.sites.bulkPut(payload.sites as never[]);
    if (payload.sessions?.length) await db.sessions.bulkPut(payload.sessions as never[]);
  });
  return counts;
}
