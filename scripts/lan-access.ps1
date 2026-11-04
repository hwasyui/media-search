# Membuka / menutup akses Media Search untuk perangkat lain di WiFi yang sama.
#   Buka:  klik kanan file ini > "Run with PowerShell" SEBAGAI ADMINISTRATOR, atau di PowerShell Administrator:
#            powershell -ExecutionPolicy Bypass -File scripts\lan-access.ps1
#   Tutup: powershell -ExecutionPolicy Bypass -File scripts\lan-access.ps1 -Close
# Aturan firewall hanya mengizinkan perangkat di subnet yang sama (LocalSubnet), bukan dari internet.
param([switch]$Close)

$name = 'Media Search 3062'
$port = 3062
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Harus dijalankan sebagai Administrator (klik kanan PowerShell > Run as administrator).' -ForegroundColor Red; exit 1 }

if ($Close) {
  Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  Write-Host "Aturan '$name' dihapus. Akses dari perangkat lain ditutup." -ForegroundColor Yellow
  exit 0
}

if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Public,Private -RemoteAddress LocalSubnet | Out-Null
}
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress
Write-Host "Akses dibuka untuk perangkat di WiFi yang sama." -ForegroundColor Green
Write-Host "Bagikan alamat ini:  http://${ip}:$port/portal.html" -ForegroundColor Cyan
Write-Host "Catatan: aplikasi belum punya login; siapa pun di WiFi bisa menekan tombol crawl/AI."
