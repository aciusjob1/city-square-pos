import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const installerDir = import.meta.dirname;
const auditDir = path.resolve(installerDir, '..');
const buildDir = path.join(installerDir, 'build');
const payloadDir = path.join(buildDir, 'payload');
const outDir = path.join(installerDir, 'out');
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

function run(exe, args, options = {}) {
  return execFileSync(exe, args, { stdio: 'inherit', ...options });
}

function robocopy(src, dest, extra = [], exclusions = []) {
  fs.mkdirSync(dest, { recursive: true });
  const args = [src, dest, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1', ...extra];
  if (exclusions.length) args.push('/XD', ...exclusions);
  try {
    execFileSync('robocopy', args, { stdio: 'inherit' });
  } catch (error) {
    if (typeof error.status === 'number' && error.status < 8) return;
    throw error;
  }
}

function step(message) {
  console.log(`\n=== ${message} ===`);
}

step('Building backend and frontend');
run('cmd.exe', ['/c', 'npm run build'], { cwd: path.join(auditDir, 'backend') });
run('cmd.exe', ['/c', 'npm run build'], { cwd: path.join(auditDir, 'frontend') });

step('Staging payload');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(payloadDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const backendStage = path.join(payloadDir, 'app', 'backend');
robocopy(path.join(auditDir, 'backend', 'dist'), path.join(backendStage, 'dist'));
robocopy(path.join(auditDir, 'backend', 'db'), path.join(backendStage, 'db'));
robocopy(path.join(auditDir, 'backend', 'node_modules'), path.join(backendStage, 'node_modules'));
fs.copyFileSync(path.join(auditDir, 'backend', 'package.json'), path.join(backendStage, 'package.json'));
fs.copyFileSync(path.join(auditDir, 'backend', 'knexfile.js'), path.join(backendStage, 'knexfile.js'));

robocopy(path.join(auditDir, 'frontend', 'dist'), path.join(payloadDir, 'app', 'frontend', 'dist'));

const nodeStage = path.join(payloadDir, 'runtime', 'node');
fs.mkdirSync(nodeStage, { recursive: true });
fs.copyFileSync('C:\\Program Files\\nodejs\\node.exe', path.join(nodeStage, 'node.exe'));

const pgsqlSource = path.join(auditDir, 'pg17', 'pgsql');
const pgsqlStage = path.join(payloadDir, 'runtime', 'pgsql');
robocopy(pgsqlSource, pgsqlStage, [], [
  path.join(pgsqlSource, 'pgAdmin 4'),
  path.join(pgsqlSource, 'doc'),
  path.join(pgsqlSource, 'include'),
  path.join(pgsqlSource, 'StackBuilder'),
]);

// PostgreSQL binaries link against the Visual C++ runtime. Machines without
// the VC++ redistributable would fail at initdb; ship the runtime app-local
// so a fresh PC needs no prerequisites.
for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
  const source = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', dll);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing ${dll} on the build machine — cannot make the installer self-contained`);
  }
  fs.copyFileSync(source, path.join(pgsqlStage, 'bin', dll));
}

step('Compiling launcher');
const launcherExe = path.join(payloadDir, 'CitySquarePOS.exe');
const iconFile = path.join(installerDir, 'assets', 'app-icon.ico');
run(csc, [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/out:' + launcherExe,
  '/win32icon:' + iconFile,
  '/r:System.Windows.Forms.dll',
  '/r:System.Drawing.dll',
  '/r:System.Management.dll',
  path.join(installerDir, 'src', 'Launcher.cs'),
]);

step('Compressing payload');
const payloadZip = path.join(buildDir, 'payload.zip');
const zipScript = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
  `if (Test-Path -LiteralPath '${payloadZip}') { Remove-Item -LiteralPath '${payloadZip}' -Force };`,
  `[System.IO.Compression.ZipFile]::CreateFromDirectory('${payloadDir}', '${payloadZip}', ` +
    `[System.IO.Compression.CompressionLevel]::Fastest, $false)`,
].join(' ');
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', zipScript]);

step('Compiling setup');
const setupExe = path.join(buildDir, 'Setup.exe');
run(csc, [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/out:' + setupExe,
  '/win32icon:' + iconFile,
  '/resource:' + path.join(installerDir, 'assets', 'app-logo.png') + ',Setup.Logo.png',
  '/r:System.Windows.Forms.dll',
  '/r:System.Drawing.dll',
  '/r:System.IO.Compression.dll',
  '/r:System.IO.Compression.FileSystem.dll',
  path.join(installerDir, 'src', 'Setup.cs'),
]);

step('Packaging installer');
const finalExe = path.join(outDir, 'CitySquarePOS-Setup.exe');
if (fs.existsSync(finalExe)) fs.rmSync(finalExe);
fs.copyFileSync(setupExe, finalExe);
fs.appendFileSync(finalExe, fs.readFileSync(payloadZip));

const desktopCandidates = [
  path.join(os.homedir(), 'OneDrive', 'Desktop'),
  path.join(os.homedir(), 'Desktop'),
];
const desktop = desktopCandidates.find((candidate) => fs.existsSync(candidate));
if (desktop) {
  const copy = path.join(desktop, 'CitySquarePOS-Setup.exe');
  fs.copyFileSync(finalExe, copy);
  console.log(`\nInstaller copied to ${copy}`);
}

const sizeMb = (fs.statSync(finalExe).size / 1048576).toFixed(1);
console.log(`\nBuilt ${finalExe} (${sizeMb} MB)`);

fs.rmSync(payloadDir, { recursive: true, force: true });
fs.rmSync(payloadZip, { force: true });
