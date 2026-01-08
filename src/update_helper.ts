const REPLACER_SCRIPT = `while($true){try{Remove-Item "handin.exe" -Force -EA Stop;Rename-Item "handin.exe.new" "handin.exe" -Force -EA Stop;Start-Process "handin.exe"; exit 0}catch{sleep 1}};`;

export { REPLACER_SCRIPT };
