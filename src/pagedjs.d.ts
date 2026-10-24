declare module 'pagedjs' {
  export class Previewer {
    polisher: { styleEl?: HTMLStyleElement; destroy(): void }
    chunker: { removePages(fromIndex?: number): void }
    preview(
      content: Node | string,
      stylesheets: Array<string | Record<string, string>>,
      renderTo: Element,
    ): Promise<unknown>
  }
}
