import { getHostElement, resolvePath, getLocation, asyncIterate, debounce } from './utils.js'
import { createSandboxGlobalVars, runScriptInSandbox } from './proxy-sandbox.js'
import { importSource, registerMicroApp } from './core.js'

const cssRules = {
  ':host': `
    display: block;
    flex: 1;
    width: 100%;
    height: 100%;
  `,
  '.mfy-sandbox': `
    width: 100%;
    height: 100%;
    display: none;
    border: 0;
    position: relative;
  `,
  '.mfy-sandbox.show': `
    display: block;
    opacity: 1;
    transition: opacity .5s;
  `,
  '.mfy-sandbox.fade-in': `
    opacity: 0;
  `,
  '.mfy-sandbox.fade-out': `
    opacity: 0;
  `,
  '.mfy-sandbox.slide': `
    display: block;
    transform: none;
    transition: transform .5s;
  `,
  '.mfy-sandbox.slide-in': `
    transform: translateX(100%);
  `,
  '.mfy-sandbox.slide-out': `
    transform: translateX(-100%);
  `,
}
const createCssText = (name) => {
  const rules = Object.keys(cssRules)
  const text = []

  rules.forEach((rule) => {
    const content = cssRules[rule]
    const selector = name ? (
        rule === ':host' ? `mfy-app[name="${name}"]` : `${rule}[name="${name}"]`
      )
      : rule
    text.push(`${selector} {${content}}`)
  })

  return text.join('\n')
}

export class MFY_Element extends HTMLElement {
  constructor() {
    super()

    this._listeners = []
    this._ready = null
    this._insideApp = null
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
    const host = getHostElement(this)
    const app = host.__apps && host.__apps.find(app => app.name === name)
    if (app && !app.element) {
      // 必须放在createSandbox前面
      this.ready(true)
      await app.createSandbox(this)
      // 如果当前app应该被渲染，那么直接渲染它
      app.mounted && await app.mount({ ...app.mounted.params, reconnect: true })
    }

    // 如果传入了src，那么直接加载应用，而不需要外部来注册
    const src = this.getAttribute('src')
    if (src && !this._insideApp) {
      const mode = this.getAttribute('mode')
      this._insideApp = registerMicroApp({
        name,
        mode,
        source: importSource(src),
        autoMount: true,
      })
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
    this._mounted = false

    style.textContent = createCssText()
    iframe.classList.add('mfy-sandbox')
    iframe.sandbox = 'allow-forms allow-pointer-lock allow-same-origin allow-scripts allow-modals'
    iframe.src = 'about:blank'
    iframe.frameborder = 0

    this.sandbox = iframe // 将沙箱挂载在sandbox属性上，方便外部调用

    const updateIframeSrc = (url, params) => {
      if (params && typeof params === 'object') {
        const { uri } = params
        const src = resolvePath(url, uri)
        if (!(iframe.src && iframe.src.endsWith(src))) {
          iframe.src = src
        }
      }
      else if (params && typeof params === 'string') {
        const src = resolvePath(url, params)
        if (!(iframe.src && iframe.src.endsWith(src))) {
          iframe.src = src
        }
      }
      else {
        if (!(iframe.src && iframe.src.endsWith(url))) {
          iframe.src = url
        }
      }
    }

    // 必须强制实现的接口
    this.mount = (url, params) => new Promise((resolve, reject) => {
      if (this.wait) {
        shadowRoot.innerHTML = '' // 清空所有内容
        this.wait = null // 删除该接口
      }

      iframe.onload = () => {
        const win = iframe.contentWindow
        if (win) {
          this.emit('mount')
          resolve(win)

          iframe.onload = () => {}
          iframe.onerror = () => {}

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

      updateIframeSrc(url, params)

      if (!this._mounted) {
        this._mounted = true
      }

      shadowRoot.appendChild(style)
      shadowRoot.appendChild(iframe)

      if (params && typeof params === 'object' && params.transition) {
        _transition = params.transition
        // 如果是重新被挂载进文档，直接显示出来，而不是动画效果出现
        if (params.reconnect) {
          iframe.classList.add('show')
        }
        else {
          iframe.classList.add(_transition)
          iframe.classList.add(_transition + '-in')
          setTimeout(() => {
            iframe.classList.remove(_transition + '-in')
          }, 10)
        }
      }
      else {
        iframe.classList.add('show')
      }
    })
    this.unmount = () => new Promise((resolve) => {
      const unmount = () => {
        shadowRoot.removeChild(iframe)
        shadowRoot.removeChild(style)
        this._mounted = false
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

      updateIframeSrc(url, params)
    })
  }

  async createVM() {
    const shadowRoot = this.attachShadow({ mode: 'closed' })
    const app = this.__app

    // 为placeholder做准备
    this.wait = (innerHTML) => {
      shadowRoot.innerHTML = innerHTML
    }
    this._readyResolve()

    const style = document.createElement('style')
    const vmbox = document.createElement('div')

    const jsvm = await createSandboxGlobalVars({
      document: vmbox,
      head: vmbox,
      body: vmbox,
    })

    let _transition = ''
    let _updating = false
    this._mounted = false

    style.textContent = createCssText()
    vmbox.classList.add('mfy-sandbox')

    this.sandbox = vmbox // 将沙箱挂载在sandbox属性上，方便外部调用

    const win = jsvm.window
    win.__MFY_SCOPE__ = app.scope // 当前custom element内部全部都是app的scope

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

    const updateInnerUrl = (params) => {
      if (params && typeof params === 'object') {
        const { uri, replace } = params
        const href = win.location.href
        const nextUrl = resolvePath(href, uri)
        if (href !== nextUrl && replace) {
          win.history.replaceState(null, null, nextUrl)
        }
        else if (href !== nextUrl) {
          win.history.pushState(null, null, nextUrl)
        }
      }
    }

    // 必须强制实现的接口
    this.mount = async ({ styles, scripts, elements }, params = {}) => {
      // 置空
      if (this.wait) {
        shadowRoot.innerHTML = ''
        this.wait = null
      }

      // 仅第一次渲染
      if (!this._mounted) {
        const styleEls = styles.map((style) => {
          if (style.rules && style.rules.some(rule => rule.selector && (rule.selector.indexOf('html') > -1 || rule.selector.indexOf('body') > -1))) {
            const ruleTexts = style.rules.map(rule => rule.cssText.replace('html', '.mfy-sandbox').replace('body', '.mfy-sandbox'))
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
      }

      shadowRoot.appendChild(style)
      shadowRoot.appendChild(vmbox)

      if (params && typeof params === 'object' && params.transition) {
        _transition = params.transition
        if (params.reconnect) {
          vmbox.classList.add('show')
        }
        else {
          vmbox.classList.add(_transition)
          vmbox.classList.add(_transition + '-in')
          setTimeout(() => {
            vmbox.classList.remove(_transition + '-in')
          }, 10)
        }
      }
      else {
        vmbox.classList.add('show')
      }

      if (!this._mounted) {
        const setElementAttributes = (el, attributes, excludes = []) => {
          attributes.filter(item => !excludes.includes(item.name)).forEach(({ name, value }) => el.setAttribute(name, value))
        }
        const mountScript = (el, src) => new Promise((resolve, reject) => {
          el.src = src
          el.onload = resolve
          el.onerror = reject
          vmbox.appendChild(el)
        })
        await asyncIterate(scripts, async (script) => {
          const { type, attributes, textContent, src, baseUrl, absRoot } = script
          const el = document.createElement('script')
          const ready = () => new Promise((resolve, reject) => {
            el.onload = resolve
            el.onerror = reject
          })

          // 将script标签进行标记
          el.__app = app

          // 非同域名的外链脚本
          if (src && !textContent) {
            setElementAttributes(el, attributes, ['src'])
            await mountScript(el, src)
          }
          // 同域名下的脚本，文件会被拉出脚本内容
          else {
            const init = () => {
              setElementAttributes(el, attributes, src ? ['src'] : [])

              // el.setAttribute('type', 'mfy')
              // el.textContent = textContent
              if (src) {
                el.setAttribute('data-script-origin-src', src)
              }

              vmbox.appendChild(el)
            }

            // 普通的javascript直接在沙箱中运行
            if (type === 'text/javascript') {
              init()
              jsvm.document.currentScript = el
              await runScriptInSandbox(textContent, jsvm)
              jsvm.document.currentScript = null
            }
            // 模块化的转化为异步函数后在沙箱中执行
            else if (type === 'module') {
              init()
              jsvm.document.currentScript = el
              const moduleScript = textContent.replace(/import (.*?) from (.*?)\n/g, function(_, vars, src) {
                const realSrc = src.substring(1, src.length - 1);
                const url = resolvePath(baseUrl, realSrc, absRoot)
                return `const ${vars} = await import('${url}');\n`
              })
              const scriptContent = `
                (async function() {
                  ${moduleScript}
                })();
              `
              await runScriptInSandbox(scriptContent, jsvm)
              jsvm.document.currentScript = null
            }
            // 其他的直接放进去即可，例如type="template"
            else {
              el.textContent = textContent
              vmbox.appendChild(el)
            }
          }

          await ready()
        })

        this._mounted = true
      }

      updateInnerUrl(params)
      this.emit('mount')
    }
    this.unmount = () => new Promise((resolve) => {
      const unmount = () => {
        shadowRoot.removeChild(vmbox)
        shadowRoot.removeChild(style)
        this._mounted = false
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
    this.update = (params = {}) => new Promise((resolve) => {
      _updating = true // 标记，避免外部修改内部url时，内部还进行事件抛出
      const updatedCallback = () => {
        _updating = false
        this.emit('update')
        resolve()
        // iframe.removeEventListener('load', updatedCallback)
      }
      // iframe.addEventListener('load', updatedCallback)
      setTimeout(updatedCallback) // 如果url没有发生变化，不会触发load事件，所以不能使用监听事件的方法

      updateInnerUrl(params)
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
    this._mounted = false

    this.sandbox = box

    box.classList.add('mfy-sandbox')

    const name = this.getAttribute('name')
    const cssText = createCssText(name)

    this.mount = async ({ styles, scripts, elements }, params) => {
      // 置空
      if (this.wait) {
        root.innerHTML = ''
        this.wait = null
      }

      const setElementAttributes = (el, attributes, excludes = []) => {
        attributes.filter(item => !excludes.includes(item.name)).forEach(({ name, value }) => el.setAttribute(name, value))
      }

      if (!this._mounted) {
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
        const createRulesCss = (rules) => {
          const ruleTexts = rules.map((rule) => {
            const { selector, content, condition, cssText } = rule

            // media query
            if (condition) {
              const cssText = createRulesCss(rule.rules)
              return `@media ${condition} { ${cssText} }`
            }
            else if (selector) {
              const names = selector.split(',').map(str => str.trim()).map((selector) => {
                const namespace = `mfy-app[name="${name}"]`
                if (selector.startsWith('html')) {
                  return selector.replace('html', namespace)
                }
                else if (selector.startsWith('body')) {
                  return selector.replace('body', namespace)
                }
                else {
                  return namespace + ' ' + selector
                }
              })
              const selectors = names.reduce((items, item) => items.includes(item) ? items : [...items, item], [])
              const ruleText = selectors.join(', ') + ' { ' + content + ' }'
              return ruleText
            }
            else {
              return cssText
            }
          })

          const cssText = ruleTexts.join('\n')
          return cssText
        }
        styles.forEach((style) => {
          if (style.rules && style.rules.length) {
            const { rules, attributes } = style

            const cssText = createRulesCss(rules)
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
        elements.map((element) => {
          const el = getElementByHtml(element.outerHTML)
          box.appendChild(el)
        })
      }

      // 整体挂载上去
      root.appendChild(box)

      if (params && typeof params === 'object' && params.transition) {
        _transition = params.transition
        if (params.reconnect) {
          box.classList.add('show')
        }
        else {
          box.classList.add(_transition)
          box.classList.add(_transition + '-in')
          setTimeout(() => {
            box.classList.remove(_transition + '-in')
          }, 10)
        }
      }
      else {
        box.classList.add('show')
      }

      // 如果已经挂载过脚本了，就不在挂载了，脚本具有运行时状态特征，不能重复挂载
      // 脚本要box挂载到root之后执行，否则DOM可能不存在
      if (!this._mounted) {
        await asyncIterate(scripts, async (script) => {
          const { attributes, textContent, src } = script
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
        this._mounted = true
      }

      this.emit('mount')
    }
    this.unmount = () => new Promise((resolve) => {
      const unmount = () => {
        root.removeChild(box)
        this._mounted = false
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

  setViewPort(viewport) {
    const sync = () => {
      requestAnimationFrame(() => {
        if (!this._mounted) {
          sync()
          return
        }

        const sandbox = this.sandbox
        const inIframe = sandbox.contentWindow
        const root = inIframe ? sandbox.contentWindow.document.body : sandbox
        const [target, ...others] = [].concat(viewport)
        const el = root.querySelector(target)
        const ignores = others.length ? Array.from(root.querySelectorAll(others.join(','))) : []

        if (!el) {
          sync()
          return
        }

        const rect = el.getBoundingClientRect()
        const { width, height } = rect

        // 所有兄弟节点隐藏
        let parent = el.parentNode
        let current = el
        while (parent) {
          if (current === this) {
            break
          }

          Array.from(parent.children).forEach((child) => {
            if (child === current) {
              return
            }
            if (ignores.includes(current)) {
              return
            }
            child.style.display = 'none'
          })

          current = parent
          parent = parent.parentNode
        }

        // 去除边距
        el.style.padding = 0
        el.style.margin = 0

        // 限制整个视口大小
        sandbox.style.maxWidth = width + 'px'
        sandbox.style.maxHeight = height + 'px'
        this.style.maxWidth = width + 'px'
        this.style.maxHeight = height + 'px'

        sync()
      })
    }
    sync()
  }
}
export default MFY_Element
