const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

content = content.replace(
  "import { CalendarDays, ChevronLeft, ChevronRight, Clock, RefreshCw, ShieldCheck, User, Users, X } from 'lucide-react-native';",
  "import { CalendarDays, ChevronLeft, ChevronRight, Clock, RefreshCw, User, Users, X } from 'lucide-react-native';"
);

const oldEnv = `  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;`;

const newEnv = `  const webClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    '243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com';

  const androidClientId =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    '243255248169-ike4t51ha6o8c5rcgsp7mvke2g5t67o1.apps.googleusercontent.com';`;

if (!content.includes(oldEnv) && !content.includes("243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com")) {
  throw new Error("Could not find Calendar Google client ID block.");
}

if (content.includes(oldEnv)) {
  content = content.replace(oldEnv, newEnv);
}

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Calendar Google client ID fallback added.");
