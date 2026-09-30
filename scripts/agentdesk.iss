; Windows installer for AgentDesk (Inno Setup 6). Per-user install, no admin rights needed.
; ISCC /DAppVersion=0.2.0 /DSourceDir=release\win\AgentDesk /DOutDir=release scripts\agentdesk.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6C1C2F3E-7A4B-4B7E-9E2D-5A1D0E5C0001}
AppName=AgentDesk
AppVersion={#AppVersion}
AppPublisher=ThinhTP204
AppPublisherURL=https://github.com/ThinhTP204/claude-codex
DefaultDirName={localappdata}\Programs\AgentDesk
DefaultGroupName=AgentDesk
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename=AgentDesk-{#AppVersion}-win-x64-setup
SetupIconFile={#SourceDir}\AgentDesk.ico
UninstallDisplayIcon={app}\AgentDesk.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\AgentDesk"; Filename: "{app}\AgentDesk.exe"
Name: "{autodesktop}\AgentDesk"; Filename: "{app}\AgentDesk.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\AgentDesk.exe"; Description: "{cm:LaunchProgram,AgentDesk}"; Flags: nowait postinstall skipifsilent
