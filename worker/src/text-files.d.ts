// build.mjs inlines .md files as text (esbuild's `text` loader).
declare module '*.md' {
  const text: string
  export default text
}
