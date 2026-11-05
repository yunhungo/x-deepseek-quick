# DSQuick

非官方 DeepSeek 网页桌面壳，支持 macOS、Linux 与 Windows。账号、聊天和上传由 DeepSeek 官网处理，应用不调用私有聊天接口。

## 构建和运行

需要 Node.js 20+、Rust 1.90+。macOS 需要 Xcode 命令行工具；Linux 需要 GTK 3、WebKitGTK 4.1 与相应构建工具；Windows 需要 WebView2 和 Rust/MSVC 工具链。

```sh
npm ci
npm run tauri dev
npm run test:adapter
npm run tauri build -- --bundles app
```

macOS 成果为 `src-tauri/target/release/bundle/macos/DSQuick.app`。其他系统运行 `npm run tauri build`，在 `src-tauri/target/release/bundle/` 获取对应安装包。桌面库仅生成 `rlib`，不生成移动端库。

默认快捷键为 macOS 的 Command+Shift+D、其他系统的 Ctrl+Shift+D，用于显示或隐藏窗口。macOS 用 Command+Q 退出，Command+W 隐藏窗口。再次启动会显示已有窗口。

macOS 隐藏原生标题栏与交通灯，顶部空白可拖动；按钮和输入控件优先接收点击。整个窗口采用 20px 圆角，最小尺寸为 420 × 480。窗口大小和位置自动保存。

## 磨砂和网站适配

原生窗口负责桌面背景模糊、透明、圆角和快捷键；网站适配器仅负责网页表面。macOS 使用原生 `NSVisualEffectView` 模糊窗口背后的画面，移除全窗口白/灰网页底色。`src-tauri/src/macos_glass.rs` 只在自身材质层中识别到背景模糊后，清除额外染色与饱和度增强；层级或滤镜无法识别时保留系统材质。内部图层不是公开稳定合同，系统升级后可能退回带调色的毛玻璃。不会修改 WebKit 图层，也不硬链接非公开窗口接口。输入框、代码卡片及页脚仍保留阅读所需的表面与阴影。Windows 使用 Mica/Acrylic，Linux 由桌面合成器提供模糊。GNOME 等没有窗口背景模糊能力的合成器只能显示透明效果。

适配代码集中在 `src-tauri/scripts/glass.js`：

- `POLICY` 维护版本、扫描上限、语义保护范围和交互范围，不依赖官网散列类名。
- `classifySurface` 是纯分类函数，仅允许识别出的浅层布局背景和页头/页脚表面；尺寸本身不构成修改依据。
- 消息、代码、输入、圆角卡片、对话框和抽屉保留官网表面。代码卡片从外层裁剪，避免下方露出直角背景。
- 输入框外围按位置、尺寸识别空渐变装饰（普通元素或伪元素），只遮掉上缘白雾，保留下缘原始主题渐变与卡片阴影；遮罩随输入框高度变化，不依赖散列类名，不删除节点或改变点击与布局。窗口原生模糊继续保留。
- 未知结构或颜色保留官网样式；异常时撤销本轮表面标记，不强行透明化。
- 扫描有深度、节点数与时间合并限制；不遍历整段聊天内容。自身标记不会反复触发观察器，页面离开时清理监听与定时器，并兼容浏览器往返缓存。

脚本作为 `scripts/glass.js` 应用资源分发，正式版启动时读取随包副本；开发模式读取项目源文件。只改网页适配时，在已有原生构建后执行：

```sh
npm run test:adapter
npm run tauri bundle -- --bundles app
```

重新打包会使用当前脚本，无需重新链接原生程序。修改 Rust、依赖、权限或窗口配置后仍需完整构建。不要直接修改已签名应用包里的资源。

官网 DOM 并非公开接口，不能保证未来任意版本自动兼容。更新适配器时先跑契约测试，再实看宽/窄窗口、长短用户消息、代码卡片、输入框、侧栏、对话框和深浅主题；未知布局优先保留可用性。

## 本机配置与登录状态

首次启动从 `src-tauri/launcher.json` 创建本机配置。macOS 位于 `~/Library/Application Support/app.deepseekglass.launcher/launcher.json`；Linux 位于 `~/.config/app.deepseekglass.launcher/launcher.json`；Windows 位于对应应用配置目录。也可用 `DEEPSEEK_GLASS_CONFIG` 指定本机配置文件，修改后重启。

配置支持 `chatUrl`（HTTPS）、`shortcut`、`allowedHosts` 和 `glass.enabled`。仅允许主机上运行适配脚本。旧版透明度和覆盖阈值字段仍可读取以兼容旧文件，但保守适配器不再用这些值识别消息或逐层叠加底色。

WebView 明确关闭无痕模式，使用系统持久化网站数据存储。Cookie、Local Storage 与登录状态由 WebKit/WebView 在本机管理，不导出到源码或配置。保留原应用标识 `app.deepseekglass.launcher`，改名不会主动隔离原有登录数据；会话期限、退出登录和远端撤销仍由 DeepSeek 控制。窗口状态与本机配置、网站数据都不应进入 Git。

远程网页仅获主窗口拖动权限，无文件系统或 shell 权限；只允许主窗口的 DeepSeek 官网调用拖动。登录弹窗允许在 WebView 内完成。网页没有本机文件访问能力，文件拖放交给官网上传控件。

## 图标

正式源图为 `src-tauri/icons/source.png`，是按用户参考生成的蓝发 Q 版头像，不代表 DeepSeek 官方应用。运行 `python3 -B scripts/render-icon.py` 根据源图重新生成平台图标；仅保留当前目标需要的正式资源，清理未使用的生成目录。

`.myself/` 用于被忽略的本机任务文件；不提交临时截图、测试报告、凭据或构建包。正式应用与可复用构建缓存保留在现有工具输出目录。

## macOS 正式安装包

完成原生 release 构建后运行 `npm run package:mac`：先打包当前网页资源，再补全 APP 签名、生成包含应用与 Applications 入口的 DMG，并只读挂载验证签名和适配器内容。默认使用本机 ad-hoc 签名；如配置 `APPLE_SIGNING_IDENTITY` 则沿用该身份。此流程不代表完成 Apple 公证。临时安装目录与挂载自动清理，正式 APP 和 DMG 留在既有 bundle 输出目录。
