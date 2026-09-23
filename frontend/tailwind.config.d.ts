// tailwind.config.js is plain JS (PostCSS loads it, so it can't be TS), but
// src/theme.contrast.test.ts reads the palette straight out of it so the
// colours under test can never drift from the ones that ship. This is just
// enough of a shape for that import to typecheck.
declare const config: {
  theme?: {
    extend?: {
      colors?: Record<string, string | Record<string, string>>;
    };
  };
};
export default config;
