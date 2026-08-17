// Stub for the `server-only` package so pure server-side modules can be imported
// in the Node test environment. In the real app it's a build-time guard; the
// functions under test never touch a server-only runtime, only pure logic.
export {};
