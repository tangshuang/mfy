export function createProxyElement(element, basic = {}) {
  return new Proxy({ ...basic }, {
    get(target, key) {
      const value = key in target ? Reflect.get(target, key) : Reflect.get(element, key)
      return typeof value === 'function' ? (key in target ? value.bind(target) : value.bind(element)) : value
    },
  })
}

export function createProxyDocument(doc = document, basic = {}) {
  const body = createProxyElement(doc.body)
  const head = createProxyElement(doc.head)
  const fakeDocument = {
    head,
    body,
    ...basic,
  }
  return createProxyElement(doc, fakeDocument)
}

export async function createProxyWindow(win = window, basic = {}) {
  const doc = createProxyDocument(document)

  // 使用一个iframe内部的window作为基座，可以隔绝history和location变化带来的影响
  const fake = {}
  const iframe = doc.createElement('iframe')
  // iframe.src = 'about:blank'
  iframe.srcdoc = ' '
  iframe.style.position = 'fixed'
  iframe.style.top = '-10000px'

  const buildFakeWindow = async () => {
    doc.body.appendChild(iframe)
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
    doc.body.removeChild(iframe)
  }

  const rebuildFakeWindow = async () => {
    if (!fake.destroyed) {
      return
    }
    await buildFakeWindow()
  }

  await buildFakeWindow()

  const fakeWindow = new Proxy({}, {
    get(target, key) {
      if (fake.window) {
        const value = fake.window[key]
        return typeof value === 'function' ? value.bind(fake.window) : value
      }
      else {
        const value = win[key]
        return typeof value === 'function' ? value.bind(win) : value
      }
    },
    set(target, key, value) {
      if (fake.window) {
        return fake.window[key] = value
      }
      else {
        return win[key] = value
      }
    },
    deleteProperty(target, key) {
      if (fake.window) {
        return delete fake.window[key]
      }
      else {
        return delete win[key]
      }
    },
  })

  return createProxyElement(fakeWindow, {
    document: doc,
    ...basic,
    rebuildFakeWindow,
    destroyFakeWindow,
  })
}

export async function createSandboxGlobalObjects(fakeGlobalObjects = {}) {
  const fakeDocument = fakeGlobalObjects.document || createProxyDocument(document)
  const fakeWindow = fakeGlobalObjects.window || await createProxyWindow(window, { document: fakeDocument })
  const { history, location } = fakeWindow
  return { window: fakeWindow, document: fakeDocument, history, location }
}

export async function runScriptInSandbox(scriptCode, sandbox, injectGlobalVars = {}) {
  const { window, document, location, history } = sandbox || await createSandboxGlobalObjects()
  const varNames = Object.keys(injectGlobalVars)

  const resolver = new Function(`
    return function(window, document, location, history${varNames.length ? ', ' + varNames.join(', ') : ''}) {
      ${scriptCode}
    }
  `)

  const varList = varNames.map(name => injectGlobalVars[name])
  return resolver()(window, document, location, history, ...varList)
}
