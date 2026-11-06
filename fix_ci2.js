// Fix ci-mode.ts - replace mangled line 83
const fs = require('fs');
let content = fs.readFileSync('src/ci-mode.ts', 'utf8');
// Replace the malformed line 83
content = content.replace(
  /^   \\(\\"\\\\n\\")\\);(.*)$/m,
  '  const lines = output.split("\\\\n");'
);
fs.writeFileSync('src/ci-mode.ts', content);
console.log('Fixed');