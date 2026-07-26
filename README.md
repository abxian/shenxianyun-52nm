<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="Clash" width="128" />
  <br>
  Continuation of <a href="https://github.com/zzzgydi/clash-verge">Clash Verge</a>
  <br>
</h1>

> 52nm 及复制业务线的统一品牌/线路配置见
> [`docs/SITE_PROFILE.md`](docs/SITE_PROFILE.md)。

<h3 align="center">
A Clash Meta GUI based on <a href="https://github.com/tauri-apps/tauri">Tauri</a>.
</h3>

<p align="center">
  Languages:
  <a href="./README.md">简体中文</a> ·
  <a href="./docs/README_en.md">English</a> ·
  <a href="./docs/README_es.md">Español</a> ·
  <a href="./docs/README_ru.md">Русский</a> ·
  <a href="./docs/README_ja.md">日本語</a> ·
  <a href="./docs/README_ko.md">한국어</a> ·
  <a href="./docs/README_fa.md">فارسی</a>
</p>

## Preview

| Dark                             | Light                             |
| -------------------------------- | --------------------------------- |
| ![预览](./docs/preview_dark.png) | ![预览](./docs/preview_light.png) |

## Install

请到 52nm 独立发布页面下载对应的安装包：[Release page](https://github.com/abxian/shenxianyun-52nm/releases)<br>
Go to the [52nm Release page](https://github.com/abxian/shenxianyun-52nm/releases) to download the corresponding installation package<br>
Supports Windows (x64/x86), Linux (x64/arm64) and macOS 11+ (intel/apple).

#### 我应当怎样选择发行版

| 版本        | 特征                                     | 链接                                                                                   |
| :---------- | :--------------------------------------- | :------------------------------------------------------------------------------------- |
| Stable      | 52nm 正式版，高可靠性，适合日常使用。 | [Release](https://github.com/abxian/shenxianyun-52nm/releases) |

#### 安装说明和常见问题，请到 [文档页](https://clash-verge-rev.github.io/) 查看

### TG 频道: [@clash_verge_rev](https://t.me/clash_verge_re)

---

## Promotion

### 🤖 [GPTKefu —— 与 Crisp 深度整合的 AI 智能客服平台](https://gptkefu.com)

- 🧠 深度理解完整对话上下文 + 图片识别，自动给出专业、精准的回复，告别机械式客服。
- ♾️ **不限回答数量**，无额度焦虑，区别于其他按条计费的 AI 客服产品。
- 💬 售前咨询、售后服务、复杂问题解答，全场景轻松覆盖，真实用户案例已验证效果。
- ⚡ 3 分钟极速接入，零门槛上手，即刻提升客服效率与客户满意度。
- 🎁 高级套餐免费试用 14 天，先体验后付费：👉 [立即试用](https://gptkefu.com)
- 📢 智能客服TG 频道：[@crisp_ai](https://t.me/crisp_ai)

---

## Features

- 基于性能强劲的 Rust 和 Tauri 2 框架
- 内置[Clash.Meta(mihomo)](https://github.com/MetaCubeX/mihomo)内核，并支持切换 `Alpha` 版本内核。
- 简洁美观的用户界面，支持自定义主题颜色、代理组/托盘图标以及 `CSS Injection`。
- 配置文件管理和增强（Merge 和 Script），配置文件语法提示。
- 系统代理和守卫、`TUN(虚拟网卡)` 模式。
- 可视化节点和规则编辑
- WebDav 配置备份和同步

### FAQ

Refer to [Doc FAQ Page](https://clash-verge-rev.github.io/faq/windows.html)

### Donation

[捐助Clash Verge Rev的开发](https://github.com/sponsors/clash-verge-rev)

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more details.

### 52nm domain profile

This repository is the PC client bound to the 52nm vpn-web deployment:

- domestic API: `https://api.52nm.de:5443`
- overseas fallbacks: `https://52nm.de`, `https://www.52nm.de`
- migration guide: [`docs/DOMAIN_MIGRATION_52NM.md`](./docs/DOMAIN_MIGRATION_52NM.md)

Website domains are centralized in `src/config/domain-profile.ts` and the root
`endpoints.json`. The updater is isolated to this repository's GitHub Release and
does not consume the original Shenxianyun update channel.

### Build and verification policy

- Full compilation and packaging must run in GitHub Actions. Local machines are only used for type checks, lint, unit tests, `git diff --check`, and optional development preview.
- For changes that are not ready to publish, push an isolated branch, manually run `Frontend Check` and `Clippy Lint`, then use `Development Test` (`.github/workflows/dev.yml`) for full cross-platform compilation and packaging against that branch. Do not change the version, create a tag/Release, or update Dufs/updater metadata merely to validate a build.
- A workflow artifact is a temporary build result, not a published client. Publishing remains a separate, explicitly authorized step.
- The release workflow is tag-only. Do not create a `v*` tag unless a new version has been approved.

To run the development server, execute the following commands after all prerequisites for **Tauri** are installed:

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

## Contributions

Issue and PR welcome!

## Acknowledgement

Clash Verge rev was based on or inspired by these projects and so on:

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge): A Clash GUI based on tauri. Supports Windows, macOS and Linux.
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri): Build smaller, faster, and more secure desktop applications with a web frontend.
- [Dreamacro/clash](https://github.com/Dreamacro/clash): A rule-based tunnel in Go.
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo): A rule-based tunnel in Go.
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg): A Windows/macOS GUI based on Clash.
- [vitejs/vite](https://github.com/vitejs/vite): Next generation frontend tooling. It's fast!

## 神仙云发布与分发流程（PC 桌面端）

> 每次更新提交、编译、发布都要遵循以下流程。安卓端流程见
> [shenxianyun-android](https://github.com/abxian/shenxianyun-android) 的 README。

### 一、改完代码后必须先升版本号

桌面端版本号有 **4 处必须同步修改**，否则 Release Action 的「版本一致性校验」会失败：

| 文件 | 字段 |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version`（`[package]`） |
| `Cargo.lock` | `name = "clash-verge"` 对应的 `version` |

四处版本号必须完全一致（例如 `2.5.12`）。

### 二、提交并触发公开仓库 Action 编译

Release Build（`.github/workflows/release.yml`）**只由 `v*.*.*` 形式的 git tag 触发**，
且会校验：① tag 所在 commit 必须在 `origin/main` 上；② tag 版本号必须与 `package.json` 一致。

```bash
# 在 main 分支上提交
git add <本任务文件>
git commit -m "feat: xxx (v2.5.12)"
git push origin main

# 打与版本号一致的 tag 并推送，触发 Release Build
git tag v2.5.12
git push origin v2.5.12
```

Action 会在 Windows / macOS / Linux / ARM 全平台编译（约 30~40 分钟），
并把安装包上传到本仓库的 GitHub Release **`v<版本号>`**（标题
`神仙云 PC 52nm v<版本号>`）。

- 桌面更新签名用 **Tauri updater 私钥**，存放在私有仓库
  [`abxian/shenxianyun-keys`](https://github.com/abxian/shenxianyun-keys)：
  `shenxianyun-updater.key` / `shenxianyun-updater.key.pub` / `updater-key-password.txt`，
  对应 CI secrets `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD`。**切勿泄露或提交进公开仓库。**

### 三、从 GitHub Release 下载安装包

Action 跑完后到本仓库 Release `v<版本号>` 页面下载（`<ver>` 为版本号，如 `2.5.12`）：

| 平台 | Action 产物文件名 |
| --- | --- |
| Windows 64 位（常用） | `Clash.Verge_<ver>_x64-setup.exe` |
| macOS Apple 芯片 | `Clash.Verge_<ver>_aarch64.dmg` |
| macOS Intel 芯片 | `Clash.Verge_<ver>_x64.dmg` |
| Linux deb 64 位 | `Clash.Verge_<ver>_amd64.deb` |
| Linux rpm 64 位 | `Clash.Verge-<ver>-1.x86_64.rpm` |

### 四、52nm 分发边界

本仓库的正式安装包和 Tauri updater 只发布到
`abxian/shenxianyun-52nm` 的 GitHub Release。不得上传或覆盖旧神仙云
Dufs，也不得修改旧客户端仓库的 Release。若以后建立 52nm 独立下载站，必须
先在 NAS 笔记记录独立域名、存储、凭据和回滚方案，再单独增加发布步骤。

### 五、流程速记（每次发布都照做）

1. 改代码 → **同步改 4 处版本号**。
2. `git commit` 到 main → `git push origin main`。
3. 打 `v<版本号>` tag → `git push origin <tag>`，触发 Release Build。
4. 等 Action 跑完 → 到 Release `v<版本号>` 下载安装包。
5. 核对 Release 为非 draft、非 prerelease，资产与 updater 均属于本 52nm 仓库，
   再更新 52nm vpn-web 后台下载地址。

## License

GPL-3.0 License. See [License here](./LICENSE) for details.
