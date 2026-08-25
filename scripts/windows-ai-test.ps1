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

function ConvertTo-UtcDateTime {
    param([Parameter(Mandatory = $true)]$Value)
    if ($Value -is [DateTimeOffset]) {
        return $Value.UtcDateTime
    }
    if ($Value -is [DateTime]) {
        return $Value.ToUniversalTime()
    }
    return ([DateTimeOffset]::Parse(
        [string]$Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    )).UtcDateTime
}

function Select-DevelopmentRun {
    param(
        [Parameter(Mandatory = $true)]$RunsJson,
        [Parameter(Mandatory = $true)][string]$Commit,
        [Parameter(Mandatory = $true)][DateTime]$NotBeforeUtc
    )
    # Windows PowerShell 5.1 preserves a top-level JSON array as one pipeline
    # object. Pipe the parsed value again so each workflow run is filtered as
    # an individual object instead of casting an Object[] createdAt to DateTime.
    $parsedRuns = $RunsJson | ConvertFrom-Json
    $runs = @($parsedRuns | ForEach-Object { $_ })
    return $runs |
        Where-Object {
            $_.headSha -eq $Commit -and
            (ConvertTo-UtcDateTime -Value $_.createdAt) -ge $NotBeforeUtc
        } |
        Sort-Object { ConvertTo-UtcDateTime -Value $_.createdAt } -Descending |
        Select-Object -First 1
}

function Get-DevelopmentRunDisposition {
    param(
        [Parameter(Mandatory = $true)]$Run,
        [Parameter(Mandatory = $true)][string]$Commit
    )
    if (-not $Run -or [string]$Run.headSha -ne $Commit) {
        return "mismatch"
    }
    $runStatus = ([string]$Run.status).ToLowerInvariant()
    if ($runStatus -eq "completed") {
        if (([string]$Run.conclusion).ToLowerInvariant() -eq "success") {
            return "success"
        }
        return "replace"
    }
    # Conservatively keep waiting for every exact-head, non-completed state.
    # GitHub may add intermediate statuses; dispatching another run here would
    # cancel the healthy run through the workflow concurrency policy.
    return "wait"
}

function Read-DevelopmentRun {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][int64]$ActionsRunId,
        [int]$MaxAttempts = 3
    )
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $runJson = (& gh run view $ActionsRunId --repo $Repository --json databaseId,headSha,status,conclusion,url 2>&1 | Out-String).Trim()
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($exitCode -eq 0) {
            try {
                return ($runJson | ConvertFrom-Json)
            }
            catch {
                if ($attempt -eq $MaxAttempts) {
                    throw "Development Test returned invalid JSON. No replacement run was dispatched."
                }
            }
        }
        elseif ($runJson -match '(?i)(HTTP\s+404|not found)') {
            return $null
        }
        elseif ($attempt -eq $MaxAttempts) {
            throw "Development Test state could not be read after $MaxAttempts attempts. No replacement run was dispatched."
        }
        Write-Warning "Development Test state read attempt $attempt failed; preserving the recorded run and retrying."
        Start-Sleep -Seconds 5
    }
}

function Find-DevelopmentRun {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string]$Workflow,
        [Parameter(Mandatory = $true)][string]$Branch,
        [Parameter(Mandatory = $true)][string]$Commit,
        [Parameter(Mandatory = $true)][DateTime]$NotBeforeUtc,
        [int]$MaxAttempts = 3
    )
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            $runsJson = (& gh run list --repo $Repository --workflow $Workflow --branch $Branch --event workflow_dispatch --limit 20 --json databaseId,createdAt,headSha,status,conclusion,url 2>&1 | Out-String).Trim()
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($exitCode -eq 0) {
            try {
                return Select-DevelopmentRun -RunsJson $runsJson -Commit $Commit -NotBeforeUtc $NotBeforeUtc
            }
            catch {
                if ($attempt -eq $MaxAttempts) {
                    throw "Development Test run list returned invalid JSON. No replacement run was dispatched."
                }
            }
        }
        elseif ($attempt -eq $MaxAttempts) {
            throw "Development Test run list could not be read after $MaxAttempts attempts. No replacement run was dispatched."
        }
        Write-Warning "Development Test run list attempt $attempt failed; retrying without dispatching."
        Start-Sleep -Seconds 5
    }
}

function Wait-DevelopmentRun {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][int64]$ActionsRunId,
        [Parameter(Mandatory = $true)][string]$Commit
    )
    while ($true) {
        $run = Read-DevelopmentRun -Repository $Repository -ActionsRunId $ActionsRunId
        if (-not $run) {
            throw "Recorded Development Test no longer exists. Retry Build to dispatch a replacement."
        }
        $disposition = Get-DevelopmentRunDisposition -Run $run -Commit $Commit
        if ($disposition -eq "success") {
            return $run
        }
        if ($disposition -eq "replace") {
            throw "Development Test completed with conclusion '$($run.conclusion)'. Retry Build to dispatch a replacement."
        }
        if ($disposition -eq "mismatch") {
            throw "Recorded Development Test does not match the tested commit."
        }
        Write-Host "Development Test status: $($run.status). Rechecking in 15 seconds..."
        Start-Sleep -Seconds 15
    }
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

function Save-GitHubArtifactFile {
    param(
        [Parameter(Mandatory = $true)][string]$DownloadUrl,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )
    # upload-artifact@v7 with archive:false serves the original file from the
    # artifact download URL. `gh run download` still assumes a ZIP and rejects
    # this valid response, so download the authenticated binary directly.
    $githubToken = (& gh auth token | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $githubToken) {
        throw "GitHub CLI authentication token could not be acquired."
    }
    $headers = @{
        Authorization = "Bearer $githubToken"
        Accept = "application/vnd.github+json"
        "X-GitHub-Api-Version" = "2022-11-28"
    }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -Headers $headers -OutFile $DestinationPath -MaximumRedirection 10 | Out-Null
    }
    finally {
        $headers = $null
        $githubToken = $null
    }
}

function Assert-WindowsInstallerFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int64]$ExpectedSize,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )
    $installer = Get-Item -LiteralPath $Path
    $installerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
    if ($installer.Length -ne $ExpectedSize -or $installerSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "Downloaded installer size or SHA-256 does not match GitHub artifact metadata."
    }
    $stream = [System.IO.File]::OpenRead($installer.FullName)
    try {
        $firstByte = $stream.ReadByte()
        $secondByte = $stream.ReadByte()
    }
    finally {
        $stream.Dispose()
    }
    if ($firstByte -ne 0x4d -or $secondByte -ne 0x5a) {
        throw "Downloaded artifact is not a Windows PE executable."
    }
    return $installerSha256
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

function Assert-AutomatedChecksPassed {
    param([Parameter(Mandatory = $true)][object[]]$Results)
    $failures = @($Results | Where-Object { $_.status -ne "pass" })
    if ($failures.Count -gt 0) {
        throw "Automated checks are not all pass. Build is forbidden."
    }
}

function Assert-ManualRecordOrder {
    param(
        [Parameter(Mandatory = $true)][object[]]$Results,
        [Parameter(Mandatory = $true)][object[]]$ExpectedCases,
        [Parameter(Mandatory = $true)][string]$TargetId
    )
    $targetIndex = -1
    for ($index = 0; $index -lt $ExpectedCases.Count; $index += 1) {
        if ($ExpectedCases[$index].id -eq $TargetId) {
            $targetIndex = $index
            break
        }
    }
    if ($targetIndex -lt 0) {
        throw "Unknown manual case: $TargetId"
    }
    if ($targetIndex -gt 0) {
        for ($index = 0; $index -lt $targetIndex; $index += 1) {
            $priorId = $ExpectedCases[$index].id
            $prior = @($Results | Where-Object { $_.id -eq $priorId }) | Select-Object -First 1
            if (-not $prior -or $prior.status -eq "not_run") {
                throw "Manual cases must be recorded in order. Complete $priorId first."
            }
        }
    }
}

function Get-AllowedBranches {
    param([Parameter(Mandatory = $true)]$Cases)
    $branches = @()
    if ($Cases.PSObject.Properties.Name -contains "allowedBranches") {
        $branches = @($Cases.allowedBranches | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    }
    if ($branches.Count -eq 0 -and $Cases.targetBranch) {
        $branches = @(([string]$Cases.targetBranch).Trim())
    }
    return $branches
}

function Assert-CandidateState {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)]$Cases,
        [Parameter(Mandatory = $true)][string]$CasesPath
    )
    $branch = (& git branch --show-current).Trim()
    $commit = (& git rev-parse HEAD).Trim()
    $allowedBranches = @(Get-AllowedBranches -Cases $Cases)
    if ($branch -ne $State.branch -or $branch -notin $allowedBranches) {
        throw "Current branch no longer matches the recorded test candidate."
    }
    if ($commit -ne $State.commit) {
        throw "Current HEAD no longer matches the commit recorded by Run. Clone the final candidate again."
    }
    $dirty = (& git status --porcelain --untracked-files=normal | Out-String).Trim()
    if ($dirty) {
        throw "Working tree changed after Run. Do not continue a stale test."
    }
    if ($State.caseVersion -ne $Cases.caseVersion) {
        throw "Test case version changed after Run. Clone the final candidate again."
    }
    $caseSha256 = (Get-FileHash -Algorithm SHA256 -Path $CasesPath).Hash.ToLowerInvariant()
    if (-not $State.caseSha256 -or $State.caseSha256 -ne $caseSha256) {
        throw "Test case content changed after Run. Clone the final candidate again."
    }
    & git merge-base --is-ancestor $Cases.requiredAncestor $State.commit
    if ($LASTEXITCODE -ne 0) {
        throw "Recorded commit does not contain the required candidate baseline."
    }
    $remoteLine = (& git ls-remote origin "refs/heads/$($State.branch)" | Out-String).Trim()
    if (-not $remoteLine) {
        throw "Unable to verify the remote candidate branch."
    }
    $remoteHead = ($remoteLine -split "\s+")[0]
    if ($remoteHead -ne $State.commit) {
        throw "Remote candidate branch moved after Run. Start a new test from a fresh clone."
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
    $branchCases = [PSCustomObject]@{
        targetBranch = "candidate"
        allowedBranches = @("candidate", "main")
    }
    $allowedBranches = @(Get-AllowedBranches -Cases $branchCases)
    if ("candidate" -notin $allowedBranches -or "main" -notin $allowedBranches -or "other" -in $allowedBranches) {
        throw "Self-test failed: allowed release branches were not enforced."
    }

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
    $automatedGateRejected = $false
    try {
        Assert-AutomatedChecksPassed -Results $oneAutomatedFail
    }
    catch {
        $automatedGateRejected = $true
    }
    if (-not $automatedGateRejected) {
        throw "Self-test failed: Build gate accepted a failed automated check."
    }
    $orderedCases = @(
        [PSCustomObject]@{ id = "WIN-ONE" },
        [PSCustomObject]@{ id = "WIN-TWO" }
    )
    $orderedResults = @(
        [PSCustomObject]@{ id = "WIN-ONE"; status = "not_run" },
        [PSCustomObject]@{ id = "WIN-TWO"; status = "not_run" }
    )
    $orderGateRejected = $false
    try {
        Assert-ManualRecordOrder -Results $orderedResults -ExpectedCases $orderedCases -TargetId "WIN-TWO"
    }
    catch {
        $orderGateRejected = $true
    }
    if (-not $orderGateRejected) {
        throw "Self-test failed: Record gate accepted an out-of-order case."
    }
    $workflowCommit = "0123456789abcdef0123456789abcdef01234567"
    $workflowRuns = @(
        [PSCustomObject]@{
            databaseId = 100
            createdAt = "2026-08-25T00:00:00Z"
            headSha = $workflowCommit
            status = "completed"
            url = "https://example.invalid/actions/runs/100"
        },
        [PSCustomObject]@{
            databaseId = 101
            createdAt = "2026-08-25T00:02:00Z"
            headSha = "ffffffffffffffffffffffffffffffffffffffff"
            status = "in_progress"
            url = "https://example.invalid/actions/runs/101"
        },
        [PSCustomObject]@{
            databaseId = 102
            createdAt = "2026-08-25T00:03:00Z"
            headSha = $workflowCommit
            status = "in_progress"
            url = "https://example.invalid/actions/runs/102"
        },
        [PSCustomObject]@{
            databaseId = 103
            createdAt = "2026-08-25T00:04:00Z"
            headSha = $workflowCommit
            status = "queued"
            url = "https://example.invalid/actions/runs/103"
        }
    )
    $workflowRunsJson = ConvertTo-Json -InputObject $workflowRuns -Compress
    $selectedWorkflowRun = Select-DevelopmentRun `
        -RunsJson $workflowRunsJson `
        -Commit $workflowCommit `
        -NotBeforeUtc ([DateTimeOffset]::Parse("2026-08-25T00:01:00Z").UtcDateTime)
    if (-not $selectedWorkflowRun -or $selectedWorkflowRun.databaseId -ne 103) {
        throw "Self-test failed: Build did not select the newest matching workflow run from a JSON array."
    }
    $workflowDispositionCases = @(
        [PSCustomObject]@{
            name = "queued matching run"
            run = [PSCustomObject]@{ headSha = $workflowCommit; status = "queued"; conclusion = "" }
            expected = "wait"
        },
        [PSCustomObject]@{
            name = "in-progress matching run"
            run = [PSCustomObject]@{ headSha = $workflowCommit; status = "in_progress"; conclusion = "" }
            expected = "wait"
        },
        [PSCustomObject]@{
            name = "successful matching run"
            run = [PSCustomObject]@{ headSha = $workflowCommit; status = "completed"; conclusion = "success" }
            expected = "success"
        },
        [PSCustomObject]@{
            name = "cancelled matching run"
            run = [PSCustomObject]@{ headSha = $workflowCommit; status = "completed"; conclusion = "cancelled" }
            expected = "replace"
        },
        [PSCustomObject]@{
            name = "mismatched run"
            run = [PSCustomObject]@{ headSha = "ffffffffffffffffffffffffffffffffffffffff"; status = "in_progress"; conclusion = "" }
            expected = "mismatch"
        }
    )
    foreach ($dispositionCase in $workflowDispositionCases) {
        $actualDisposition = Get-DevelopmentRunDisposition -Run $dispositionCase.run -Commit $workflowCommit
        if ($actualDisposition -ne $dispositionCase.expected) {
            throw "Self-test failed: $($dispositionCase.name) was '$actualDisposition', expected '$($dispositionCase.expected)'."
        }
    }
    $installerSelfTestDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("windows-ai-installer-{0}" -f [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $installerSelfTestDirectory | Out-Null
    try {
        $validInstallerPath = Join-Path $installerSelfTestDirectory "valid.exe"
        [System.IO.File]::WriteAllBytes($validInstallerPath, [byte[]](0x4d, 0x5a, 0x00, 0x01))
        $validDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $validInstallerPath).Hash.ToLowerInvariant()
        $verifiedDigest = Assert-WindowsInstallerFile -Path $validInstallerPath -ExpectedSize 4 -ExpectedSha256 $validDigest
        if ($verifiedDigest -ne $validDigest) {
            throw "Self-test failed: installer digest verification changed the digest."
        }
        $invalidInstallerPath = Join-Path $installerSelfTestDirectory "invalid.exe"
        [System.IO.File]::WriteAllBytes($invalidInstallerPath, [byte[]](0x50, 0x4b, 0x03, 0x04))
        $invalidDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $invalidInstallerPath).Hash.ToLowerInvariant()
        $peGateRejected = $false
        try {
            Assert-WindowsInstallerFile -Path $invalidInstallerPath -ExpectedSize 4 -ExpectedSha256 $invalidDigest | Out-Null
        }
        catch {
            $peGateRejected = $true
        }
        if (-not $peGateRejected) {
            throw "Self-test failed: installer gate accepted a non-PE file."
        }
    }
    finally {
        if (Test-Path -LiteralPath $installerSelfTestDirectory) {
            [System.IO.Directory]::Delete($installerSelfTestDirectory, $true)
        }
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
    $allowedBranches = @(Get-AllowedBranches -Cases $CaseSpec)
    if ($branch -notin $allowedBranches) {
        throw "Current branch is '$branch'; expected one of: $($allowedBranches -join ', ')."
    }
    & git merge-base --is-ancestor $CaseSpec.requiredAncestor HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "Current commit does not contain required candidate baseline $($CaseSpec.requiredAncestor)."
    }
    $dirty = (& git status --porcelain --untracked-files=normal | Out-String).Trim()
    if ($dirty) {
        throw "Working tree is dirty. Do not modify source; restore it or clone again."
    }
    $badWorkingTreeEol = @(& git ls-files --eol | Select-String 'w/(crlf|mixed)')
    if ($badWorkingTreeEol.Count -gt 0) {
        throw "Working tree contains CRLF or mixed source files. Clone again with core.autocrlf=false."
    }

    $nodeVersion = (& node --version).Trim()
    $pnpmVersion = (& pnpm --version).Trim()
    if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
        throw "This acceptance case requires Windows x64 (AMD64)."
    }
    if ($nodeVersion -notmatch '^v24\.') {
        throw "This acceptance case requires Node.js 24."
    }
    if ($pnpmVersion -ne "11.3.0") {
        throw "This acceptance case requires pnpm 11.3.0."
    }
    $commit = (& git rev-parse HEAD).Trim()
    $remoteLine = (& git ls-remote origin "refs/heads/$branch" | Out-String).Trim()
    if (-not $remoteLine -or ($remoteLine -split "\s+")[0] -ne $commit) {
        throw "Local HEAD is not the current remote candidate branch HEAD. Clone again before testing."
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
        commit = $commit
        caseSha256 = (Get-FileHash -Algorithm SHA256 -Path $CasePath).Hash.ToLowerInvariant()
        startedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        os = $osCaption
        architecture = $env:PROCESSOR_ARCHITECTURE
        nodeVersion = $nodeVersion
        pnpmVersion = $pnpmVersion
        buildDispatchStartedAtUtc = $null
        actionsRunId = $null
        actionsUrl = $null
        artifactName = $null
        artifactSize = $null
        artifactSha256 = $null
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
    $allowedBranches = @(Get-AllowedBranches -Cases $CaseSpec)
    if ($state.branch -notin $allowedBranches) {
        throw "The branch stored in test state does not match the test target."
    }
    Assert-CandidateState -State $state -Cases $CaseSpec -CasesPath $CasePath
    if (-not (Test-Path $automatedPath)) {
        throw "Automated results are missing. Execute -Mode Run first."
    }
    $automated = Read-JsonFile -Path $automatedPath
    Assert-ResultMatrix -Results @($automated.results) -ExpectedCases @($CaseSpec.automatedChecks) -AllowedStatuses @("pass", "fail") -Label "Automated"
    Assert-AutomatedChecksPassed -Results @($automated.results)

    if (-not ($state.PSObject.Properties.Name -contains "buildDispatchStartedAtUtc")) {
        $state | Add-Member -NotePropertyName buildDispatchStartedAtUtc -NotePropertyValue $null
    }

    $candidate = $null
    $candidateDisposition = $null
    if ($state.actionsRunId) {
        $recordedRun = Read-DevelopmentRun -Repository $CaseSpec.repository -ActionsRunId ([int64]$state.actionsRunId)
        if ($recordedRun) {
            $recordedDisposition = Get-DevelopmentRunDisposition -Run $recordedRun -Commit $state.commit
            if ($recordedDisposition -in @("wait", "success")) {
                $candidate = $recordedRun
                $candidateDisposition = $recordedDisposition
                Write-Host "Resuming recorded Development Test: $($recordedRun.url)" -ForegroundColor Cyan
            }
            else {
                Write-Warning "Recorded Development Test is stale or completed without success; a replacement may be dispatched."
            }
        }
        else {
            Write-Warning "Recorded Development Test no longer exists; a replacement may be dispatched."
        }
    }

    if (-not $candidate -and $state.buildDispatchStartedAtUtc) {
        try {
            $recoveryStarted = ConvertTo-UtcDateTime -Value $state.buildDispatchStartedAtUtc
        }
        catch {
            throw "Stored Development Test dispatch timestamp is invalid. Start a new Run from a fresh clone."
        }
        $recoveryAttempts = 1
        if (((Get-Date).ToUniversalTime() - $recoveryStarted).TotalMinutes -lt 10) {
            # A dispatch can take a few seconds to appear in `gh run list`.
            # During that propagation window, wait for the original run instead
            # of treating one empty list response as permission to dispatch again.
            $recoveryAttempts = 12
        }
        $recoveredRun = $null
        for ($recoveryAttempt = 1; $recoveryAttempt -le $recoveryAttempts -and -not $recoveredRun; $recoveryAttempt += 1) {
            if ($recoveryAttempt -gt 1) {
                Start-Sleep -Seconds 5
            }
            $recoveredRun = Find-DevelopmentRun `
                -Repository $CaseSpec.repository `
                -Workflow $CaseSpec.developmentWorkflow `
                -Branch $state.branch `
                -Commit $state.commit `
                -NotBeforeUtc $recoveryStarted
        }
        if ($recoveredRun) {
            $recoveredDisposition = Get-DevelopmentRunDisposition -Run $recoveredRun -Commit $state.commit
            if ($recoveredDisposition -in @("wait", "success")) {
                $candidate = $recoveredRun
                $candidateDisposition = $recoveredDisposition
                Write-Host "Recovered Development Test dispatched by an interrupted Build: $($recoveredRun.url)" -ForegroundColor Cyan
            }
        }
    }

    if (-not $candidate) {
        $dispatchStarted = (Get-Date).ToUniversalTime().AddMinutes(-1)
        $state.buildDispatchStartedAtUtc = $dispatchStarted.ToString("o")
        $state.actionsRunId = $null
        $state.actionsUrl = $null
        $state.artifactName = $null
        $state.artifactSize = $null
        $state.artifactSha256 = $null
        Save-State -State $state -Directory $effectiveRunDirectory
        & gh workflow run $CaseSpec.developmentWorkflow --repo $CaseSpec.repository --ref $state.branch -f run_windows=true -f run_macos_aarch64=false -f run_windows_arm64=false -f run_linux_amd64=false
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to dispatch Development Test. The dispatch marker was preserved for safe retry."
        }
        for ($selectionAttempt = 1; $selectionAttempt -le 12 -and -not $candidate; $selectionAttempt += 1) {
            Start-Sleep -Seconds 5
            $candidate = Find-DevelopmentRun `
                -Repository $CaseSpec.repository `
                -Workflow $CaseSpec.developmentWorkflow `
                -Branch $state.branch `
                -Commit $state.commit `
                -NotBeforeUtc $dispatchStarted
        }
        if (-not $candidate) {
            throw "Workflow was dispatched, but its run ID is not visible yet. Retry Build; it will recover this dispatch instead of creating another."
        }
        $candidateDisposition = Get-DevelopmentRunDisposition -Run $candidate -Commit $state.commit
    }

    $state.actionsRunId = $candidate.databaseId
    $state.actionsUrl = $candidate.url
    if ($candidateDisposition -ne "success") {
        $state.artifactName = $null
        $state.artifactSize = $null
        $state.artifactSha256 = $null
    }
    Save-State -State $state -Directory $effectiveRunDirectory
    Write-Host "Development Test: $($candidate.url)" -ForegroundColor Cyan
    if ($candidateDisposition -ne "success") {
        $candidate = Wait-DevelopmentRun -Repository $CaseSpec.repository -ActionsRunId ([int64]$candidate.databaseId) -Commit $state.commit
    }
    $artifactJson = & gh api "repos/$($CaseSpec.repository)/actions/runs/$($candidate.databaseId)/artifacts"
    if ($LASTEXITCODE -ne 0) {
        throw "Development Test passed, but artifact metadata could not be verified."
    }
    $artifactResponse = $artifactJson | ConvertFrom-Json
    $artifacts = @($artifactResponse.artifacts | Where-Object { -not $_.expired })
    if ($artifacts.Count -ne 1) {
        throw "Expected exactly one non-expired Windows x64 artifact."
    }
    $artifact = $artifacts[0]
    if (-not $artifact.name.EndsWith(".exe") -or [int64]$artifact.size_in_bytes -lt 10000000) {
        throw "Development artifact is not a plausible Windows installer."
    }
    if (-not $artifact.digest -or -not $artifact.digest.StartsWith("sha256:")) {
        throw "Development artifact is missing a GitHub SHA-256 digest."
    }
    if (-not $artifact.archive_download_url) {
        throw "Development artifact is missing its authenticated download URL."
    }
    $artifactFileName = [System.IO.Path]::GetFileName([string]$artifact.name)
    if ($artifactFileName -ne [string]$artifact.name) {
        throw "Development artifact name contains an invalid path."
    }
    $installerDirectory = Join-Path $effectiveRunDirectory "windows-installer-local-only"
    New-Item -ItemType Directory -Force -Path $installerDirectory | Out-Null
    $installerPath = Join-Path $installerDirectory $artifactFileName
    Save-GitHubArtifactFile -DownloadUrl ([string]$artifact.archive_download_url) -DestinationPath $installerPath
    $githubSha256 = $artifact.digest.Substring(7).ToLowerInvariant()
    $installerSha256 = Assert-WindowsInstallerFile -Path $installerPath -ExpectedSize ([int64]$artifact.size_in_bytes) -ExpectedSha256 $githubSha256
    $state.artifactName = [string]$artifact.name
    $state.artifactSize = [int64]$artifact.size_in_bytes
    $state.artifactSha256 = $installerSha256
    Save-State -State $state -Directory $effectiveRunDirectory
    Write-Host "Temporary Windows installer: .ai-test-results/$effectiveRunId/windows-installer-local-only" -ForegroundColor Green
    Write-Host "Before installation, confirm this is a spare, virtualized, or otherwise recoverable test environment."
    exit 0
}

if ($Mode -eq "Record") {
    if (-not $CaseId) {
        throw "Record mode requires -CaseId."
    }
    if ($Status -eq "not_run") {
        throw "Record mode requires pass, fail, or blocked. not_run is reserved for unexecuted cases."
    }
    if (-not $Summary.Trim() -or -not $Evidence.Trim()) {
        throw "Record mode requires a non-empty redacted summary and evidence note."
    }
    Assert-CandidateState -State $state -Cases $CaseSpec -CasesPath $CasePath
    if (-not $state.actionsRunId -or -not $state.actionsUrl -or -not $state.artifactSha256) {
        throw "Verified Development Test and installer evidence are required before manual recording."
    }
    Assert-SafeText -Text "$Summary`n$Evidence"
    $manual = Read-JsonFile -Path $manualPath
    Assert-ResultMatrix -Results @($manual.results) -ExpectedCases @($CaseSpec.manualChecks) -AllowedStatuses @("pass", "fail", "blocked", "not_run") -Label "Manual"
    Assert-ManualRecordOrder -Results @($manual.results) -ExpectedCases @($CaseSpec.manualChecks) -TargetId $CaseId
    $target = @($manual.results) | Where-Object { $_.id -eq $CaseId } | Select-Object -First 1
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
    Assert-CandidateState -State $state -Cases $CaseSpec -CasesPath $CasePath
    $automated = Read-JsonFile -Path $automatedPath
    $manual = Read-JsonFile -Path $manualPath
    foreach ($item in @($manual.results)) {
        if ($item.status -ne "not_run" -and (-not $item.summary.Trim() -or -not $item.evidence.Trim())) {
            throw "Completed manual result is missing its redacted summary or evidence: $($item.id)"
        }
        Assert-SafeText -Text "$($item.summary)`n$($item.evidence)"
    }

    Assert-ResultMatrix -Results @($automated.results) -ExpectedCases @($CaseSpec.automatedChecks) -AllowedStatuses @("pass", "fail") -Label "Automated"
    Assert-ResultMatrix -Results @($manual.results) -ExpectedCases @($CaseSpec.manualChecks) -AllowedStatuses @("pass", "fail", "blocked", "not_run") -Label "Manual"

    if (-not $state.actionsRunId -or -not $state.actionsUrl -or -not $state.artifactName -or -not $state.artifactSha256) {
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
        "- Installer artifact: ``$($state.artifactName)`` / $($state.artifactSize) bytes / SHA-256 ``$($state.artifactSha256)``",
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
