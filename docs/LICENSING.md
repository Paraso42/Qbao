# Qbao 许可与边界说明（Licensing）

> **文档定位**：本项目**不是**统一单一许可证。本文是「哪部分适用哪条许可」的唯一事实源，供使用者、贡献者与二次分发者对照。
> 许可证正文见仓库根 [LICENSE](../LICENSE)。
> 相关：[README 许可证章节](../README.md#许可证) · [CONTRIBUTING.md](../CONTRIBUTING.md) · [SECURITY.md](../SECURITY.md)

## 1. 一句话概括

**Qbao 自研代码 = PolyForm Noncommercial License 1.0.0（源码公开，禁止商业使用）；
仓库内移植的第三方游戏与组件 = 各自上游原始许可证（多为 MIT），不受本项目非商业条款约束。**

## 2. Qbao 自研代码（适用非商业许可）

以下范围由 **PolyForm Noncommercial License 1.0.0** 覆盖（SPDX：`PolyForm-Noncommercial-1.0.0`）：

| 路径 | 内容 |
|---|---|
| `app/` | 前端 SPA 源码（`app/public/games/` 目录除外，见 §3） |
| `server/` | Node.js 后端：路由、鉴权、AI Provider 适配、服务层、SQL 迁移 |
| `desktop/` | Electron 桌面壳（main / preload / updater） |
| `mobile/` | Capacitor 手机壳工程 |
| `scripts/`、`tools/` | 部署与维护工具链 |
| `docs/`、根目录文档 | 项目文档（架构 / 部署 / 流程 / 本文件） |

### 2.1 允许（免费，无需申请）

- **个人用途**：学习、研究、实验、私人娱乐、业余项目、宗教活动，且**无预期商业应用**；
- **非商业组织**：慈善机构、教育机构、公共研究机构、公共安全与卫生机构、环保组织、政府机构使用
  ——**不论其资金来源，也不论资金是否附带义务**；
- 在遵守许可条款的前提下复制、修改、创作衍生作品与分发（须随附许可条款或链接，并保留 `Required Notice` 声明）。

### 2.2 禁止（须事先取得书面商业授权）

- **任何商业目的**，包括但不限于：付费产品或服务、SaaS 转售、企业内部经营性使用、
  以本项目为基础的收费培训或外包交付、以本项目吸引广告或流量变现；
- **再许可（sublicense）或转让**许可给他人；
- 去除或篡改版权声明、`Required Notice` 行与许可条款后分发。

> 注意：PolyForm Noncommercial 定义下的「非商业」以**使用目的**而非使用者身份判断。
> 营利性机构将其用于内部经营流程同样属于商业用途；反之，教育机构即便有政府拨款也属于允许用途。

### 2.3 商业授权

如需商业使用，请通过 [GitHub Issues](https://github.com/Paraso42/Qbao/issues) 联系作者洽谈授权条款。
获得授权后，授权范围以**书面授权文件**为准，与本文件或 `LICENSE` 冲突时以后者为准。

## 3. 第三方组件（保留其上游许可）

以下内容**不受**本项目非商业条款约束，其使用条件以各组件自带 `LICENSE` 原文与 `SOURCE.md` 为准：

| 路径 | 组件 | 上游 | 许可 |
|---|---|---|---|
| `app/public/games/2048/` | 2048 | gabrielecirulli/2048 | MIT |
| `app/public/games/froggy/` | Flexbox Froggy | thomaspark/flexboxfroggy | MIT |
| `app/public/games/gridgarden/` | Grid Garden | thomaspark/gridgarden | MIT |
| `app/public/games/tetris/` | 俄罗斯方块 | jakesgordon/javascript-tetris | MIT |
| `app/public/games/werewolf/` | 狼人杀前端构建产物 | xiong35/werewolf | MIT |
| `party/werewolf/` | 狼人杀前后端 fork 源码 | xiong35/werewolf | MIT |
| `app/public/games/common/` | jquery / animate.css | 随 gridgarden 上游提交 | MIT / Apache-2.0 |
| `app/public/games/marble/` | 弹猪乐（单球弹珠机） | anshang1766/marble-wx-game | **个人授权，非开源许可** |

### 3.1 MIT 组件的含义

上述 MIT 组件**允许商业使用**——第三方完全可以只取这些游戏目录用于商业项目，本项目无权限制。
各目录均保留上游 `LICENSE` 原文与 `SOURCE.md`（含精确 commit 与本地改动清单），**分发时不得移除**。

### 3.2 弹猪乐（marble）特别说明

`app/public/games/marble/` 来自同学自研项目 anshang1766/marble-wx-game，其上游仓库**暂无 LICENSE 文件**，
经作者**个人授权**引入本项目，**仅限本项目托管使用**，并非开源许可。
含义：该目录**既不适用** PolyForm 非商业条款，**也不授予**任何第三方再分发权利。
如需复用，请自行联系原作者取得授权，勿从本项目转手。

### 3.3 npm 依赖

`package.json` 声明的 npm 依赖各自遵循其自身许可证（MIT / Apache-2.0 / ISC 等），
本项目的非商业条款**不改变**这些依赖的许可，也不对其施加额外限制。
分发本项目时请遵守各依赖的许可要求。

## 4. 贡献者须知

提交 PR / 补丁即表示你同意 [CONTRIBUTING.md](../CONTRIBUTING.md) 的「贡献许可条款」：

- 你的贡献将按本项目**当前许可证**发布，且维护者可在未来变更或重新许可（含商业许可）时一并纳入；
- 若贡献包含第三方代码，请说明来源与许可证，并确保与本项目兼容。

**不接收**「仅限非商业使用」「仅限本项目使用」等与本项目许可冲突的第三方代码并入 §2 范围。

## 5. 许可证变更历史与既有副本

| 生效范围 | 许可证 |
|---|---|
| 至 commit `09c35bc`（2026-09-10）及此前的全部提交与已发布版本 | MIT License |
| 本次变更起（含之后的所有提交与发布） | PolyForm Noncommercial License 1.0.0 |

含义说明：

- 在 MIT 期间**已经取得**的副本，其 MIT 授权**继续有效**——依据该 MIT 许可作出的使用、修改与分发不会被追溯收回；
- 本次变更**仅向前生效**，适用于变更之后的版本；
- 因此如需商业使用，取用 MIT 期间的历史版本在许可层面是可行的（但会缺少此后的全部功能、修复与安全更新，
  且仓库内的第三方组件仍受各自许可约束）。**作者建议并欢迎**有商业需求的用户直接洽谈授权，以获得受支持的最新版本。

## 6. 修订记录

- 2026-09-11 初版：项目由 MIT 切换为 PolyForm Noncommercial 1.0.0（禁止商业使用），
  本文件明确「自研代码 / 第三方 MIT 组件 / 弹猪乐个人授权」三类边界。
