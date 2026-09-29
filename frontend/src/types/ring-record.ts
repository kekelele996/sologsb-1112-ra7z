/** 年龄 */
export type BirdAge = '幼' | '亚成' | '成';

/** 环志状态（捕获事件级） */
export type RingStatus = '初捕' | '重捕' | '回收';

/**
 * 个体来源（主档级）：
 * - 本地初捕：档案由本站初捕事件建立
 * - 外站回收：自站外回收、本地无初捕记录，回收事件直接建档
 * - 缺初捕档案：历史数据中只有重捕、找不到初捕事件，先保留主档待补
 */
export type BirdOrigin = '本地初捕' | '外站回收' | '缺初捕档案';

/** 个体主档：一只金属环号对应一条，环号首次出现时建档 */
export interface BirdProfile {
  id: string;
  /** 金属环号（个体唯一标识，库内 &ringNo 唯一索引） */
  ringNo: string;
  /** 彩环组合（可空） */
  colorRing: string;
  /** 鸟种中文名 */
  speciesCn: string;
  /** 学名 */
  speciesSci: string;
  /** 个体来源 */
  origin: BirdOrigin;
  /** 建档时间 ISO */
  createdAt: string;
}

/** 捕获事件（初捕 / 重捕 / 回收），挂在同一主档下 */
export interface RingRecord {
  id: string;
  /** 所属个体主档 id */
  birdId: string;
  /** 金属环号（自主档冗余，便于事件表直接检索） */
  ringNo: string;
  /** 彩环组合（可空） */
  colorRing: string;
  /** 鸟种中文名（与主档一致） */
  speciesCn: string;
  /** 学名 */
  speciesSci: string;
  /** 年龄 */
  age: BirdAge;
  /** 捕获日期 ISO */
  ringDate: string;
  /** 网号 */
  netNo: string;
  /** 网次 */
  netRound: number;
  /** 状态：初捕 / 重捕 / 回收 */
  status: RingStatus;
  /** 环志人 */
  ringer: string;
  /** 鸟点 id */
  siteId: string;
  /** 调查批次 id */
  sessionId: string;
  /** 备注 */
  remark?: string;
}

/** 金属环号格式：一般为「环前缀-序号」，如 A-12345 */
export const RING_PREFIXES: string[] = ['A', 'B', 'C', 'D', 'E'];

/** 彩环颜色组合可选值 */
export const COLOR_RING_PRESETS: string[] = ['无', '红-黄', '蓝-白', '绿-橙', '黑-红', '黄-蓝-白'];

export const BIRD_AGES: BirdAge[] = ['幼', '亚成', '成'];
export const RING_STATUSES: RingStatus[] = ['初捕', '重捕', '回收'];
export const BIRD_ORIGINS: BirdOrigin[] = ['本地初捕', '外站回收', '缺初捕档案'];

export const STATUS_COLOR: Record<RingStatus, string> = {
  初捕: 'success',
  重捕: 'warning',
  回收: 'danger',
};

export const ORIGIN_COLOR: Record<BirdOrigin, string> = {
  本地初捕: 'success',
  外站回收: 'danger',
  缺初捕档案: 'warning',
};

export const ORIGIN_HINT: Record<BirdOrigin, string> = {
  本地初捕: '本站初捕时建立的个体档案',
  外站回收: '自站外回收，本地没有初捕记录，按回收事件建档',
  缺初捕档案: '历史档案中只找到重捕事件，初捕记录待补，主档先予保留',
};
