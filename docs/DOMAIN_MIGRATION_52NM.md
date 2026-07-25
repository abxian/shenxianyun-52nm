# 52nm 网站换绑手册

本仓库是 PC 客户端的 52nm 站点绑定版本。国内主线路为
`https://api.52nm.de:5443`，国外备用线路为 `https://52nm.de` 和
`https://www.52nm.de`（443）。

## 后续更换网站域名

1. 先在新服务器部署兼容的 vpn-web，保留旧入口。
2. 为新 API 域名申请可信证书，验证 `/api/app-version` 和
   `/api/endpoints`。
3. 修改 `src/config/domain-profile.ts`：
   - `domesticApiBase`：国内 API；
   - `apiBases`：按优先级排列全部线路；
   - `discoveryUrls`：动态发现入口；
   - `officialDomainSuffixes`：需要直连并被识别为官网订阅的注册域。
4. 同步修改仓库根目录 `endpoints.json`，保证首次启动和动态发现结果一致。
5. 执行 `pnpm typecheck`、相关 lint 与 `git diff --check`，推送后使用 GitHub
   Actions 的 `Frontend Check`、`Clippy Lint` 和 `Development Test` 编译。
6. 真机验证新购/续费、提取码导入、受保护 ticket、订阅更新、心跳、流量和
   旧域名失联时的线路切换。
7. 观察期结束后再移除旧域名。不要先关旧入口再发客户端。

## 更新通道

网站 API 与客户端安装包更新是两个独立通道。本仓库的 Tauri updater 只指向
`abxian/shenxianyun-52nm` 的 GitHub Release，不会从旧神仙云仓库下载并覆盖
52nm 绑定版本。正式发布前仍需使用原有 Tauri updater 签名密钥。

Android 使用独立仓库 `abxian/shenxianyun-android-52nm`，必须单独修改、
编译、签名和验证；不能用 PC 的完成状态代替 Android。
