import { getTopElement, resolvePath, getLocation, asyncIterate, debounce } from './utils/utils.js'
import { createSandboxGlobalObjects, runScriptInSandbox, createProxyDocument } from './proxy-sandbox.js'

const cssText = `
  :host {
    display: block;
    overflow: hidden;
    flex: 1;
    width: 100%;
    height: 100%;
  }
  .mfy-sandbox {
    width: 100%;
    height: 100%;
    border: 0;
    display: none;
  }
  .mfy-sandbox.show {
    display: block;
  }

  .mfy-sandbox.fade {
    display: block;
    opacity: 1;
    transition: opacity .5s;
  }
  .mfy-sandbox.fade-in,
  .mfy-sandbox.fade-out {
    opacity: 0;
  }

  .mfy-sandbox.slide {
    display: block;
    transform: none;
    transition: transform .5s;
  }
  .mfy-sandbox.slide-in {
    transform: translateX(100%);
  }
  .mfy-sandbox.slide-out {
    transform: translateX(-100%);
  }
`

export class MFY_Element extends HTMLElement {
  constructor() {
    super()

    this._listeners = []
    this.ready(true)
  }

  ready(create) {
    if (create) {
      this._ready = new Promise((resolve, reject) => {
        this._readyResolve = resolve
        this._readyReject = reject
      })
    }
    return this._ready
  }

  on(event, callback) {
    this._listeners.push({ event, callback })
    return this
  }
  off(event, callback) {
    this._listeners.forEach((item, i) => {
      if (item.event === event && (!callback || item.callback === callback)) {
        this._listeners.splice(i, 1)
      }
    })
    return this
  }
  emit(event, data) {
    this._listeners.forEach((item) => {
      if (item.event === event) {
        item.callback.call(this, data)
      }
    })
    return this
  }

  async connectedCallback() {
    // 通过读取app来重新设置app的element
    const name = this.getAttribute('name')
    const rootElement = getTopElement(this)
    const app = rootElement.__apps && rootElement.__apps.find(app => app.name === name)
    if (app && !app.element) {
      // 必须放在createSandbox前面
      this.ready(true)
      app.element = this
      await app.createSandbox()
      // 如果当前app应该被渲染，那么直接渲染它
      app.mounted && await app.mount(app.mounted.params)
    }
  }

  disconnectedCallback() {
    this.emit('destroy')
  }

  createIframe() {
    const shadowRoot = this.attachShadow({ mode: 'closed' })

    // 为placeholder做准备
    this.wait = (innerHTML) => {
      shadowRoot.innerHTML = innerHTML
    }
    this._readyResolve()

    const style = document.createElement('style')
    const iframe = document.createElement('iframe')

    let _transition = ''
    let _updating = false

    this.sandbox = iframe // 将沙箱挂载在sandbox属性上，方便外部调用
    style.textContent = cssText
    iframe.classList.add('mfy-sandbox')
    iframe.sandbox = 'allow-forms allow-pointer-lock allow-same-origin allow-scripts allow-modals'
    iframe.src = 'about:blank'

    // const operators = {
    //   get window() {
    //     return iframe.contentWindow
    //   },
    //   get document() {
    //     return iframe.contentDocument
    //   },
    //   get iframe() {
    //     return iframe
    //   },
    //   html(html) {
    //     iframe.contentDocument.documentElement.innerHTML = html
    //   },
    //   load(src) {
    //     iframe.src = src
    //   },
    //   doc(doc) {
    //     iframe.srcdoc = doc
    //   },
    //   blob(content) {
    //     const blob = new Blob([content], {
    //       type: 'text/html'
    //     })
    //     iframe.src = URL.createObjectURL(blob)
    //   },
    //   inject(scripts, head = true) {
    //     const doc = iframe.contentDocument
    //     const script = doc.createElement('script')
    //     script.type = 'text/javascript'
    //     script.text = scripts

    //     if (head) {
    //       doc.head.appendChild(script)
    //     }
    //     else {
    //       doc.body.appendChild(script)
    //     }
    //   },
    //   invoke(scripts) {
    //     iframe.contentWindow.eval(scripts)
    //   },
    //   clear() {
    //     iframe.removeAttribute('srcdoc')
    //     iframe.src = 'about:blank'
    //   },
    //   resize(width, height) {
    //     iframe.style.width = width + 'px'
    //     iframe.style.height = height + 'px'
    //   },
    //   attr(key, value) {
    //     if (value === null) {
    //       iframe.removeAttribute(key)
    //     }
    //     else {
    //       iframe.setAttribute(key, value)
    //     }
    //   },
    // }

    // 必须强制实现的接口
    this.mount = (url, params) => new Promise((resolve, reject) => {
      if (this.wait) {
        shadowRoot.innerHTML = '' // 清空所有内容
        this.wait = null // 删除该接口
      }

      shadowRoot.appendChild(style)
      shadowRoot.appendChild(iframe)

      iframe.onload = () => {
        const win = iframe.contentWindow
        if (win) {
          this.emit('mount')
          resolve()

          const reactive = debounce((event) => {
            // 外部迫使内部发生变化时，不会抛出事件
            if (_updating) {
              return
            }
            const info = getLocation(win)
            // 对外抛出urlchange是可选的，但是最好都实现
            this.emit('urlchange', { ...info, type: 'change:' + event })
          }, 100)
          win.addEventListener('popstate', () => reactive('popstate'))
          win.addEventListener('pushState', () => reactive('pushState'))
          win.addEventListener('replaceState', () => reactive('replaceState'))
          win.addEventListener('hashchange', () => reactive('hashchange'))
        }
      }
      iframe.onerror = reject

      if (params && typeof params === 'object') {
        const { uri, transition } = params
        iframe.src = resolvePath(url, uri)

        if (transition) {
          _transition = transition
          iframe.classList.add(transition)
          iframe.classList.add(transition + '-in')
          setTimeout(() => {
            iframe.classList.remove(transition + '-in')
          }, 10)
        }
        else {
          iframe.classList.add('show')
        }
      }
      else if (params && typeof params === 'string') {
        iframe.src = resolvePath(url, params)
        iframe.classList.add('show')
      }
      else {
        iframe.src = url
        iframe.classList.add('show')
      }
    })
    this.unmount = () => new Promise((resolve) => {
      const unmount = () => {
        shadowRoot.removeChild(iframe)
        shadowRoot.removeChild(style)
        this.emit('unmount')
        resolve()
      }
      if (_transition) {
        iframe.classList.add(_transition + '-out')
        setTimeout(() => {
          iframe.classList.remove(_transition + '-out')
          unmount()
        }, 500)
      }
      else {
        unmount()
      }
    })
    this.update = (url, params) => new Promise((resolve) => {
      _updating = true // 标记，避免外部修改内部url时，内部还进行事件抛出
      const updatedCallback = () => {
        _updating = false
        this.emit('update')
        resolve()
        // iframe.removeEventListener('load', updatedCallback)
      }
      // iframe.addEventListener('load', updatedCallback)
      setTimeout(updatedCallback) // 如果url没有发生变化，不会触发load事件，所以不能使用监听事件的方法

      if (params && typeof params === 'object') {
        const { uri } = params
        iframe.src = resolvePath(url, uri)
      }
      else if (params && typeof params === 'string') {
        iframe.src = resolvePath(url, params)
      }
      else {
        iframe.src = url
      }
    })
  }

  async createVM() {
    const shadowRoot = this.attachShadow({ mode: 'closed' })

    // 为placeholder做准备
    this.wait = (innerHTML) => {
      shadowRoot.innerHTML = innerHTML
    }
    this._readyResolve()

    const style = document.createElement('style')
    const vmbox = document.createElement('div')

    const vdoc = createProxyDocument(shadowRoot)
    const jsvm = await createSandboxGlobalObjects({ document: vdoc })

    let _transition = ''
    let _updating = false

    this.sandbox = vmbox // 将沙箱挂载在sandbox属性上，方便外部调用
    style.textContent = cssText
    vmbox.classList.add('mfy-sandbox')

    const win = jsvm.window
    const reactive = debounce((event) => {
      if (_updating) {
        return
      }

      const info = getLocation(win)
      // 对外抛出urlchange是可选的，但是最好都实现
      this.emit('urlchange', { ...info, type: 'change:' + event })
    }, 100)
    win.addEventListener('popstate', () => reactive('popstate'))
    win.addEventListener('pushState', () => reactive('pushState'))
    win.addEventListener('replaceState', () => reactive('replaceState'))
    win.addEventListener('hashchange', () => reactive('hashchange'))

    // 必须强制实现的接口
    this.mount = async ({ styles, scripts, elements }, options = {}) => {
      // 置空
      if (this.wait) {
        shadowRoot.innerHTML = ''
        this.wait = null
      }

      shadowRoot.appendChild(style)
      shadowRoot.appendChild(vmbox)

      const { params, globalVars } = options

      const setElementAttributes = (el, attributes, excludes = []) => {
        attributes.filter(item => !excludes.includes(item.name)).forEach(({ name, value }) => el.setAttribute(name, value))
      }

      const styleEls = styles.map((style) => {
        if (style.rules && style.rules.some(rule => rule.selector.indexOf('html') > -1 || rule.selector.indexOf('body') > -1)) {
          const ruleTexts = style.rules.map(rule => rule.cssText.replace('html', ':host').replace('body', ':host'))
          const cssText = ruleTexts.join('\n')
          const attrs = style.attributes.map(({ name, value }) => `${name}="${value}"`).join(' ')
          return `<style${attrs ? ' ' + attrs : ''}>\n${cssText}\n</style>`
        }
        else {
          return style.outerHTML
        }
      }).join('\n')
      const htmlEls = elements.map(el => el.outerHTML).join('\n')
      const innerHTML = styleEls + '\n' + htmlEls
      vmbox.innerHTML = innerHTML

      if (params && typeof params === 'object') {
        const { transition } = params
        if (transition) {
          _transition = transition
          vmbox.classList.add(transition)
          vmbox.classList.add(transition + '-in')
          setTimeout(() => {
            vmbox.classList.remove(transition + '-in')
          }, 10)
        }
        else {
          vmbox.classList.add('show')
        }
      }
      else {
        vmbox.classList.add('show')
      }

      await asyncIterate(scripts, async (script) => {
        const { type, attributes, textContent, src } = script
        const el = document.createElement('script')
        const ready = () => new Promise((resolve, reject) => {
          el.onload = resolve
          el.onerror = reject
        })

        // 仅支持普通javascript在沙箱中运行，不支持其他任何形式在沙箱中运行，所以全部原样输出
        const isScript = type === 'text/javascript'

        if (!isScript) {
          setElementAttributes(el, attributes, ['src'])
          if (!src) {
            el.textContent = textContent
          }
          // src经过相对路径处理，不能使用原始src
          else {
            el.src = src
          }
          vmbox.appendChild(el)
          await ready()
        }
        else if (src) {
          setElementAttributes(el, attributes, ['src'])
          vmbox.appendChild(el)
          await runScriptInSandbox(textContent, jsvm, { ...globalVars, currenctScript: el })
        }
        else {
          setElementAttributes(el, attributes)
          vmbox.appendChild(el)
          await runScriptInSandbox(textContent, jsvm, globalVars)
        }
      })

      this.emit('mount')
    }
    this.unmount = () => new Promise((resolve) => {
      const unmount = () => {
        shadowRoot.removeChild(vmbox)
        shadowRoot.removeChild(style)
        this.emit('unmount')
        resolve()
      }
      if (_transition) {
        vmbox.classList.add(_transition + '-out')
        setTimeout(() => {
          vmbox.classList.remove(_transition + '-out')
          unmount()
        }, 500)
      }
      else {
        unmount()
      }
    })
    this.update = (options = {}) => new Promise((resolve) => {
      _updating = true // 标记，避免外部修改内部url时，内部还进行事件抛出
      const updatedCallback = () => {
        _updating = false
        this.emit('update')
        resolve()
        // iframe.removeEventListener('load', updatedCallback)
      }
      // iframe.addEventListener('load', updatedCallback)
      setTimeout(updatedCallback) // 如果url没有发生变化，不会触发load事件，所以不能使用监听事件的方法

      const { params } = options
      if (params && typeof params === 'object') {
        const { uri } = params
        const href = jsvm.window.location.href
        const nextUrl = resolvePath(href, uri)
        jsvm.window.history.pushState(null, null, nextUrl)
      }
    })
  }

  async createBox() {
    const root = this

    // 为placeholder做准备
    this.wait = (innerHTML) => {
      root.innerHTML = innerHTML
    }
    this._readyResolve()

    const box = document.createElement('div')

    let _transition = ''
    let _updating = false
    let _mounted = false

    this.sandbox = box
    box.classList.add('mfy-sandbox')

    const name = this.getAttribute('name')

    this.mount = async ({ styles, scripts, elements }, options = {}) => {
      // 置空
      if (this.wait) {
        root.innerHTML = ''
        this.wait = null
      }

      const { params } = options

      const setElementAttributes = (el, attributes, excludes = []) => {
        attributes.filter(item => !excludes.includes(item.name)).forEach(({ name, value }) => el.setAttribute(name, value))
      }
      const getElementByHtml = (html) => {
        const el = document.createElement('div')
        el.innerHTML = html
        const target = el.children[0]
        return target
      }

      // 挂载全局样式
      const style = document.createElement('style')
      style.textContent = cssText
      style.setAttribute('mfy-app-name', name)
      box.appendChild(style) // 直接加载到当前文档
      // 挂载当前应用样式
      styles.forEach((style) => {
        if (style.rules && style.rules.length) {
          const { rules, attributes } = style
          const ruleTexts = rules.map((rule) => {
            const { selector, content } = rule
            const names = selector.split(',').map(str => str.trim()).map((name) => {
              const namespace = `mfy-app[name=${name}]`
              if (name.startsWith('html') || name.startsWith('body')) {
                return name.replace('html', namespace)
              }
              else {
                return namespace + ' ' + name
              }
            })
            const ruleText = names.join(', ') + '{' + content + '}'
            return ruleText
          })

          const cssText = ruleTexts.join('\n')
          const el = document.createElement('style')

          setElementAttributes(el, attributes)
          el.setAttribute('mfy-app-name', name)
          el.textContent = cssText
          box.appendChild(el)
        }
        else {
          const el = getElementByHtml(style.outerHTML)
          el.setAttribute('mfy-app-name', name)
          box.appendChild(el)
        }
      })

      // 挂载html
      const html = elements.map(el => el.outerHTML).join('\n')
      box.innerHTML = html
      // 整体挂载上去
      root.appendChild(box)

      if (params && typeof params === 'object') {
        const { transition } = params
        if (transition) {
          _transition = transition
          box.classList.add(transition)
          box.classList.add(transition + '-in')
          setTimeout(() => {
            box.classList.remove(transition + '-in')
          }, 10)
        }
        else {
          box.classList.add('show')
        }
      }
      else {
        box.classList.add('show')
      }

      // 如果已经挂载过脚本了，就不在挂载了，脚本具有运行时状态特征，不能重复挂载
      if (!_mounted) {
        await asyncIterate(scripts, async (script) => {
          const { type, attributes, textContent, src } = script
          const el = document.createElement('script')
          const ready = () => new Promise((resolve, reject) => {
            el.onload = resolve
            el.onerror = reject
          })

          setElementAttributes(el, attributes, ['src'])
          el.setAttribute('mfy-app-name', name)

          if (!src) {
            el.textContent = textContent
          }
          // src经过相对路径处理，不能使用原始src
          else {
            el.src = src
          }

          // 直接挂载在document上面
          document.body.appendChild(el)
          await ready()
        })
      }

      _mounted = true
      this.emit('mount')
    }
    this.unmount = () => new Promise((resolve) => {
      const unmount = () => {
        root.removeChild(box)
        this.emit('unmount')
        resolve()
      }
      if (_transition) {
        box.classList.add(_transition + '-out')
        setTimeout(() => {
          box.classList.remove(_transition + '-out')
          unmount()
        }, 500)
      }
      else {
        unmount()
      }
    })
    this.update = () => new Promise((resolve) => {
      _updating = true // 标记，避免外部修改内部url时，内部还进行事件抛出
      const updatedCallback = () => {
        _updating = false
        this.emit('update')
        resolve()
      }
      setTimeout(updatedCallback)
    })
  }

  // attributeChangedCallback() {}
}
export default MFY_Element
