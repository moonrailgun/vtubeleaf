; Only remove this installation's per-user camera registration.
!macro NSIS_HOOK_PREUNINSTALL
  SetRegView 64
  ReadRegStr $0 HKCU "Software\Classes\CLSID\{1789A10D-66F4-47AF-BEF1-872237DF2167}\InprocServer32" ""
  ${If} $0 == "$INSTDIR\camera\x64\VTubeLeafCamera.dll"
    DeleteRegKey HKCU "Software\Classes\CLSID\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\Instance\{1789A10D-66F4-47AF-BEF1-872237DF2167}"
    DeleteRegKey HKCU "Software\Classes\CLSID\{1789A10D-66F4-47AF-BEF1-872237DF2167}"
  ${EndIf}
  SetRegView 32
  ReadRegStr $0 HKCU "Software\Classes\CLSID\{1789A10D-66F4-47AF-BEF1-872237DF2167}\InprocServer32" ""
  ${If} $0 == "$INSTDIR\camera\x86\VTubeLeafCamera.dll"
    DeleteRegKey HKCU "Software\Classes\CLSID\{860BB310-5D01-11D0-BD3B-00A0C911CE86}\Instance\{1789A10D-66F4-47AF-BEF1-872237DF2167}"
    DeleteRegKey HKCU "Software\Classes\CLSID\{1789A10D-66F4-47AF-BEF1-872237DF2167}"
  ${EndIf}
  SetRegView 64
!macroend
