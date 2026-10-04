'use strict';

const { spawnSync, spawn } = require('node:child_process');

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function encodedToastCommand(title, message, iconPath) {
  // A portable Electron build has no registered Start Menu shortcut/AUMID, so
  // ToastNotificationManager can report success while Windows drops the toast.
  // NotifyIcon balloon tips are available to the standalone build as well.
  // powershell.exe is 5.1: no ternary operator, use Test-Path + if instead.
  const iconLines = iconPath && String(iconPath).trim()
    ? [
      '$notification.Icon = [System.Drawing.SystemIcons]::Information',
      `if (Test-Path -LiteralPath ${psQuote(iconPath)}) { $notification.Icon = New-Object System.Drawing.Icon(${psQuote(iconPath)}) }`,
    ]
    : ['$notification.Icon = [System.Drawing.SystemIcons]::Information'];
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$notification = New-Object System.Windows.Forms.NotifyIcon',
    ...iconLines,
    '$notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info',
    `$notification.BalloonTipTitle = ${psQuote(String(title).slice(0, 63))}`,
    `$notification.BalloonTipText = ${psQuote(String(message).slice(0, 255))}`,
    '$notification.Visible = $true',
    '$notification.ShowBalloonTip(7000)',
    'Start-Sleep -Seconds 7',
    '$notification.Visible = $false',
    '$notification.Dispose()',
  ].join('; ');
  return Buffer.from(script, 'utf16le').toString('base64');
}

function showWindowsToast(title, message, iconPath) {
  if (process.platform !== 'win32') return null;
  const encoded = encodedToastCommand(title, message, iconPath);
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    timeout: 15000,
  });
  return result.status === 0;
}

function showWindowsToastAsync(title, message, iconPath) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const encoded = encodedToastCommand(title, message, iconPath);
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => child.kill(), 15000);
    child.once('error', () => { clearTimeout(timeout); resolve(false); });
    child.once('close', (code) => { clearTimeout(timeout); resolve(code === 0); });
  });
}

module.exports = { showWindowsToast, showWindowsToastAsync, encodedToastCommand, xmlEscape, psQuote };

if (require.main === module) {
  const sent = showWindowsToast(
    process.argv[2] || 'Musician 알림 테스트',
    process.argv[3] || '빌드 완료 알림이 정상적으로 연결되었습니다.',
  );
  console.log(sent === null ? 'Windows notification is unavailable on this platform.' : sent ? 'Windows notification request sent.' : 'Windows notification failed.');
  process.exit(sent === null || sent ? 0 : 1);
}
