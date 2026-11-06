# ClashWin

基于 [mihomo](https://github.com/MetaCubeX/mihomo)（Clash Meta）内核的 Windows 代理客户端。界面与功能参照 macOS 上的 ClashMac 设计：托盘面板、控制台（概览 / 请求 / 策略 / 规则 / 配置 / 日志 / 引擎设置 / 流量飞行地图）、偏好设置窗口。

> 本项目是独立实现，没有使用 ClashMac 的代码或素材。ClashMac 是闭源软件，这里只参照了它公开的截图和用户手册。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面外壳 | Tauri 2（Rust，WebView2） |
| 界面 | React 18 + TypeScript + Vite，Zustand 状态管理，lucide 图标 |
| 图表 / 地图 | 手写 SVG 图表；d3-geo + world-atlas 绘制世界地图 |
| 内核 | mihomo，首次启动时从官方 GitHub Release 下载 |
| 历史统计 | SQLite（rusqlite） |

## 目录结构

```
src/                       前端
  lib/backend.ts           前后端接口契约（每个函数对应一个 Rust 命令）
  lib/mihomo.ts            mihomo 控制器 REST + WebSocket 客户端
  lib/store.ts / live.ts   全局状态、实时数据流
  lib/mock/                浏览器预览用的模拟后端和模拟内核
  components/ui/           组件库（卡片、分段控件、开关、菜单、弹窗、表单…）
  components/layout/       侧边栏、顶栏、窗口按钮、通用工具栏按钮
  pages/                   控制台各页面
  tray/                    托盘弹出面板
  settings/                设置窗口
  i18n/                    中英文文案（按模块拆分）
src-tauri/                 Rust 后端（内核管理、系统代理、TUN、订阅、统计、托盘）
```

## 开发

```bash
npm install
npm run dev          # 仅前端，在浏览器里用模拟数据预览 http://localhost:1420
npx tauri dev        # 完整桌面应用
npx tauri build      # 打包 NSIS 安装程序
```

数据目录：`%APPDATA%\ClashWin`（设置、配置文件、内核、历史数据库、日志）。

发布：在 GitHub 的 Actions 页面手动运行 **Release** 工作流（或推送 `v*` 标签），会在 Windows 上构建 NSIS 安装包并发布到 Releases。

应用内更新：「设置 → 更新」读取本仓库（`ljt940601/clashwin`，见 `src-tauri/src/updates.rs` 的 `APP_REPO`）的 GitHub Releases。版本号取自标签（`v0.2.0`），安装包按文件名 `*_x64-setup.exe` 识别，发布说明会显示为更新日志卡片。安装时以被动模式运行安装包（`/P /UPDATE /R`），装完自动重新打开 ClashWin。

下载源：内核和安装包可以经 GitHub 镜像（ghfast.top 等，可自定义）下载，「自动选择」会测速后用最快的。只有 GitHub 公布了 SHA-256 的文件才会走镜像，下载后核对校验值，不一致就丢弃并换下一个来源。

## 与 ClashMac 的差异

- **增强模式（TUN）**：Windows 创建虚拟网卡需要管理员权限。可以在「设置 → 权限」安装辅助任务（一次授权，之后以管理员身份自动启动），或临时以管理员身份重启。
- **托盘网速**：Windows 托盘不能在图标旁显示文字，网速显示在鼠标悬停提示里。
- **托盘点击**：按 Windows 习惯，左键单击托盘图标打开控制面板，右键单击弹出托盘菜单。托盘菜单会按屏幕可用高度（分辨率与缩放比例）自动缩放，也可在「设置 → 通用 → 托盘菜单大小」里固定大小。
- **网页加规卡片**：Windows 上暂时读不到浏览器当前网址，需要手动输入域名。
- **指纹浏览器**：暂未实现。
