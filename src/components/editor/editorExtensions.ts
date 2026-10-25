import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Markdown } from 'tiptap-markdown'
import { CharacterSheet, ReadAloud, Statblock } from './extensions/blocks'
import { GrimoireImageNode } from './extensions/imageNode'
import { TableExtensions } from './extensions/tables'
import { ContentBox } from './extensions/ContentBox'

/** What the page editor can read and write; the book export renders documents with the same set. */
export const EDITOR_EXTENSIONS = [
  StarterKit,
  GrimoireImageNode,
  ContentBox,
  ...TableExtensions,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Statblock,
  ReadAloud,
  CharacterSheet,
  Markdown.configure({ html: true, tightLists: true, breaks: false }),
]
