// Register additional Prism language grammars beyond the set bundled with
// prism-react-renderer (which only has javascript/python/go/markup/json/etc).
// Importing this file is a side effect — order matters: prism-setup must run
// first so the language modules find the global Prism to extend.
import './prism-setup'

import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-markup-templating'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-bash'
