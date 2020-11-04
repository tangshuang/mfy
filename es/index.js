import {
  resolvePath,
  getTopWindow,
  getTopElement,
  isInternalLink,
  asyncIterate,
} from './utils/utils.js'
import MFY_Element from './mfy-element.js'

// 注册元素
if (!customElements.get('mfy-app')) {
  customElements.define('mfy-app', MFY_Element)
}

const _setScopeToTopWindow = (scope) => {
  const win = getTopWindow()
  win.__MFY_SCOPE__ = scope
}

const topWindow = getTopWindow()
topWindow.__MFY_ROOT_SCOPE__ = topWindow.__MFY_ROOT_SCOPE__ ? topWindow.__MFY_ROOT_SCOPE__ : createScope(topWindow.location.pathname)

function createSource(url, options = {}) {
  const source = {
    url,
    text: '',
  }

  const { sourceSwitchMapping } = options

  const fetchText = () => {
    if (!isInternalLink(url) && (!sourceSwitchMapping || !sourceSwitchMapping[url])) {
      return Promise.resolve()
    }

    // url是外部链接，例如来自CDN的链接，仅支持独立的模块加载，不支持带有全局污染的模块加载
    if (!isInternalLink(url) && sourceSwitchMapping && sourceSwitchMapping[url]) {
      const { getExports, setEnv } = sourceSwitchMapping

      return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe')
        iframe.srcdoc = ' '
        iframe.onload = () => {
          const win = iframe.contentWindow
          const doc = win.document
          doc.write('')
          setEnv && setEnv(win)

          const script = doc.createElement('script')
          script.src = url
          doc.body.appendChild(script)
          script.onload = () => {
            source.exports = getExports(win)
            doc.write('')
            iframe.src = 'about:blanck'
            document.body.removeChild(iframe)
            resolve()
          }
          script.onerror = reject
        }
        iframe.onerror = reject
        document.body.appendChild(iframe)
      })
    }

    return fetch(url).then(res => res.text()).then((text) => {
      source.text = text
    }).finally(() => {
      source.fetched = true
    })
  }

  const deferer = fetchText()
  source.ready = fn => fn ? deferer.then(fn) : deferer

  return source
}

function createScope(url, parentScope) {
  const scope = {
    url, // scope所在的资源url
    parentScope, // 父级scope
    apps: [], // scope内注册的子应用
  }

  const listeners = []
  const on = (event, callback) => {
    listeners.push([event, callback])
  }
  const off = (event, callback) => {
    listeners.forEach((item, i) => {
      if (item[0] === event && (!callback || item[1] === callback)) {
        listeners.splice(i, 1)
      }
    })
  }
  const trigger = (event, data) => {
    listeners.forEach((item) => {
      if (item[0] === event) {
        item[1](data)
      }
    })
  }

  scope.on = on
  scope.off = off
  scope.trigger = trigger

  // 向父应用发消息
  const emit = (data) => {
    trigger('message:toParent', data)
  }
  // 接收到子应用发来的消息
  // 将接收函数挂载在子应用scope上有一个好处，当子应用销毁时，这些函数也会被销毁
  const watch = (name, fn) => {
    // 监听全部子应用
    if (typeof name === 'function') {
      fn = name
      scope.apps.forEach((app) => {
        app.scope.on('message:toParent', fn)
      })
      return
    }
    // 监听单个子应用
    const app = scope.apps.find(app => app.name === name)
    if (app) {
      app.scope.on('message:toParent', fn)
    }
  }

  // 向单个子应用发送消息
  const send = (name, data) => {
    const app = scope.apps.find(app => app.name === name)
    if (app) {
      app.scope.trigger('message:toChild', data)
    }
  }
  // 向子应用广播消息
  const dispatch = (data) => {
    scope.apps.forEach((app) => {
      app.scope.trigger('message:toChild', data)
    })
  }
  // 从rootScope开始广播
  const broadcast = (data) => {
    const rootScope = connectScope(true)
    const dispatch = (scope) => {
      scope.apps.forEach((app) => {
        app.scope.trigger('message:toChild', data)
        dispatch(app.scope)
      })
    }
    dispatch(rootScope)
  }
  // 接收父应用广播的消息
  const listen = (fn) => {
    on('message:toChild', fn)
  }

  scope.emit = emit
  scope.send = send
  scope.dispatch = dispatch
  scope.broadcast = broadcast
  scope.listen = listen
  scope.watch = watch

  return scope
}

function createApp(parentScope, options) {
  const { name, source, type, placeholder, onLoad, onBootstrap, onMount, onUnmount, onDestroy, onMessage, autoBootstrap, autoMount, hoistCssRules } = options
  const app = {
    name,
    type,
    mounted: null, // 用来标记当前app是否处于被挂载状态，并不表面dom元素一定存在，可能已经被销毁了
    hoistCssRules,
  }

  async function bootstrap(isToMount) {
    onBootstrap && onBootstrap()

    if (typeof source === 'function') {
      _setScopeToTopWindow(parentScope)
      app.source = source()
      _setScopeToTopWindow(null)
    }
    else {
      app.source = source
    }

    const scope = createScope(app.source.url, parentScope)
    const element = document.querySelector(`mfy-app[name=${name}]`)

    if (!element) {
      throw new Error(`文档中不存在 mfy-app[name=${name}] 元素`)
    }

    app.scope = scope
    app.element = element

    // 让父级监听当前应用
    // 必须在app.scope赋值之后
    if (onMessage) {
      parentScope.watch(name, onMessage)
    }

    // 将当前app挂载在顶层元素上，这样，可以在customElement第二次加载时被取出来
    const rootElement = getTopElement(element)
    rootElement.__apps = rootElement.__apps || []
    rootElement.__apps.push(app)

    await createSandbox()
    await load()
    if (isToMount) {
      await mount()
    }
  }

  async function load() {
    await app.source.ready()
    onLoad && onLoad()
  }

  async function createSandbox() {
    const { type, source, element } = app
    element.on('mount', () => onMount && onMount())
    element.on('unmount', () => onUnmount && onUnmount())
    element.on('destroy', () => onDestroy && onDestroy())
    element.on('destroy', () => { delete app.element })

    if (type === 'iframe') {
      await element.createIframe()
    }
    else if (type === 'shadowdom') {
      await element.createVM()
    }
    else {
      await element.createBox()
    }

    const { url } = source
    element.sandbox.setAttribute('scope-url', url)
    element.on('urlchange', (data) => {
      app.scope.trigger(data)
    })
  }

  async function mount(params = {}) {
    const { type, source, element, scope, hoistCssRules, name } = app
    app.mounted = { params }

    // element可能已经被销毁
    if (!element) {
      return
    }

    await element.ready()
    placeholder && !source.fetched && element.wait && element.wait(typeof placeholder === 'function' ? placeholder() : placeholder)
    await source.ready()

    if (type === 'iframe') {
      const { url } = source
      await element.mount(url, params)
    }
    else if (type === 'shadowdom') {
      const { styles, scripts, elements } = await parseSourceText(source)

      if (hoistCssRules) {
        const rules = []
        styles.forEach((style) => {
          if (!style.rules) {
            return
          }
          style.rules.forEach((rule) => {
            const res = hoistCssRules(rule)
            if (res && typeof res === 'string') {
              rules.push(res)
            }
          })
        })

        const id = 'mfy-hoist-style-' + name

        // 卸载原有的样式块
        const el = document.querySelector('style#' + id)
        if (el) {
          el.parentNode.removeChild(el)
        }

        const styleEl = document.createElement('style')
        styleEl.id = id

        const textContent = '\n' + rules.join('\n') + '\n'
        styleEl.textContent = textContent
        document.head.appendChild(styleEl)
      }

      await element.mount({ styles, scripts, elements }, {
        ...params,
        // 运行资源内的脚本
        // 脚本内部可能会产生新的子应用
        globalVars: {
          __MFY_SCOPE__: scope,
        },
      })
    }
    else {
      const { styles, scripts, elements } = await parseSourceText(source)
      await element.mount({ styles, scripts, elements }, params)
    }
  }

  async function update(params) {
    const { type, source, element, mounted } = app
    if (!mounted) {
      return
    }

    app.mounted = { params }

    // element可能已经被销毁
    if (!element) {
      return
    }

    await source.ready()

    if (type === 'iframe') {
      const { url } = source
      await element.update(url, params)
    }
    else {
      await element.update(params)
    }
  }

  async function unmount() {
    const { element } = app
    // element可能已经被销毁
    element && await element.unmount()
    app.mounted = null

    // 卸载污染的样式块
    if (hoistCssRules && type === 'shadowdom') {
      const id = 'mfy-hoist-style-' + name
      const el = document.querySelector('style#' + id)
      if (el) {
        el.parentNode.removeChild(el)
      }
    }
  }

  app.bootstrap = bootstrap
  app.mount = mount
  app.update = update
  app.unmount = unmount
  app.createSandbox = createSandbox

  // 允许用户不需要自己写启动代码，自动启动
  if (autoMount) {
    bootstrap(true)
  }
  else if (autoBootstrap) {
    bootstrap()
  }

  return app
}

export function connectScope(root) {
  const win = getTopWindow()
  const rootScope = win.__MFY_ROOT_SCOPE__
  if (root) {
    return rootScope
  }

  if (win.__MFY_SCOPE__) {
    return win.__MFY_SCOPE__
  }

  // 在iframe中启用的子应用
  if (window !== win && window.frameElement) {
    const iframe = window.frameElement
    const scopeUrl = iframe.getAttribute('scope-url')
    const src = iframe.contentWindow && iframe.contentWindow.location.pathname
    // 需要保证iframe是被scope化的
    if (scopeUrl && src && scopeUrl === src) {
      // 创建一个查找scope的函数（遍历树）
      const find = (scope) => {
        if (scope.url === scopeUrl) {
          return scope
        }
        for (const app of scope.apps) {
          const { scope } = app
          const res = find(scope)
          if (res) {
            return res
          }
        }
      }

      const scope = find(rootScope)
      if (scope) {
        return scope
      }
    }
  }

  // 默认顶级scope
  return rootScope
}

export function importSource(url, options = {}) {
  const scope = connectScope()
  const { url: scopeUrl } = scope
  const { baseUrl = scopeUrl, sourceSwitchMapping: mapping } = options
  const realUrl = resolvePath(baseUrl, url)

  const win = getTopWindow()
  const caches = win.__MFY_SOURCES__ = win.__MFY_SOURCES__ || []
  const cache = caches.find(item => item.url === realUrl)
  if (cache) {
    return cache
  }

  const sourceOptions = {}
  if (mapping) {
    sourceOptions.sourceSwitchMapping = mapping
  }

  const source = createSource(realUrl, sourceOptions)
  caches.push(source)
  return source
}

export function registerMicroApp(options) {
  const parentScope = connectScope()
  const app = createApp(parentScope, options)
  parentScope.apps.push(app)
  return app
}

async function parseSourceText(source) {
  await source.ready()

  // 使用缓存
  if (source.styles && source.scripts && source.elements) {
    return {
      styles: source.styles,
      scripts: source.scripts,
      elements: source.elements,
    }
  }

  const { text, url: sourceUrl, sourceSwitchMapping } = source

  const parser = new DOMParser()
  const htmlDoc = parser.parseFromString(text, 'text/html')
  const { head, body } = htmlDoc

  const styles = []
  const scripts = []
  const elements = []

  const buildAttributes = (attributes) => {
    return Array.from(attributes).map(({ name, value }) => ({ name, value }))
  }

  // 用于移除样式中的@import
  const replaceIgnoreQuota = (content, match, result) => {
    const match1 = match.replace(/"/g, "'")
    const match2 = match.replace(/'/g, '"')
    const output = content.replace(match1, result).replace(match2, result)
    return output
  }

  // 替换css样式表中的url
  const replaceCssUrl = (content, baseUrl) => {
    const text = content.replace(/url\((.*?)\)/g, function(match, url) {
      const uri = url.replace(/"/g, "'").replace(/'/g, '"')
      if (/^[a-z]+:\/\//.test(url)) {
        return match
      }
      else {
        return resolvePath(baseUrl, uri)
      }
    })
    return text
  }

  const pushStyleNode = async (node, url = sourceUrl) => {
    const { outerHTML, textContent, sheet, attributes } = node
    const cssRules = sheet.cssRules
    const buildContent = (cssText, selector) => {
      const text = cssText.replace(selector, '').trim()
      const content = text.substring(1, text.length - 1).trim()
      return content
    }
    const affectContent = async (cssRules, textContent = '', outerHTML = '') => {
      const rules = []

      await asyncIterate(Array.from(cssRules), async (rule) => {
        const { type, cssText } = rule
        const res = { type, cssText }
        if (type === 1) {
          const text = buildContent(cssText, rule.selectorText)
          const content = replaceCssUrl(text, url)
          res.selector = rule.selectorText
          res.content = content
        }
        else if (type === 3) {
          res.import = resolvePath(url, rule.href)
        }
        else if (type === 4) {
          const { rules } = await affectContent(rule.cssRules)
          res.condition = rule.conditionText
          res.rules = rules
        }
        rules.push(res)
      })

      const listToDelete = []
      await asyncIterate(rules, async (rule, i) => {
        if (!rule.import) {
          return
        }

        // 如果是使用了@import导入其他文件，那么尝试把这个文件直接请求回来，直接作为样式来插入
        const source = importSource(rule.import, { baseUrl: url, sourceSwitchMapping })
        try {
          await source.ready()
          const text = source.text
          const style = document.createElement('style')
          style.textContent = text
          document.body.appendChild(style)
          await pushStyleNode(style, rule.import)
          document.body.removeChild(style)
          listToDelete.unshift(i) // 因为我们下面要从后往前删除，所以我们反向存储

          textContent = replaceIgnoreQuota(textContent, rule.cssText, '')
          outerHTML = replaceIgnoreQuota(outerHTML, rule.cssText, '')
        }
        // 如果跨域，无法请求，那么仍然保持import状态
        catch (e) {
          console.error(e)
        }
      })

      // 把已经请求得到的样式对应的rule删掉
      listToDelete.forEach((index) => {
        rules.splice(index, 1)
      })

      textContent = replaceCssUrl(textContent, url)
      outerHTML = replaceCssUrl(outerHTML, url)

      return { rules, textContent, outerHTML }
    }

    const res = await affectContent(cssRules, textContent, outerHTML)
    res.attributes = buildAttributes(attributes)
    styles.push(res)
  }
  const pushSheetLink = async (node) => {
    const { outerHTML, attributes } = node
    const link = resolvePath(sourceUrl, node.getAttribute('href'))

    const source = importSource(link, { baseUrl: sourceUrl, sourceSwitchMapping })
    try {
      await source.ready()
      const text = source.text
      const style = document.createElement('style')
      style.textContent = text
      await pushStyleNode(style, link)
    }
    catch (e) {
      const res = {
        outerHTML,
        attributes: buildAttributes(attributes),
        link,
      }
      styles.push(res)
    }
  }
  const pushScriptNode = async (node) => {
    const { outerHTML, attributes, type, textContent } = node
    const res = {
      outerHTML,
      attributes: buildAttributes(attributes),
      type: type || 'text/javascript',
    }

    if (node.src) {
      try {
        const src = resolvePath(sourceUrl, node.src)
        const source = importSource(src, { baseUrl: sourceUrl, sourceSwitchMapping })
        res.src = src

        // 如果是外链，会被中断
        await source.ready()
        const text = source.text
        res.textContent = text
        scripts.push(res)
      }
      catch (e) {
        scripts.push(res)
      }
    }
    else {
      res.textContent = textContent
      scripts.push(res)
    }
  }

  const push = async (node) => {
    const { outerHTML, attributes, nodeName } = node
    const tag = nodeName.toLowerCase()
    if (tag === 'style') {
      await pushStyleNode(node)
    }
    else if (tag === 'link' && node.rel === 'stylesheet') {
      await pushSheetLink(node)
    }
    else if (tag === 'script') {
      await pushScriptNode(node)
    }
    else {
      elements.push({
        outerHTML,
        attributes: buildAttributes(attributes),
        tag,
      })
    }
  }

  const eachNode = async (child) => {
    if (child.nodeName === '#text' && !child.textContent.trim()) {
      return
    }
    await push(child)
  }

  await Promise.all([
    await asyncIterate(Array.from(head.childNodes), eachNode),
    await asyncIterate(Array.from(body.childNodes), eachNode),
  ])

  source.styles = styles
  source.scripts = scripts
  source.elements = elements

  return { styles, scripts, elements }
}
