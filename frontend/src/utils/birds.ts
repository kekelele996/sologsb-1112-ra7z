import type { BirdOrigin, BirdProfile, RingRecord } from '../types/ring-record';
import { uid } from './id';

/** 环号归一化：去空白并忽略大小写（同一金属环号即同一个体） */
export function normalizeRingNo(ringNo: string): string {
  return ringNo.trim().toLowerCase();
}

/** 最早事件的状态决定主档来源 */
export function originOfEarliest(status: RingRecord['status']): BirdOrigin {
  if (status === '回收') return '外站回收';
  if (status === '重捕') return '缺初捕档案';
  return '本地初捕';
}

/** 建档入参（迁移与新登记共用） */
export interface BirdSeed {
  ringNo: string;
  colorRing?: string;
  speciesCn: string;
  speciesSci: string;
  origin: BirdOrigin;
  createdAt: string;
}

/** 新建个体主档 */
export function createBird(seed: BirdSeed): BirdProfile {
  return {
    id: uid('bird'),
    ringNo: seed.ringNo.trim(),
    colorRing: seed.colorRing || '无',
    speciesCn: seed.speciesCn.trim(),
    speciesSci: seed.speciesSci.trim(),
    origin: seed.origin,
    createdAt: seed.createdAt,
  };
}

/**
 * 由一组捕获事件（同一环号）建立主档：
 * 取最早事件承载身份信息，来源按最早事件状态推断。
 */
export function buildBirdFromEvents(events: RingRecord[]): BirdProfile {
  const sorted = [...events].sort((a, b) => a.ringDate.localeCompare(b.ringDate));
  const earliest = sorted[0];
  return createBird({
    ringNo: earliest.ringNo,
    colorRing: earliest.colorRing,
    speciesCn: earliest.speciesCn,
    speciesSci: earliest.speciesSci,
    origin: originOfEarliest(earliest.status),
    createdAt: earliest.ringDate,
  });
}
