import { getLocation, resolvePath, debounce } from './utils.js'

export function registerRouter(options) {
  const { routes, onChange, onEnter, onLeave, onUpdate, transition, autoBootstrap } = options

  let current = null

  const toggle = (next, uri) => {
    const params = { transition, uri }
    if (current) {
      if (current === next) {
        current.update(params)
        onUpdate && onUpdate(current, params)
        return
      }
      current.unmount()
      onLeave && onLeave(current)
    }

    next.mount(params)
    onEnter && onEnter(next, params)
    current = next
  }

  const checkChange = () => {
    const info = getLocation(window)

    onChange && onChange(info)

    for (const route of routes) {
      const { app, match, map } = route
      if (!match(info)) {
        continue
      }
      toggle(app, map && map(info))
      break
    }
  }
  const handleChange = debounce(checkChange, 100)

  const deferer = new Promise((resolve) => {
    window.addEventListener('load', () => {
      window.addEventListener('popstate', handleChange)
      window.addEventListener('pushState', handleChange)
      window.addEventListener('replaceState', handleChange)
      window.addEventListener('hashchange', handleChange)
      resolve()
    })
  })

  async function bootstrap() {
    await deferer
    routes.forEach(async ({ app, reactive }) => {
      await app.bootstrap()
      // reactive配置用于监听内部iframe变化，通过该变化可以反馈到当前顶级url中，以保证刷新页面后仍然能指定到内部iframe的新url上
      if (!reactive) {
        return
      }
      app.element.on('urlchange', (data) => {
        const { type } = data
        if (type.indexOf('change:') === 0) {
          const url = window.location.href
          const uri = reactive(data)
          if (uri) {
            const nextUrl = resolvePath(url, uri)
            window.history.replaceState(null, null, nextUrl)
          }
        }
      })
    })

    checkChange()

    if (!current) {
      const route = routes[0]
      const { app, map } = route
      const info = getLocation(window)
      toggle(app, map && map(info))
    }
  }

  // 支持自动启动
  if (autoBootstrap) {
    bootstrap()
  }

  const navigator = {
    bootstrap,
  }

  return navigator
}
