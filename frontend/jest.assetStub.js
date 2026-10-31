// What `require('./picture.webp')` returns in the unit tests. React Native
// hands back a number that stands for the bundled image; the tests only need
// something truthy that is not the file's bytes.
module.exports = 1;
