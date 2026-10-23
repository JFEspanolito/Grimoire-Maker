import { ReactNodeViewRenderer } from '@tiptap/react'
import { GrimoireImage } from './image'
import { ImageView } from './ImageView'

/** The editor's image node: attributes and Markdown from `GrimoireImage`, canvas rendering from `ImageView`. */
export const GrimoireImageNode = GrimoireImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})
