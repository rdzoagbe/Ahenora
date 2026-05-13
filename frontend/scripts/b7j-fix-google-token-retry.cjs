const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "app", "(tabs)", "calendar.tsx");
let content = fs.readFileSync(file, "utf8");

const oldBlock = `        if (typeof googleSigninAny.addScopes === 'function') {
          console.log('B7G_DEBUG requesting calendar scope with addScopes');
          await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
        }

        const tokens = await GoogleSignin.getTokens();

        console.log('B7G_DEBUG native Google tokens', {
          hasAccessToken: Boolean(tokens.accessToken),
          hasIdToken: Boolean(tokens.idToken),
        });`;

const newBlock = `        if (typeof googleSigninAny.addScopes === 'function') {
          console.log('B7G_DEBUG requesting calendar scope with addScopes');
          await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
        }

        let tokens: { accessToken?: string | null; idToken?: string | null } = {};

        try {
          tokens = await GoogleSignin.getTokens();
        } catch (tokenError: any) {
          console.log('B7G_DEBUG getTokens failed, forcing interactive signIn', tokenError);

          try {
            await GoogleSignin.signOut();
          } catch (signOutError) {
            console.log('B7G_DEBUG signOut before retry failed', signOutError);
          }

          GoogleSignin.configure({
            webClientId,
            scopes: ['profile', 'email', GOOGLE_CALENDAR_SCOPE],
            offlineAccess: false,
          });

          await GoogleSignin.signIn();

          if (typeof googleSigninAny.addScopes === 'function') {
            console.log('B7G_DEBUG requesting calendar scope after forced signIn');
            await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
          }

          tokens = await GoogleSignin.getTokens();
        }

        console.log('B7G_DEBUG native Google tokens', {
          hasAccessToken: Boolean(tokens.accessToken),
          hasIdToken: Boolean(tokens.idToken),
        });`;

if (!content.includes(oldBlock)) {
  throw new Error("Could not find token block to replace. Send current calendar.tsx around GoogleSignin.getTokens.");
}

content = content.replace(oldBlock, newBlock);

fs.writeFileSync(file, content, { encoding: "utf8" });

console.log("Google Calendar token retry fix applied.");
