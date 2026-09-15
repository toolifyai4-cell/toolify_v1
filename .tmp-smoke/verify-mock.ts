import { MockModelAdapter } from "/TOOLIFY_V1/src/models/mock.js";

const m = new MockModelAdapter([
  { text: "hello from mock", finishReason: "stop" },
]);
const r = await m.chat({
  messages: [{ role: "user", content: "hi" }],
});
console.log("MOCK-TEXT:" + r.text);
console.log("FINISH:" + r.finishReason);
console.log("INPUT_TOK:" + r.usage.inputTokens);
console.log("OUTPUT_TOK:" + r.usage.outputTokens);
