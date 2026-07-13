// Vite `?raw` imports used to load XML/HTML fixtures as strings in tests
// (the edge-runtime test environment has no node:fs).
declare module "*?raw" {
  const content: string;
  export default content;
}
