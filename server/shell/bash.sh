# AgentDesk shell integration for bash, run as: bash --init-file <this> -i
# Behave like a login shell (profile files), then mark prompts and commands with OSC 633
# (A = prompt · E = command line · C = runs · D;<code> = finished · P;Cwd= = folder), like VS Code.
[ -r /etc/profile ] && . /etc/profile
if [ -r ~/.bash_profile ]; then . ~/.bash_profile
elif [ -r ~/.bash_login ]; then . ~/.bash_login
elif [ -r ~/.profile ]; then . ~/.profile
fi

__agentdesk_ran=0
__agentdesk_waiting=0
__agentdesk_precmd() {
  local code=$?
  [ "$__agentdesk_ran" = 1 ] && builtin printf '\e]633;D;%s\a' "$code"
  __agentdesk_ran=0
  builtin printf '\e]633;P;Cwd=%s\a\e]633;A\a' "$PWD"
  __agentdesk_waiting=1
}
__agentdesk_preexec() {
  # DEBUG fires for every simple command: only the first one after a prompt counts
  [ "$__agentdesk_waiting" = 1 ] || return
  [ -n "$COMP_LINE" ] && return
  case "$BASH_COMMAND" in __agentdesk_precmd*) return ;; esac
  __agentdesk_waiting=0
  __agentdesk_ran=1
  local line
  line=$(HISTTIMEFORMAT= builtin history 1 | sed 's/^ *[0-9]* *//')
  builtin printf '\e]633;E;%s\a\e]633;C\a' "${line//[[:cntrl:]]/ }"
}
PROMPT_COMMAND="__agentdesk_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
trap '__agentdesk_preexec' DEBUG
