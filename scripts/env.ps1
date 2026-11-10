# 点源使用：Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; . .\scripts\env.ps1
# 沙箱只允许写工作区，所以 JDK / Android SDK / Gradle / npm 缓存全部放在 .toolchain 下

$root = $null
if ($PSScriptRoot) {
  $root = Split-Path -Parent $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
  $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
if (-not $root) { $root = 'G:\AI\Deepseek\app-maker' }

$env:APP_ROOT         = $root
$env:JAVA_HOME        = Join-Path $root '.toolchain\jdk21'
$env:ANDROID_HOME     = Join-Path $root '.toolchain\android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $root '.toolchain\gradle-home'
$env:GRADLE_DIST      = Join-Path $root '.toolchain\gradle-8.14.3'
$env:npm_config_cache = Join-Path $root '.toolchain\npm-cache'
$env:ANDROID_USER_HOME = Join-Path $root '.toolchain\android-user-home'
$env:JAVA_TOOL_OPTIONS = '-Djava.util.prefs.userRoot=' + $root.Replace('\', '/') + '/.toolchain/prefs'

# npm 走直连（沙箱里 curl/schannel 失败，Node 自带 TLS 正常）
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:http_proxy = ''
$env:https_proxy = ''

New-Item -ItemType Directory -Force -Path (Join-Path $root '.toolchain\npm-cache') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root '.toolchain\android-user-home') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root '.toolchain\prefs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root '.toolchain\gradle-home') | Out-Null

$env:Path = @(
  (Join-Path $env:JAVA_HOME 'bin'),
  (Join-Path $env:ANDROID_HOME 'platform-tools'),
  (Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin'),
  (Join-Path $env:GRADLE_DIST 'bin'),
  $env:Path
) -join ';'
