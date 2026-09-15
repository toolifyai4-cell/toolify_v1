const fs = require("fs");
const p = "C:/TOOLIFY_V1/src/components/ChatUI.tsx";
let c = fs.readFileSync(p, "utf8");
// Remove the orphaned JSX comment line
c = c.replace(/\/\*\s*Hint line\s*\*\/\r?\n/g, "");
// Remove the orphaned </Box> at line 176
c = c.replace(/      <\/Box>\r?\n    <\/Box>\r?\n  \);/g, "      </Box>\r\n    </Box>\r\n  );");
fs.writeFileSync(p, c);
console.log("OK", c.length);