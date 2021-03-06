export function isInternalLink(url) {
  const topWindow = getTopWindow()
  const { host, origin } = topWindow.location
  if (url.substr(0, 2) === '//') {
    return url.substr(2) === host || url.substr(2).indexOf(host + '/') === 0
  }
  if (/^[a-z]+:\/\//.test(url)) {
    return url.indexOf(origin) === 0
  }
  return true
}

export function isAbsolutePath(url) {
  return url[0] === '/' && url[1] !== '/'
}

export function resolvePath(baseUrl, uri, absRoot = '') {
  if (!uri) {
    return baseUrl
  }

  if (!baseUrl) {
    return uri
  }

  if (uri.indexOf('/') === 0) {
    return absRoot + uri
  }

  if (/^[a-z]+:\/\//.test(uri)) {
    // 使用绝对路径
    if (uri === window.location.origin) {
      return absRoot ? absRoot : '/'
    }
    if (uri.indexOf(window.location.origin + '/') === 0) {
      return absRoot + uri.replace(window.location.origin, '')
    }

    return uri
  }

  if (/^(\?|&|#)$/.test(uri[0])) {
    return baseUrl + uri
  }

  let dir = ''
  if (baseUrl[baseUrl.length - 1] === '/') {
    dir = baseUrl.substring(0, baseUrl.length - 1)
  }
  else {
    const chain = baseUrl.split('/')
    const tail = chain.pop()
    dir = tail.indexOf('.') === -1 ? baseUrl : chain.join('/')
  }

  const roots = dir.split('/')
  const blocks = uri.split('/')
  while (true) {
    const block = blocks[0]
    if (block === '..') {
      blocks.shift()
      roots.pop()
    }
    else if (block === '.') {
      blocks.shift()
    }
    else {
      break
    }
  }

  const url = roots.join('/') + '/' + blocks.join('/')
  return url
}

export function getTopWindow() {
  return window.top
}

export function getHostElement(element) {
  let host = element
  while (host.parentNode || host.host) {
    host = host.parentNode || host.host
    if (host.nodeName === 'MFY-APP') {
      return host
    }
  }
  return host
}

export function getLocation(win) {
  const { location } = win
  const { hash, host, hostname, href, origin, pathname, protocol, search } = location
  const info = { hash, host, hostname, href, origin, pathname, protocol, search }
  return info
}

export function asyncIterate(items, fn) {
  return new Promise((resolve, reject) => {
    let i = 0
    const through = () => {
      const item = items[i]
      if (!item) {
        resolve()
        return
      }
      const next = () => {
        i ++
        through()
      }
      return fn(item, i).then(next).catch(reject)
    }
    through()
  })
}

export function debounce(fn, wait) {
  let timeout = null

  return function() {
    const next = () => {
      timeout = null
      fn.apply(this, arguments)
    }

    clearTimeout(timeout)
    timeout = setTimeout(next, wait)
  }
}
