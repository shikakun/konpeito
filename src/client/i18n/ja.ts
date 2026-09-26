import type { Messages } from './en.ts'

export const ja: Messages = {
  language: {
    label: '言語',
    en: 'English',
    ja: '日本語',
  },
  common: {
    cancel: 'キャンセル',
    close: '閉じる',
    loading: '読み込み中…',
    untitled: '無題',
    save: '保存',
    saving: '保存中…',
    saveFailed: '保存できませんでした',
    delete: '削除',
    deleteConfirm: '削除する',
    joinSentences: (sentences: string[]) => sentences.join(''),
    create: '作成',
    add: '追加',
    search: '検索',
    settings: '設定',
    logout: 'ログアウト',
    image: '画像',
    feeds: 'フィード',
    feed: 'フィード',
    tag: 'タグ',
    tags: 'タグ',
    refreshing: '再取得中',
    notFound: '見つかりません',
    moreActions: 'その他の操作',
    refresh: '再取得',
    sidebarWidth: 'サイドバーの幅',
    listWidth: '記事リストの幅',
  },
  demo: {
    label: 'サンプル画面',
    banner:
      'このページはCloudflare Workers + D1で動作するように設計された、フィードリーダーアプリ「Konpeito」のサンプル画面です。',
    repo: 'Konpeito',
  },
  login: {
    submit: 'パスキーでログイン',
    registerFailed: 'パスキーを登録できませんでした',
    unknownPasskey: 'このパスキーは登録されていません',
    loginFailed: 'ログインできませんでした',
    challengeFailed: 'ログインを開始できませんでした。もう一度お試しください。',
    registerChallengeFailed: 'パスキーの登録を開始できませんでした。もう一度お試しください。',
    registerVerifyFailed: 'パスキーを登録できませんでした',
    tokenLabel: 'アクセストークン',
    back: '戻る',
    tokenSubmit: 'アクセストークンでログイン',
    tokenFailed:
      'ログインできませんでした。アクセストークンが正しいか、ログインにも使えるアクセストークンかを確認してください。',
  },
  sidebar: {
    addMenu: '追加',
    addFeed: 'フィードを追加',
    createTag: 'タグを作成',
    allArticles: 'すべての記事',
    unread: '未読の記事',
    bookmarked: 'ブックマークした記事',
    uncategorized: '未分類',
    emptyFeeds: 'フィードはまだありません',
    gone: '削除済み',
    unreadCount: (count: number) => `未読${count}件`,
    unreadCountShort: (count: number) => `${count}件`,
  },
  list: {
    newestFirst: '新しい順',
    oldestFirst: '古い順',
    markAllRead: 'すべて既読',
    articleList: '記事リスト',
    updated: '更新',
    emptySearch: (query: string) => `「${query}」に一致する記事はありません`,
    emptyUnread: '未読の記事はありません',
    emptyBookmarks: 'ブックマークした記事はありません',
    emptyRecentlyRead: '最近読んだ記事はありません',
    emptyUpdated: '更新された記事はありません',
    emptyDefault: '記事はありません',
    recentlyRead: '最近読んだ記事',
    updatedHeading: '更新あり',
    searchResults: (query: string) => `「${query}」の検索結果`,
  },
  article: {
    backToList: '記事リストへ戻る',
    actions: '記事の操作',
    bookmark: 'ブックマーク',
    unbookmark: 'ブックマークを外す',
    markRead: '既読にする',
    markUnread: '未読へ戻す',
    showFull: '全文を表示',
    showFeed: '配信された内容を表示',
    showDiff: '変更点を表示',
    hideDiff: '変更点を隠す',
    openOriginal: '元記事を開く',
    nextArticle: '次の記事へ',
    caughtUp: 'すべての記事を読み終えました',
    markedRead: '既読にしました',
    markedUnread: '未読へ戻しました',
    bookmarked: 'ブックマークしました',
    unbookmarked: 'ブックマークを外しました',
    markedAllRead: 'すべて既読にしました',
    markAllConfirmTitle: 'すべて既読にしますか？',
    markAllConfirmBody: 'いま表示している記事をすべて既読にします。',
    shownFull: '全文を表示しました',
    shownFeed: '配信された内容を表示しました',
  },
  sourceMenu: {
    editFeed: 'フィードを編集',
    refresh: '再取得',
    moveToFront: '先頭へ移動',
    unsubscribe: '購読を解除',
    rename: '名前を変更',
    delete: '削除',
  },
  feedDialog: {
    addTitle: 'フィードを追加',
    urlLabel: 'フィードまたはサイトのURL',
    invalidUrl: 'URLを確認してください',
    find: '探す',
    findAgain: '探し直す',
    finding: '探しています…',
    foundTitle: '見つかったフィード',
    foundCount: (count: number) => `${count}件見つかりました`,
    subscribed: '購読中',
    addedRow: '追加済み',
    adding: '追加しています…',
    itemCount: (count: number) => `記事${count}件`,
    latestItem: (when: string) => `最新は${when}`,
    notFound: 'フィードが見つかりませんでした',
    addFailed: '追加できませんでした',
    added: 'フィードを追加しました',
    addedCount: (count: number) => `${count}件のフィードを追加しました`,
    discoverFailure: (kind: string, status: number | null): string => {
      switch (kind) {
        case 'timeout':
          return '配信元から応答がありませんでした'
        case 'network':
          return '配信元と接続できませんでした。URLを確認してください'
        case 'http_5xx':
          return `配信元のサーバーでエラーが発生しています（HTTP ${status ?? '5xx'}）`
        case 'rate_limited':
          return '配信元にアクセスを制限されています。時間をおいて試してください'
        case 'cf_challenge':
          return '配信元のbot対策によってアクセスを拒否されました'
        case 'forbidden':
          return '配信元にアクセスを拒否されました（HTTP 403）'
        case 'not_found':
          return 'ページが見つかりませんでした（HTTP 404）'
        case 'gone':
          return 'このフィードは配信を終了しています（HTTP 410）'
        case 'http_4xx':
          return `配信元がエラーを返しました（HTTP ${status ?? '4xx'}）`
        case 'too_large':
          return 'フィードが大きすぎて取得できませんでした'
        case 'empty_body':
          return '配信元から空の応答が返ってきました'
        case 'unsupported_format':
          return 'このURLではフィードが見つかりませんでした'
        case 'parse_error':
          return 'フィードの形式を読み取れませんでした'
        case 'ssrf_blocked':
          return 'このURLは開けません'
        case 'redirect_loop':
          return 'リダイレクトが繰り返されて、アクセスできませんでした'
        default:
          return 'フィードが見つかりませんでした'
      }
    },
    editTitle: 'フィードを編集',
    titleLabel: 'タイトル',
    titleHint: '空にすると配信元のタイトルを表示します。',
    feedUrlLabel: 'フィードのURL',
    openSite: 'サイトを開く',
    lastFetchLabel: '最終取得',
    neverFetched: 'まだ取得していません',
    refreshQueued: '再取得を予約しました',
    fullContent: '記事を全文で表示する',
    fullContentHint:
      '元記事のページから本文を取り出して表示します。概要だけを配信しているフィードで便利です。新着は取り込むときに、古い記事は開いたときに取り出します。',
    ogImage: 'og:imageを表示する',
    ogImageHint:
      '記事のタイトルの下に、記事のog:imageに指定されているアイキャッチ画像を表示します。どの記事にも同じ画像が指定されている場合は、オフにすると読みやすくなります。',
    newTag: '新しいタグ',
    newTagPlaceholder: 'タグ名を入力してEnter',
    createTagFailed: 'タグを作成できませんでした',
    saved: '保存しました',
    unsubscribeTitle: '購読を解除',
    unsubscribeBody: (title: string) => `「${title}」の購読を解除しますか？記事も削除されます。`,
    unsubscribeConfirm: '購読を解除する',
    unsubscribed: '購読を解除しました',
    unsubscribeFailed: '購読を解除できませんでした',
  },
  tagDialog: {
    createTitle: 'タグを作成',
    renameTitle: 'タグ名を変更',
    nameLabel: 'タグ名',
    createFailed: '作成できませんでした',
    deleted: 'タグを削除しました',
    deleteFailed: '削除できませんでした',
    deleteTitle: 'タグを削除',
    deleteBody: (name: string) => `「${name}」を削除しますか？フィードの購読は残ります。`,
  },
  shortcuts: {
    title: 'キーボードショートカット',
    nextAndOpen: '次 / 前の記事へ移動して開く',
    selectOnly: '開かずに選択だけを移動',
    toggleOpen: '選択中の記事を開く / 閉じる',
    openOriginal: '元サイトを新しいタブで開く',
    toggleRead: '既読・未読の切り替え',
    toggleBookmark: 'ブックマークの付け外し',
    toggleFullContent: '全文と配信された内容の切り替え',
    markAllRead: '表示中の記事をすべて既読にする',
    refreshFeed: '表示中のフィードを再取得',
    focusSearch: '検索を開く',
    goUnread: '未読の記事へ',
    goBookmarks: 'ブックマークした記事へ',
    goAll: 'すべての記事へ',
    focusColumn: 'カラム間のフォーカス移動',
    openShortcuts: 'ショートカット一覧',
    escape: 'ダイアログ / 記事を閉じる',
    afterG: (key: string) => `g のあと ${key}`,
  },
  settings: {
    title: '設定',
    tabs: {
      display: '表示',
      data: 'データ',
      storage: 'ストレージ',
      health: '取得状況',
      passkeys: 'パスキー',
      sessions: 'ログイン中の端末',
      tokens: 'アクセストークン',
    },
    display: {
      title: '表示',
      theme: 'テーマ',
      themeSystem: 'システム',
      themeLight: 'ライト',
      themeDark: 'ダーク',
      sort: '記事の並び順',
      initialUnread: 'フィード追加時の取得件数',
      autoMarkRead: '記事を開いたら既読にする',
      unreadOnlyFeeds: '未読の記事があるフィードだけ表示する',
      homeUnread: 'トップページを「未読の記事」にする',
    },
    data: {
      title: 'データ',
      opmlTitle: 'OPML',
      opmlDescription: '購読しているフィードの一覧を、OPML形式で書き出したり取り込んだりできます。',
      importFile: 'ファイルから取り込む',
      exportOpml: 'OPMLを書き出す',
      importPaste: 'テキストを貼り付けて取り込む',
      opmlText: 'OPMLのテキスト',
      importPasted: '貼り付けた内容を取り込む',
      importFailed: 'OPMLの取り込みに失敗しました',
      imported: (count: number) => `${count}件を取り込みました`,
      refreshTitle: '再取得',
      refreshDescription: '購読しているフィードをすべて再取得し、保存済みの本文を上書きします。',
      refreshAll: 'すべてのフィードを再取得',
      refreshQueued: '再取得を予約しています…',
      refreshAllQueued: 'すべてのフィードの再取得を予約しました',
      refreshAllFailed: '再取得を予約できませんでした',
      refreshConfirmTitle: 'すべてのフィードを再取得',
      refreshConfirmBody: (count: number) =>
        `購読している${count}件のフィードをすべて再取得し、保存済みの本文を上書きします。`,
      refreshConfirm: '再取得する',
    },
    storage: {
      title: 'ストレージ',
      recompute: '集計を更新',
      recomputed: '集計を更新しました',
      usage: '使用量',
      perFeedTitle: 'フィードごとの容量',
      perFeedDescription:
        'フィードの保存済みの記事を削除しても、ブックマークした記事は削除しません。',
      empty: '集計済みのフィードはありません。「集計を更新」を押すと最新の状態になります。',
      itemBytes: (count: number, bytes: string) => `${count}件 · ${bytes}`,
      deleteMenu: '削除',
      deleteTrigger: '削除…',
      confirmTitle: '削除の確認',
      deleted: '削除しました',
      deleteFailed: '削除できませんでした',
      purgeRead30: '30日以前の既読を削除',
      purgeRead30Body: (title: string, count: number) =>
        `「${title}」の30日以前の既読記事を削除します。対象は最大${count}件です。ブックマークした記事は削除しません。`,
      purgeFull: '全文だけ削除',
      purgeFullBody: (title: string, count: number) =>
        `「${title}」の全文だけを削除します。記事${count}件が対象です。ブックマークした記事は削除しません。`,
      purgeOriginal: '変更前の本文だけ削除',
      purgeOriginalBody: (title: string, count: number) =>
        `「${title}」に保存されている変更前の本文だけを削除します。記事${count}件が対象です。ブックマークした記事は削除しません。`,
      purgeAll: '記事をすべて削除',
      purgeAllBody: (title: string, count: number) =>
        `「${title}」の記事${count}件をすべて削除します。ブックマークした記事は削除しません。この操作は取り消せません。`,
    },
    health: {
      title: '取得状況',
      empty: 'エラーが発生しているフィードはありません',
      refreshQueued: '再取得を予約しました',
      disabled: (reason: string) => `無効: ${reason}`,
    },
    passkeys: {
      title: 'パスキー',
      description: 'このアカウントにログインできるパスキーを管理できます。',
      add: 'パスキーを追加',
      added: 'パスキーを追加しました',
      registerFailed: 'パスキーを追加できませんでした',
      empty: 'パスキーはありません',
      fallbackName: 'パスキー',
      registered: (datetime: string) => `${datetime}に登録`,
      lastCannotDelete: '最後のひとつは削除できません。先に別のパスキーを追加してください。',
      deleted: 'パスキーを削除しました',
      deleteFailed: '削除できませんでした',
      deleteTitle: 'パスキーを削除',
      deleteBody: (name: string) =>
        `「${name}」を削除します。このパスキーではログインできなくなります。`,
      deleteConfirm: '削除する',
      reauthFailed: '本人確認ができなかったため、中止しました',
    },
    sessions: {
      title: 'ログイン中の端末',
      description: 'ログインしている端末を管理できます。',
      empty: 'ログイン中の端末はありません',
      unknownDevice: '不明な端末',
      signOut: 'ログアウト',
      signOutCurrentConfirm: 'ログアウトする',
      signOutOtherConfirm: 'ログアウトさせる',
      signedOut: '端末をログアウトさせました',
      signOutFailed: 'ログアウトできませんでした',
      current: 'この端末',
      lastSeen: (datetime: string) => `最終アクセス ${datetime}`,
      signedInWithToken: (name: string, lastSeen: string) =>
        `アクセストークン「${name}」でログイン・${lastSeen}`,
      signOutCurrentTitle: 'この端末からログアウト',
      signOutOtherTitle: '端末をログアウト',
      signOutCurrentBody:
        'この端末からログアウトします。続けるには、もう一度ログインしてください。',
      signOutOtherBody: (name: string) =>
        `「${name}」をログアウトさせます。その端末では、もう一度ログインが必要になります。`,
    },
    tokens: {
      title: 'アクセストークン',
      description:
        'RSSリーダーアプリとの連携に使うアクセストークンを管理できます。パスキーの代わりにログインするときにも使えます。',
      issueTitle: 'アクセストークンの発行',
      name: '名前',
      nameHint: '使う場所がわかる名前にしておくと、あとで見分けやすくなります。',
      allowSignIn: 'ログインにも使えるようにする',
      allowSignInHint:
        'ログイン画面で、パスキーの代わりに使えます。パスキーを失くしたときの復旧にも役立ちます。発行する前に、パスキーで本人確認をします。',
      issue: '発行',
      issued: 'アクセストークンを発行しました',
      issuedAndResumed: 'アクセストークンを発行し、アクセストークンでのログインを再開しました',
      resumeTitle: 'アクセストークンでのログインを再開',
      resumeBody:
        'アクセストークンでのログインは停止しています。ログイン可のアクセストークンを発行すると、ログインを再開します。',
      resumeBodyExisting:
        '停止する前に発行したログイン可のアクセストークンも、ふたたびログインに使えるようになります。',
      resumeConfirm: '再開して発行する',
      issueFailed: '発行できませんでした',
      reauthFailed: '本人確認ができなかったため、発行を中止しました',
      newToken: '新しいアクセストークン',
      showOnce:
        'このアクセストークンを表示できるのは今だけです。RSSリーダーアプリに入力するまで、この画面を開いたままにしてください。',
      showOnceSignIn:
        'このアクセストークンを表示できるのは今だけです。パスワードマネージャーなどに保存してください。ログインにも使えるため、RSSリーダーアプリには別のアクセストークンを発行して使ってください。',
      copy: 'コピー',
      copied: 'コピーしました',
      copyFailed: 'コピーできませんでした',
      listTitle: 'アクセストークンの一覧',
      empty: 'アクセストークンはまだありません',
      issuedAt: (datetime: string) => `${datetime}に発行`,
      signInBadge: 'ログイン可',
      delete: '削除',
      deleteConfirm: '削除する',
      deleted: 'アクセストークンを削除しました',
      deleteFailed: '削除できませんでした',
      deleteTitle: 'アクセストークンを削除',
      deleteBody: (name: string) =>
        `「${name}」を削除します。このアクセストークンを使っているRSSリーダーアプリとは、連携できなくなります。`,
      deleteSignsOut: 'このアクセストークンでログインしている端末は、すべてログアウトされます。',
      deleteLastSignIn:
        'ログイン可のアクセストークンがなくなるため、ログイン画面にアクセストークンの入力欄が表示されなくなります。',
      deleteCurrent: 'この端末もログアウトされます。',
      signIn: {
        title: 'アクセストークンでのログイン',
        statusEnabled: 'ログイン画面に、アクセストークンの入力欄を表示しています。',
        statusPaused:
          '停止しています。ログイン可のアクセストークンがあっても、ログインには使えません。',
        resumeHint: '再開する前に、パスキーで本人確認をします。',
        pause: '停止',
        resume: '再開',
        pauseTitle: 'アクセストークンでのログインを停止',
        pauseBody:
          'ログイン画面からアクセストークンの入力欄を消し、アクセストークンでログインしている端末をすべてログアウトさせます。RSSリーダーアプリとの連携は、そのまま使えます。',
        pauseCurrent:
          'この端末もログアウトされます。パスキーが手元にない場合は、再びログインできなくなります。',
        pauseConfirm: '停止する',
        paused: 'アクセストークンでのログインを停止しました',
        resumed: 'アクセストークンでのログインを再開しました',
        pauseFailed: '停止できませんでした',
        resumeFailed: '再開できませんでした',
        reauthFailed: '本人確認ができなかったため、再開を中止しました',
      },
    },
  },
  format: {
    justNow: 'たった今',
    minutesAgo: (count: number) => `${count}分前`,
    hoursAgo: (count: number) => `${count}時間前`,
    daysAgo: (count: number) => `${count}日前`,
    errorKinds: {
      timeout: '応答がタイムアウトしました',
      network: 'ネットワークエラーです',
      http_5xx: 'サーバーエラーです',
      rate_limited: 'レート制限中です',
      cf_challenge: 'Cloudflareのbot判定で拒否されました',
      forbidden: 'アクセスが拒否されました',
      not_found: 'フィードが見つかりません',
      gone: 'フィードは削除されています',
      http_4xx: 'リクエストエラーです',
      too_large: 'フィードが大きすぎます',
      empty_body: '応答が空です',
      unsupported_format: '未対応の形式です',
      parse_error: 'フィードの形式が読み取れません',
      ssrf_blocked: '安全でないURLです',
      redirect_loop: 'リダイレクトが多すぎます',
    },
  },
  embed: {
    loadVideo: (host: string) => `${host}の動画を読み込む`,
    fallbackHost: '埋め込み',
  },
  fullContent: {
    failed: '全文を取得できませんでした',
    reasons: {
      no_url: 'URLがありません',
      ssrf_blocked: 'このURLには接続できません',
      timeout: '時間内に応答がありませんでした',
      too_large: 'ページが大きすぎます',
      network: '接続できませんでした',
      not_html: 'HTMLのページではありません',
      extract: '本文を見つけられませんでした',
    },
    failedHttp: (code: string) => `全文を取得できませんでした（HTTP ${code}）`,
    failedWith: (reason: string) => `全文を取得できませんでした（${reason}）`,
  },
}
