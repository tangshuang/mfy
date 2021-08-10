export function createProxyElement(element, fakeElement = {}) {
  const proxy = new Proxy(fakeElement, {
    get(_, key) {
      // 加固，防止逃逸
      if (key === Symbol.unscopables) {
        return;
      }
      const el = typeof fakeElement[key] !== 'undefined' ? fakeElement : element
      const value = el[key]
      return typeof value === 'function' ? value.bind(element) : value
    },
  })
  return proxy
}

export function createProxyDocument(doc = {}) {
  const body = createProxyElement(doc.body || document.body)
  const head = createProxyElement(doc.head || document.head)
  const fakeDocument = {
    head,
    body,
  }
  return createProxyElement(doc, fakeDocument)
}

export async function createProxyWindow(win = window, doc = createProxyDocument()) {
  const fakeId = Number.parseInt(Math.random() * 1000, 10)

  // 使用一个iframe内部的window作为基座，可以隔绝history和location变化带来的影响
  const fake = {}
  const iframe = document.createElement('iframe')
  // iframe.src = 'about:blank'
  iframe.srcdoc = ' '
  iframe.style.position = 'fixed'
  iframe.style.top = '-10000px'
  iframe.id = 'mfy-window-' + fakeId

  const buildFakeWindow = async () => {
    document.body.appendChild(iframe)
    await new Promise((resolve, reject) => {
      const onload = () => {
        fake.window = iframe.contentWindow
        // 下面这两句让空iframe神奇的同域了
        iframe.contentWindow.document.write('')
        iframe.contentWindow.document.clear()
        // 让它拥有一个默认的url地址
        fake.window.history.replaceState(null, null, win.location.href)
        resolve()
      }
      if (iframe.src === 'about:blank') {
        onload()
      }
      else {
        iframe.onload = onload
        iframe.onerror = reject
      }
    })
  }

  const destroyFakeWindow = () => {
    fake.window = null
    fake.destroyed = true
    iframe.src = 'about:blank'
    iframe.contentWindow.document.write('')
    iframe.contentWindow.document.clear()
    document.body.removeChild(iframe)
  }

  const rebuildFakeWindow = async () => {
    if (!fake.destroyed) {
      return
    }
    await buildFakeWindow()
  }

  await buildFakeWindow()

  const fakeWindow = new Proxy({}, {
    get(_, key) {
      // 加固，防止逃逸
      if (key === Symbol.unscopables) {
        return;
      }
      if (fake.window) {
        const value = fake.window[key]
        return typeof value === 'function' ? value.bind(fake.window) : value
      }
      else {
        const value = win[key]
        return typeof value === 'function' ? value.bind(win) : value
      }
    },
    set(_, key, value) {
      if (fake.window) {
        return fake.window[key] = value
      }
      else {
        return win[key] = value
      }
    },
    deleteProperty(_, key) {
      if (fake.window) {
        return delete fake.window[key]
      }
      else {
        return delete win[key]
      }
    },
  })

  return createProxyElement(fakeWindow, {
    fakeId,
    document: doc,
    rebuildFakeWindow,
    destroyFakeWindow,
  })
}

export async function createSandboxGlobalVars(fakeGlobalVars = {}) {
  const { document: doc = document, window: win = window, body, head, history: his, location: loc } = fakeGlobalVars
  const fakeDocument = createProxyDocument(doc || document, { body, head })
  const fakeWindow = await createProxyWindow(win || window, fakeDocument)
  const history = his || fakeWindow.history
  const location = loc || fakeWindow.location
  return { $$type: 'sandbox', window: fakeWindow, document: fakeDocument, history, location }
}

export async function runScriptInSandbox(scriptCode, sandboxGlobalVars = {}, injectGlobalVars = {}) {
  const { window, document, location, history } = sandboxGlobalVars.$$type === 'sandbox' ? sandboxGlobalVars : await createSandboxGlobalVars(sandboxGlobalVars)

  const names = Object.keys(injectGlobalVars)
  const hasVars = names.length
  const values = Object.values(injectGlobalVars)

  // 检查代码合法性，避免代码非法关闭 with
  let pairs = []
  for (let i = 0, len = scriptCode.length; i < len; i ++) {
    const char = scriptCode[i]
    if (char === '{') {
      pairs.push('{')
    }
    else if (char === '}') {
      if (!pairs.length) {
        throw new Error(`传入代码有非法的关闭 } at ${i}: ${scriptCode}`)
      }
      pairs.pop()
    }
  }

  // 在内部可能直接使用window上的全局变量，因此要放在with内部运行
  const resolver = new Function([
    `return function(window,document,location,history${hasVars ? ',' + names.join(',') : ''}) {`,
      'with (window) {',
        scriptCode,
      '}',
    '}',
  ].join(''))
  return resolver()(window, document, location, history, ...values)
}
