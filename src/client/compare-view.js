    /* ============================== compare page ============================== */
    /* IDEA's "Compare with Branch/Tag", generalized to two arbitrary refs.
       The workbench hosts this as its last tab. It owns two ref pickers and a
       two-pane layout: a file list on the left, the shared LineDiff on the
       right. The server's refDiff is a plain two-dot tree diff, so both panes
       describe the same "base -> head" comparison. */

    function compareRefGroups(branches, current) {
      const bag = branches === null || branches === undefined ? {} : branches
      const local = Array.isArray(bag.local) ? bag.local : []
      const remote = Array.isArray(bag.remote) ? bag.remote : []
      const tags = Array.isArray(bag.tags) ? bag.tags : []
      const seen = new Set()
      const groups = [
        { id: 'local', label: 'cmp.local', items: [] },
        { id: 'remote', label: 'cmp.remote', items: [] },
        { id: 'tag', label: 'cmp.tagGroup', items: [] },
      ]
      const push = (group, name) => {
        if (typeof name !== 'string' || name === '' || seen.has(name)) return
        seen.add(name)
        groups.find((entry) => entry.id === group).items.push(name)
      }
      /* Current branch first, then the rest, so the default pair is useful. */
      if (typeof current === 'string' && current !== '') push('local', current)
      for (const entry of local) push('local', entry.name)
      for (const entry of remote) push('remote', entry.name)
      for (const entry of tags) push('tag', entry.name)
      return groups
    }

    /* A ref picker that is BOTH type-to-filter and grouped: a text field the
       user can type into, opening a panel below with the matching refs under
       their Local / Remote / Tag headings (never one flat list). A remote ref's
       short name (origin/main) is a valid git ref, so it goes straight through. */
    function RefPicker(props) {
      const t = props.t
      const groups = props.groups
      const [open, setOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [focused, setFocused] = useState(false)
      const wrapRef = useRef(null)
      useEffect(() => {
        const onDown = (event) => {
          if (wrapRef.current !== null && wrapRef.current.contains(event.target)) return
          setOpen(false)
          setFocused(false)
          setQuery('')
        }
        if (open !== true) return undefined
        const timer = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
        return () => { clearTimeout(timer); document.removeEventListener('pointerdown', onDown, true) }
      }, [open])
      const needle = query.trim().toLowerCase()
      const match = (name) => needle === '' || name.toLowerCase().indexOf(needle) >= 0
      const shown = groups.map((group) => Object.assign({}, group, { items: group.items.filter(match) })).filter((group) => group.items.length > 0)
      const pick = (name) => { props.onPick(name); setOpen(false); setFocused(false); setQuery('') }
      const display = open === true && focused === true && query !== '' ? query : props.value
      return E('span', { className: 'git4idea-cmp-picker', ref: wrapRef },
        E('input', {
          className: 'git4idea-input git4idea-cmp-picker-input', value: display, spellCheck: false,
          'aria-label': props.label, 'data-tip': props.value,
          onFocus: (event) => { setFocused(true); setOpen(true); if (typeof event.target.select === 'function') event.target.select() },
          onChange: (event) => { setQuery(event.target.value); setOpen(true) },
          onKeyDown: (event) => {
            if (event.key === 'Escape') { setOpen(false); setFocused(false); setQuery('') }
            if (event.key === 'Enter') {
              event.preventDefault()
              const first = shown.length === 0 ? null : shown[0].items[0]
              if (first !== undefined && first !== null) pick(first)
              else setOpen(false)
            }
          },
        }),
        E('span', { className: 'git4idea-cmp-picker-caret' }, E(Icon, { name: 'chevron', size: 12 })),
        open !== true ? null : E('div', { className: 'git4idea-cmp-picker-menu' },
          shown.length === 0
            ? E('div', { className: 'git4idea-cmp-picker-empty' }, t('cmp.noMatch'))
            : shown.map((group) => E('div', { key: group.id, className: 'git4idea-cmp-picker-group' },
                E('div', { className: 'git4idea-menu-header' }, t(group.label) + ' · ' + String(group.items.length)),
                group.items.map((name) => E('button', {
                  key: name, type: 'button',
                  className: 'git4idea-menu-item' + (name === props.value ? ' git4idea-menu-item-active' : ''),
                  onClick: () => pick(name),
                },
                  E('span', { className: 'git4idea-menu-label' }, name),
                  name === props.value ? E(Icon, { name: 'check', size: 12 }) : null))))))
    }

    /* One file row in the compare file list. Uses the same glyph and status
       colours as the commit file list, with a ± count tail. */
    function compareFileRow(props) {
      const file = props.file
      return E('div', {
        key: 'file:' + file.path,
        className: 'git4idea-row git4idea-row-file' + (props.selected ? ' git4idea-row-selected' : ''),
        style: { paddingLeft: (8 + props.depth * 12) + 'px' },
        'data-tip': file.path,
        tabIndex: 0,
        onClick: () => props.onSelect(props.index),
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelect(props.index) } },
      },
        FileTypeGlyph({ path: file.path }),
        E('span', { className: 'git4idea-row-label' }, baseName(file.path)),
        E('span', { className: 'git4idea-cmp-file-num' }, '+' + String(file.adds)),
        E('span', { className: 'git4idea-cmp-file-num git4idea-cmp-file-num-del' }, '\u2212' + String(file.dels)))
    }

    /* The left pane's tree, built from the SAME patch order as LineDiff so an
       index always points at the file the right pane shows. groupBy follows the
       commit page: flat, by directory (nested) or by module (first path segment
       collapsed, its whole subtree listed flat underneath). */
    function CompareFileTree(props) {
      const files = props.files
      const groupBy = props.groupBy
      const folded = props.folded
      const toggle = props.toggle
      const rows = []
      const addFile = (file, depth) => {
        const index = files.indexOf(file)
        rows.push(compareFileRow({ file: file, depth: depth, index: index, selected: index === props.active, onSelect: props.onSelect }))
      }
      if (groupBy === 'flat') {
        for (const file of files) addFile(file, 0)
        return rows
      }
      const forest = buildDirForest(files, 'cmpFiles')
      const sortByPath = (a, b) => a.path.localeCompare(b.path)
      if (groupBy === 'module') {
        for (const node of forest.roots) {
          const id = 'cmpFiles|' + node.path.join('/')
          const open = folded[id] !== true
          const flatFiles = (n) => {
            const all = n.files.slice()
            for (const child of forest.sortedChildren(n)) all.push(...flatFiles(child))
            return all
          }
          rows.push(E('button', {
            key: 'folder:' + id, type: 'button', className: 'git4idea-folder-head',
            onClick: () => toggle(id),
          },
            E('span', { className: 'git4idea-chevron' + (open ? ' git4idea-chevron-open' : '') }, E(Icon, { name: 'chevron', size: 10 })),
            E('span', { className: 'git4idea-row-icon git4idea-tone-accent' }, E(Icon, { name: 'folder', size: 14 })),
            E('span', { className: 'git4idea-folder-name' }, node.path[node.path.length - 1]),
            E('span', { className: 'git4idea-count' }, String(forest.countOf(node)))))
          if (open === true) for (const file of flatFiles(node).sort(sortByPath)) addFile(file, 1)
        }
        for (const file of forest.rootFiles.slice().sort(sortByPath)) addFile(file, 0)
        return rows
      }
      /* groupBy === 'dir': nested directory tree, subfolders before files. */
      const walk = (node, depth, parentLen) => {
        const id = 'cmpFiles|' + node.path.join('/')
        const open = folded[id] !== true
        rows.push(E('button', {
          key: 'folder:' + id, type: 'button', className: 'git4idea-folder-head',
          style: { paddingLeft: (4 + depth * 12) + 'px' },
          onClick: () => toggle(id),
        },
          E('span', { className: 'git4idea-chevron' + (open ? ' git4idea-chevron-open' : '') }, E(Icon, { name: 'chevron', size: 10 })),
          E('span', { className: 'git4idea-row-icon git4idea-tone-accent' }, E(Icon, { name: 'folder', size: 14 })),
          E('span', { className: 'git4idea-folder-name' }, node.path.slice(parentLen).join('/')),
          E('span', { className: 'git4idea-count' }, String(forest.countOf(node)))))
        if (open !== true) return
        for (const child of forest.sortedChildren(node)) walk(child, depth + 1, node.path.length)
        for (const file of node.files.slice().sort(sortByPath)) addFile(file, depth + 1)
      }
      for (const file of forest.rootFiles.slice().sort(sortByPath)) addFile(file, 0)
      for (const node of forest.roots) walk(node, 0, 0)
      return rows
    }

    function CompareView(props) {
      const t = props.t
      const request = props.request
      const base = props.base
      const groups = useMemo(() => compareRefGroups(props.branches, props.branch), [props.branches, props.branch])
      const [left, setLeft] = useState('')
      const [right, setRight] = useState('')
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [active, setActive] = useState(0)
      /* Grouping mirrors the commit page: a multi-select of dir/module. Both
         on nests module inside nothing (reads as module), neither on reads flat,
         and the default is dir. */
      const [groupModes, setGroupModes] = useState(() => new Set(['dir']))
      const toggleGroupMode = (mode) => {
        setGroupModes((previous) => {
          const next = new Set(previous)
          if (next.has(mode) === true) next.delete(mode)
          else next.add(mode)
          return next
        })
      }
      const groupBy = groupModes.has('dir') === true && groupModes.has('module') === true ? 'module'
        : groupModes.has('dir') === true ? 'dir'
          : groupModes.has('module') === true ? 'module' : 'flat'
      const [folded, setFolded] = useState({})
      const [listWidth, setListWidth] = useState(220)
      const [viewMenu, setViewMenu] = useState(null)
      const listRef = useRef(null)
      const dragRef = useRef(null)
      const toggleFold = (id) => setFolded((previous) => Object.assign({}, previous, { [id]: previous[id] !== true }))

      /* Seed the two pickers when refs first arrive or the repository changes:
         left = current branch, right = the first different ref. */
      useEffect(() => {
        const flat = groups.reduce((all, group) => all.concat(group.items), [])
        if (flat.length === 0) return
        setLeft((now) => (flat.indexOf(now) >= 0 ? now : flat[0]))
        setRight((now) => (flat.indexOf(now) >= 0 ? now : (flat.length > 1 ? flat[1] : flat[0])))
      }, [props.repoRoot, groups])

      const run = useCallback(async (a, b) => {
        if (a === '' || b === '') return
        setBusy(true)
        setError(null)
        try {
          const result = await request('refDiff', Object.assign({}, base, { base: a, head: b }))
          setData(result === undefined ? null : result)
          setActive(0)
          setFolded({})
        } catch (caught) {
          setData(null)
          setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          setBusy(false)
        }
      }, [request, base])

      const refreshKey = props.refreshKey === undefined ? null : props.refreshKey
      const lastRefresh = useRef(refreshKey)
      useEffect(() => {
        if (refreshKey === null || lastRefresh.current === refreshKey) return
        lastRefresh.current = refreshKey
        if (left !== '' && right !== '') void run(left, right)
      }, [refreshKey, left, right, run])

      const swap = () => { setLeft(right); setRight(left) }
      const files = useMemo(() => splitPatchFiles(data === null || data === undefined ? '' : data.patch), [data])

      /* Left-pane resize: a pointer-drag on the gutter sets the file list's
         pixel width, clamped so neither pane can disappear. */
      const onGutterDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return
        dragRef.current = { id: event.pointerId, x: event.clientX, width: listWidth }
        if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }
      const onGutterMove = (event) => {
        const drag = dragRef.current
        if (drag === null || drag.id !== event.pointerId) return
        const host = listRef.current
        const max = host === null || host.parentElement === null ? 640 : Math.max(120, host.parentElement.getBoundingClientRect().width - 160)
        setListWidth(Math.min(max, Math.max(140, drag.width + event.clientX - drag.x)))
      }
      const onGutterUp = () => { dragRef.current = null }

      const openViewMenu = (event) => {
        event.preventDefault()
        /* ContextMenu positions against .git4idea-root (its containing block),
           so anchor offsets must be measured in that coordinate space. */
        const host = listRef.current === null ? null : listRef.current.closest('.git4idea-root')
        const rect = host === null ? null : host.getBoundingClientRect()
        setViewMenu({
          x: event.clientX - (rect === null ? 0 : rect.left),
          y: event.clientY - (rect === null ? 0 : rect.top),
          boundsWidth: rect === null ? undefined : Math.round(rect.width),
          boundsHeight: rect === null ? undefined : Math.round(rect.height),
        })
      }
      const viewItems = [
        { header: true, label: t('changes.groupBy') },
        { id: 'dir', label: t('changes.groupDir'), active: groupModes.has('dir') === true, run: () => toggleGroupMode('dir') },
        { id: 'module', label: t('changes.groupModule'), active: groupModes.has('module') === true, run: () => toggleGroupMode('module') },
      ]
      const foldAll = () => setFolded(compareFoldAll(files, 'cmpFiles'))

      return E('div', { className: 'git4idea-cmp' },
        E('div', { className: 'git4idea-cmp-top' },
          E('div', { className: 'git4idea-cmp-top-inner' },
            E('label', { className: 'git4idea-cmp-field' },
              E('span', { className: 'git4idea-cmp-field-label' }, t('cmp.base')),
              E(RefPicker, { t: t, groups: groups, value: left, label: t('cmp.base'), onPick: setLeft })),
            E('button', {
              type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('cmp.swap'),
              disabled: left === '' || right === '', onClick: swap,
            }, E(Icon, { name: 'compare', size: 15 })),
            E('label', { className: 'git4idea-cmp-field' },
              E('span', { className: 'git4idea-cmp-field-label' }, t('cmp.head')),
              E(RefPicker, { t: t, groups: groups, value: right, label: t('cmp.head'), onPick: setRight })),
            E('button', {
              type: 'button', className: 'git4idea-btn git4idea-btn-primary',
              disabled: busy === true || left === '' || right === '' || left === right,
              onClick: () => { void run(left, right) },
            }, t('cmp.run')))),
        error === null ? null : E('div', { className: 'git4idea-cmp-error' }, error),
        E('div', { className: 'git4idea-cmp-body' },
          E('div', { className: 'git4idea-cmp-left', ref: listRef, style: { width: listWidth + 'px' } },
            E('div', { className: 'git4idea-cmp-list-head' },
              E('span', { className: 'git4idea-cmp-list-title' }, t('cmp.files') + (data === null || data === undefined ? '' : ' · ' + String(files.length))),
              E('button', {
                type: 'button', className: 'git4idea-icon-btn' + (groupModes.size > 0 ? ' git4idea-icon-btn-active' : ''),
                'data-tip': t('changes.groupBy'), 'data-action': 'cmp-view', onClick: openViewMenu,
              }, E(Icon, { name: 'eye', size: 14 })),
              E('button', {
                type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('changes.expandAll'),
                onClick: () => setFolded({}),
              }, E(Icon, { name: 'unfoldMore', size: 14 })),
              E('button', {
                type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('changes.collapseAll'),
                onClick: foldAll,
              }, E(Icon, { name: 'unfoldLess', size: 14 }))),
            E('div', { className: 'git4idea-cmp-files' },
              data === null || data === undefined
                ? E('div', { className: 'git4idea-empty' }, busy === true ? t('status.loading') : t('cmp.empty'))
                : files.length === 0
                  ? E('div', { className: 'git4idea-empty' }, t('cmp.same'))
                  : E(CompareFileTree, {
                      files: files, groupBy: groupBy, folded: folded, toggle: toggleFold,
                      active: active, onSelect: setActive,
                    }))),
          E('div', {
            className: 'git4idea-cmp-gutter', role: 'separator', 'aria-orientation': 'vertical',
            onPointerDown: onGutterDown, onPointerMove: onGutterMove, onPointerUp: onGutterUp,
            onPointerCancel: onGutterUp, onLostPointerCapture: onGutterUp,
            onDoubleClick: () => setListWidth(220),
          }),
          E('div', { className: 'git4idea-cmp-diff' },
            data === null || data === undefined || files.length === 0
              ? null
              : E(LineDiff, {
                  t: t, patch: data.patch,
                  activeIndex: active < files.length ? active : 0,
                  onActiveChange: setActive,
                }))),
        viewMenu === null ? null : E(ContextMenu, {
          anchor: { x: viewMenu.x, y: viewMenu.y },
          boundsWidth: viewMenu.boundsWidth, boundsHeight: viewMenu.boundsHeight,
          items: viewItems, onClose: () => setViewMenu(null),
        }))
    }

    /* Every foldable node id, for Collapse All — mirroring the commit page's
       commitFileFoldState so the same tree starts closed. */
    function compareFoldAll(files, key) {
      const forest = buildDirForest(files, key)
      const all = {}
      if (forest.rootFiles.length > 0) all[key + '|/'] = true
      for (const id of forest.ids) all[id] = true
      return all
    }
