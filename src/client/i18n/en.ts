function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export const en = {
  language: {
    label: 'Language',
    en: 'English',
    ja: '日本語',
  },
  common: {
    cancel: 'Cancel',
    close: 'Close',
    loading: 'Loading…',
    untitled: 'Untitled',
    save: 'Save',
    saving: 'Saving…',
    saveFailed: 'Couldn’t save changes',
    delete: 'Delete',
    deleteConfirm: 'Delete',
    joinSentences: (sentences: string[]) => sentences.join(' '),
    create: 'Create',
    add: 'Add',
    search: 'Search',
    settings: 'Settings',
    logout: 'Sign out',
    image: 'Image',
    feeds: 'Feeds',
    feed: 'Feed',
    tag: 'Tag',
    tags: 'Tags',
    refreshing: 'Refreshing',
    notFound: 'Not found',
    moreActions: 'More actions',
    refresh: 'Refresh',
    sidebarWidth: 'Sidebar width',
    listWidth: 'Article list width',
  },
  demo: {
    label: 'Sample screen',
    banner:
      'This page is a sample screen of Konpeito, a feed reader app designed to run on Cloudflare Workers + D1.',
    repo: 'Konpeito',
  },
  login: {
    submit: 'Sign in with a passkey',
    registerFailed: 'Couldn’t register the passkey',
    unknownPasskey: 'This passkey isn’t registered',
    loginFailed: 'Couldn’t sign in',
    challengeFailed: 'Couldn’t start signing in. Try again.',
    registerChallengeFailed: 'Couldn’t start registering the passkey. Try again.',
    registerVerifyFailed: 'Couldn’t register the passkey',
    or: 'or',
    tokenLabel: 'Access token',
    showToken: 'Show',
    hideToken: 'Hide',
    tokenSubmit: 'Sign in with an access token',
    tokenFailed:
      'Couldn’t sign in. Check that the access token is correct and allowed for sign-in.',
  },
  sidebar: {
    addMenu: 'Add',
    addFeed: 'Add feed',
    createTag: 'Create tag',
    allArticles: 'All articles',
    unread: 'Unread',
    bookmarked: 'Bookmarked',
    uncategorized: 'Uncategorized',
    emptyFeeds: 'No feeds yet',
    gone: 'Removed',
    unreadCount: (count: number) => `${count} unread`,
    unreadCountShort: (count: number) => `${count}`,
  },
  list: {
    newestFirst: 'Newest first',
    oldestFirst: 'Oldest first',
    markAllRead: 'Mark all as read',
    articleList: 'Articles',
    updated: 'Updated',
    emptySearch: (query: string) => `No articles match “${query}”`,
    emptyUnread: 'No unread articles',
    emptyBookmarks: 'No bookmarked articles',
    emptyRecentlyRead: 'No recently read articles',
    emptyUpdated: 'No updated articles',
    emptyDefault: 'No articles',
    recentlyRead: 'Recently read',
    updatedHeading: 'Updated',
    searchResults: (query: string) => `Results for “${query}”`,
  },
  article: {
    backToList: 'Back to list',
    actions: 'Article actions',
    bookmark: 'Bookmark',
    unbookmark: 'Remove bookmark',
    markRead: 'Mark as read',
    markUnread: 'Mark as unread',
    showFull: 'Show full article',
    showFeed: 'Show feed content',
    showDiff: 'Show changes',
    hideDiff: 'Hide changes',
    openOriginal: 'Open original',
    nextArticle: 'Next article',
    caughtUp: 'You’re all caught up',
    markedRead: 'Marked as read',
    markedUnread: 'Marked as unread',
    bookmarked: 'Bookmarked',
    unbookmarked: 'Bookmark removed',
    markedAllRead: 'All marked as read',
    markAllConfirmTitle: 'Mark all as read?',
    markAllConfirmBody: 'Every article in the current view will be marked as read.',
    shownFull: 'Showing full article',
    shownFeed: 'Showing feed content',
  },
  sourceMenu: {
    editFeed: 'Edit feed',
    refresh: 'Refresh',
    moveToFront: 'Move to top',
    unsubscribe: 'Unsubscribe',
    rename: 'Rename',
    delete: 'Delete',
  },
  feedDialog: {
    addTitle: 'Add feed',
    urlLabel: 'Feed or site URL',
    invalidUrl: 'That doesn’t look like a URL',
    find: 'Find',
    findAgain: 'Find again',
    finding: 'Finding…',
    foundTitle: 'Feeds found',
    foundCount: (count: number) => `${plural(count, 'feed')} found`,
    subscribed: 'Subscribed',
    addedRow: 'Added',
    adding: 'Adding…',
    itemCount: (count: number) => plural(count, 'article'),
    latestItem: (when: string) => `latest ${when}`,
    notFound: 'No feed found',
    addFailed: 'Couldn’t add the feed',
    added: 'Feed added',
    addedCount: (count: number) => `Added ${plural(count, 'feed')}`,
    discoverFailure: (kind: string, status: number | null): string => {
      switch (kind) {
        case 'timeout':
          return 'The site didn’t respond'
        case 'network':
          return 'Couldn’t reach the site. Check the URL'
        case 'http_5xx':
          return `The site is returning an error (HTTP ${status ?? '5xx'})`
        case 'rate_limited':
          return 'The site is rate limiting us. Try again later'
        case 'cf_challenge':
          return 'The site’s bot protection denied access'
        case 'forbidden':
          return 'The site refused access (HTTP 403)'
        case 'not_found':
          return 'That page doesn’t exist (HTTP 404)'
        case 'gone':
          return 'This feed has been discontinued (HTTP 410)'
        case 'http_4xx':
          return `The site returned an error (HTTP ${status ?? '4xx'})`
        case 'too_large':
          return 'The feed is too large to fetch'
        case 'empty_body':
          return 'The site returned an empty response'
        case 'unsupported_format':
          return 'No feed was found at that URL'
        case 'parse_error':
          return 'Couldn’t read the feed’s format'
        case 'ssrf_blocked':
          return 'That URL can’t be opened'
        case 'redirect_loop':
          return 'The redirects kept looping'
        default:
          return 'No feed found'
      }
    },
    editTitle: 'Edit feed',
    titleLabel: 'Title',
    titleHint: 'Leave this empty to use the title from the feed',
    feedUrlLabel: 'Feed URL',
    openSite: 'Open the site',
    lastFetchLabel: 'Last fetched',
    neverFetched: 'Not fetched yet',
    refreshQueued: 'Queued a refresh',
    fullContent: 'Show full articles',
    fullContentHint:
      'Pulls the article text from the original page. Useful for feeds that only deliver summaries. New articles are pulled when the feed is fetched, older ones when you open them',
    ogImage: 'Show og:image',
    ogImageHint:
      'Shows the article’s og:image below the title. If every article uses the same image, turning this off reads better',
    newTag: 'New tag',
    newTagPlaceholder: 'Tag name, then Enter',
    createTagFailed: 'Couldn’t create the tag',
    saved: 'Saved',
    unsubscribeTitle: 'Unsubscribe',
    unsubscribeBody: (title: string) =>
      `Unsubscribe from “${title}”? Its articles will be deleted too.`,
    unsubscribeConfirm: 'Unsubscribe',
    unsubscribed: 'Unsubscribed',
    unsubscribeFailed: 'Couldn’t unsubscribe',
  },
  tagDialog: {
    createTitle: 'Create tag',
    renameTitle: 'Rename tag',
    nameLabel: 'Tag name',
    createFailed: 'Couldn’t create the tag',
    deleted: 'Tag deleted',
    deleteFailed: 'Couldn’t delete the tag',
    deleteTitle: 'Delete tag',
    deleteBody: (name: string) => `Delete “${name}”? Feeds in this tag will stay subscribed.`,
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    nextAndOpen: 'Go to the next / previous article and open it',
    selectOnly: 'Move the selection without opening',
    toggleOpen: 'Open / close the selected article',
    openOriginal: 'Open the original page in a new tab',
    toggleRead: 'Toggle read / unread',
    toggleBookmark: 'Toggle bookmark',
    toggleFullContent: 'Switch between full article and feed content',
    markAllRead: 'Mark everything in the current view as read',
    refreshFeed: 'Refresh the current feed',
    focusSearch: 'Open search',
    goUnread: 'Go to unread articles',
    goBookmarks: 'Go to bookmarked articles',
    goAll: 'Go to all articles',
    focusColumn: 'Move focus between columns',
    openShortcuts: 'Show keyboard shortcuts',
    escape: 'Close the dialog / article',
    afterG: (key: string) => `g then ${key}`,
  },
  settings: {
    title: 'Settings',
    tabs: {
      display: 'Display',
      data: 'Data',
      storage: 'Storage',
      health: 'Fetch status',
      passkeys: 'Passkeys',
      sessions: 'Signed-in devices',
      tokens: 'Access tokens',
    },
    display: {
      title: 'Display',
      theme: 'Theme',
      themeSystem: 'System',
      themeLight: 'Light',
      themeDark: 'Dark',
      sort: 'Sort order',
      initialUnread: 'Articles to fetch when adding a feed',
      autoMarkRead: 'Mark articles as read when opened',
      unreadOnlyFeeds: 'Show only feeds with unread articles',
      homeUnread: 'Use Unread articles as the home page',
    },
    data: {
      title: 'Data',
      opmlTitle: 'OPML',
      opmlDescription: 'Import or export your feed subscriptions as an OPML file.',
      importFile: 'Import from file',
      exportOpml: 'Export OPML',
      importPaste: 'Import from pasted text',
      opmlText: 'OPML text',
      importPasted: 'Import pasted text',
      importFailed: 'Couldn’t import the OPML',
      imported: (count: number) => `Imported ${plural(count, 'feed')}`,
      refreshTitle: 'Refresh',
      refreshDescription: 'Re-fetches every subscribed feed and replaces the stored article text.',
      refreshAll: 'Refresh all feeds',
      refreshQueued: 'Queuing refresh…',
      refreshAllQueued: 'Refresh queued for all feeds',
      refreshAllFailed: 'Couldn’t queue the refresh',
      refreshConfirmTitle: 'Refresh all feeds',
      refreshConfirmBody: (count: number) =>
        `Re-fetches ${plural(count, 'subscribed feed')} and replaces the stored article text.`,
      refreshConfirm: 'Refresh',
    },
    storage: {
      title: 'Storage',
      recompute: 'Recalculate',
      recomputed: 'Storage recalculated',
      usage: 'Usage',
      perFeedTitle: 'Storage by feed',
      perFeedDescription: 'Deleting a feed’s stored articles never removes bookmarked articles.',
      empty: 'No feeds have been calculated yet. Press “Recalculate” to see current usage',
      itemBytes: (count: number, bytes: string) => `${plural(count, 'article')} · ${bytes}`,
      deleteMenu: 'Delete',
      deleteTrigger: 'Delete…',
      confirmTitle: 'Confirm deletion',
      deleted: 'Deleted',
      deleteFailed: 'Couldn’t delete',
      purgeRead30: 'Delete read articles older than 30 days',
      purgeRead30Body: (title: string, count: number) =>
        `Deletes read articles in “${title}” that are older than 30 days (up to ${plural(count, 'article')}). Bookmarked articles are kept.`,
      purgeFull: 'Delete full-article text only',
      purgeFullBody: (title: string, count: number) =>
        `Deletes only the full-article text from ${plural(count, 'article')} in “${title}”. Bookmarked articles are kept.`,
      purgeOriginal: 'Delete previous article text only',
      purgeOriginalBody: (title: string, count: number) =>
        `Deletes only the saved previous text of ${plural(count, 'article')} in “${title}”. Bookmarked articles are kept.`,
      purgeAll: 'Delete all articles',
      purgeAllBody: (title: string, count: number) =>
        `Deletes all ${plural(count, 'article')} in “${title}”. Bookmarked articles are kept. This can’t be undone.`,
    },
    health: {
      title: 'Fetch status',
      empty: 'No feeds have errors',
      refreshQueued: 'Refresh queued',
      disabled: (reason: string) => `Disabled: ${reason}`,
    },
    passkeys: {
      title: 'Passkeys',
      description: 'Manage the passkeys that can sign in to this account.',
      add: 'Add passkey',
      added: 'Passkey added',
      registerFailed: 'Couldn’t add the passkey',
      empty: 'No passkeys',
      fallbackName: 'Passkey',
      registered: (datetime: string) => `Registered ${datetime}`,
      lastCannotDelete: 'You can’t delete your last passkey. Add another one first.',
      deleted: 'Passkey deleted',
      deleteFailed: 'Couldn’t delete the passkey',
      deleteTitle: 'Delete passkey',
      deleteBody: (name: string) =>
        `Delete “${name}”? You won’t be able to sign in with this passkey anymore.`,
      deleteConfirm: 'Delete',
    },
    sessions: {
      title: 'Signed-in devices',
      description: 'Manage the devices signed in to this account.',
      empty: 'No signed-in devices',
      unknownDevice: 'Unknown device',
      signOut: 'Sign out',
      signOutCurrentConfirm: 'Sign out',
      signOutOtherConfirm: 'Sign out',
      signedOut: 'Device signed out',
      signOutFailed: 'Couldn’t sign out the device',
      current: 'This device',
      lastSeen: (datetime: string) => `Last active ${datetime}`,
      signedInWithToken: (name: string, lastSeen: string) =>
        `Signed in with the access token “${name}” · ${lastSeen}`,
      signOutCurrentTitle: 'Sign out of this device',
      signOutOtherTitle: 'Sign out device',
      signOutCurrentBody: 'You’ll be signed out on this device. Sign in again to continue.',
      signOutOtherBody: (name: string) =>
        `Sign out “${name}”? That device will need to sign in again.`,
    },
    tokens: {
      title: 'Access tokens',
      description:
        'Manage access tokens for RSS reader apps. Tokens can also be used to sign in instead of a passkey.',
      issueTitle: 'Create an access token',
      name: 'Name',
      nameHint: 'Use a name that says where you’ll use it, so it’s easy to tell apart later.',
      allowSignIn: 'Also allow signing in with this token',
      allowSignInHint:
        'Use it on the sign-in page instead of a passkey. It also helps you get back in if you lose your passkeys. You’ll confirm it’s you with a passkey before the token is created.',
      issue: 'Create',
      issued: 'Access token created',
      issuedAndResumed: 'Access token created, and sign-in with access tokens resumed',
      issueFailed: 'Couldn’t create the token',
      reauthFailed: 'Couldn’t confirm it’s you, so the token wasn’t created',
      newToken: 'New access token',
      showOnce:
        'This token is shown only once. Keep this page open until you’ve entered it in your RSS reader app.',
      showOnceSignIn:
        'This token is shown only once. Save it in a password manager or another safe place. Because it can also be used to sign in, create a separate token for your RSS reader apps.',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Couldn’t copy',
      listTitle: 'Your access tokens',
      empty: 'No access tokens yet',
      issuedAt: (datetime: string) => `Created ${datetime}`,
      signInBadge: 'Sign-in allowed',
      delete: 'Delete',
      deleteConfirm: 'Delete',
      deleted: 'Access token deleted',
      deleteFailed: 'Couldn’t delete the token',
      deleteTitle: 'Delete access token',
      deleteBody: (name: string) =>
        `Delete “${name}”? RSS reader apps using this token will be disconnected.`,
      deleteSignsOut: 'Every device signed in with this token will be signed out.',
      deleteLastSignIn:
        'No tokens will be allowed to sign in after this, so the access token field will disappear from the sign-in page.',
      deleteCurrent: 'This device will be signed out too.',
      signIn: {
        title: 'Sign-in with access tokens',
        statusEnabled: 'The sign-in page shows a field for entering an access token.',
        statusPaused:
          'Paused. Tokens marked “Sign-in allowed” can’t be used to sign in until you resume.',
        resumeHint: 'You’ll confirm it’s you with a passkey before resuming.',
        pause: 'Pause',
        resume: 'Resume',
        pauseTitle: 'Pause sign-in with access tokens',
        pauseBody:
          'The access token field will be removed from the sign-in page, and every device signed in with an access token will be signed out. RSS reader apps stay connected.',
        pauseCurrent:
          'This device will be signed out too. If you don’t have your passkey with you, you won’t be able to sign in again.',
        pauseConfirm: 'Pause',
        paused: 'Sign-in with access tokens paused',
        resumed: 'Sign-in with access tokens resumed',
        pauseFailed: 'Couldn’t pause sign-in with access tokens',
        resumeFailed: 'Couldn’t resume sign-in with access tokens',
        reauthFailed: 'Couldn’t confirm it’s you, so sign-in wasn’t resumed',
      },
    },
  },
  format: {
    justNow: 'Just now',
    minutesAgo: (count: number) => `${count} min ago`,
    hoursAgo: (count: number) => `${count} hr ago`,
    daysAgo: (count: number) => `${plural(count, 'day')} ago`,
    errorKinds: {
      timeout: 'Request timed out',
      network: 'Network error',
      http_5xx: 'Server error',
      rate_limited: 'Rate limited',
      cf_challenge: 'Blocked by a Cloudflare bot check',
      forbidden: 'Access denied',
      not_found: 'Feed not found',
      gone: 'Feed has been removed',
      http_4xx: 'Request error',
      too_large: 'Feed is too large',
      empty_body: 'Empty response',
      unsupported_format: 'Unsupported format',
      parse_error: 'Couldn’t parse the feed',
      ssrf_blocked: 'Unsafe URL',
      redirect_loop: 'Too many redirects',
    },
  },
  embed: {
    loadVideo: (host: string) => `Load ${host} video`,
    fallbackHost: 'embedded',
  },
  fullContent: {
    failed: 'Couldn’t load the full article',
    reasons: {
      no_url: 'no URL',
      ssrf_blocked: 'this URL can’t be fetched',
      timeout: 'the page didn’t respond in time',
      too_large: 'the page is too large',
      network: 'couldn’t connect',
      not_html: 'not an HTML page',
      extract: 'couldn’t find the article text',
    },
    failedHttp: (code: string) => `Couldn’t load the full article (HTTP ${code})`,
    failedWith: (reason: string) => `Couldn’t load the full article (${reason})`,
  },
}

export type Messages = typeof en
