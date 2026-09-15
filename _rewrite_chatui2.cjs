const fs = require("fs");
const p = "C:/TOOLIFY_V1/src/components/ChatUI.tsx";
let c = fs.readFileSync(p, "utf8");
// Fix: remove orphaned </Box> before </Box> before </Box> before );
c = c.replace(/      <\/Box>\r?\n      <\/Box>\r?\n    <\/Box>\r?\n  \);/g, "      </Box>\r\n    </Box>\r\n  );");
// Also handle any remaining orphaned </Box>
c = c.replace(/      <\/Box>\r?\n      <\/Box>/g, "      </Box>");
fs.writeFileSync(p, c);
console.log("OK", c.length);