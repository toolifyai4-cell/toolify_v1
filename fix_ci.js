const fs = require('fs');
let content = fs.readFileSync('src/ci-mode.ts', 'utf8');
// Fix the malformed line 83
content = content.replace(
  /const lines = const lines = output\.split\(.*?\\n.*?\);/s,
  'const lines = output.split("\\n");'
);
fs.writeFileSync('src/ci-mode.ts', content);
console.log('Fixed ci-mode.ts');