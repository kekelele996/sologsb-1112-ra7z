# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：**一只鸟一个个体主档**，金属环号首次出现（含自站外回收）即建档，初捕 / 重捕 / 回收作为捕获事件挂在同一主档下，各自保留日期、鸟点、批次、量度与备注；登记环号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21812>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（5 条业务路由 + 404） |
| 状态 | Pinia（bird/ringStore · measureStore / siteStore / sessionStore） |
| 地图 | 高德地图 JS API（可选，按需动态加载）+ 本地 SVG 网格退化视图 |
| 存储 | IndexedDB（Dexie，库名 `gbbirdring-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 地图 key 说明（可选）

- 未配置 `VITE_AMAP_KEY`：`<SiteMap>` 渲染本地 SVG 网格视图，标记按生境配色落在对应格位，表单拾取坐标即落到格位中心；**构建与运行都不依赖该 key**。
- 配置后：`.env` 里填 `VITE_AMAP_KEY=<你的 key>`，再 `docker compose up -d --build`（compose 通过 build args 传入，Dockerfile 用 `ARG VITE_AMAP_KEY` 注入 Vite）。高德控制台需为该访问域名开启 JS API。

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21812
npm run build    # 类型检查 + 生产构建
npm run verify   # 个体链迁移与 store 行为验证（fake-indexeddb，无需浏览器）
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射 / 可选 VITE_AMAP_KEY build arg
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT、可选 VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # bird-profile + ring-event（捕获事件）/ morphometrics / bird-site / session（+ ui.ts）
│       ├── stores/            # ringStore（个体主档 + 捕获事件）/ measureStore / siteStore / sessionStore
│       ├── components/common/ # SiteMap / MeasureInput / RingCodeInput / SpeciesPicker / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useSiteFilter / useAmap
│       ├── pages/             # RingBoard / RingList / MeasureEntry / SiteList / SessionList
│       ├── router/index.ts    # 路由表
│       └── utils/             # stats.ts / birds.ts（个体链）/ geo.ts / db.ts / export.ts（+ seed.ts / id.ts / plain.ts / format.ts）
│   └── scripts/               # verify-migration.ts（v2→v3 归链）/ verify-store.ts（建档/续录/删除口径）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 个体主档数、捕获事件数、鸟种数、初捕/重捕/回收比、鸟点分布图与生境分布 |
| `/rings` | 环志记录 | 一只鸟一个主档：环号首次出现（含外站回收）建档，重捕/回收在主档下续录事件；个体档案查看同链全部事件与量度 |
| `/measure` | 量度测量 | 量度挂在具体捕获事件上（重捕可分别量度），6 项量度带单位与范围校验，与同鸟种历史均值比对 |
| `/sites` | 鸟点台账 | 地图 / SVG 网格双模式切换，表单拾取坐标即时落点，点位间距提示 |
| `/sessions` | 调查批次 | 观测条件录入，关闭批次后按事件计鸟种数与捕获数、同环号去重计个体数 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`birds`（个体主档）、`rings`（捕获事件）、`morphs`（量度，挂事件）、`sites`、`sessions`、`meta`。
- 一只鸟一个主档：`birds.ringNo` 为唯一索引（忽略大小写）；`rings` 每条是一次捕获事件，通过 `birdId` 挂主档，日期 / 鸟点 / 批次 / 备注各自独立，量度经 `morphs.ringId` 挂在具体事件上。
- 主档来源：`本地初捕`（最早事件为初捕）、`外站回收`（最早事件为回收，无本地初捕也建档）、`缺初捕档案`（历史数据仅有重捕，主档先保留待补初捕）。
- `db.version(3).upgrade(...)` 打开旧库时按环号归组现有环志记录，同环号的初捕与重捕自动并入同一条个体链并回填 `birdId`。升级前可用顶栏「导出备份」导出全量 JSON；旧版备份（无 `birds` 表）导入时会自动补建个体链。
- 删除捕获事件只删该事件及其量度（同事务级联），个体主档与同链其他事件完整保留；即使主档下已无事件，有历史的主档也先保留。
- 批次统计口径：鸟种数、初捕 / 重捕 / 回收数按捕获事件计算，个体数按金属环号去重（同一只鸟在同一批多次出现只计一个个体）。
- `db.version(1)` 建表声明索引；`db.version(2)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段。
- 首次打开且表为空时写入示例数据（6 个鸟点、4 个调查批次、17 条个体主档、18 条捕获事件与 14 条量度）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
