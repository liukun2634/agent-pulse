param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [ValidateSet('inspect', 'focus')][string]$Action = 'inspect',
  [string]$Selection = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PulseTerminalWindow {
  private delegate bool WindowCallback(IntPtr handle, IntPtr context);
  [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr context);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  public static IntPtr[] FindWindows(int processId) {
    var handles = new List<IntPtr>();
    EnumWindows((handle, context) => {
      uint owner;
      GetWindowThreadProcessId(handle, out owner);
      if (owner == processId && IsWindowVisible(handle)) handles.Add(handle);
      return true;
    }, IntPtr.Zero);
    return handles.ToArray();
  }
}
'@
  $processes = @{}
  Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate | ForEach-Object { $processes[[int]$_.ProcessId] = $_ }
  $target = $processes[$ProcessId]
  if (-not $target) { throw 'The Claude process has exited.' }
  $processStart = $target.CreationDate.ToUniversalTime().Ticks.ToString()
  $ancestor = $target
  $hostProcess = $null
  for ($depth = 0; $depth -lt 32 -and $ancestor; $depth++) {
    if ($ancestor.Name -eq 'WindowsTerminal.exe') { $hostProcess = $ancestor; break }
    $parent = $processes[[int]$ancestor.ParentProcessId]
    if ($parent -and $parent.CreationDate -gt $ancestor.CreationDate) { break }
    $ancestor = $parent
  }
  if (-not $hostProcess) { throw 'This version supports Claude in Windows Terminal only.' }
  $hostStart = $hostProcess.CreationDate.ToUniversalTime().Ticks.ToString()
  $windows = @([PulseTerminalWindow]::FindWindows([int]$hostProcess.ProcessId) | ForEach-Object {
    [System.Windows.Automation.AutomationElement]::FromHandle($_)
  })
  $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem
  )
  $paneCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'TermControl'
  )
  $choices = @()
  foreach ($window in $windows) {
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    foreach ($tab in $tabs) {
      $choices += [pscustomobject]@{
        windowHandle = $window.Current.NativeWindowHandle.ToString()
        tabId = ($tab.GetRuntimeId() -join '.')
        label = ('Windows Terminal: ' + $tab.Current.Name).Substring(0, [Math]::Min(240, 18 + $tab.Current.Name.Length))
      }
    }
  }
  if ($Action -eq 'inspect') {
    [pscustomobject]@{ processStart = $processStart; hostStart = $hostStart; choices = @($choices) } | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  $chosen = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Selection)) | ConvertFrom-Json
  if ($chosen.processStart -ne $processStart -or $chosen.hostStart -ne $hostStart) {
    throw 'The original process changed. Select the current session again.'
  }
  $candidate = @($choices | Where-Object { $_.windowHandle -eq $chosen.windowHandle -and $_.tabId -eq $chosen.tabId })
  if ($candidate.Count -ne 1) { throw 'The selected terminal tab no longer exists.' }
  $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][long]$chosen.windowHandle)
  $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
  $tab = @($tabs | Where-Object { ($_.GetRuntimeId() -join '.') -eq $chosen.tabId })[0]
  $pattern = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
  $handle = [IntPtr][long]$chosen.windowHandle
  if ([PulseTerminalWindow]::IsIconic($handle)) { [void][PulseTerminalWindow]::ShowWindow($handle, 9) }
  [void][PulseTerminalWindow]::SetForegroundWindow($handle)
  $window.SetFocus()
  $pattern.Select()
  $panes = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $paneCondition) | Where-Object { -not $_.Current.IsOffscreen })
  if (-not $panes.Count) { throw 'Restore Windows Terminal and retry; no terminal pane is visible.' }
  if (-not $chosen.paneId -and $panes.Count -gt 1) {
    $paneChoices = @()
    $number = 0
    foreach ($pane in $panes) {
      $number++
      $paneChoices += [pscustomobject]@{
        windowHandle = $chosen.windowHandle; tabId = $chosen.tabId
        paneId = ($pane.GetRuntimeId() -join '.')
        label = "Pane $number (x=$([int]$pane.Current.BoundingRectangle.X), y=$([int]$pane.Current.BoundingRectangle.Y))"
      }
    }
    [pscustomobject]@{ processStart = $processStart; hostStart = $hostStart; choices = @($paneChoices) } | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  $pane = if ($chosen.paneId) {
    @($panes | Where-Object { ($_.GetRuntimeId() -join '.') -eq $chosen.paneId }) | Select-Object -First 1
  } else { $panes[0] }
  if (-not $pane) { throw 'The selected terminal pane no longer exists.' }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -Property CreationDate
  if (-not $current -or $current.CreationDate.ToUniversalTime().Ticks.ToString() -ne $processStart) {
    throw 'The Claude process changed before focus.'
  }
  $pane.SetFocus()
  $focused = $pane.Current.HasKeyboardFocus
  if (-not $focused) { throw 'Windows Terminal did not confirm focus on the selected pane.' }
  [pscustomobject]@{
    focused = $true
    windowFocused = ([PulseTerminalWindow]::GetForegroundWindow() -eq $handle)
    processStart = $processStart; hostStart = $hostStart
    selection = @{ windowHandle = $chosen.windowHandle; tabId = $chosen.tabId; paneId = ($pane.GetRuntimeId() -join '.') }
  } | ConvertTo-Json -Depth 5 -Compress
} catch {
  [pscustomobject]@{
    error = 'Terminal navigation could not be completed. The process or tab may have closed, or Windows accessibility access is unavailable.'
    errorType = $_.Exception.GetType().Name
    errorLine = $_.InvocationInfo.ScriptLineNumber
  } | ConvertTo-Json -Compress
  exit 1
}