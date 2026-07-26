# 可复制站点配置

复制客户端项目后，只修改仓库根目录 `site-profile.properties`，运行：

```bash
pnpm brand:apply
```

该配置集中管理站点/客户端/节点品牌、订阅名称模板、Tauri
productName/identifier、deep-link scheme、API 主备地址、发现地址、官方域名、
GitHub/updater 仓库、应用标题和 SVG 品牌字。`pnpm build` 的 prebuild 也会自动
应用配置，固定下载别名也会使用 `client.name`。

Web 的 `/api/endpoints` 可以在运行时下发 `brand`。已安装客户端会使用服务端的
客户端显示名和上报名称；操作系统安装名称、identifier 和 deep-link 注册仍必须
重新编译。

`shenxianyun.*` 本地存储键、`target=shenxianyun` 和内部事件名是兼容协议，不是
展示品牌；复制项目时保留它们，端点缓存会通过 `profile.id` 自动隔离。

复制为新业务线时必须同时建立新的 GitHub 仓库、签名/更新通道、配置目录迁移策略，
不能只改名称后覆盖安装现有客户端。
