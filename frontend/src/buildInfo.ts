// Stamped at export time (EXPO_PUBLIC_BUILD_TAG=... npx expo export). Web
// caching made "which build is this phone actually running?" a guessing
// game during the invite debugging — the tag makes it readable off any
// screenshot. 'dev' means a local/dev bundle.
export const BUILD_TAG = process.env.EXPO_PUBLIC_BUILD_TAG || 'dev';
