' Starts the Pulse Attendance server hidden (used at Windows logon).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
webDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = webDir
If Not fso.FolderExists(webDir & "\data") Then fso.CreateFolder(webDir & "\data")
sh.Run "cmd /c npx next start -H 0.0.0.0 -p 3300 >> data\server.log 2>&1", 0, False
