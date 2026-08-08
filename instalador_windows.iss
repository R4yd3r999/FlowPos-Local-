; instalador_windows.iss
;
; Genera un instalador de Windows (FlowPos_Setup.exe) para el
; ejecutable ya compilado con PyInstaller. Requiere Inno Setup
; (gratis): https://jrsoftware.org/isinfo.php
;
; Antes de compilar este script:
;   1. Compilá primero FlowPos.exe siguiendo la sección 4 del README.
;   2. Verificá que la ruta de SourceExe abajo apunte a ese .exe.
;
; No pude correr Inno Setup desde este entorno (no tengo Windows
; disponible) -- este script sigue la documentación oficial de Inno
; Setup, pero no quedó probado end-to-end como sí el resto del
; proyecto. Si algo no compila, avisame el error exacto.

#define MyAppName "FlowPos (Local)"
#define MyAppVersion "1.0"
#define SourceExe "dist\FlowPos.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\FlowPos
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; El instalador NO borra la carpeta data/ al desinstalar -- ver [UninstallDelete] abajo.
OutputBaseFilename=FlowPos_Setup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el Escritorio"; GroupDescription: "Accesos directos:"

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "FlowPos.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\FlowPos.exe"
Name: "{group}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\FlowPos.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\FlowPos.exe"; Description: "Abrir {#MyAppName} ahora"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; A propósito NO se borra la carpeta data\ al desinstalar -- ahí vive
; la base de datos del negocio. Desinstalar el programa no debe borrar
; las ventas ni el inventario. Si de verdad querés borrar todo,
; hacelo a mano desde el Explorador de Windows.
Type: files; Name: "{app}\FlowPos.exe"
