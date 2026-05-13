const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

// Remove B7G debug console logs only. Keep real error logs.
content = content.replace(/^\s*console\.log\('B7G_DEBUG[^;]*;\r?\n/gm, "");
content = content.replace(/^\s*console\.log\('B7G_DEBUG[\s\S]*?\}\);\r?\n/gm, "");
content = content.replace(/^\s*console\.log\('B7G_DEBUG[\s\S]*?\);\r?\n/gm, "");

// Keep these important logs:
// console.log('calendar sync failed', e);
// console.log('native google calendar sync failed', e);

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Calendar debug logs cleaned.");
