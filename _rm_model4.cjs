const fs = require("fs");
const p = "C:/TOOLIFY_V1/src/components/OnboardingWizard.tsx";
let c = fs.readFileSync(p, "utf8");
const start = c.indexOf('{step.name === "model" && (');
if (start < 0) {
  console.log("model block not found");
  process.exit(0);
}
// Find the closing of this block: "    </Box>\n  );\n}"
const end = c.indexOf("    </Box>\n  );\n}", start);
if (end < 0) {
  console.log("end not found");
  process.exit(0);
}
c = c.substring(0, start) + c.substring(end + 20);
fs.writeFileSync(p, c);
console.log("removed model block, new length:", c.length);