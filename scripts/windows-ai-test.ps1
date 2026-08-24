[CmdletBinding()]
param(
    [ValidateSet("Run", "Build", "Record", "Status", "Publish", "SelfTest")]
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
    return Get-Content -Raw -Encoding UTF8 -Path $Path | ConvertFrom-Json
}

function Get-EffectiveRunId {
    if ($RunId) {
        return $RunId
    }
    if (-not (Test-Path $LatestPath)) {
        throw "No test run found. Execute -Mode Run first."
    }
    return (Get-Content -Raw -Path $LatestPath).Trim()
}

function Get-RunDirectory {
    param([Parameter(Mandatory = $true)][string]$EffectiveRunId)
    $candidate = Join-Path $ResultsRoot $EffectiveRunId
    if (-not (Test-Path $candidate)) {
        throw "Test run does not exist: $EffectiveRunId"
    }
    return $candidate
}

function Assert-CommandExists {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command is missing: $Name"
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
            throw "Report text matches a sensitive-data rule. Redact it before retrying."
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
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 wraps native stderr as ErrorRecord objects.
        # With the script-wide Stop policy, an otherwise successful native
        # command can jump into catch before LASTEXITCODE is collected. Keep
        # native output non-terminating inside this narrow invocation scope and
        # use the process exit code as the authoritative result.
        $ErrorActionPreference = "Continue"
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
        $ErrorActionPreference = $previousErrorActionPreference
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

function Assert-ResultMatrix {
    param(
        [Parameter(Mandatory = $true)][object[]]$Results,
        [Parameter(Mandatory = $true)][object[]]$ExpectedCases,
        [Parameter(Mandatory = $true)][string[]]$AllowedStatuses,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (@($Results).Count -ne @($ExpectedCases).Count) {
        throw "$Label result count does not match the case specification."
    }
    foreach ($expected in @($ExpectedCases)) {
        $matches = @($Results | Where-Object { $_.id -eq $expected.id })
        if ($matches.Count -ne 1) {
            throw "$Label result ID must occur exactly once: $($expected.id)"
        }
    }
    foreach ($result in @($Results)) {
        if ($result.status -notin $AllowedStatuses) {
            throw "$Label result has an invalid status: $($result.id)"
        }
    }
}

function Get-TestVerdict {
    param(
        [Parameter(Mandatory = $true)][object[]]$AutomatedResults,
        [Parameter(Mandatory = $true)][object[]]$ManualResults
    )
    # The outer array expression is required for Windows PowerShell 5.1.
    # Without it, one pipeline match becomes a scalar whose Count can be null,
    # allowing exactly one failure to be misclassified as PASS.
    $automatedFailureCount = @($AutomatedResults | Where-Object { $_.status -eq "fail" }).Count
    $manualFailureCount = @($ManualResults | Where-Object { $_.status -eq "fail" }).Count
    $blockedCount = @($ManualResults | Where-Object { $_.status -in @("blocked", "not_run") }).Count
    if (($automatedFailureCount -gt 0) -or ($manualFailureCount -gt 0)) {
        return "FAIL"
    }
    if ($blockedCount -gt 0) {
        return "BLOCKED"
    }
    return "PASS"
}

Set-Location $RepoRoot
if (-not (Test-Path $CasePath)) {
    throw "Test case file does not exist: $CasePath"
}
$CaseSpec = Read-JsonFile -Path $CasePath

if ($Mode -eq "SelfTest") {
    $oneAutomatedPass = @([PSCustomObject]@{ id = "AUTO-ONE"; status = "pass" })
    $oneAutomatedFail = @([PSCustomObject]@{ id = "AUTO-ONE"; status = "fail" })
    $oneManualPass = @([PSCustomObject]@{ id = "WIN-ONE"; status = "pass" })
    $oneManualFail = @([PSCustomObject]@{ id = "WIN-ONE"; status = "fail" })
    $oneManualBlocked = @([PSCustomObject]@{ id = "WIN-ONE"; status = "blocked" })
    $expectedAutomated = @([PSCustomObject]@{ id = "AUTO-ONE" })
    $expectedManual = @([PSCustomObject]@{ id = "WIN-ONE" })

    Assert-ResultMatrix -Results $oneAutomatedPass -ExpectedCases $expectedAutomated -AllowedStatuses @("pass", "fail") -Label "Automated"
    Assert-ResultMatrix -Results $oneManualPass -ExpectedCases $expectedManual -AllowedStatuses @("pass", "fail", "blocked", "not_run") -Label "Manual"
    if ((Get-TestVerdict -AutomatedResults $oneAutomatedPass -ManualResults $oneManualPass) -ne "PASS") {
        throw "Self-test failed: all-pass matrix was not PASS."
    }
    if ((Get-TestVerdict -AutomatedResults $oneAutomatedFail -ManualResults $oneManualPass) -ne "FAIL") {
        throw "Self-test failed: one automated failure was not FAIL."
    }
    if ((Get-TestVerdict -AutomatedResults $oneAutomatedPass -ManualResults $oneManualFail) -ne "FAIL") {
        throw "Self-test failed: one manual failure was not FAIL."
    }
    if ((Get-TestVerdict -AutomatedResults $oneAutomatedPass -ManualResults $oneManualBlocked) -ne "BLOCKED") {
        throw "Self-test failed: one blocked manual result was not BLOCKED."
    }
    Write-Host "Windows AI verdict self-test passed." -ForegroundColor Green
    exit 0
}

if ($Mode -eq "Run") {
    if ($env:OS -ne "Windows_NT") {
        throw "This test runner is restricted to Windows."
    }
    foreach ($requiredCommand in @("git", "node", "pnpm")) {
        Assert-CommandExists -Name $requiredCommand
    }

    $branch = (& git branch --show-current).Trim()
    if ($branch -ne $CaseSpec.targetBranch) {
        throw "Current branch is '$branch'; expected '$($CaseSpec.targetBranch)'."
    }
    & git merge-base --is-ancestor $CaseSpec.requiredAncestor HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Current commit does not contain required candidate baseline $($CaseSpec.requiredAncestor)."
    }
    $dirty = (& git status --porcelain --untracked-files=normal | Out-String).Trim()
    if ($dirty) {
        throw "Working tree is dirty. Do not modify source; restore it or clone again."
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
    $automatedFailureCount = @($automatedResults | Where-Object { $_.status -eq "fail" }).Count
    Write-Host "`nAutomated checks completed. Run ID: $newRunId"
    Write-Host "Raw logs remain local only: .ai-test-results/$newRunId/raw-logs-local-only"
    if ($automatedFailureCount -gt 0) {
        Write-Host "$automatedFailureCount automated check(s) failed. Do not build or claim PASS." -ForegroundColor Red
        exit 1
    }
    Write-Host "All automated checks passed." -ForegroundColor Green
    Write-Host "Next: -Mode Build -RunId $newRunId"
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
        throw "GitHub CLI is not authenticated. Run gh auth login first."
    }
    if ($state.branch -ne $CaseSpec.targetBranch) {
        throw "The branch stored in test state does not match the test target."
    }

    $dispatchStarted = (Get-Date).ToUniversalTime().AddMinutes(-1)
    & gh workflow run $CaseSpec.developmentWorkflow --repo $CaseSpec.repository --ref $state.branch -f run_windows=true -f run_macos_aarch64=false -f run_windows_arm64=false -f run_linux_amd64=false
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to dispatch Development Test."
    }
    Start-Sleep -Seconds 6
    $runsJson = & gh run list --repo $CaseSpec.repository --workflow $CaseSpec.developmentWorkflow --branch $state.branch --event workflow_dispatch --limit 10 --json databaseId,createdAt,headSha,status,url
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to read Development Test runs."
    }
    $runs = @($runsJson | ConvertFrom-Json)
    $candidate = $runs |
        Where-Object { $_.headSha -eq $state.commit -and ([DateTime]$_.createdAt).ToUniversalTime() -ge $dispatchStarted } |
        Sort-Object { [DateTime]$_.createdAt } -Descending |
        Select-Object -First 1
    if (-not $candidate) {
        throw "Workflow dispatched, but no run matched commit $($state.commit). Retry -Mode Build shortly."
    }

    $state.actionsRunId = $candidate.databaseId
    $state.actionsUrl = $candidate.url
    Save-State -State $state -Directory $effectiveRunDirectory
    Write-Host "Development Test: $($candidate.url)" -ForegroundColor Cyan
    & gh run watch $candidate.databaseId --repo $CaseSpec.repository --exit-status
    if ($LASTEXITCODE -ne 0) {
        throw "Development Test failed. Keep the Actions URL and mark dependent manual cases blocked."
    }
    $installerDirectory = Join-Path $effectiveRunDirectory "windows-installer-local-only"
    New-Item -ItemType Directory -Force -Path $installerDirectory | Out-Null
    & gh run download $candidate.databaseId --repo $CaseSpec.repository --dir $installerDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Actions passed, but the Windows artifact download failed."
    }
    Write-Host "Temporary Windows installer: .ai-test-results/$effectiveRunId/windows-installer-local-only" -ForegroundColor Green
    Write-Host "Before installation, confirm this is a spare, virtualized, or otherwise recoverable test environment."
    exit 0
}

if ($Mode -eq "Record") {
    if (-not $CaseId) {
        throw "Record mode requires -CaseId."
    }
    Assert-SafeText -Text "$Summary`n$Evidence"
    $manual = Read-JsonFile -Path $manualPath
    $target = @($manual.results) | Where-Object { $_.id -eq $CaseId } | Select-Object -First 1
    if (-not $target) {
        throw "Unknown manual case: $CaseId"
    }
    $target.status = $Status
    $target.summary = $Summary.Trim()
    $target.evidence = $Evidence.Trim()
    Write-JsonFile -Value $manual -Path $manualPath
    Write-Host "Recorded $CaseId = $Status" -ForegroundColor Green
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
        throw "GitHub CLI is not authenticated. Run gh auth login first."
    }
    if (-not (Test-Path $automatedPath)) {
        throw "Automated results are missing. Execute -Mode Run first."
    }
    $automated = Read-JsonFile -Path $automatedPath
    $manual = Read-JsonFile -Path $manualPath
    foreach ($item in @($manual.results)) {
        Assert-SafeText -Text "$($item.summary)`n$($item.evidence)"
    }

    Assert-ResultMatrix -Results @($automated.results) -ExpectedCases @($CaseSpec.automatedChecks) -AllowedStatuses @("pass", "fail") -Label "Automated"
    Assert-ResultMatrix -Results @($manual.results) -ExpectedCases @($CaseSpec.manualChecks) -AllowedStatuses @("pass", "fail", "blocked", "not_run") -Label "Manual"

    if (-not $state.actionsRunId -or -not $state.actionsUrl) {
        throw "Development Test evidence is missing. Execute -Mode Build first."
    }
    $actionsJson = & gh run view $state.actionsRunId --repo $CaseSpec.repository --json status,conclusion,headSha,url
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to verify the recorded Development Test."
    }
    $actions = $actionsJson | ConvertFrom-Json
    if ($actions.status -ne "completed" -or $actions.conclusion -ne "success") {
        throw "Recorded Development Test is not completed successfully."
    }
    if ($actions.headSha -ne $state.commit -or $actions.url -ne $state.actionsUrl) {
        throw "Recorded Development Test does not match the tested commit or URL."
    }

    $verdict = Get-TestVerdict -AutomatedResults @($automated.results) -ManualResults @($manual.results)

    $bodyPath = Join-Path $effectiveRunDirectory "github-issue-body.md"
    $lines = @(
        "## Windows AI test result",
        "",
        "- Verdict: **$verdict**",
        "- Run ID: ``$effectiveRunId``",
        "- Case version: ``$($state.caseVersion)``",
        "- Commit: ``$($state.commit)``",
        "- Branch: ``$($state.branch)``",
        "- OS: $(Escape-MarkdownCell $state.os)",
        "- Architecture: ``$($state.architecture)``",
        "- Node / pnpm: ``$($state.nodeVersion)`` / ``$($state.pnpmVersion)``",
        "- Development Test: $(if ($state.actionsUrl) { $state.actionsUrl } else { 'not run' })",
        "",
        "### Automated checks",
        "",
        "| ID | Check | Status | Exit | Seconds |",
        "|---|---|---:|---:|---:|"
    )
    foreach ($item in @($automated.results)) {
        $lines += "| $($item.id) | $(Escape-MarkdownCell $item.title) | $($item.status) | $($item.exitCode) | $($item.durationSeconds) |"
    }
    $lines += @(
        "",
        "### Windows manual checks",
        "",
        "| ID | Check | Status | Redacted summary | Evidence note |",
        "|---|---|---:|---|---|"
    )
    foreach ($item in @($manual.results)) {
        $lines += "| $($item.id) | $(Escape-MarkdownCell $item.title) | $($item.status) | $(Escape-MarkdownCell $item.summary) | $(Escape-MarkdownCell $item.evidence) |"
    }
    $lines += @(
        "",
        "### Safety statement",
        "",
        "- Raw logs and installers remain only in the local ignored ``.ai-test-results`` directory and were not uploaded.",
        "- This report excludes subscription URLs, import codes, tokens, cookies, passwords, MachineGuid, usernames, and private paths.",
        "- BLOCKED means prerequisites were unavailable and must not be interpreted as PASS.",
        "",
        "Generated by repository-native ``scripts/windows-ai-test.ps1``."
    )
    $lines | Set-Content -Path $bodyPath -Encoding UTF8
    $shortCommit = $state.commit.Substring(0, 8)
    $title = "[Windows AI Test][$verdict] $shortCommit $effectiveRunId"
    $issueUrl = & gh issue create --repo $CaseSpec.repository --title $title --body-file $bodyPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the GitHub Issue."
    }
    Write-Host "Test result uploaded: $issueUrl" -ForegroundColor Green
    Write-Host "Send the Issue URL and Development Test URL to the primary review task."
    exit 0
}
