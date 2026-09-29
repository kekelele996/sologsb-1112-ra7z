import type { BirdAge } from './ring-record';

/**
 * 个体主档：一只金属环号对应一只鸟。
 * 环号首次出现（初捕 / 仅重捕 / 站外回收）时建档，后续捕获事件都挂在同一主档下。
 */
export interface Bird {
  id: string;
  /** 金属环号（建档环号，trim 后原样保存） */
  ringNo: string;
  /** 彩环组合（取最近事件，可空） */
  colorRing: string;
  /** 鸟种中文名 */
  speciesCn: string;
  /** 学名 */
  speciesSci: string;
  /** 最近一次记录的年龄 */
  age: BirdAge;
  /** 首次捕获日期 ISO（主档建立事件） */
  firstDate: string;
  /** 最近一次捕获日期 ISO */
  lastDate: string;
  /** 捕获事件数（初捕 + 重捕 + 回收） */
  eventCount: number;
  /** 建档时间 ISO */
  createdAt: string;
  /** 最近更新时间 ISO */
  updatedAt: string;
}
