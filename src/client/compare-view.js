    /* ============================== compare page ============================== */
    /* IDEA's "Compare with Branch/Tag", generalized to two arbitrary refs.
       The workbench hosts this as its last tab. It owns two ref pickers and a
       two-pane layout: a file list on the left, the shared LineDiff on the
       right. The server's refDiff is a plain two-dot tree diff, so both panes
       describe the same "base -> head" comparison. */

    function compareRefOptions(branches, current) {
      const bag = branches === null || branches === undefined ? {} : branches
      const local = Array.isArray(bag.local) ? bag.local : []
      const tags = Array.isArray(bag.tags) ? bag.tags : []
      const out = []
      const seen = new Set()
      const push = (name, group) => {
        if (typeof name !== 'string' || name === '' || seen.has(name)) return
        seen.add(name)
        out.push({ name: name, group: group })
      }
      /* Current branch first, then the rest, so the default pair is useful. */
      if (typeof current === 'string' && current !== '') push(current, 'local')
      for (const entry of local) push(entry.name, 'local')
      for (const entry of tags) push(entry.name, 'tag')
      return out
    }

    function CompareView(props) {
      const t = props.t
      const request = props.request
      const base = props.base
      const refs = useMemo(() => compareRefOptions(props.branches, props.branch), [props.branches, props.branch])
      const [left, setLeft] = useState('')
      const [right, setRight] = useState('')
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [active, setActive] = useState(0)

      /* Seed the two pickers when refs first arrive or the repository changes:
         left = current branch, right = the first different ref. */
      useEffect(() => {
        if (refs.length === 0) return
        setLeft((now) => (refs.some((entry) => entry.name === now) ? now : (refs[0].name)))
        setRight((now) => (refs.some((entry) => entry.name === now) ? now : (refs.length > 1 ? refs[1].name : refs[0].name)))
      }, [props.repoRoot, refs])

      const run = useCallback(async (a, b) => {
        if (a === '' || b === '') return
        setBusy(true)
        setError(null)
        try {
          const result = await request('refDiff', Object.assign({}, base, { base: a, head: b }))
          setData(result === undefined ? null : result)
          setActive(0)
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

      const picker = (value, setter, label) => E('label', { className: 'git4idea-cmp-field' },
        E('span', { className: 'git4idea-cmp-field-label' }, label),
        E('select', {
          className: 'git4idea-input', value: value,
          onChange: (event) => setter(event.target.value),
        }, refs.length === 0
          ? E('option', { value: '' }, '—')
          : refs.map((entry) => E('option', { key: entry.name, value: entry.name },
            entry.group === 'tag' ? entry.name + '  (' + t('cmp.tag') + ')' : entry.name))))

      return E('div', { className: 'git4idea-cmp' },
        E('div', { className: 'git4idea-cmp-top' },
          picker(left, setLeft, t('cmp.base')),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('cmp.swap'),
            disabled: left === '' || right === '', onClick: swap,
          }, E(Icon, { name: 'compare', size: 15 })),
          picker(right, setRight, t('cmp.head')),
          E('button', {
            type: 'button', className: 'git4idea-btn git4idea-btn-primary',
            disabled: busy === true || left === '' || right === '' || left === right,
            onClick: () => { void run(left, right) },
          }, t('cmp.run'))),
        error === null ? null : E('div', { className: 'git4idea-cmp-error' }, error),
        E('div', { className: 'git4idea-cmp-body' },
          E('div', { className: 'git4idea-cmp-files' },
            data === null || data === undefined
              ? E('div', { className: 'git4idea-empty' }, busy === true ? t('status.loading') : t('cmp.empty'))
              : files.length === 0
                ? E('div', { className: 'git4idea-empty' }, t('cmp.same'))
                : files.map((file, index) => E('button', {
                    key: file.path + '#' + index,
                    type: 'button',
                    className: 'git4idea-cmp-file' + (index === active ? ' git4idea-cmp-file-active' : ''),
                    'data-tip': file.path,
                    onClick: () => setActive(index),
                  },
                    E('span', { className: 'git4idea-cmp-file-name', 'data-tip': file.path }, file.path === '' ? t('cmp.unnamed') : file.path),
                    E('span', { className: 'git4idea-cmp-file-counts' },
                      E('span', { className: 'git4idea-lf-added' }, '+' + String(file.adds)),
                      E('span', { className: 'git4idea-lf-deleted' }, '\u2212' + String(file.dels)))))),
          E('div', { className: 'git4idea-cmp-diff' },
            data === null || data === undefined || files.length === 0
              ? null
              : E(LineDiff, {
                  t: t, patch: data.patch,
                  activeIndex: active < files.length ? active : 0,
                  onActiveChange: setActive,
                }))))
    }
