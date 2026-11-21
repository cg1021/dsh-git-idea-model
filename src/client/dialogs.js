    /* The chip in the New Session row's options strip, after the mode picker.
       It borrows the strip's `_heroOptions` class so the frame CSS can drop the
       host's right-justifying auto margin while the entry is mounted, and it
       matches the mode chip's own type scale (13px/500, 28px row — the specs
       the host ships for .workspace/.seat). Only action is to raise the
       centered clone card; the overlay host owns the rest. */
    function CloneOption(props) {
      return E('button', {
        type: 'button', className: 'git4idea-hero-action _heroOptions', 'data-tip': props.t('more.clone'),
        onClick: () => { cloneDialog.set({}) },
      },
        E(Icon, { name: 'plus', size: 16 }), E('span', null, props.t('more.clone')))
    }

    /* The leaf of a clone URL: the folder git will create, minus .git. Mirrors
       the host's repoNameFromUrl so the pre-filled target ends in the same name
       the clone actually lands in. scp-style, URL-style and local paths all cut
       on the last slash or colon. */
    function cloneNameFromUrl(url) {
      if (typeof url !== 'string' || url.trim() === '') return ''
      const tail = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
      const segments = tail.split(/[\\/:]/).filter((segment) => segment !== '')
      return segments.length > 0 ? segments[segments.length - 1] : ''
    }

    /* The clone target is remembered across sessions in the host settings file
       (readStored/writeStored), so the card opens on the directory the user
       last picked or cloned into instead of the home dir every time. */
    const CLONE_DIR_KEY = 'dsh-git4idea.clone-dir.v1'

    /* Frame-wide clone card, raised from the New Session workspace options.
       The two fields are the remote URL and the local directory, the same
       shape as the panel's Clone dialog (IDEA Clone repository). The target
       starts at the last used directory (or the host home dir on first use),
       refined with the URL's repo name, and can be replaced with the host's
       folder picker. Clone first, then adopt the directory as a Workspace and
       open it, so the new session points at the freshly cloned checkout. */
    function FrameCloneDialog(props) {
      const [url, setUrl] = useState('')
      const [dir, setDir] = useState('')
      const [dirTouched, setDirTouched] = useState(false)
      const [busy, setBusy] = useState(false)
      const ref = useRef(null)
      const homeRef = useRef('')
      /* The homedir default is a BASE that the URL's repo leaf extends; a
         remembered directory is an exact target. Only the former follows URL
         edits. */
      const followUrlRef = useRef(false)
      useEffect(() => { if (ref.current !== null) ref.current.focus() }, [])
      /* Seed the target: last used directory wins; otherwise ask the host for
         home and append the URL's repo leaf. A manual edit or a pick wins
         thereafter. Both defaults are replaced once the user commits a dir. */
      useEffect(() => {
        let alive = true
        const remember = readStored(CLONE_DIR_KEY)
        if (typeof remember === 'string' && remember !== '') {
          homeRef.current = remember
          followUrlRef.current = false
          setDir(remember)
          return undefined
        }
        void (async () => {
          let home = ''
          try {
            const data = await request('homedir')
            if (alive === true && data !== null && data !== undefined && typeof data.home === 'string') home = data.home
          } catch (caught) { void caught }
          if (alive !== true) return
          homeRef.current = home
          followUrlRef.current = true
          if (home !== '' && dirTouched === false) {
            const name = cloneNameFromUrl(url)
            setDir(name === '' ? home : home.replace(/[\\/]+$/, '') + (home.includes('\\') ? '\\' : '/') + name)
          }
        })()
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      const changeUrl = (value) => {
        setUrl(value)
        /* Only the homedir default follows the URL's repo name, and only until
           the user picks or edits the directory. A remembered exact target
           stays put. */
        if (dirTouched === true || followUrlRef.current !== true) return
        const home = homeRef.current
        if (home === '') return
        const name = cloneNameFromUrl(value)
        setDir(name === '' ? home : home.replace(/[\\/]+$/, '') + (home.includes('\\') ? '\\' : '/') + name)
      }
      /* The host owns the OS folder chooser. On Desktop the native bridge is
         installed directly on globalThis; elsewhere fall back to the uiWorkspace
         service (the same one the worktree dialog rides). Report a failure to
         the corner stack instead of swallowing it — a silent catch looked like
         a dead button. The text field stays the manual fallback. */
      const pickDir = async () => {
        let picked = null
        try {
          const desktop = typeof globalThis === 'undefined' ? undefined : globalThis.__DSH_DIRECTORY_PICKER__
          if (desktop !== undefined && desktop !== null && typeof desktop.pick === 'function') {
            picked = await desktop.pick()
          } else {
            let workspace = null
            try { workspace = props.ctx === undefined || props.ctx === null ? null : props.ctx.get('uiWorkspace') } catch (error) { void error }
            if (workspace === null || workspace === undefined || typeof workspace.pickDirectory !== 'function') {
              notifyFail(props.t('clone.pickUnavailable'))
              return
            }
            picked = await workspace.pickDirectory()
          }
          if (typeof picked === 'string' && picked !== '') {
            setDir(picked)
            setDirTouched(true)
            writeStored(CLONE_DIR_KEY, picked)
          }
        } catch (error) {
          notifyFail(error)
        }
      }
      const ready = url.trim() !== '' && dir.trim() !== '' && busy === false
      const submit = () => {
        if (ready !== true) return
        setBusy(true)
        void (async () => {
          try {
            const target = dir.trim()
            await request('clone', { url: url.trim(), dir: target })
            /* Remember the target on a successful clone: next time the card
               opens here instead of at home (user request). */
            writeStored(CLONE_DIR_KEY, target)
            const workspaces = props.ctx.get('workspaces')
            const uiWorkspace = props.ctx.get('uiWorkspace')
            let workspaceId = null
            if (workspaces !== undefined && workspaces !== null && typeof workspaces.create === 'function') {
              const created = await workspaces.create({ path: target })
              workspaceId = created === null || created === undefined ? null : created.workspaceId
            }
            props.onClose()
            notifyOk(props.t('toast.cloned'))
            if (workspaceId !== null && uiWorkspace !== undefined && uiWorkspace !== null && typeof uiWorkspace.openWorkspace === 'function') {
              void uiWorkspace.openWorkspace(workspaceId).catch((caught) => notifyFail(caught))
            }
          } catch (caught) {
            notifyFail(caught)
          } finally {
            setBusy(false)
          }
        })()
      }
      const onKey = (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit() }
        if (event.key === 'Escape') { event.preventDefault(); if (busy !== true) props.onClose() }
      }
      return E('div', {
        className: 'git4idea-commit-overlay git4idea-prompt-overlay',
        'data-git4idea-clone': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget && busy !== true) props.onClose() },
      },
        E('div', { className: 'git4idea-dialog git4idea-prompt-card' },
          E('div', { className: 'git4idea-dialog-title' }, props.t('clone.title')),
          E('div', { className: 'git4idea-clone-hint' }, props.t('clone.hint')),
          E('input', {
            ref: ref, className: 'git4idea-input', value: url, spellCheck: false,
            placeholder: props.t('clone.url'), onChange: (event) => changeUrl(event.target.value), onKeyDown: onKey,
          }),
          E('div', { className: 'git4idea-wt-pathrow' },
            E('input', {
              className: 'git4idea-input', value: dir, spellCheck: false,
              placeholder: props.t('clone.dir'),
              onChange: (event) => { setDir(event.target.value); setDirTouched(true) }, onKeyDown: onKey,
            }),
            E('button', {
              type: 'button', className: 'git4idea-icon-btn', 'data-tip': props.t('worktree.pickDir'),
              'data-git4idea-clone-pick': '', onClick: () => { void pickDir() },
            }, E(Icon, { name: 'folder', size: 16 }))),
          E('div', { className: 'git4idea-dialog-actions' },
            E('button', { type: 'button', className: 'git4idea-btn', onClick: props.onClose }, props.t('confirm.cancel')),
            E('button', { type: 'button', className: 'git4idea-btn git4idea-btn-primary', disabled: ready === false, onClick: submit }, props.t('clone.run')))))
    }

    function CloneDialogHost(props) {
      const [entry, setEntry] = useState(cloneDialog.entry)
      useEffect(() => {
        const sync = () => setEntry(cloneDialog.entry)
        sync()
        const off = cloneDialog.subscribe(sync)
        cloneDialog.hosted = true
        return () => { cloneDialog.hosted = false; off() }
      }, [])
      if (entry === null) return null
      return E(FrameCloneDialog, { key: 'clone', t: props.t, ctx: props.ctx, onClose: () => cloneDialog.set(null) })
    }

    function GitDialogHost(props) {
      const [entry, setEntry] = useState(commitDialog.entry)
      const [pushEntry, setPushEntry] = useState(pushDialog.entry)
      const [conflictEntry, setConflictEntry] = useState(conflictDialog.entry)
      const [overviewEntry, setOverviewEntry] = useState(conflictOverviewDialog.entry)
      useEffect(() => {
        const sync = () => setEntry(commitDialog.entry)
        const syncPush = () => setPushEntry(pushDialog.entry)
        const syncConflict = () => setConflictEntry(conflictDialog.entry)
        const syncOverview = () => setOverviewEntry(conflictOverviewDialog.entry)
        sync()
        syncPush()
        syncConflict()
        syncOverview()
        const off = commitDialog.subscribe(sync)
        const offPush = pushDialog.subscribe(syncPush)
        const offConflict = conflictDialog.subscribe(syncConflict)
        const offOverview = conflictOverviewDialog.subscribe(syncOverview)
        commitDialog.hosted = true
        pushDialog.hosted = true
        conflictDialog.hosted = true
        conflictOverviewDialog.hosted = true
        return () => {
          commitDialog.hosted = false
          pushDialog.hosted = false
          conflictDialog.hosted = false
          conflictOverviewDialog.hosted = false
          off()
          offPush()
          offConflict()
          offOverview()
        }
      }, [])
      /* A throw inside either card used to unmount the overlay slot for the rest
         of the page load — the card vanished once and never came back (m04102).
         The boundary keeps the failure local, closes the card and reports it in
         the corner toast (m04914). The old fallback bar sat at the top of the
         page, far from the click, and read as a broken page. */
      const guard = (key, onClose, child) => E(RenderBoundary, {
        key: key,
        silent: true,
        onError: () => {
          toastCenter.push({ text: props.t('toast.dialogFailed'), tone: 'error', icon: 'close' })
          onClose()
        },
      }, child)
      return E(Fragment, null,
        entry === null ? null : guard('commit|' + entry.sessionId + '|' + entry.repoRoot, () => commitDialog.set(null), E(CommitDialogBody, {
          key: entry.sessionId + '|' + entry.repoRoot,
          entry: entry,
          t: props.t,
          onClose: () => commitDialog.set(null),
        })),
        pushEntry === null ? null : guard('push|' + pushEntry.sessionId + '|' + pushEntry.repoRoot + '|' + (typeof pushEntry.branch === 'string' ? pushEntry.branch : '') + '|' + (pushEntry.force === true ? 'force' : ''), () => { pushDialog.set(null) }, E(PushDialogBody, {
          key: 'push|' + pushEntry.sessionId + '|' + pushEntry.repoRoot + '|' + (typeof pushEntry.branch === 'string' ? pushEntry.branch : '') + '|' + (pushEntry.force === true ? 'force' : ''),
          entry: pushEntry,
          t: props.t,
          ctx: props.ctx,
          onClose: () => { pushDialog.set(null) },
        })),
        overviewEntry === null ? null : guard('conflictOverview|' + overviewEntry.sessionId + '|' + overviewEntry.repoRoot, () => { conflictOverviewDialog.set(null) }, E(ConflictOverviewBody, {
          key: 'conflictOverview|' + overviewEntry.sessionId + '|' + overviewEntry.repoRoot,
          entry: overviewEntry,
          t: props.t,
          onClose: () => { conflictOverviewDialog.set(null) },
        })),
        conflictEntry === null ? null : guard('conflict|' + conflictEntry.sessionId + '|' + conflictEntry.repoRoot + '|' + conflictEntry.path, () => { conflictDialog.set(null) }, E(ConflictDialogBody, {
          key: 'conflict|' + conflictEntry.sessionId + '|' + conflictEntry.repoRoot + '|' + conflictEntry.path,
          entry: conflictEntry,
          t: props.t,
          onClose: () => { conflictDialog.set(null) },
        })),
        E(PromptDialogHost, null),
        E(ConfirmDialogHost, { t: props.t }),
        E(CloneDialogHost, { t: props.t, ctx: props.ctx }))
    }

    /* The frame-wide commit card (the composer pill's 提交 verb) wraps the same
       card the Git panel's commit tab renders inline (see Workbench): one body,
       two shells. */
    function CommitDialogBody(props) {
      return E('div', {
        className: 'git4idea-commit-overlay',
        'data-git4idea-commit-dialog': '',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      },
        E(CommitCard, { entry: props.entry, t: props.t, onClose: props.onClose }))
    }

    /* The card is the panel's commit layer, rebuilt without the panel: every
       mutation runs its own route call and reloads the summary, so the overlay
       never depends on a mounted Git tab. props.active re-reads the summary
       each time the host surface (the commit tab) becomes visible — staging
       done elsewhere must be on screen when the user arrives. */
    function CommitCard(props) {
      const t = props.t
      const entry = props.entry
      const [summary, setSummary] = useState(null)
      const [busy, setBusy] = useState(false)
      /* Grouping is a SET now (user request): 按目录 and 按模块 can be on
         together; with neither, the list falls back to the flat layout. */
      const [groupModes, setGroupModes] = useState(() => new Set(['dir']))
      const toggleGroupMode = (mode) => {
        setGroupModes((previous) => {
          const next = new Set(previous)
          if (next.has(mode) === true) next.delete(mode)
          else next.add(mode)
          return next
        })
      }
      const [foldedDirs, setFoldedDirs] = useState({})
      /* View options of the commit tab's header (user request): grouping and
         the ignored-file display. Local state — the composer pill's dialog
         never passes these props and keeps the old defaults. */
      const [showIgnored, setShowIgnored] = useState(props.showIgnored === true)
      /* The view menu (eye icon) and the fold controls (user request): one
         dropdown keeps the strip tight — grouping (flat/dir/module) and the
         ignored-file display live there as two labelled sections. */
      const [viewMenuOpen, setViewMenuOpen] = useState(false)
      const viewMenuRef = useRef(null)
      useEffect(() => {
        if (viewMenuOpen !== true) return undefined
        const onDown = (event) => {
          const host = viewMenuRef.current
          if (host !== null && host.contains(event.target) === true) return
          setViewMenuOpen(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setViewMenuOpen(false) }
        const timer = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0)
        document.addEventListener('keydown', onKey)
        return () => {
          clearTimeout(timer)
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [viewMenuOpen])
      /* 展开全部 / 收起全部 (user request): the same fold ids the directory
         forest builds (see buildDirForest.ids) — 写一个 state flip。 */
      const setAllFolders = (open) => {
        setFoldedDirs(() => {
          if (open === true) return {}
          const next = {}
          /* The ids are rebuilt from the CURRENT summary; an empty summary
             folds nothing. */
          const changes = summary === null ? null : summary.changes
          if (changes === null) return next
          for (const pair of [['conflicted', changes.conflicted], ['staged', changes.staged], ['unstaged', changes.unstaged], ['untracked', changes.untracked], ['ignored', changes.ignored === undefined ? [] : changes.ignored]]) {
            const forest = buildDirForest(pair[1], pair[0])
            for (const id of forest.ids) next[id] = true
          }
          return next
        })
      }
      const [rowMenu, setRowMenu] = useState(null)
      const [discardAsk, setDiscardAsk] = useState(null)
      const anchorRef = useRef(null)
      /* m05307: the row click selects (and previews in the right pane); the
         checkbox still decides what the commit carries. */
      const [selection, setSelection] = useState(() => new Set())
      const [picked, setPicked] = useState(null)
      /* Draggable 40/60 split (user request): the left pane's width as a ratio
         of the card, remembered with the other panel settings. */
      const COMMIT_SPLIT_KEY = 'dsh-git4idea.commit-split.v1'
      const COMMIT_SPLIT_DEFAULT = 0.4
      const readSplitRatio = () => {
        const raw = readStored(COMMIT_SPLIT_KEY)
        const value = raw === null ? Number.NaN : Number.parseFloat(raw)
        return Number.isFinite(value) && value >= 0.2 && value <= 0.8 ? value : COMMIT_SPLIT_DEFAULT
      }
      const [splitRatio, setSplitRatio] = useState(readSplitRatio)
      const splitRef = useRef(splitRatio)
      splitRef.current = splitRatio
      /* The container is captured ONCE at drag start: the document-level
         pointermove listener has `document` as currentTarget, so resolving
         the card there can never work. */
      const splitBoxRef = useRef(null)
      const onSplitPointer = (event) => {
        const card = splitBoxRef.current
        if (card === null) return
        const rect = card.getBoundingClientRect()
        if (!(rect.width > 0)) return
        const px = event.clientX - rect.left
        const next = Math.min(0.8, Math.max(0.2, px / rect.width))
        setSplitRatio(next)
      }
      const endSplitPointer = () => {
        writeStored(COMMIT_SPLIT_KEY, String(splitRef.current))
        document.removeEventListener('pointermove', onSplitPointer)
        document.removeEventListener('pointerup', endSplitPointer)
        setSplitDragging(false)
      }
      const [splitDragging, setSplitDragging] = useState(false)
      const startSplitDrag = (event) => {
        event.preventDefault()
        splitBoxRef.current = event.currentTarget.closest('.git4idea-commit-layer-body')
        onSplitPointer(event)
        setSplitDragging(true)
        document.addEventListener('pointermove', onSplitPointer)
        document.addEventListener('pointerup', endSplitPointer)
      }
      useEffect(() => () => {
        document.removeEventListener('pointermove', onSplitPointer)
        document.removeEventListener('pointerup', endSplitPointer)
      }, [])
      const base = { cwd: entry.cwd, repoRoot: entry.repoRoot }
      const messageOf = (caught) => (caught !== null && caught !== undefined && typeof caught.message === 'string' && caught.message !== ''
        ? caught.message
        : String(caught))
      const loadSummary = async () => {
        try {
          const data = await request('summary', Object.assign({}, base, { ignored: showIgnored === true, stats: true }))
          setSummary(data)
          return data
        } catch (caught) {
          notifyFail(caught)
          return null
        }
      }
      useEffect(() => { void loadSummary() }, [showIgnored])
      /* The commit tab mounts this card once and shows it per tab; re-reading
         on every activation keeps the list honest about staging done elsewhere. */
      useEffect(() => { if (props.active === true) void loadSummary() }, [props.active])
      /* One mutation at a time: staging, discarding and committing all reload
         the same summary, so overlapping calls would race their results. */
      const call = async (method, payload, options) => {
        setBusy(true)
        try {
          const result = await request(method, Object.assign({}, base, payload))
          await loadSummary()
          if (options === undefined || options.silent !== true) notifyOk(successToastText(t, method, payload))
          return result
        } catch (caught) {
          notifyFail(caught)
          return undefined
        } finally {
          setBusy(false)
        }
      }
      /* m04916: the menu entry and the double click open the file card above
         this dialog. m05307: a plain row click previews the patch in this
         card's right pane, split 40/60 with the change list. */
      const openDiff = (item, group) => {
        fileDialog.set({
          path: item.path,
          staged: group === 'staged',
          untracked: group === 'untracked' ? true : undefined,
          cwd: entry.cwd,
          repoRoot: entry.repoRoot,
          sessionId: entry.sessionId,
        })
      }
      /* A landed commit closes the card and tells every branch readout to
         refresh; a rejected one reports in the bottom-right stack.
         ChangesPanel has already cleared its draft by the time this returns.
         m02986: the push is a second, explicit step — hand over to the push
         dialog only after the commit route reports success. The commit tab
         mounts this card without a shell (no onClose prop): there the card
         stays open and the branch notification below reloads its list. */
      const commit = (message, amend, push, paths) => {
        void (async () => {
          setBusy(true)
          try {
            await request('commit', Object.assign({}, base, {
              message: message,
              amend: amend === true,
              paths: paths,
            }))
            try { notifyBranchSwitched(entry.sessionId, entry.repoRoot) } catch (caught) { void caught }
            toastCenter.push({ text: t('toast.committed'), tone: 'ok', icon: 'check' })
            if (push === true) pushDialog.set({ cwd: entry.cwd, repoRoot: entry.repoRoot, sessionId: entry.sessionId })
            if (props.onClose !== undefined) props.onClose()
          } catch (caught) {
            notifyFail(caught)
            setBusy(false)
          }
        })()
      }
      /* The commit tab's card has no dialog shell, so nothing closed over it.
         The same watcher that follows a branch switch reloads the summary: the
         push dialog opened from 提交并推送 reports its landing through it, and
         this page refreshes the moment that card closes (user request). */
      useEffect(() => {
        const onChanged = () => { void loadSummary() }
        composerBranchWatchers.add(onChanged)
        return () => { composerBranchWatchers.delete(onChanged) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [entry.cwd, entry.repoRoot])
      /* No Escape handler: the card is frame-anchored only through the dialog
         shell; the commit tab keeps it mounted and must not be closed by a key. */
      const stagedPaths = () => (summary === null ? [] : summary.changes.staged.map((item) => item.path))
      const ignoreAdd = (item, local) => {
        /* A directory row keeps its trailing slash: git ignores the whole
           folder, not just the name. The summary marks directories. */
        const pattern = item.dir === true && item.path.slice(-1) !== '/' ? item.path + '/' : item.path
        void (async () => {
          const result = await call('ignoreAdd', { paths: [pattern], local: local === true }, { silent: true })
          if (result === undefined) return
          toastCenter.push({
            text: fill(t(local === true ? 'toast.ignoreAddedLocal' : 'toast.ignoreAdded'), { path: pattern, file: local === true ? '.git/info/exclude' : '.gitignore' }),
            tone: 'ok', icon: 'check',
          })
        })()
      }
      const ignoreEntriesOf = (item) => ([
        { id: 'ignore-file', label: fill(t('menu.ignoreIn'), { file: '.gitignore' }), run: () => { setRowMenu(null); ignoreAdd(item, false) } },
        { id: 'ignore-local', label: fill(t('menu.ignoreIn'), { file: '.git/info/exclude' }), run: () => { setRowMenu(null); ignoreAdd(item, true) } },
      ])
      /* Directory rows (user request): ignore verbs for untracked folders,
         stage for tracked ones, copy for both. Same card-relative offsets as
         the row menu above. */
      const folderMenu = (event, dirPath, group) => {
        const dirItem = { path: dirPath, dir: true }
        const host = event.currentTarget instanceof Element ? event.currentTarget.closest('.git4idea-commit-layer-card') : null
        const rect = host === null ? null : host.getBoundingClientRect()
        setRowMenu({
          item: dirItem, group: group, folderOnly: true,
          x: event.clientX - (rect === null ? 0 : rect.left),
          y: event.clientY - (rect === null ? 0 : rect.top),
          boundsWidth: rect === null ? undefined : Math.round(rect.width),
          boundsHeight: rect === null ? undefined : Math.round(rect.height),
        })
      }
      const rowMenuItems = rowMenu === null ? [] : (
        rowMenu.folderOnly === true ? [
          rowMenu.group === 'untracked'
            ? { id: 'ignore', icon: 'filter', label: t('menu.ignoreTitle'), items: ignoreEntriesOf(rowMenu.item) }
            : { id: 'stage', icon: 'plus', label: t('action.stage'), run: () => { void call('stage', { paths: [rowMenu.item.path] }) } },
          null,
          { id: 'copy', icon: 'tag', label: t('action.copyPath'), run: () => { copyText(rowMenu.item.path) } },
        ] : [
          rowMenu.group === 'staged'
            ? { id: 'unstage', icon: 'minus', label: t('action.unstage'), run: () => { void call('unstage', { paths: [rowMenu.item.path] }) } }
            : { id: 'stage', icon: 'plus', label: t('action.stage'), run: () => { void call('stage', { paths: [rowMenu.item.path] }) } },
          { id: 'diff', icon: 'diff', label: t('action.showDiff'), run: () => { void openDiff(rowMenu.item, rowMenu.group) } },
          rowMenu.group === 'untracked' ? { id: 'ignore', icon: 'filter', label: t('menu.ignoreTitle'), items: ignoreEntriesOf(rowMenu.item) } : null,
          {
            id: 'discard', icon: 'undo', danger: true, label: t('action.discard'),
            run: () => setDiscardAsk({ item: rowMenu.item, group: rowMenu.group }),
          },
        ])
      const viewMenuItems = [
        /* 分组 (grouping): multi-select — both on nests module INSIDE nothing,
           both off reads flat. */
        { header: true, label: t('changes.groupBy') },
        { id: 'view-dir', label: t('changes.groupDir'), active: groupModes.has('dir') === true, run: () => toggleGroupMode('dir') },
        { id: 'view-module', label: t('changes.groupModule'), active: groupModes.has('module') === true, run: () => toggleGroupMode('module') },
        null,
        /* 显示 (display): what the list may include. */
        { header: true, label: t('commit.viewDisplay') },
        { id: 'view-ignored', label: t('changes.showIgnored'), active: showIgnored === true, run: () => setShowIgnored(showIgnored !== true) },
      ]
      return E(Fragment, null,
        E('div', { className: 'git4idea-commit-layer-head' },
          E(Icon, { name: 'commit', size: 13 }),
          E('span', { className: 'git4idea-commit-layer-title' }, t('changes.title')),
          /* The eye (view options) menu (user request): grouping + display as
             two labelled sections in one dropdown, anchored under the button. */
          E('span', { className: 'git4idea-commit-view-wrap', ref: viewMenuRef },
            E('button', {
              type: 'button', className: 'git4idea-icon-btn'
                + (groupModes.size > 0 || showIgnored === true ? ' git4idea-icon-btn-active' : ''),
              'data-action': 'commit-view',
              'data-tip': t('commit.viewOptions'),
              'aria-expanded': viewMenuOpen === true ? 'true' : 'false',
              onClick: () => setViewMenuOpen(viewMenuOpen !== true),
            }, E(Icon, { name: 'eye', size: 14 })),
            viewMenuOpen !== true ? null : E('div', { className: 'git4idea-menu git4idea-menu-sub git4idea-commit-view-menu', 'data-menu-material': 'translucent' },
              E('div', { className: 'git4idea-menu-scroll' },
                viewMenuItems.map((item, index) => item === null
                  ? E('div', { key: 'sep-' + index, className: 'git4idea-menu-sep' })
                  : item.header === true
                    ? E('div', { key: 'head-' + index, className: 'git4idea-menu-header' }, item.label)
                    : E('button', {
                        key: item.id,
                        type: 'button',
                        className: 'git4idea-menu-item' + (item.active === true ? ' git4idea-menu-item-active' : ''),
                        onClick: () => { item.run(); },
                      },
                        E('span', { className: 'git4idea-menu-label' }, item.label),
                        item.active === true ? E(Icon, { name: 'check', size: 12 }) : null))))),
          /* 展开全部 / 收起全部 (user request): IntelliJ's ExpandAll/CollapseAll
             chevron pair — pointing away spreads the tree, pointing in folds it. */
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'data-action': 'commit-expand',
            'data-tip': t('changes.expandAll'),
            onClick: () => setAllFolders(true),
          }, E(Icon, { name: 'unfoldMore', size: 14 })),
          E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'data-action': 'commit-collapse',
            'data-tip': t('changes.foldAll'),
            onClick: () => setAllFolders(false),
          }, E(Icon, { name: 'unfoldLess', size: 14 })),
          E('span', { className: 'git4idea-topbar-spacer' }),
          props.onClose === undefined ? null : E('button', {
            type: 'button', className: 'git4idea-icon-btn', 'data-tip': t('confirm.cancel'),
            onClick: () => props.onClose(),
          }, E(Icon, { name: 'close', size: 12 }))),
        E('div', { className: 'git4idea-commit-layer-body' + (splitDragging === true ? ' git4idea-commit-splitting' : '') },
            E('div', { className: 'git4idea-commit-layer-left', style: { flex: '0 0 ' + (splitRatio * 100) + '%' } },
              E(ChangesPanel, {
                t: t, summary: summary, busy: busy, compact: false, hideHeader: true,
                groupBy: groupModes.has('dir') === true && groupModes.has('module') === true ? 'module'
                  : groupModes.has('dir') === true ? 'dir'
                    : groupModes.has('module') === true ? 'module' : 'flat',
                sortKey: 'git',
                foldedDirs: foldedDirs, onFoldedDirs: setFoldedDirs,
                request: request, cwd: entry.cwd, sessionId: entry.sessionId,
                base: base,
                onCommit: commit,
                onStage: (item) => { void call('stage', { paths: [item.path] }) },
                onUnstage: (item) => { void call('unstage', { paths: [item.path] }) },
                onStageAll: (entries) => { void call('stage', { paths: entries.map((item) => item.path) }) },
                onUnstageAll: () => { void call('unstage', { paths: stagedPaths() }) },
                onDiscard: (item, group) => setDiscardAsk({ item: item, group: group }),
                onDiff: (item, group) => { openDiff(item, group) },
                showIgnored: showIgnored,
                onChangeMenu: (event, item, group) => {
                  /* The card is the menu's containing block (see the CSS): store
                     card-relative offsets, the way the panel does for .git4idea-root. */
                  const host = event.currentTarget instanceof Element ? event.currentTarget.closest('.git4idea-commit-layer-card') : null
                  const rect = host === null ? null : host.getBoundingClientRect()
                  setRowMenu({
                    item: item, group: group,
                    x: event.clientX - (rect === null ? 0 : rect.left),
                    y: event.clientY - (rect === null ? 0 : rect.top),
                    boundsWidth: rect === null ? undefined : Math.round(rect.width),
                    boundsHeight: rect === null ? undefined : Math.round(rect.height),
                  })
                },
                onFolderMenu: folderMenu,
                /* The checkbox is the commit pick; the row click only
                   selects, and feeds the right-hand preview (m05307). */
                selection: selection,
                onSelectionChange: setSelection,
                onSelect: (item, group) => setPicked({ item: item, group: group }),
                anchorRef: anchorRef,
              })),
            E('div', {
              className: 'git4idea-commit-split',
              role: 'separator',
              'aria-orientation': 'vertical',
              onPointerDown: startSplitDrag,
              onDoubleClick: () => { setSplitRatio(COMMIT_SPLIT_DEFAULT); writeStored(COMMIT_SPLIT_KEY, String(COMMIT_SPLIT_DEFAULT)) },
            }),
            E('div', { className: 'git4idea-commit-layer-right' },
              picked === null
                ? E('div', { className: 'git4idea-preview-root' },
                    E('div', { className: 'git4idea-preview-body' },
                      E('div', { className: 'git4idea-empty' }, t('changes.diffHint'))))
                : E(DiffPreview, {
                    key: picked.group + ':' + picked.item.path,
                    seed: {
                      path: picked.item.path,
                      staged: picked.group === 'staged',
                      untracked: picked.group === 'untracked' ? true : undefined,
                      cwd: entry.cwd,
                      repoRoot: entry.repoRoot,
                      sessionId: entry.sessionId,
                    },
                    t: t,
                    mergeHead: true,
                  }))),
        discardAsk === null ? null : E(ConfirmDialog, {
          key: 'discard',
          t: t,
          title: t('confirm.title'),
          text: discardAsk.group === 'untracked'
            ? fill(t('discard.untracked.confirm'), { path: discardAsk.item.path })
            : fill(t('discard.confirm'), { path: discardAsk.item.path }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          onCancel: () => setDiscardAsk(null),
          onConfirm: () => {
            const item = discardAsk.item
            const group = discardAsk.group
            setDiscardAsk(null)
            void call('discard', { paths: [item.path], confirm: true, untracked: group === 'untracked' })
          },
        }),
        rowMenu === null ? null : E(ContextMenu, {
          key: 'row-menu',
          anchor: { x: rowMenu.x, y: rowMenu.y },
          /* The menu is absolute inside the card, so the clamp runs against the
             card's own box, not the window. */
          boundsWidth: typeof window === 'undefined' ? 0 : (rowMenu.boundsWidth === undefined ? window.innerWidth : rowMenu.boundsWidth),
          boundsHeight: typeof window === 'undefined' ? 0 : (rowMenu.boundsHeight === undefined ? window.innerHeight : rowMenu.boundsHeight),
          items: rowMenuItems,
          onClose: () => setRowMenu(null),
        }))
    }

    function ComposerGitStatus(props) {
      const ctx = props.ctx
      const t = props.t
      const sessionId = typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : 'default'
      const [enabled] = useState(() => composerStatusEnabled())
      const [cwd, setCwd] = useState(() => sessionCwdOf(ctx, sessionId))
      /* Warm first paint: a workspace the panel, the pill or the prewarmer
         has already visited starts from the keep-warm cache, so a session
         switch swaps text instead of flashing through an empty pill. */
      const [repoState, setRepoState] = useState(() => {
        const cwd0 = sessionCwdOf(ctx, sessionId)
        if (cwd0 === undefined) return null
        const cached = readPaintRepos(cwd0)
        return cached === undefined ? null : cached
      })
      const [repoRoot, setRepoRoot] = useState(() => {
        const cwd0 = sessionCwdOf(ctx, sessionId)
        if (cwd0 === undefined) return null
        const cached = readPaintRepos(cwd0)
        return cached === undefined ? null : composerPickRepoOf(sessionId, cached)
      })
      const [summary, setSummary] = useState(null)
      const [menu, setMenu] = useState(null)
      const [branchList, setBranchList] = useState(null)
      const [branchLoading, setBranchLoading] = useState(false)
      const [checkingOut, setCheckingOut] = useState('')
      const [tick, setTick] = useState(0)
      /* Branch popover (m01216 #10): a searchable local/remote/tag tree, the
         fetch button beside the search box, and commit/push/new-branch at the
         bottom. Everything here runs on this pill's own API calls — it lives in
         the host composer and cannot reach the panel. */
      const [branchFilter, setBranchFilter] = useState('')
      /* Folded folders of the popover tree, keyed by slash path. Absent means
         open — the tree starts expanded like the IDE's branch chooser. */
      const [csFolded, setCsFolded] = useState({})
      /* Secondary menu for a row (m01737 #5): a click SELECTS, it never checks
         out. { entry, kind, x, y } — offsets inside the popover root. */
      const [csMenu, setCsMenu] = useState(null)
      const [csBusy, setCsBusy] = useState('')
      /* The branch chooser's delete verb uses the same confirm card as the
         panel: a local branch offers force delete, a remote one names the
         remote it pushes the deletion to. */
      const rootRef = useRef(null)
      /* Measured to place the row flyout: the popover's right edge decides
         whether it opens to the right or flips to the left of the popover. */
      const popRef = useRef(null)
      /* Read by the fast `head` probe: it compares against the summary the
         pill currently shows, not a private baseline, so the first probe after
         a mount can already spot a checkout made while the page was closed. */
      const summaryRef = useRef(null)
      summaryRef.current = summary

      /* cwd follows the session list, exactly like ConversationPanel. */
      useEffect(() => {
        let alive = true
        const sync = () => { if (alive === true) setCwd(sessionCwdOf(ctx, sessionId)) }
        sync()
        let unsubscribe
        try {
          const sessions = ctx.get('sessions')
          const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
          if (list !== undefined && list !== null && typeof list.subscribe === 'function') unsubscribe = list.subscribe(sync)
        } catch (error) { void error }
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') { try { unsubscribe() } catch (error) { void error } }
        }
      }, [ctx, sessionId])

      /* Discovery per workspace; the pick order matches the panel's (remembered
         repo → workspace root when it is a repository → first row). */
      useEffect(() => {
        if (cwd === undefined || enabled !== true) { setRepoState(null); setRepoRoot(null); setSummary(null); return undefined }
        let cancelled = false
        const applyRepos = (data) => {
          setRepoState(data)
          setRepoRoot(composerPickRepoOf(sessionId, data))
        }
        /* Warm seed first: a workspace the panel, the pill or the prewarmer
           already visited paints its labels this tick; the request below
           silently re-proves them. A failed refresh must not evict a good
           seed — only fall back to the empty state when nothing is on
           screen. */
        const seeded = readPaintRepos(cwd)
        if (seeded !== undefined) applyRepos(seeded)
        void (async () => {
          try {
            const data = await request('repos', { cwd: cwd })
            if (cancelled === true) return
            writePaintRepos(cwd, data)
            applyRepos(data)
          } catch (error) { void error; if (cancelled !== true && seeded === undefined) setRepoState({ repos: [], isRepo: false }) }
        })()
        return () => { cancelled = true }
      }, [cwd, sessionId, enabled])

      /* Summary on a slow poll: the branch name only. The panel keeps its own
         12s poll for its bigger surface; 30s here is only the ambient state,
         never a correctness dependency. */
      useEffect(() => {
        if (repoRoot === null || enabled !== true) { setSummary(null); return undefined }
        let cancelled = false
        const load = async () => {
          try {
            const data = await request('summary', { cwd: cwd, repoRoot: repoRoot, stats: false })
            if (cancelled === true) return
            setSummary(data)
            /* Stale-while-revalidate both ways: our poll keeps the warm page
               (panel / prewarm / seed) fresh, and a warm page seeds the NEXT
               mount with zero round trips. Merge only our field — a panel
               page keeps its commits. */
            mergePaintPage(repoRoot, { summary: data })
          } catch (error) { void error }
        }
        const seed = readPaintPage(repoRoot)
        if (seed !== undefined && seed.summary !== undefined && seed.summary !== null) setSummary(seed.summary)
        void load()
        const timer = setInterval(() => { void load() }, COMPOSER_POLL_MS)
        return () => { cancelled = true; clearInterval(timer) }
      }, [cwd, repoRoot, enabled, tick])

      /* A checkout made in a terminal or an IDE fires no watcher (m02856), and
         the summary poll is 30s by design. Probe branch + HEAD every couple of
         seconds and reload the summary only on a real move; waking on tab focus
         covers the moment the user is about to look at the pill. */
      useEffect(() => {
        if (repoRoot === null || enabled !== true) return undefined
        let cancelled = false
        const probe = async () => {
          /* A hidden tab needs no updates; the wake listeners above probe the
             moment it becomes visible again. */
          if (document.visibilityState === 'hidden') return
          try {
            const state = await request('head', { cwd: cwd, repoRoot: repoRoot })
            if (cancelled === true) return
            const current = summaryRef.current
            if (current === null) return
            const sig = String(state.head) + '|' + String(state.branch)
            const shown = String(current.head === undefined ? '' : current.head) + '|' + String(current.branch === undefined ? '' : current.branch)
            if (sig === shown) return
            setTick((value) => value + 1)
            /* The popover marks HEAD on one row; while it is open, keep that
               marker true too — a summary tick does not reload the tree. */
            if (menu === 'branch') void loadBranches()
          } catch (error) { void error }
        }
        const timer = setInterval(() => { void probe() }, COMPOSER_HEAD_POLL_MS)
        const wake = () => { if (document.visibilityState !== 'hidden') void probe() }
        document.addEventListener('visibilitychange', wake)
        window.addEventListener('focus', wake)
        void probe()
        return () => {
          cancelled = true
          clearInterval(timer)
          document.removeEventListener('visibilitychange', wake)
          window.removeEventListener('focus', wake)
        }
      }, [cwd, repoRoot, enabled, menu])

      /* The panel picking a repo (or this pill picking one in another seat)
         lands here: follow it so both seats always show the same repository. */
      useEffect(() => {
        const watcher = (sid, root) => {
          if (sid !== sessionId || typeof root !== 'string' || root === '') return
          setRepoRoot((current) => (current === root ? current : root))
          setSummary(seedSummaryOf(root))
          setBranchList(null)
          setTick((value) => value + 1)
        }
        composerRepoWatchers.add(watcher)
        return () => { composerRepoWatchers.delete(watcher) }
      }, [sessionId])

      /* A branch switched in the panel (or here) refreshes the summary now
         instead of at the next poll tick. */
      useEffect(() => {
        const watcher = () => { setTick((value) => value + 1) }
        composerBranchWatchers.add(watcher)
        return () => { composerBranchWatchers.delete(watcher) }
      }, [sessionId])

      /* Click-away closes the dropdown; nothing here is anchored to a panel
         (.git4idea-root) — the pill lives in the host's composer DOM, so the menu
         is positioned inside this relative root. */
      useEffect(() => {
        if (menu === null) return undefined
        const close = (event) => {
          const el = rootRef.current
          if (el !== null && el !== undefined && event.target !== null && event.target !== undefined
            && typeof Node === 'function' && event.target instanceof Node === true && el.contains(event.target) === true) return
          setMenu(null)
        }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [menu])

      /* A merge in progress owns the pill (m00602): the branch it is on matters
         less than the operation that blocks the tree, and the two buttons beside
         it are the only two verbs that operation accepts right now. */
      const operation = summary === null || summary.operation === undefined ? null : summary.operation
      const operationSource = summary === null || summary.operationSource === undefined ? null : summary.operationSource
      const operationPillKey = operation === 'cherry-pick' ? 'operation.pillCherryPick'
        : operation === 'rebase' ? 'operation.pillRebase'
          : operation === 'revert' ? 'operation.pillRevert'
            : operation === 'bisect' ? 'operation.pillBisect'
              : 'operation.pillMerge'
      /* The pill names the merge as source -> target, so the branch the tree
         sits on stays readable while the operation blocks it. */
      const operationBranch = summary !== null && typeof summary.branch === 'string' ? summary.branch : ''
      const operationName = operation === 'merge' && operationSource !== null && operationBranch !== ''
        ? operationSource + ' → ' + operationBranch
        : (operation === 'merge' && operationSource !== null ? operationSource : operationBranch)
      const operationText = operation === null ? ''
        : operationName === '' ? t('operation.' + operation) : fill(t(operationPillKey), { name: operationName })
      const openConflictOverview = () => {
        if (repoRoot === null) { openPanelSeat(); return }
        if (conflictOverviewDialog.hosted === true) {
          conflictOverviewDialog.set({ cwd: cwd, repoRoot: repoRoot, sessionId: sessionId })
          setMenu(null)
          return
        }
        openPanelSeat()
      }
      const abortOperation = async () => {
        if (repoRoot === null || operation === null || csBusy !== '') return
        setCsBusy('operationFinish')
        try {
          await request('operationFinish', { cwd: cwd, repoRoot: repoRoot, operation: operation, action: 'abort' })
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
          notifyOk(t('toast.operationAborted'))
        } catch (caught) {
          notifyFail(caught)
        } finally {
          setCsBusy('')
        }
      }

      if (enabled !== true) return null
      const data = repoState
      if (data === null || (data.isRepo !== true && (data.repos === undefined || data.repos.length === 0))) return null
      const branchName = summary !== null && typeof summary.branch === 'string' && summary.branch !== '' ? summary.branch : null
      const detached = summary !== null && summary.detached === true
      /* The same dirty count the top bar commits with: the branch menu's 提交
         verb must say how much work it would carry before it opens. */
      const pending = summary === null || summary.changes === undefined ? 0
        : summary.changes.staged.length + summary.changes.unstaged.length
          + summary.changes.untracked.length + summary.changes.conflicted.length

      /* Split out of openBranchMenu so a fetch can refresh the refs WITHOUT
         closing the popover (m02697 #4). A warm page (panel or prewarm) fills the
         list this tick; the request below re-proves it. On failure keep whatever
         is showing. */
      const loadBranches = async () => {
        const seed = readPaintPage(repoRoot)
        const seeded = seed !== undefined && seed.branches !== undefined && seed.branches !== null ? seed.branches : null
        if (seeded !== null) setBranchList(seeded)
        setBranchLoading(seeded === null)
        try {
          const branchesData = await request('branches', { cwd: cwd, repoRoot: repoRoot })
          setBranchList(branchesData)
          mergePaintPage(repoRoot, { branches: branchesData })
        } catch (caught) { void caught } finally { setBranchLoading(false) }
      }
      const openBranchMenu = async () => {
        setMenu('branch')
        await loadBranches()
      }
      const checkoutBranch = async (name) => {
        if (repoRoot === null || checkingOut !== '') return
        setCheckingOut(name)
        try {
          await request('checkout', { cwd: cwd, repoRoot: repoRoot, branch: name, confirm: true })
          setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
          notifyOk(fill(t('toast.checkedOut'), { name: name }))
        } catch (caught) {
          setMenu(null)
          notifyFail(caught)
        } finally { setCheckingOut('') }
      }
      /* Popover actions (m01216 #10). Nothing here may depend on panel state:
         the pill lives in the host composer, outside the panel's React tree. */
      /* Every popover verb answers in the frame notifications (m05310): the
         success line and the failure line both, whether the chooser closes or
         stays open. */
      const csSuccessText = (action, payload) => {
        const p = payload === null || payload === undefined ? {} : payload
        if (action === 'fetch') return t('toast.fetchDone')
        if (action === 'pull') return t('toast.pullDone')
        if (action === 'push') return t('toast.pushDone')
        if (action === 'merge') return fill(t('toast.merged'), { name: String(p.branch) })
        if (action === 'tagDelete') return fill(t('toast.tagDeleted'), { name: String(p.name) })
        if (action === 'branchDelete') return fill(t('toast.branchDeleted'), { name: String(p.name) })
        if (action === 'branchDeleteRemote') return t('toast.remoteBranchDeleted')
        if (action === 'stashDrop') return fill(t('toast.stashDropped'), { ref: String(p.ref) })
        return ''
      }
      const csCall = async (action, payload, options) => {
        if (repoRoot === null || csBusy !== '') return
        const keepOpen = options !== undefined && options.keepOpen === true
        const toastText = options !== undefined && typeof options.toast === 'string' ? options.toast : ''
        setCsBusy(action)
        try {
          const result = await request(action, Object.assign({ cwd: cwd, repoRoot: repoRoot }, payload))
          /* fetch keeps the chooser on screen (m02697 #4): it refreshes the same
             list the user is looking at, so closing it would undo the point. */
          if (keepOpen !== true) setMenu(null)
          setTick((value) => value + 1)
          notifyBranchSwitched(sessionId, repoRoot)
          /* A merge, rebase, cherry-pick or revert that stops on conflicts
             exits as data, not as a refusal: report it and raise the conflict
             overview, which is the only surface that can settle them. */
          if (result !== null && result !== undefined && result.conflicted === true) {
            const output = typeof result.output === 'string' ? result.output.trim() : ''
            const text = output === '' ? t('toast.mergedConflict') : output
            toastCenter.push({ text: text, tone: 'error' })
            if (conflictOverviewDialog.hosted === true) {
              conflictOverviewDialog.set({ cwd: cwd, repoRoot: repoRoot, sessionId: sessionId })
            } else {
              openPanelSeat()
            }
          } else {
            notifyOk(toastText !== '' ? toastText : csSuccessText(action, payload))
          }
        } catch (caught) {
          if (keepOpen !== true) setMenu(null)
          notifyFail(caught)
        } finally { setCsBusy('') }
      }
      const openPanelSeat = () => {
        try {
          const sidebarRight = ctx.get('sidebarRight')
          if (sidebarRight !== undefined && sidebarRight !== null && typeof sidebarRight.openTab === 'function') {
            sidebarRight.openTab(NATIVE_KIND)
            setMenu(null)
          }
        } catch (caught) { void caught }
      }
      /* 提交 raises the message card HERE (m02090). It used to open the sidebar
         seat, which then needed a second click on the tab's own 提交 button —
         two surfaces and two clicks for one verb. The frame-wide overlay is
         mounted by this module's shell.overlay seat; a host without that slot
         falls back to the seat so the verb never dies silently. */
      const openCommitDialog = () => {
        if (repoRoot === null) { openPanelSeat(); return }
        if (overlaySeatReady === true) {
          commitDialog.set({ sessionId: sessionId, cwd: cwd, repoRoot: repoRoot })
          setMenu(null)
          return
        }
        openPanelSeat()
      }
      /* Push followed the commit dialog (m02986): the popover verb previews
         the commits and files instead of publishing on a bare confirm. */
      const openPushDialog = (seed) => {
        if (repoRoot === null) { openPanelSeat(); return }
        if (overlaySeatReady === true) {
          pushDialog.set(Object.assign({ sessionId: sessionId, cwd: cwd, repoRoot: repoRoot }, seed || {}))
          setMenu(null)
          return
        }
        openPanelSeat()
      }
      /* Name prompts (new branch, rename) live in the FRAME overlay, centered on
         the window (m03873). The chooser closes first: the card is not part of
         its scroll body and must survive the popover closing. */
      const openBranchPrompt = (options) => {
        if (repoRoot === null) return
        if (overlaySeatReady !== true) { openPanelSeat(); return }
        promptDialog.set(Object.assign({}, options, {
          cancelLabel: t('confirm.cancel'),
          okLabel: t('confirm.ok'),
          onCancel: () => { promptDialog.set(null) },
        }))
        setMenu(null)
        setCsMenu(null)
      }
      /* 更新 works on the SELECTED branch (m03873). The checked-out branch is
         pulled ff-only; any other branch is fast-forwarded in place by a
         refspec fetch, which git refuses to move backwards. */
      const updateBranch = async (entry) => {
        if (repoRoot === null || csBusy !== '') return
        const toastText = fill(t('toast.branchUpdated'), { name: entry.name })
        if (entry.head === true) {
          await csCall('pull', { mode: 'ff-only' }, { toast: toastText })
          return
        }
        const upstream = entry.upstream === null || entry.upstream === undefined ? '' : String(entry.upstream)
        const slash = upstream.indexOf('/')
        const remote = slash > 0 ? upstream.slice(0, slash) : 'origin'
        const remoteBranch = slash > 0 ? upstream.slice(slash + 1) : entry.name
        await csCall('fetch', { remote: remote, branch: remoteBranch + ':' + entry.name }, { toast: toastText })
      }
      /* 推送 opens the SAME push card for every branch (m00005). A row that is
         not HEAD used to push straight with the configured upstream name, which
         repeated a stale remote name after a rename; the card previews that
         branch and lets the user correct the destination. */
      const pushBranch = (entry) => {
        if (repoRoot === null || csBusy !== '') return
        openPushDialog({ branch: entry.name })
      }
      /* A remote row that has no local twin is checked out as a tracking branch
         in one step (the panel's row menu does the same). Only the secondary
         menu calls this: a row click never changes the working tree by itself. */
      const csCheckout = (entry, kind) => {
        if (kind !== 'remote') { void checkoutBranch(entry.name); return }
        const slash = entry.name.indexOf('/')
        const local = slash >= 0 ? entry.name.slice(slash + 1) : entry.name
        const exists = branchList !== null && branchList.local.some((item) => item.name === local)
        if (exists === true) { void checkoutBranch(local); return }
        void (async () => {
          if (repoRoot === null || checkingOut !== '') return
          setCheckingOut(entry.name)
          try {
            await request('checkout', {
              cwd: cwd, repoRoot: repoRoot, branch: local, create: true,
              startPoint: entry.name, track: true, confirm: true,
            })
            setMenu(null)
            setTick((value) => value + 1)
            notifyBranchSwitched(sessionId, repoRoot)
            notifyOk(fill(t('toast.branchCreated'), { name: local }))
          } catch (caught) {
            setMenu(null)
            notifyFail(caught)
          } finally { setCheckingOut('') }
        })()
      }
      /* A local branch delete is the one popover verb with a handle: the host
         keeps the ref for a while and undoApply recreates it. The notice and its
         undo button live in the frame stack, so the popover may close first. */
      const csUndoDelete = async (id) => {
        if (repoRoot === null) return
        try {
          const data = await request('undoApply', { cwd: cwd, repoRoot: repoRoot, id: id })
          toastCenter.dropUndo(id)
          await loadBranches()
          setTick((value) => value + 1)
          const label = data !== null && data !== undefined && typeof data.label === 'string' ? data.label : ''
          notifyOk(t('toast.restored') + (label === '' ? '' : ' · ' + label))
        } catch (caught) { notifyFail(caught) }
      }
      const csDeleteLocal = async (entry, force) => {
        if (repoRoot === null || csBusy !== '') return
        setCsBusy('branchDelete')
        setCsMenu(null)
        setMenu(null)
        try {
          const data = await request('branchDelete', {
            cwd: cwd, repoRoot: repoRoot, name: entry.name, confirm: true, force: force === true,
          })
          await loadBranches()
          setTick((value) => value + 1)
          if (data === null || data === undefined || data.undo === undefined) {
            notifyOk(fill(t('toast.branchDeleted'), { name: entry.name }))
          } else {
            toastCenter.push({
              text: fill(t('toast.branchDeleted'), { name: entry.name }),
              icon: 'trash', tone: 'warn',
              undoId: data.undo.id, actionLabel: t('toast.undo'),
              onAction: () => { void csUndoDelete(data.undo.id) },
            })
          }
        } catch (caught) { notifyFail(caught) } finally { setCsBusy('') }
      }
      const csDelete = (entry, kind) => {
        if (kind === 'tags') { void csCall('tagDelete', { name: entry.name }); return }
        if (kind === 'remote') {
          const slash = entry.name.indexOf('/')
          confirmDialog.set({
            key: 'cs-delete|' + entry.name,
            title: t('confirm.title'),
            text: fill(t('confirm.deleteRemoteBranch'), {
              remote: slash >= 0 ? entry.name.slice(0, slash) : entry.name,
              branch: slash >= 0 ? entry.name.slice(slash + 1) : entry.name,
            }),
            okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
            onConfirm: () => { void csCall('branchDeleteRemote', {
              remote: slash >= 0 ? entry.name.slice(0, slash) : entry.name,
              branch: slash >= 0 ? entry.name.slice(slash + 1) : entry.name,
              confirm: true,
            }) },
          })
          return
        }
        confirmDialog.set({
          key: 'cs-delete|' + entry.name,
          title: t('confirm.title'),
          text: fill(t('delete.confirm'), { name: entry.name }),
          okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel'),
          checkbox: { label: t('confirm.forceDelete'), defaultChecked: true },
          onConfirm: (force) => { void csDeleteLocal(entry, force) },
        })
      }
      /* Row menu (m01737 #5, floated beside the popover since m02697 #2): a
         click SELECTS the row and shows the IDEA verb list next to the chooser,
         anchored on that row. The list cannot live inside the popover body —
         that box scrolls and clips — but it must not push the tree either, so
         it is a root-level floating layer. Offsets are root-relative because the
         composer seat is the containing block. */
      const openCsMenu = (entry, kind, event) => {
        if (csMenu !== null && csMenu.entry === entry && csMenu.kind === kind) { setCsMenu(null); return }
        const root = rootRef.current
        const pop = popRef.current
        const rootRect = root !== null && root !== undefined ? root.getBoundingClientRect() : { left: 0, top: 0 }
        const popRect = pop !== null && pop !== undefined ? pop.getBoundingClientRect() : null
        const rowRect = event !== undefined && event !== null && event.currentTarget !== null && event.currentTarget !== undefined
          ? event.currentTarget.getBoundingClientRect() : null
        /* Four verbs: 4 * 26 + 8 padding, plus the shadow gutter. The flyout
           itself is max-content (m03424): a long ref makes the card wider
           instead of truncating, so the flip estimate measures the longest
           label rather than assuming the 240px minimum. */
        const labelWidthOf = (text) => {
          let width = 0
          for (const character of String(text)) {
            width += character.codePointAt(0) > 0x2E80 ? 12 : 6.6
          }
          return width
        }
        const items = csMenuItems({ entry: entry, kind: kind })
        const widestLabel = items
          .reduce((widest, item) => Math.max(widest, labelWidthOf(item.label)), 0)
        const flyoutWidth = Math.max(240, Math.ceil(widestLabel) + 44)
        /* One 26px row per verb plus the 8px padding (m03873 grew the local
           list from four to seven, so the height can no longer be a constant). */
        const flyoutHeight = 8 + items.length * 26
        const gutter = 6
        const viewportWidth = typeof window === 'undefined' ? 0 : (window.innerWidth || 0)
        const viewportHeight = typeof window === 'undefined' ? 0 : (window.innerHeight || 0)
        let x = popRect === null ? 0 : popRect.right - rootRect.left + gutter
        /* Flip to the popover's left side when the right edge is too close to
           the viewport, the way the IDE keeps a submenu on screen. */
        if (popRect !== null && viewportWidth > 0 && popRect.right + gutter + flyoutWidth > viewportWidth - 8) {
          x = popRect.left - rootRect.left - flyoutWidth - gutter
        }
        if (x < 4) x = 4
        /* The chooser opens UPWARD from the composer, so a row's root-relative
           top is negative by design — clamping it to 0 would drop the menu onto
           the pill. Clamp against the viewport instead. */
        let y = rowRect === null ? 0 : rowRect.top - rootRect.top
        if (viewportHeight > 0) {
          const maxY = viewportHeight - rootRect.top - flyoutHeight - 8
          const minY = 8 - rootRect.top
          if (y > maxY) y = maxY
          if (y < minY) y = minY
        }
        setCsMenu({ entry: entry, kind: kind, x: x, y: y })
      }
      const csMenuItems = (sel) => {
        const entry = sel.entry
        const kind = sel.kind
        const local = kind === 'local'
        /* A branch checked out in ANOTHER worktree stays selectable (m00043):
           only 签出 is refused, because git cannot check the same branch out in
           two trees. Every other verb works on the ref or the remote. */
        const inUse = entry.worktree !== null && entry.worktree !== undefined
        const busy = checkingOut !== ''
        /* The four verbs the IDEA row menu offers (m02697 #3). Merge always runs
           in the direction IDEA words it: the SELECTED ref is merged INTO the
           branch checked out right now, never the other way round. */
        return [
          {
            id: 'checkout', icon: 'checkout', tone: 'accent', label: t('action.checkout'),
            disabled: entry.head === true || inUse || busy,
            run: () => { setCsMenu(null); csCheckout(entry, kind) },
          },
          {
            id: 'newBranch', icon: 'branchCreate', tone: 'success',
            label: t('action.newBranchFrom'),
            run: () => {
              setCsMenu(null)
              openBranchPrompt({
                key: 'new|' + kind + '|' + entry.name,
                title: t('toolbar.newBranch'),
                text: fill(t('prompt.newBranchFrom'), { branch: entry.name }),
                initialValue: kind === 'remote' ? entry.name.slice(entry.name.indexOf('/') + 1) : '',
                placeholder: t('prompt.newBranch'),
                onSubmit: async (name) => {
                  const payload = {
                    cwd: cwd, repoRoot: repoRoot, branch: name, create: true, confirm: true,
                    startPoint: entry.name,
                  }
                  /* Only a REMOTE start point may bind an upstream: `--track` on a
                     local name git cannot resolve as a tracking ref fails the
                     whole checkout. */
                  if (kind === 'remote') payload.track = true
                  await request('checkout', payload)
                  promptDialog.set(null)
                  setTick((value) => value + 1)
                  notifyBranchSwitched(sessionId, repoRoot)
                  notifyOk(fill(t('toast.branchCreated'), { name: name }))
                },
              })
            },
          },
          {
            id: 'merge', icon: 'compare', tone: 'violet',
            label: fill(t('action.mergeInto'), { from: entry.name, to: branchName === null ? '' : branchName }),
            disabled: entry.head === true || branchName === null || busy,
            run: () => { setCsMenu(null); void csCall('merge', { branch: entry.name }) },
          },
          /* A remote row offers 拉取 (m03874): the selected remote branch is
             pulled INTO the branch checked out right now, ff-only like every
             other pull in the panel — git refuses a diverged merge here. */
          kind === 'remote' ? {
            id: 'pull', icon: 'pull',
            label: fill(t('action.pullRemoteInto'), { branch: entry.name, to: branchName === null ? '' : branchName }),
            disabled: branchName === null || busy,
            run: () => {
              setCsMenu(null)
              const slash = entry.name.indexOf('/')
              void csCall('pull', {
                remote: slash >= 0 ? entry.name.slice(0, slash) : entry.name,
                branch: slash >= 0 ? entry.name.slice(slash + 1) : entry.name,
                mode: 'ff-only',
              })
            },
          } : null,
          /* Local rows only (m03873): update and push act on the SELECTED ref,
             not on HEAD; rename needs a local branch to move. The checked-out
             row keeps working too — pull/push then mean what they say on it. */
          local ? {
            id: 'update', icon: 'pull', label: t('action.updateBranch'),
            disabled: csBusy !== '',
            run: () => { setCsMenu(null); void updateBranch(entry) },
          } : null,
          local ? {
            id: 'push', icon: 'push', label: t('action.push'),
            disabled: csBusy !== '',
            run: () => { setCsMenu(null); void pushBranch(entry) },
          } : null,
          local ? {
            id: 'rename', icon: 'file', label: t('action.rename'),
            disabled: csBusy !== '',
            run: () => {
              setCsMenu(null)
              openBranchPrompt({
                key: 'rename|' + entry.name,
                title: t('action.rename'),
                text: entry.name,
                initialValue: entry.name,
                placeholder: t('prompt.renameBranch'),
                onSubmit: async (name) => {
                  if (name === entry.name) { promptDialog.set(null); return }
                  await request('branchRename', {
                    cwd: cwd, repoRoot: repoRoot, from: entry.name, to: name,
                  })
                  promptDialog.set(null)
                  setTick((value) => value + 1)
                  if (entry.head === true) notifyBranchSwitched(sessionId, repoRoot)
                  notifyOk(fill(t('toast.branchRenamed'), { from: entry.name, to: name }))
                },
              })
            },
          } : null,
          {
            id: 'delete', icon: 'trash', tone: 'danger', danger: true, label: t('action.delete'),
            disabled: entry.head === true && local,
            run: () => { setCsMenu(null); csDelete(entry, kind) },
          },
          /* Remote rows get no update/push/rename (m03873), so the list can
             carry holes — drop them once here; the caller measures and counts
             the same array. */
        ].filter((item) => item !== null)
      }
      const csFlyout = () => (csMenu === null ? null : E('div', {
        className: 'git4idea-cs-flyout',
        'data-cordis-panel': '',
        style: { left: String(csMenu.x) + 'px', top: String(csMenu.y) + 'px' },
      }, csMenuItems(csMenu).map((item) => E('button', {
        key: item.id,
        type: 'button',
        className: 'git4idea-cs-sub-item',
        'data-tone': item.danger === true ? 'danger' : (item.tone === undefined ? 'secondary' : item.tone),
        'aria-disabled': item.disabled === true ? 'true' : 'false',
        onClick: () => { if (item.disabled !== true) item.run() },
      }, E('span', { className: 'git4idea-cs-sub-label' }, item.label)))))
      const csNeedle = branchFilter.trim().toLowerCase()
      const csEntries = (list) => (Array.isArray(list) ? list : []).filter((entry) => csNeedle === ''
        || String(entry.name).toLowerCase().indexOf(csNeedle) >= 0)
      /* Branch tree (m01737 #3): names are split on "/" into folders, the shape
         the IDEA chooser shows. A search hides nothing but forces every folder
         open, so a filtered tree never hides its own hits. */
      const csLeaf = (entry, kind, depth) => E('button', {
        key: kind + ':' + entry.name,
        type: 'button',
        className: 'git4idea-cs-item',
        'data-current': entry.head === true ? 'true' : 'false',
        'data-menu': csMenu !== null && csMenu.entry === entry ? 'true' : 'false',
        disabled: checkingOut !== '',
        style: { paddingLeft: String(6 + depth * 12) + 'px' },
        onClick: (event) => { openCsMenu(entry, kind, event) },
      },
        E(Icon, { name: kind === 'tags' ? 'tag' : 'branch', size: 11 }),
        E('span', { className: 'git4idea-cs-item-name' }, entry.name.slice(entry.name.lastIndexOf('/') + 1)),
        entry.worktree !== null ? E('span', { className: 'git4idea-cs-item-note' }, t('composer.inWorktree')) : null,
        checkingOut === entry.name ? E('span', { className: 'git4idea-cs-item-note' }, '…') : null,
        /* Every row advertises the menu with a tail chevron (m02697 #2): the
           user should not have to click a row to discover the verbs. */
        E('span', { className: 'git4idea-cs-item-tail' },
          entry.ahead > 0 || entry.behind > 0
            ? E('span', { className: 'git4idea-cs-item-counts' },
              entry.ahead > 0 ? E('span', { className: 'git4idea-cs-ahead' }, E(Icon, { name: 'push', size: 10 }), String(entry.ahead)) : null,
              entry.behind > 0 ? E('span', { className: 'git4idea-cs-behind' }, E(Icon, { name: 'pull', size: 10 }), String(entry.behind)) : null)
            : null,
          E(Icon, { name: 'chevronRight', size: 10 })))
      const csTree = (key, label, entries, kind) => {
        if (entries.length === 0) return null
        const root = { folders: new Map(), leaves: [] }
        for (const entry of entries) {
          const parts = String(entry.name).split('/')
          let node = root
          for (let i = 0; i < parts.length - 1; i += 1) {
            const part = parts[i]
            if (node.folders.has(part) !== true) node.folders.set(part, { folders: new Map(), leaves: [] })
            node = node.folders.get(part)
          }
          node.leaves.push(entry)
        }
        const rows = [E('div', { key: key + '-head', className: 'git4idea-cs-head' }, label)]
        const walk = (node, prefix, depth) => {
          /* Round 2 #2: directories sort A→Z, so a fresh chooser reads like the
             branch tree instead of following discovery order. */
          for (const name of Array.from(node.folders.keys()).sort()) {
            const child = node.folders.get(name)
            const path = prefix === '' ? name : prefix + '/' + name
            /* Closed unless opened (m00324): a fresh chooser must not dump
               every remote's branches; a search still forces folders open. */
            const closed = csNeedle === '' && csFolded[path] !== true
            rows.push(E('button', {
              key: key + ':dir:' + path,
              type: 'button',
              className: 'git4idea-cs-item git4idea-cs-folder',
              style: { paddingLeft: String(6 + depth * 12) + 'px' },
              onClick: () => { setCsFolded((map) => Object.assign({}, map, { [path]: map[path] !== true })) },
            },
              E(Icon, { name: closed === true ? 'chevronRight' : 'chevron', size: 10 }),
              E(Icon, { name: 'folder', size: 11 }),
              E('span', { className: 'git4idea-cs-item-name' }, name)))
            if (closed !== true) walk(child, path, depth + 1)
          }
          for (const entry of node.leaves) {
            rows.push(csLeaf(entry, kind, depth))
          }
        }
        walk(root, '', 0)
        return rows
      }
      /* Swap to a warm summary synchronously when one exists — the null gap
         between pick and effect would paint one empty frame. */
      const seedSummaryOf = (root) => {
        if (typeof root !== 'string' || root === '') return null
        const seed = readPaintPage(root)
        return seed !== undefined && seed.summary !== undefined && seed.summary !== null ? seed.summary : null
      }

      return E('div', {
        ref: rootRef,
        className: 'git4idea-cs-root',
        'data-dsh-git4idea-status': '',
      },
        operation !== null ? E('span', { className: 'git4idea-cs-op' },
          E('span', { className: 'git4idea-cs-alert git4idea-tone-warn', 'data-tip': operationText }, E(Icon, { name: 'warning', size: 13 })),
          E('button', {
            type: 'button', className: 'git4idea-cs-pill', 'data-tip': operationText,
            onClick: openConflictOverview,
          }, E(ComposerMarqueeName, { text: operationText })),
          E('button', {
            type: 'button', className: 'git4idea-cs-opbtn git4idea-cs-go', 'data-tip': t('operation.advanceHint'),
            onClick: openConflictOverview,
          }, E(Icon, { name: 'arrowRight', size: 14 })),
          E('button', {
            type: 'button', className: 'git4idea-cs-opbtn git4idea-cs-stop', 'data-tip': t('operation.abortHint'),
            'aria-disabled': csBusy !== '' ? 'true' : 'false',
            onClick: () => { if (csBusy === '') void abortOperation() },
          }, E(Icon, { name: 'close', size: 14 }))) : branchName !== null ? E('button', {
          type: 'button',
          className: 'git4idea-cs-pill',
          'data-tip': t('composer.branchHint'),
          'aria-expanded': menu === 'branch' ? 'true' : 'false',
          onClick: () => {
            setCsMenu(null)
            if (menu !== 'branch') { void openBranchMenu() } else { setMenu(null) }
          },
        },
          E(Icon, { name: 'branch', size: 14 }),
          E(ComposerMarqueeName, { text: detached === true ? t('composer.detached') : branchName }),
          /* The pill shows only the glyphs (m00312): the count stays in the
             tooltip, because digits made the narrow capsule jump per commit. */
          summary === null || summary.ahead === undefined || summary.ahead <= 0 ? null
            : E('span', { className: 'git4idea-cs-pill-count git4idea-tone-success', 'data-tip': t('track.push') + ' ' + summary.ahead },
              E(Icon, { name: 'push', size: 10 })),
          summary === null || summary.behind === undefined || summary.behind <= 0 ? null
            : E('span', { className: 'git4idea-cs-pill-count git4idea-tone-business', 'data-tip': t('track.pull') + ' ' + summary.behind },
              E(Icon, { name: 'pull', size: 10 })),
          E(Icon, { name: 'chevron', size: 10 })) : null,
        /* The old red "×" chip sat inside the composer and read as a failed
           switch even while the switch was still running (m01737 #5). Errors
           now live in the popover's own bar and in the pill tooltip. */
        menu === 'branch' ? (branchLoading === true || branchList === null
          ? E('div', { className: 'git4idea-cs-menu', 'data-cordis-panel': '' }, E('div', { className: 'git4idea-cs-item git4idea-cs-static' }, '…'))
          : (() => {
            const sections = [].concat(
              csTree('local', t('branches.local'), csEntries(branchList.local), 'local') || [],
              csTree('remote', t('branches.remote'), csEntries(branchList.remote), 'remote') || [],
            )
            return E('div', { ref: popRef, className: 'git4idea-cs-menu git4idea-cs-branches', 'data-cordis-panel': '' },
              E('div', { className: 'git4idea-cs-search' },
                E('input', {
                  className: 'git4idea-cs-input', value: branchFilter, spellCheck: false,
                  placeholder: t('branches.filter'),
                  onChange: (event) => setBranchFilter(event.target.value),
                }),
                E('button', {
                  type: 'button', className: 'git4idea-cs-tool',
                  'data-tip': t('toolbar.fetch'),
                  'aria-disabled': repoRoot === null || csBusy !== '' ? 'true' : 'false',
                  /* Fetch keeps the chooser open (m02697 #4): it refreshes the
                     refs the user is looking at, then reloads that same list. */
                  onClick: () => {
                    void (async () => {
                      await csCall('fetch', { prune: true }, { keepOpen: true })
                      await loadBranches()
                    })()
                  },
                }, E(Icon, { name: 'fetch', size: 13 }))),
              /* Actions sit under the search box and above the tree, one per row
                 (m01737 #6) — they read as verbs on the branch list below them,
                 not as a footer. */
              E('div', { className: 'git4idea-cs-actions' },
                E('button', { type: 'button', className: 'git4idea-cs-action', 'data-tip': t('changes.commit'), onClick: openCommitDialog },
                  E(Icon, { name: 'commit', size: 12 }), E('span', null, t('changes.commit')),
                  pending > 0 ? E('span', { className: 'git4idea-cs-action-count' }, String(pending)) : null),
                E('button', {
                  type: 'button', className: 'git4idea-cs-action', 'data-tip': t('toolbar.push'),
                  'aria-disabled': repoRoot === null || csBusy !== '' ? 'true' : 'false',
                  onClick: openPushDialog,
                }, E(Icon, { name: 'push', size: 12 }), E('span', null, t('toolbar.push'))),
                E('button', {
                  type: 'button', className: 'git4idea-cs-action', 'data-tip': t('toolbar.newBranch'),
                  onClick: () => {
                    openBranchPrompt({
                      key: 'new|head',
                      title: t('toolbar.newBranch'),
                      text: branchName === null ? '' : branchName,
                      initialValue: '',
                      placeholder: t('prompt.newBranch'),
                      onSubmit: async (name) => {
                        await request('checkout', {
                          cwd: cwd, repoRoot: repoRoot, branch: name, create: true, confirm: true,
                        })
                        promptDialog.set(null)
                        setTick((value) => value + 1)
                        notifyBranchSwitched(sessionId, repoRoot)
                        notifyOk(fill(t('toast.branchCreated'), { name: name }))
                      },
                    })
                  },
                }, E(Icon, { name: 'plus', size: 12 }), E('span', null, t('toolbar.newBranch')))),
              E('div', {
                className: 'git4idea-cs-sections',
                /* The flyout is anchored to a row: once the tree scrolls, that
                   anchor is stale, so the menu closes instead of drifting. */
                onScroll: () => { if (csMenu !== null) setCsMenu(null) },
              },
                sections.length === 0 ? E('div', { className: 'git4idea-cs-item git4idea-cs-static' }, t('filter.none')) : sections),
              )
          })())
          : null,
        /* Root-level sibling of the popover, not a child of it: the popover body
           clips and scrolls, which would cut the menu off. */
        menu === 'branch' ? csFlyout() : null,
      )
    }

    /* The conversation shell re-renders on EVERY keystroke (the composer owns
       the draft state), and the view area re-renders with it. Without a bail-out
       at this boundary that cascade dragged the ENTIRE Git panel tree — branch
       rows, graph lanes, changes — through a synchronous render per keypress
       while the Git view was the active one (typing lag, reported against
       v0.13.0). The component consumes exactly three stable props (sessionId,
       t, ctx); everything else the slot passes (inspectCall, viewRequest, …)
       changes identity per shell render and is deliberately ignored, so the
       comparator is: same session, same bindings → skip the subtree. cwd moves
       through the sessions subscription inside, not through props. */
    const ConversationPanel = memo(function ConversationPanel(props) {
      const ctx = props.ctx
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [cwd, setCwd] = useState(() => sessionCwdOf(ctx, sessionId))
      /* Immersive mode (issue #8 round 3): when on, the seat declares the
         host's composer-overlay contract (`data-conversation-composer-overlay`)
         and the conversation view area goes `flex: 1 1 0; min-height: 0;
         overflow: hidden` — the panel fills the WHOLE conversation height and
         scrolls inside itself, with the composer seat hidden away (CSS keeps
         the blocking approvals visible). The v0.13.2 pin-to-scrollport
         machinery below is the FALLBACK for immersive-off: it exists because
         the active view area is `flex: 1 0 auto` (content height) in the
         normal layout, which is exactly what the overlay contract replaces. */
      const [immersive] = useState(() => conversationImmersiveEnabled())
      /* The active conversation's view area is `flex: 1 0 auto; min-height:
         auto` — it GROWS with content and scrolls inside the shared
         conversation scrollport. An auto-height panel there measured
         content-tall (a 120-commit history, a long diff), so the width-vs-
         height chrome test flipped the wide seat into the stacked sidebar
         layout and everything shifted downward (v0.13.1 report). Pin the seat
         to the scrollport's VISIBLE height instead: the panel fills exactly
         the on-screen area and scrolls internally, the way the sidebar seats
         behave. */
      const seatRef = useRef(null)
      const [seatHeight, setSeatHeight] = useState(null)
      useEffect(() => {
        const el = seatRef.current
        if (el === null) return undefined
        /* Immersive ON: the host's overlay layout owns this seat's height
           (the view area is the flex child now) — no pinning, no convergence,
           none of the scrollport arithmetic below applies. Toggling the
           setting re-runs this effect through the dependency below, so the
           fallback machinery spins back up on the way off. */
        if (immersive === true) return undefined
        /* Leftover wheel scroll, root cause: the composer seat is sticky, but a
           sticky box still occupies FLOW space inside the scrollport, so even
           with the panel seat pinned to the visible height the scrollHeight
           stays clientHeight + that flow space — the wheel could still scroll
           the whole window by exactly that leftover (user report: the layout
           fits, yet the page keeps scrolling). v0.13.3 report: content mounts
           or changes AFTER the first pass (the composer, the hero, a diff), and
           a single feedback convergence is not enough. measure() therefore
           recomputes the UNCORRECTED base (base.current) and hands off to the
           CONTROLLED CONVERGER below, which is re-run by every trigger: the
           initial mount, rAF/timeout follow-ups, the scrollport's own resize
           (ResizeObserver) and window resizes, and — new — the scrollport's
           content mutations (MutationObserver, debounced), because content
           growing later re-opens the overflow without resizing the scrollport
           itself. */
        const leftover = { current: 0 }
        const base = { current: 0 }
        /* The converger: up to FOUR rAF-spaced rounds. Each round reads
           scroll.scrollHeight - scroll.clientHeight; anything over 1px shrinks
           the seat by exactly that amount and OVERWRITES the leftover record
           (never adds — every corrected height derives from the fresh base, so
           repeated rounds cannot compound), clamped at the same 240 floor.
           Shrink-only: nothing here grows the seat back. A host without the
           conversation scrollport never reaches this code — measure() skips it
           all, silently, and never throws. */
        const converge = (scroll) => {
          let rounds = 0
          const step = () => {
            rounds += 1
            if (el.isConnected !== true) return
            const overflow = scroll.scrollHeight - scroll.clientHeight
            if (overflow <= 1) return
            leftover.current = overflow
            setSeatHeight(Math.max(240, base.current - overflow))
            if (rounds < 4) requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }
        const measure = () => {
          let scroll = null
          try { scroll = el.closest('[data-conversation-scroll]') } catch (error) { void error }
          if (scroll === null || scroll === undefined) return
          const offset = Math.max(0, el.getBoundingClientRect().top - scroll.getBoundingClientRect().top)
          base.current = Math.round(scroll.clientHeight - offset - 8)
          const corrected = base.current - leftover.current
          if (corrected >= 240) setSeatHeight(corrected)
          converge(scroll)
        }
        measure()
        const raf = requestAnimationFrame(() => { measure() })
        const late = setTimeout(() => { measure() }, 400)
        let observer
        try {
          const scroll = el.closest('[data-conversation-scroll]')
          if (scroll !== null && scroll !== undefined && typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(() => { measure() })
            observer.observe(scroll)
          }
        } catch (error) { void error }
        /* Content that mounts or changes later does not resize the scrollport,
           so the ResizeObserver stays silent while the overflow re-opens; the
           mutation watcher re-measures for it. Debounced ~120ms so a mount
           burst converges once instead of once per node. */
        let mutationObserver
        let mutationTimer = null
        try {
          const scroll = el.closest('[data-conversation-scroll]')
          if (scroll !== null && scroll !== undefined && typeof MutationObserver === 'function') {
            mutationObserver = new MutationObserver(() => {
              if (mutationTimer !== null) clearTimeout(mutationTimer)
              mutationTimer = setTimeout(() => { mutationTimer = null; measure() }, 120)
            })
            mutationObserver.observe(scroll, { childList: true, subtree: true })
          }
        } catch (error) { void error }
        window.addEventListener('resize', measure)
        return () => {
          cancelAnimationFrame(raf)
          clearTimeout(late)
          if (mutationTimer !== null) clearTimeout(mutationTimer)
          if (mutationObserver !== undefined) mutationObserver.disconnect()
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [immersive])
      useEffect(() => {
        let alive = true
        const sync = () => { if (alive === true) setCwd(sessionCwdOf(ctx, sessionId)) }
        sync()
        /* The session list is a live store; without a subscription a later
           start (first message in a blank session) would leave the tab on the
           no-repo chrome until the next remount. The notify walks are cheap:
           getSnapshot + a string compare, and setCwd with an identical string
           bails out without a render. */
        let unsubscribe
        try {
          const sessions = ctx.get('sessions')
          const list = sessions !== undefined && sessions !== null ? sessions.list : undefined
          if (list !== undefined && typeof list.subscribe === 'function') unsubscribe = list.subscribe(sync)
        } catch (error) { void error }
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') {
            try { unsubscribe() } catch (error) { void error }
          }
        }
      }, [ctx, sessionId])
      const scope = useMemo(() => ({ cwd: cwd, sessionId: sessionId }), [cwd, sessionId])
      /* The overlay marker rides the SEAT element (a viewArea descendant): the
         host's `.scrollBody:has([data-conversation-composer-overlay])` rules
         pick it up from anywhere inside, flipping the view area to
         `flex: 1 1 0; min-height: 0; overflow: hidden` (full-height, internal
         scrolling) and the composer seat to an overlay. `data-immersive`
         drives the plugin's own CSS (composer hide + width-handle hide). */
      const immersiveAttrs = immersive === true
        ? { 'data-conversation-composer-overlay': '', 'data-immersive': '1' }
        : {}
      return E('div', Object.assign({
        ref: seatRef,
        className: 'git4idea-conversation-seat',
        style: immersive === true ? { height: '100%' } : (seatHeight === null ? undefined : { height: seatHeight + 'px' }),
      }, immersiveAttrs), E(LocaleLive, { ctx: ctx, scope: scope, t: props.t, visible: true }))
    }, (prev, next) => prev.sessionId === next.sessionId && prev.t === next.t && prev.ctx === next.ctx)

    function NativePanel(props) {
      const workspaces = typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces(NATIVE_WORKSPACE_ITEMS)
        : null
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : 'default'
      let cwd
      if (Array.isArray(workspaces)) {
        for (const item of workspaces) {
          if (item === null || typeof item !== 'object') continue
          if (!Array.isArray(item.sessionIds) || item.sessionIds.indexOf(sessionId) < 0) continue
          if (typeof item.path === 'string' && item.path !== '') cwd = item.path
          break
        }
      }
      const scope = useMemo(() => ({ cwd: cwd, sessionId: sessionId }), [cwd, sessionId])
      /* The dock actions need this tab's own identity, which only this seat
         binds; the conversation-area seat has no sidebarRight tab id and
         therefore wires nothing (a panel hosted elsewhere must not float a
         foreign tab). */
      const dock = readDockInfo(props.useTabInfo, props.ctx)
      return E(LocaleLive, { ctx: props.ctx, scope: scope, t: props.t, visible: true, dock: dock })
    }

