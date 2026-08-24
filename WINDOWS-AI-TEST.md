# Windows AI 测试唯一入口

本文件供 Windows 上的 AI 测试代理使用。测试目标是当前仓库的 52nm
商业化候选分支。用户说出精确触发词 **“开始测试”** 后，AI 才能执行测试；
触发前只能读取本文件和用例、检查环境、说明风险，不得安装、联网测试或改变系统代理。

机器可读用例：[`test-cases/windows-commercial.json`](test-cases/windows-commercial.json)。
统一执行器：[`scripts/windows-ai-test.ps1`](scripts/windows-ai-test.ps1)。

## 1. 不可越过的边界

- 不修改源码，不创建版本号、tag、Release，不推送测试代码，不合并分支。
- 只测试 `codex/commercial-canary-20260824`，且 HEAD 必须包含用例声明的候选基线。
- 原始日志、安装包和本机信息只允许保留在 `.ai-test-results/`；该目录已被 Git 忽略。
- GitHub 只上传结构化状态、提交号、时长、Actions URL 和人工脱敏摘要。
- 禁止上传订阅 URL、导入码、Token、Cookie、Authorization、密码、密钥、
  MachineGuid、用户名、主机名、用户目录或未脱敏用户数据。
- 仓库不保存测试凭据。真实导入所需的专用账号只能由用户在运行时安全提供。
- 缺少凭据、52nm 后端尚未灰度或没有可回滚测试环境时，相关用例必须记为
  `blocked`，不得伪报 `pass`。
- 安装、代理、断网、重装测试只允许在备用机、虚拟机、Windows Sandbox 或用户明确
  确认可回滚的测试电脑执行。检测到日常生产客户端时，安装前暂停并请求用户确认。

## 2. 首次克隆

每一轮真机验收都使用新的空目录，避免旧 checkout 的 CRLF 行尾或本机测试结果污染
新 commit。在 PowerShell 中执行：

```powershell
git -c core.autocrlf=false clone `
  --branch codex/commercial-canary-20260824 --single-branch `
  https://github.com/abxian/shenxianyun-52nm.git
cd shenxianyun-52nm

git config core.autocrlf false
git status --short
git branch --show-current
git ls-files --eol | Select-String 'w/(crlf|mixed)'
```

要求：工作树干净，分支为 `codex/commercial-canary-20260824`，最后一条行尾检查无输出。
仓库用 `.gitattributes` 固定源码为 LF；不要在旧目录里用批量格式化伪装修复，也不要把
行尾变化提交回仓库。

运行环境：

- Windows x64 测试机；
- Git、Node.js 24、pnpm 11.3.0；
- GitHub CLI `gh`，并已通过 `gh auth login` 登录有权创建 Issue 和运行 Actions 的账号。

如果 pnpm 尚未安装：

```powershell
corepack enable
corepack prepare pnpm@11.3.0 --activate
```

## 3. 收到“开始测试”后的固定流程

### A. 自动检查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\windows-ai-test.ps1 -Mode Run
```

脚本会输出 `Run ID`。记住该值；不填写 `-RunId` 时，后续命令默认使用最近一次运行。
自动阶段会执行锁定依赖安装、类型、格式、Lint、流量、导入、刷新、更新通道、品牌和
Git 补丁检查。某一项失败后仍会继续其余检查，以获得完整矩阵，但执行器最终返回非零；
此时必须停止 Build/真机步骤并把该轮作为 FAIL，不能继续生成 PASS。

### B. 构建并下载 Windows x64 临时安装包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\windows-ai-test.ps1 -Mode Build -RunId <RUN_ID>
```

脚本只触发仓库 `Development Test` 的 Windows x64 项，等待 Actions 完成并将临时 EXE
下载到本机忽略目录。该构件不是正式发布，不得传播或上传到其他渠道。

### C. 执行 Windows 真机用例

严格按 `test-cases/windows-commercial.json` 中 `manualChecks` 的顺序测试。每项完成后
立即记录，不要等到最后凭记忆补写：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\windows-ai-test.ps1 -Mode Record `
  -RunId <RUN_ID> `
  -CaseId WIN-INSTALL-001 `
  -Status pass `
  -Summary "临时安装包安装成功，启动观察 60 秒无闪退" `
  -Evidence "界面目视检查；未上传截图"
```

状态只能是：

- `pass`：全部步骤执行且符合预期；
- `fail`：执行后不符合预期；
- `blocked`：缺少安全前置条件；
- `not_run`：尚未执行，发布时整体结论会是 BLOCKED。

失败摘要要写清楚“操作步骤、实际现象、是否稳定复现、回滚结果”，但不得复制原始日志。
原始日志只保留在本机，主审阅任务确有需要时再指定最小脱敏片段。

`WIN-TRAFFIC-001` 允许读取本机 localStorage 的
`shenxianyun.managedTrafficStatus.v1`。该记录只包含状态、时间、失败分类、HTTP 状态和
确认序号，不含提取码、Token、URL、设备标识或流量值。Issue 只写
`scheduled/attempting/acknowledged/retrying`、确认序号是否推进和脱敏失败分类，不复制
整个 localStorage 或网络请求。

客户端收到 API 确认不等于已经直接核验生产数据库。Windows Issue 必须如实写明是否
存在服务端聚合证据；没有时写“待主审任务核验”，不得用“接口写入语义”推断
`traffic_counters` 或 `traffic_daily` 已有记录。主审任务会在拉取 Issue 后通过授权的
只读运维通道核对两张表的脱敏行数/总量，不读取或公开账号、IP、设备标识、凭据和明细。

随时查看进度：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\windows-ai-test.ps1 -Mode Status -RunId <RUN_ID>
```

### D. 上传 GitHub

所有可执行项目记录后运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\windows-ai-test.ps1 -Mode Publish -RunId <RUN_ID>
```

脚本先检查常见凭据模式，再创建标准化 GitHub Issue。它不会上传原始日志或安装包。

## 4. Windows AI 最终回复格式

```text
Windows 测试已完成并上传。
Issue: <GitHub Issue URL>
Development Test: <GitHub Actions URL>
Commit: <40 位提交号>
Verdict: PASS / FAIL / BLOCKED
本机原始日志未上传，保存在 .ai-test-results/<RUN_ID>/raw-logs-local-only。
```

主审阅任务收到 Issue URL 后，通过 GitHub 拉取结构化报告和 Actions 结果进行复核。
