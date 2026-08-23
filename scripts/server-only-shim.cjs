// Stand-in for Next.js's `server-only` marker package when a verify script runs
// modules that import it under plain Node. The marker's whole job is to fail a
// CLIENT bundle; a Node script IS the server, so an empty module is the correct
// resolution rather than a workaround.
module.exports = {};
