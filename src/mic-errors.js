// 把 getUserMedia 的錯誤翻成使用者看得懂的說明（純函式，可測試）

export function isMicContextAllowed(loc, isSecureContext) {
  if (isSecureContext) return true;
  const host = loc && loc.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** @returns {{kind:string, title:string, steps:string[]}} */
export function describeMicError(err, { secure = true } = {}) {
  const name = (err && err.name) || '';
  if (!secure) {
    return {
      kind: 'insecure',
      title: '這個網址不能使用麥克風',
      steps: [
        '瀏覽器只允許 https:// 或 localhost 的網頁使用麥克風。',
        '請改用 https:// 開頭的網址，或在電腦上用 http://localhost 開啟。',
      ],
    };
  }
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return {
        kind: 'denied',
        title: '麥克風權限被拒絕了',
        steps: [
          'iPhone Safari：點網址列左側的「ぁA」（或「aA」）圖示 → 網站設定 → 麥克風 → 選「允許」，然後重新整理頁面。',
          'iPhone 也可以到「設定 → Safari → 麥克風」，把這個網站改成「詢問」或「允許」。',
          'Chrome（電腦）：點網址列左側的圖示 → 網站設定 → 麥克風 → 允許，然後重新整理。',
          'Safari（Mac）：Safari → 設定 → 網站 → 麥克風，把這個網站設為「允許」。',
        ],
      };
    case 'NotSupportedError':
      return unsupported();
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return {
        kind: 'notfound',
        title: '找不到可用的麥克風',
        steps: ['請確認麥克風已接上，或在下方「麥克風」選單換一個裝置，再按一次「開始調音」。'],
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        kind: 'busy',
        title: '麥克風無法啟動',
        steps: ['可能有其他 App 正在使用麥克風（例如視訊會議）。關閉它們後再試一次。'],
      };
    default:
      if (name === 'TypeError' && /getUserMedia|mediaDevices/i.test(String(err && err.message))) {
        return unsupported();
      }
      return {
        kind: 'other',
        title: '無法開啟麥克風',
        steps: [`錯誤訊息：${(err && (err.message || err.name)) || '未知錯誤'}`],
      };
  }
}

export function unsupported() {
  return {
    kind: 'unsupported',
    title: '這個瀏覽器不支援麥克風輸入',
    steps: ['請改用較新版本的 Safari、Chrome、Edge 或 Firefox。'],
  };
}
