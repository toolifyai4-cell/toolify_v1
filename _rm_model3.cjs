const fs = require("fs");
const p = "C:/TOOLIFY_V1/src/components/OnboardingWizard.tsx";
let c = fs.readFileSync(p, "utf8");
const start = c.indexOf('{step.name === "model" && (');
const end = c.indexOf("    </Box>\n  );\n}", start);
if (start >= 0 && end >= 0) {
  c = c.substring(0, start) + c.substring(end + 20);
  fs.writeFileSync(p, c);
  console.log("removed model block");
} else {
  console.log("start:", start, "end:", end);
}