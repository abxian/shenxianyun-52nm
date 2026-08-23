[CmdletBinding()]
param(
    [ValidateSet("Run", "Build", "Record", "Status", "Publish")]
    [string]$Mode = "Status",
    [string]$RunId,
    [string]$CaseId,
    [ValidateSet("pass", "fail", "blocked", "not_run")]
    [string]$Status = "not_run",
    [string]$Summary = "",
    [string]$Evidence = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CasePath = Join-Path $RepoRoot "test-cases/windows-commercial.json"
$ResultsRoot = Join-Path $RepoRoot ".ai-test-results"
$LatestPath = Join-Path $ResultsRoot "LATEST"

function Write-JsonFile {
    param([Parameter(Mandatory = $true)]$Value, [Parameter(Mandatory = $true)][string]$Path)
    $Value | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding UTF8
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    return Get-Content -Raw -Path $Path | ConvertFrom-Json
}

function Get-EffectiveRunId {
    if ($RunId) {
        return $RunId
    }
    if (-not (Test-Path $LatestPath)) {
        throw "没有找到测试运行。请先执行 -Mode Run。"
    }
    return (Get-Content -Raw -Path $LatestPath).Trim()
}

function Get-RunDirectory {
    param([Parameter(Mandatory = $true)][string]$EffectiveRunId)
    $candidate = Join-Path $ResultsRoot $EffectiveRunId
    if (-not (Test-Path $candidate)) {
        throw "测试运行不存在：$EffectiveRunId"
    }
    return $candidate
}

function Assert-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "缺少命令：$Name"
    }
}

function Assert-SafeText {
    param([Parameter(Mandatory = $true)][string]$Text)
    $patterns = @(
        '(?i)bearer\s+\S+',
        '(?i)(token|password|passwd|secret|authorization|cookie|machineguid|subscription)\s*[:=]\s*\S+',
        '(?i)https?://\S+[?&][^\s=]+=',
        '(?i)HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography'
    )
    foreach ($pattern in $patterns) {
        if ($Text -match $pattern) {
            throw "报告文本命中敏感信息规则，拒绝上传。请脱敏后重试。"
        }
    }
}

function Escape-MarkdownCell {
    param([AllowEmptyString()][string]$Text)
    if (-not $Text) {
        return "-"
    }
    return (($Text -replace '\|', '\|') -replace "`r?`n", "<br>")
}

function Invoke-CapturedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][object[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$LogDirectory
    )
    $safeId = $Id -replace '[^A-Za-z0-9_.-]', '_'
    $logPath = Join-Path $LogDirectory "$safeId.log"
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $exitCode = 1
    try {
        & $Executable @Arguments 2>&1 | Tee-Object -FilePath $logPath | Out-Host
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) {
            $exitCode = 0
        }
    }
    catch {
        $_ | Out-String | Set-Content -Path $logPath -Encoding UTF8
        $exitCode = 1
    }
    finally {
        $stopwatch.Stop()
    }
    return [PSCustomObject]@{
        id = $Id
        title = $Title
        status = $(if ($exitCode -eq 0) { "pass" } else { "fail" })
        exitCode = $exitCode
        durationSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 2)
        localLog = "$safeId.log"
    }
}

function Save-State {
    param([Parameter(Mandatory = $true)]$State, [Parameter(Mandatory = $true)][string]$Directory)
    Write-JsonFile -Value $State -Path (Join-Path $Directory "state.json")
}

function Get-ManualTemplate {
    param([Parameter(Mandatory = $true)]$Cases)
    $items = @()
    foreach ($case in $Cases) {
        $items += [PSCustomObject]@{
            id = $case.id
            title = $case.title
            status = "not_run"
            summary = ""
            evidence = ""
        }
    }
    return [PSCustomObject]@{ results = $items }
}

Set-Location $RepoRoot
if (-not (Test-Path $CasePath)) {
    throw "测试用例不存在：$CasePath"
}
$CaseSpec = Read-JsonFile -Path $CasePath

if ($Mode -eq "Run") {
    if ($env:OS -ne "Windows_NT") {
        throw "此测试执行器只允许在 Windows 上运行。"
    }
    foreach ($requiredCommand in @("git", "node", "pnpm")) {
        Assert-CommandExists -Name $requiredCommand
    }

    $branch = (& git branch --show-current).Trim()
    if ($branch -ne $CaseSpec.targetBranch) {
        throw "当前分支为 '$branch'，必须切换到 '$($CaseSpec.targetBranch)'。"
    }
    & git merge-base --is-ancestor $CaseSpec.requiredAncestor HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "当前提交不包含要求的商业化候选基线 $($CaseSpec.requiredAncestor)。"
    }
    $dirty = (& git status --porcelain --untracked-files=normal | Out-String).Trim()
    if ($dirty) {
        throw "工作树不干净。请勿修改源码；先恢复或重新克隆仓库。"
    }

    New-Item -ItemType Directory -Force -Path $ResultsRoot | Out-Null
    $newRunId = "win-{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), (Get-Random -Minimum 1000 -Maximum 9999)
    $runDirectory = Join-Path $ResultsRoot $newRunId
    $logDirectory = Join-Path $runDirectory "raw-logs-local-only"
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    Set-Content -Path $LatestPath -Value $newRunId -Encoding UTF8

    $osCaption = (Get-CimInstance Win32_OperatingSystem).Caption
    $state = [PSCustomObject]@{
        runId = $newRunId
        caseVersion = $CaseSpec.caseVersion
        repository = $CaseSpec.repository
        branch = $branch
        commit = (& git rev-parse HEAD).Trim()
        startedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        os = $osCaption
        architecture = $env:PROCESSOR_ARCHITECTURE
        nodeVersion = (& node --version).Trim()
        pnpmVersion = (& pnpm --version).Trim()
        actionsRunId = $null
        actionsUrl = $null
    }
    Save-State -State $state -Directory $runDirectory
    Write-JsonFile -Value (Get-ManualTemplate -Cases $CaseSpec.manualChecks) -Path (Join-Path $runDirectory "manual-results.json")

    $automatedResults = @()
    foreach ($check in $CaseSpec.automatedChecks) {
        Write-Host "`n=== $($check.id) $($check.title) ===" -ForegroundColor Cyan
        $automatedResults += Invoke-CapturedCommand -Id $check.id -Title $check.title -Executable $check.executable -Arguments @($check.arguments) -LogDirectory $logDirectory
    }
    Write-JsonFile -Value ([PSCustomObject]@{ results = $automatedResults }) -Path (Join-Path $runDirectory "automated-results.json")
    Write-Host "`n自动测试结束。Run ID: $newRunId" -ForegroundColor Green
    Write-Host "原始日志仅保存在本机忽略目录：.ai-test-results/$newRunId/raw-logs-local-only"
    Write-Host "下一步：-Mode Build -RunId $newRunId"
    exit 0
}

$effectiveRunId = Get-EffectiveRunId
$effectiveRunDirectory = Get-RunDirectory -EffectiveRunId $effectiveRunId
$statePath = Join-Path $effectiveRunDirectory "state.json"
$manualPath = Join-Path $effectiveRunDirectory "manual-results.json"
$automatedPath = Join-Path $effectiveRunDirectory "automated-results.json"
$state = Read-JsonFile -Path $statePath

if ($Mode -eq "Build") {
    foreach ($requiredCommand in @("gh", "git")) {
        Assert-CommandExists -Name $requiredCommand
    }
    & gh auth status | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI 尚未登录。请先执行 gh auth login。"
    }
    if ($state.branch -ne $CaseSpec.targetBranch) {
        throw "测试状态中的分支不符合用例目标。"
    }

    $dispatchStarted = (Get-Date).ToUniversalTime().AddMinutes(-1)
    & gh workflow run $CaseSpec.developmentWorkflow --repo $CaseSpec.repository --ref $state.branch -f run_windows=true -f run_macos_aarch64=false -f run_windows_arm64=false -f run_linux_amd64=false
    if ($LASTEXITCODE -ne 0) {
        throw "触发 Development Test 失败。"
    }
    Start-Sleep -Seconds 6
    $runsJson = & gh run list --repo $CaseSpec.repository --workflow $CaseSpec.developmentWorkflow --branch $state.branch --event workflow_dispatch --limit 10 --json databaseId,createdAt,headSha,status,url
    if ($LASTEXITCODE -ne 0) {
        throw "无法读取 Development Test 运行列表。"
    }
    $runs = @($runsJson | ConvertFrom-Json)
    $candidate = $runs |
        Where-Object { $_.headSha -eq $state.commit -and ([DateTime]$_.createdAt).ToUniversalTime() -ge $dispatchStarted } |
        Sort-Object { [DateTime]$_.createdAt } -Descending |
        Select-Object -First 1
    if (-not $candidate) {
        throw "已触发工作流，但未找到与提交 $($state.commit) 匹配的运行。请稍后重试 -Mode Build。"
    }

    $state.actionsRunId = $candidate.databaseId
    $state.actionsUrl = $candidate.url
    Save-State -State $state -Directory $effectiveRunDirectory
    Write-Host "Development Test: $($candidate.url)" -ForegroundColor Cyan
    & gh run watch $candidate.databaseId --repo $CaseSpec.repository --exit-status
    if ($LASTEXITCODE -ne 0) {
        throw "Development Test 未通过。保留 Actions URL 并将相关真机项目标记为 blocked。"
    }
    $installerDirectory = Join-Path $effectiveRunDirectory "windows-installer-local-only"
    New-Item -ItemType Directory -Force -Path $installerDirectory | Out-Null
    & gh run download $candidate.databaseId --repo $CaseSpec.repository --dir $installerDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Actions 已通过，但下载 Windows 构件失败。"
    }
    Write-Host "Windows 临时安装包已下载到：.ai-test-results/$effectiveRunId/windows-installer-local-only" -ForegroundColor Green
    Write-Host "安装前确认这是备用机、虚拟机或可回滚环境。"
    exit 0
}

if ($Mode -eq "Record") {
    if (-not $CaseId) {
        throw "Record 模式必须提供 -CaseId。"
    }
    Assert-SafeText -Text "$Summary`n$Evidence"
    $manual = Read-JsonFile -Path $manualPath
    $target = @($manual.results) | Where-Object { $_.id -eq $CaseId } | Select-Object -First 1
    if (-not $target) {
        throw "未知手工用例：$CaseId"
    }
    $target.status = $Status
    $target.summary = $Summary.Trim()
    $target.evidence = $Evidence.Trim()
    Write-JsonFile -Value $manual -Path $manualPath
    Write-Host "已记录 $CaseId = $Status" -ForegroundColor Green
    exit 0
}

if ($Mode -eq "Status") {
    $automated = if (Test-Path $automatedPath) { Read-JsonFile -Path $automatedPath } else { [PSCustomObject]@{ results = @() } }
    $manual = Read-JsonFile -Path $manualPath
    Write-Host "Run ID: $effectiveRunId"
    Write-Host "Commit: $($state.commit)"
    Write-Host "Actions: $($state.actionsUrl)"
    Write-Host "Automated:"
    @($automated.results) | Format-Table id, status, exitCode, durationSeconds -AutoSize
    Write-Host "Manual:"
    @($manual.results) | Format-Table id, status, summary -AutoSize
    exit 0
}

if ($Mode -eq "Publish") {
    Assert-CommandExists -Name "gh"
    & gh auth status | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "GitHub CLI 尚未登录。请先执行 gh auth login。"
    }
    if (-not (Test-Path $automatedPath)) {
        throw "缺少自动测试结果。请先执行 -Mode Run。"
    }
    $automated = Read-JsonFile -Path $automatedPath
    $manual = Read-JsonFile -Path $manualPath
    foreach ($item in @($manual.results)) {
        Assert-SafeText -Text "$($item.summary)`n$($item.evidence)"
    }

    $automatedFailureCount = (@($automated.results) | Where-Object { $_.status -eq "fail" }).Count
    $manualFailureCount = (@($manual.results) | Where-Object { $_.status -eq "fail" }).Count
    $hasFailure = ($automatedFailureCount -gt 0) -or ($manualFailureCount -gt 0)
    $hasBlocked = (@($manual.results) | Where-Object { $_.status -in @("blocked", "not_run") }).Count -gt 0
    $verdict = if ($hasFailure) { "FAIL" } elseif ($hasBlocked) { "BLOCKED" } else { "PASS" }

    $bodyPath = Join-Path $effectiveRunDirectory "github-issue-body.md"
    $lines = @(
        "## Windows AI 测试结果",
        "",
        "- Verdict: **$verdict**",
        "- Run ID: ``$effectiveRunId``",
        "- Case version: ``$($state.caseVersion)``",
        "- Commit: ``$($state.commit)``",
        "- Branch: ``$($state.branch)``",
        "- OS: $(Escape-MarkdownCell $state.os)",
        "- Architecture: ``$($state.architecture)``",
        "- Node / pnpm: ``$($state.nodeVersion)`` / ``$($state.pnpmVersion)``",
        "- Development Test: $(if ($state.actionsUrl) { $state.actionsUrl } else { '未运行' })",
        "",
        "### 自动检查",
        "",
        "| ID | 检查 | 状态 | Exit | 秒 |",
        "|---|---|---:|---:|---:|"
    )
    foreach ($item in @($automated.results)) {
        $lines += "| $($item.id) | $(Escape-MarkdownCell $item.title) | $($item.status) | $($item.exitCode) | $($item.durationSeconds) |"
    }
    $lines += @(
        "",
        "### Windows 真机检查",
        "",
        "| ID | 检查 | 状态 | 脱敏摘要 | 证据说明 |",
        "|---|---|---:|---|---|"
    )
    foreach ($item in @($manual.results)) {
        $lines += "| $($item.id) | $(Escape-MarkdownCell $item.title) | $($item.status) | $(Escape-MarkdownCell $item.summary) | $(Escape-MarkdownCell $item.evidence) |"
    }
    $lines += @(
        "",
        "### 安全声明",
        "",
        "- 原始日志和安装包仅保留在 Windows 本机的 ``.ai-test-results`` 忽略目录，未上传 GitHub。",
        "- 报告不包含订阅 URL、导入码、Token、Cookie、密码、MachineGuid、用户名或私人路径。",
        "- BLOCKED 表示前置条件不足，不得解释为通过。",
        "",
        "Generated by repository-native ``scripts/windows-ai-test.ps1``."
    )
    $lines | Set-Content -Path $bodyPath -Encoding UTF8
    $shortCommit = $state.commit.Substring(0, 8)
    $title = "[Windows AI Test][$verdict] $shortCommit $effectiveRunId"
    $issueUrl = & gh issue create --repo $CaseSpec.repository --title $title --body-file $bodyPath
    if ($LASTEXITCODE -ne 0) {
        throw "创建 GitHub Issue 失败。"
    }
    Write-Host "测试结果已上传：$issueUrl" -ForegroundColor Green
    Write-Host "请把 Issue URL 和 Development Test URL 发送给主审阅任务。"
    exit 0
}
