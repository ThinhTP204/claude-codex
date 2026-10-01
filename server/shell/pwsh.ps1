# AgentDesk shell integration for PowerShell (Windows PowerShell 5.1 and PowerShell 7).
# Runs after the user's profile and wraps their prompt, adding OSC 633 marks like zsh/bash:
#   E;<command> + D;<exit code> for the command that just finished, P;Cwd= and A for the new prompt.
$Global:__AgentDeskLastId = -1
$Global:__AgentDeskPrompt = $function:prompt
function Global:prompt {
  $ok = $?
  $code = $Global:LASTEXITCODE
  $e = [char]27
  $b = [char]7
  $out = ''
  $h = Get-History -Count 1
  if ($h -and $h.Id -ne $Global:__AgentDeskLastId) {
    $Global:__AgentDeskLastId = $h.Id
    $c = if ($ok) { 0 } elseif ($code) { $code } else { 1 }
    $cmd = $h.CommandLine -replace '[\x00-\x1f]', ' '
    $out += "$e]633;E;$cmd$b$e]633;D;$c$b"
  }
  $out += "$e]633;P;Cwd=$($ExecutionContext.SessionState.Path.CurrentLocation.ProviderPath)$b$e]633;A$b"
  $out + (& $Global:__AgentDeskPrompt)
}
