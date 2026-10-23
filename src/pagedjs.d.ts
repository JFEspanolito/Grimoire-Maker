declare module 'pagedjs' {
  export class Previewer {
    polisher: { destroy(): void }
    preview(
      content: Node | string,
      stylesheets: Array<string | Record<string, string>>,
      renderTo: Element,
    ): Promise<unknown>
  }
}
