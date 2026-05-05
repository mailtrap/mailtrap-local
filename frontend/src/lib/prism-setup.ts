// Hoist Prism onto globalThis BEFORE any prismjs/components/prism-* imports
// run. Those modules self-register language grammars by mutating the global
// Prism instance, so the assignment must happen first. Imports of this file
// must precede imports of language defs (see prism-langs.ts).
import { Prism } from 'prism-react-renderer'

;(globalThis as unknown as { Prism: typeof Prism }).Prism = Prism
