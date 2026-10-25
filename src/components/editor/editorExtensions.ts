import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Markdown } from 'tiptap-markdown'
import { CharacterSheet, ReadAloud, Statblock } from './extensions/blocks'
import { GrimoireImageNode } from './extensions/imageNode'
import { TableExtensions } from './extensions/tables'
import { ContentBox } from './extensions/ContentBox'
import { BlockFormat } from './extensions/blockFormat'
import { SearchHighlight } from './extensions/searchHighlight'

/** What the page editor can read and write; the book export renders documents with the same set. */
export const EDITOR_EXTENSIONS = [
  StarterKit,
  BlockFormat,
  TextStyle,
  Color,
  FontSize,
  GrimoireImageNode,
  ContentBox,
  ...TableExtensions,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Statblock,
  ReadAloud,
  CharacterSheet,
  SearchHighlight,
  Markdown.configure({ html: true, tightLists: true, breaks: false }),
]
