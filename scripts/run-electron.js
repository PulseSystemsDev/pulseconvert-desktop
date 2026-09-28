// Launches Electron against this folder. ELECTRON_RUN_AS_NODE leaks in from some shells and
// tools (VS Code's terminal among them) and would make Electron behave like plain Node.
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = ['.', ...process.argv.slice(2)];
if (process.platform === 'linux' && process.env.PULSECONVERT_NO_SANDBOX === '1') args.push('--no-sandbox');

const child = spawn(electron, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
