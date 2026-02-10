; RosyidPOS Print Agent Installer Script
; Uses Inno Setup Compiler (https://jrsoftware.org/isinfo.php)
;
; To build installer:
; 1. Install Inno Setup on Windows
; 2. Open this script in Inno Setup Compiler
; 3. Build the installer
;
; Or use command line:
; iscc installer.iss

#define MyAppName "RosyidPOS Print Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "RosyidPOS"
#define MyAppURL "https://rosyidpos.com"
#define MyAppExeName "RosyidPrintAgent.exe"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=
OutputDir=installer
OutputBaseFilename=RosyidPrintAgentSetup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "firewall"; Description: "Add Windows Firewall exception"; GroupDescription: "Network Configuration:"

[Files]
Source: "dist\RosyidPrintAgent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\config\*"; DestDir: "{app}\config"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "dist\dashboard\*"; DestDir: "{app}\dashboard"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\install-service.js"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "scripts\uninstall-service.js"; DestDir: "{app}\scripts"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Open Dashboard"; Filename: "http://127.0.0.1:7331/dashboard"
Name: "{group}\{cm:ProgramOnTheWeb,{#MyAppName}}"; Filename: "{#MyAppURL}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""RosyidPOS Print Agent"" dir=in action=allow protocol=TCP localport=7331"; StatusMsg: "Adding firewall exception..."; Flags: runhidden; Tasks: firewall
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""RosyidPOS Print Agent"""; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{commonappdata}\RosyidPOS\PrintAgent\data"

[Code]
// Custom installer actions

procedure InitializeWizard();
begin
  // Initialization code
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Post-installation actions
    // Service installation would go here if needed
  end;
end;

function InitializeUninstall(): Boolean;
begin
  // Stop service before uninstall if running
  Result := True;
end;
