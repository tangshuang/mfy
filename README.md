# 麦饭（MFY）

简易的无侵入式微前端框架。

不需要对原有应用做任何修改，就可以被融入到新的技术体系中，麦饭的目标，是让开发者以最简单的开发方式，以低廉的成本完成技术迁移。抑或，将你的巨无霸应用得以拆分为多个子应用，让你的开发团队专注于特定的功能应用上，而不受技术栈的影响。虽然小巧，但精悍无比，花5分钟试用它，你一定会爱上麦饭。

除了拥有其他微前端框架几乎所有功能之外，与其他微前端框架的不同点（亮点）：

- 支持子应用嵌套，子应用里面还可以嵌套子应用
- 支持子应用被挂载的DOM节点被删掉之后又挂载回来，例如使用v-if控制一块区域的隐现
- 支持路由映射，不需要对子应用进行修改的情况下，把外层的url映射为内层url
- 动画过渡效果

[快速体验小DEMO](https://unpkg.com/mfy@latest/spec/index.html)

## 安装

```
npm i mfy
```

或者直接通过cdn加载麦饭。

```html
<script src="https://unpkg.com/mfy"></script>
```

## 快速上手

麦饭总共只有4个接口函数，你可以在5分钟内接入它。

首先，在你需要加载子应用的位置使用`<mfy>`标签占位：

```html
<mfy-app name="some"></mfy-app>
```

然后注册和启动同名的子应用：

```js
import { importSource, registerMicroApp } from 'mfy'

const app = registerMicroApp({
  name: 'some', // 对应<mfy>标签的name属性值
  source: () => importSource('./apps/some/index.html'),
  autoMount: true, // 自动完成挂载
})
```

好了，你当前的应用成功加载了子应用。如果没有父子通信的需要，你甚至不需要在子应用中改任何一处。

<details>
<summary><em>黑魔法：不使用registerMicroApp注册子应用</em></summary>

```html
<mfy-app source="/apps/sum.html"></mfy-app>
```

直接通过标签加载一个html的内容，而不需要使用registerMicroApp。这种用法过于粗暴。
</details>

## 接口

麦饭的四个接口，`importSource`和`registerMicroApp`为子应用的加载和挂载服务，`connectScope`为父子应用通信服务，`registerRouter`为路由映射服务。

### importSource(relativePath)

导入资源，传入子应用的html入口文件的相对路径，改相对路径是指从当前能被访问到的url到子应用入口文件url地址的相对路径。

```js
importSource('./apps/some/index.html')
```

在麦饭中，资源加载具有缓存，同一个文件不会加载第二次，而是直接使用缓存，因此你不需要担心统一资源反复加载的问题。一般而言，`importSource`只会作为`registerMicroApp`的`source`参数中使用。

### registerMicroApp(options)

注册一个微应用，使html中的`<mfy-app>`对应name的应用生效。

配置参数如下：

```
{
  name: string, 对应<mfy-app>的name属性，当前环境中，不允许多次注册同名应用
  source: 资源，只能使用importSource进行导入，直接导入，资源会立即加载，如果接收函数，资源会在bootstrap的时候加载
  type: iframe|shadowdom|none, 默认none。子应用的环境隔离类型，默认不做脚本执行环境隔离
  placeholder: html字符串，可选，当资源还没有下载完时，可以用这个字符串渲染，字符串内应该包含样式
  onLoad(): 资源加载好时被调用
  onBootstrap(): 子应用启动时被调用
  onMount(): 子应用被挂载时调用
  onUnmount(): 子应用被卸载时调用
  onDestroy(): 子应用对应的<mfy-app>标签从文档中移除时调用
  onMessage(data): 子应用向当前环境发送消息时调用
  autoBootstrap: 自动启动该子应用
  autoMount: 自动挂载该子应用，包含了autoBootstrap的效果
  hoistCssRules(rule): 哪些样式要被挂载到当前环境的head中实现全局样式，返回样式的字符串文本cssText
}
```

大多数配置项都是可选的，只有name和source是必须传的。

```js
const app = registerMicroApp(...)
```

它会返回一个注册好的app对象，该app是和对应的`<mfy-app>`绑定的。对于一个app而言，它需要被执行两个步骤，才会在界面上展示出来：bootstrap+mount。

```js
app.bootstrap()
```

`bootstrap`方法用于启动该app，启动之后，会进行资源加载、环境创建等工作。为了根据实际需要进行这些消耗内存的操作，你可以在不同的时间点上启动app。

```js
app.mount()
```

`mount`方法用于将app的内容渲染到界面上，调用之后，你可以通过开发者工具看到`<mfy-app>`内部发生了变化。

```js
app.unmount()
```

`unmount`方法用于将渲染到界面上的内容移除，调用之后，你可以通过开发者工具看到`<mfy-app>`内部发生了变化。

另外，`<mfy-app>`在文档中有可能会因为其他程序的操作，比如vue或react的更新操作，会从文档中被移除，一个`<mfy-app>`标签被移除之后，并不代表这个app被销毁了，这个app仍然存在于内存中，当对应的`<mfy-app>`重新回到文档中时，它会自动重建环境，并根据销毁前的状态决定是否挂载app。

### connectScope(willUseRoot?)

麦饭中，通过scope完成父子应用的通信。一个子应用一定运行在一个由麦饭创建的环境中，这个环境就是scope，一个scope内，可能运行着多个子应用。每一个子应用又包含了一个自己的内部环境scope，在这个scope中，可能又会有新的子应用挂载进来，这样，app+scope就形成了一个树状结构。scope的主要功能，是为父子应用提供通信。

```js
const scope = connectScope()

scope.emit({ type: 'event', message: 'ok' }) // 向父应用发送消息
scrope.listen((data) => { // 接收到来自父应用发送的消息
  const { type } = data
  // ...
})
scope.watch(name, (data) => { // 接收到来自子应用发送的消息，name为子应用的名称
  // ..
})
scope.send(name, data) // 向单个子应用发送消息
scope.dispatch({ type: 'event', message: 'gogo' }) // 向所有子应用广播消息（不包含孙应用）
scope.broadcast({ type: 'xx', message: 'oo' }) // 向整个应用树广播消息，自顶向下进行广播
```

麦饭并不提供全局状态共享的能力，因为应用之间不应该直接共享状态，共享状态导致状态的不可预测性，不利于子应用开发团队专注完成子应用的功能开发。但是，父子通信的能力，实际上提供了传递状态的能力，在必要的时候，可以通过通信机制传递状态。

### registerRouter(options)

注册一个路由管理器。通过该方法，你可以把多个子应用放在一个路由管理器下面，用以规定这个子应用在什么路由状态下执行mount/unmount操作。另外，路由系统还提供了路由映射功能，浏览器的url并非直接被子应用识别，子应用识别到的url，来自路由管理器map的结果。我们来看下options都可以进行哪些配置：

```
{
  routes: [
    {
      app: 对应的app对象
      match: (data) => true|false, 用以决定是否匹配到当前app的函数，当该函数返回true时，app会被mount
      map: (data) => url字符串，用于将外部信息映射为子应用的url，即使子应用是用vue-router等进行路由管理的，也不需要对子应用的路由系统进行修改，我们用map就可以处理好子应用接收到的url信息
      reactive: (data) => {}, 当子应用内部的url被子应用内的程序修改时，该函数被执行，从而可以让外部环境记录子应用的url，从而即使用户直接刷新浏览器，也不会丢失子应用的url
    }
  ]
  autoBoostrap: 是否自动启动路由监听
  transition: fade|slide, 子应用mount/unmount时的过渡动画效果
  onChange(): url发生变化时被被调用
  onEnter(): 有app被mount时被调用
  onLeave(): 有app被unmount时被调用
}
```

和app的启动一样，你也可以主动调用`router.bootstrap()`来启动路由监听。

## 注意点

- 麦饭不支持跨域拉取资源，因此，请将你的所有应用部署在主应用域名下。
- 麦饭的所有接口函数，必须在脚本顶层执行，不能异步执行上面的任何一个函数（app.bootstrap等对象方法可以异步执行）
- 不支持子应用通过`<script type="module">`执行脚本，直接在浏览器中运行的ES脚本目前还不支持创建环境，所以不支持

## License

MIT.
