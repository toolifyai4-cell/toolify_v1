import { execSync } from 'child_process';
const output = execSync('npx vitest run tests/ui-components.test.ts --reporter=verbose 2>&1', { encoding: 'utf8' });
console.log(output);