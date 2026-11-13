# User-scoped Windows logon launcher, not an elevated Windows Service.
# Requires Selecta to be installed into the current Python environment.
[CmdletBinding()]
param([switch]$Uninstall)
$ErrorActionPreference = "Stop"
$TaskName = "Selecta Local Engine"
if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Selecta logon launcher removed. Data was not deleted."
    exit 0
}
$Command = Get-Command selecta -ErrorAction Stop
if (-not $Command.Source) {
    throw "Selecta entrypoint is not installed. Install Selecta in the target environment."
}
$Action = New-ScheduledTaskAction -Execute $Command.Source -Argument "engine run"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Description "User-owned loopback Selecta music engine"
Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force | Out-Null
Write-Host "Selecta user-scoped logon task installed. Start now with: selecta engine start"
Write-Host "Logon launcher only; this is not an unattended privileged Windows Service."
