const fs = require("fs");
const p = "C:/TOOLIFY_V1/src/components/OnboardingWizard.tsx";
let c = fs.readFileSync(p, "utf8");
const blockStart = c.indexOf("{step.name === \"model\" && (");
const blockEnd = c.indexOf("}\n    </Box>\n  );\n}", blockStart);
if (blockStart >= 0 && blockEnd >= 0) {
  c = c.substring(0, blockStart) + c.substring(blockEnd + 20);
  fs.writeFileSync(p, c);
  console.log("removed model block");
} else {
  console.log("not found");
}