const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

const oldBlock = `        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

        const googleSigninAny = GoogleSignin as any;

        if (typeof googleSigninAny.addScopes === 'function') {
          console.log('B7G_DEBUG requesting calendar scope with addScopes');
          await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
        } else {
          console.log('B7G_DEBUG requesting calendar scope with signIn');
          await GoogleSignin.signIn();
        }

        const tokens = await GoogleSignin.getTokens();`;

const newBlock = `        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

        const googleSigninAny = GoogleSignin as any;

        let currentUser: any = null;

        try {
          if (typeof googleSigninAny.getCurrentUser === 'function') {
            currentUser = await googleSigninAny.getCurrentUser();
          }
        } catch (e) {
          console.log('B7G_DEBUG getCurrentUser failed', e);
        }

        if (!currentUser) {
          try {
            console.log('B7G_DEBUG trying signInSilently');
            if (typeof googleSigninAny.signInSilently === 'function') {
              currentUser = await googleSigninAny.signInSilently();
            }
          } catch (e) {
            console.log('B7G_DEBUG signInSilently failed, opening signIn', e);
          }
        }

        if (!currentUser) {
          console.log('B7G_DEBUG opening Google signIn');
          currentUser = await GoogleSignin.signIn();
        }

        console.log('B7G_DEBUG signed in user ready', { hasUser: Boolean(currentUser) });

        if (typeof googleSigninAny.addScopes === 'function') {
          console.log('B7G_DEBUG requesting calendar scope with addScopes');
          await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
        }

        const tokens = await GoogleSignin.getTokens();`;

if (!content.includes(oldBlock)) {
  throw new Error("Could not find the old GoogleSignin token block. The file may have changed.");
}

content = content.replace(oldBlock, newBlock);

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Google Calendar sign-in-before-token fix applied.");
