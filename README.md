# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：登记环志编号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

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
| 状态 | Pinia（birdStore / ringStore / measureStore / siteStore / sessionStore） |
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
│       ├── types/             # ring-record / morphometrics / bird-site / session（+ ui.ts）
│       ├── stores/            # ringStore / measureStore / siteStore / sessionStore
│       ├── components/common/ # SiteMap / MeasureInput / RingCodeInput / SpeciesPicker / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useSiteFilter / useAmap
│       ├── pages/             # RingBoard / RingList / MeasureEntry / SiteList / SessionList
│       ├── router/index.ts    # 路由表
│       └── utils/             # stats.ts / geo.ts / db.ts / export.ts（+ seed.ts / id.ts / plain.ts / format.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 个体数 / 捕获事件数、初捕/重捕比、鸟点分布图、鸟种个体数与捕获数、生境分布 |
| `/rings` | 个体档案 | 一只鸟一个主档：环号首次出现（含站外回收）建档，重捕/回收作为捕获事件续录，误删事件主档保留 |
| `/measure` | 量度测量 | 量度挂在每次捕获事件上，6 项量度带单位与范围校验，与同鸟种历史均值比对给出偏离提示 |
| `/sites` | 鸟点台账 | 地图 / SVG 网格双模式切换，表单拾取坐标即时落点，点位间距提示 |
| `/sessions` | 调查批次 | 观测条件录入，关闭批次后统计鸟种数、初捕/重捕/回收与去重个体数 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`birds`、`rings`、`morphs`、`sites`、`sessions`、`meta`。
- 数据模型为「一只鸟一个主档」：`birds` 是个体主档（环号首次出现即建档），`rings` 是捕获事件（初捕 / 重捕 / 回收），每条事件以 `birdId` 挂在主档下，`morphs` 量度挂在具体捕获事件上。
- `db.version(1)` 建表声明索引；`version(2)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段；`version(3)` 新增 `birds` 主档表、给 `rings` 加 `birdId` 索引，并把历史数据按金属环号自动归入同一条个体链（同环号的初捕/重捕合并，仅重捕、站外回收无本地初捕也建档）。升级前可用顶栏「导出备份」导出全量 JSON。
- 删除保护：删除一条捕获事件只删该事件及其量度，个体主档与其他事件完整保留；有事件历史的主档受保护不能直接删，仅事件清空后的空主档可手动删除。
- 批次统计中鸟种数与初捕/重捕/回收数按捕获事件计算，个体数按主档（`birdId`）去重，同一只鸟在一批内多次出现只计一个个体。
- 首次打开且表为空时写入示例数据（6 个鸟点、4 个调查批次、17 只个体 / 18 条捕获事件与 15 条量度，含同环号跨点重捕与站外回收）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
