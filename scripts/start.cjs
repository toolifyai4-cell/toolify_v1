const { execSync, spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function runBuild(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: root });
}

try {
  console.log('🔨 Building webview UI...');
  runBuild('npm run build:webview');

  console.log('🔨 Building extension host...');
  runBuild(
    'esbuild src/extension.ts --bundle --platform=node --format=esm --outfile=dist/extension.js --external:vscode --external:react --external:react-reconciler --external:ink --external:react-devtools-core --external:commander --external:dotenv',
  );

  console.log('🚀 Launching VS Code...');
  // spawn without waiting — VS Code runs independently
  spawn('code', ['--extensionDevelopmentPath=.', '--reuse-window'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
  }).unref();

  console.log('✅ TOOLIFY is launching in VS Code!');
  process.exit(0);
} catch (err) {
  console.error('❌ Failed:', err.message);
  process.exit(1);
}
