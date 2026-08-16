import "@testing-library/jest-dom";

// Pure logic suites run under the `node` environment (see vitest.config.ts), so
// there is no `window` to patch. DOM shims apply only when a DOM exists.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
