# AgentDesk shell integration for zsh (ZDOTDIR points here only for this file).
# Hand ZDOTDIR back to the user so zsh reads their own .zprofile / .zshrc / .zlogin next,
# then mark each prompt and command with OSC 633 (the same marks VS Code uses):
#   A = prompt starts · E = command line · C = command runs · D;<code> = it finished · P;Cwd= = folder
ZDOTDIR="${AGENTDESK_USER_ZDOTDIR:-$HOME}"
unset AGENTDESK_USER_ZDOTDIR
[[ -f "$ZDOTDIR/.zshenv" ]] && builtin source "$ZDOTDIR/.zshenv"

if [[ -o interactive ]]; then
  typeset -g __agentdesk_ran=0
  __agentdesk_precmd() {
    local code=$?
    (( __agentdesk_ran )) && builtin printf '\e]633;D;%s\a' "$code"
    __agentdesk_ran=0
    builtin printf '\e]633;P;Cwd=%s\a\e]633;A\a' "$PWD"
  }
  __agentdesk_preexec() {
    __agentdesk_ran=1
    builtin printf '\e]633;E;%s\a\e]633;C\a' "${1//[[:cntrl:]]/ }"
  }
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd __agentdesk_precmd
  add-zsh-hook preexec __agentdesk_preexec
fi
