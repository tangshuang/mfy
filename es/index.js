
import MFYElement from './mfy-element.js'

export { registerMicroApp, importSource, connectScope } from './core.js'
export { registerRouter } from './router.js'

// 注册元素
if (!customElements.get('mfy-app')) {
  customElements.define('mfy-app', MFYElement)
}
