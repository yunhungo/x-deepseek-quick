# DeepSeek Glass

把 [DeepSeek 网页聊天](https://chat.deepseek.com/) 装进一个桌面窗口。macOS 和 Linux 都是正式支持的目标：Dock / 启动台 / Spotlight，或桌面环境的应用菜单，都能打开它。窗口尽量只剩聊天页。

磨砂的来源两个系统不一样：

- **macOS** 用系统 vibrancy（`NSVisualEffectView`，配置里的 `hudWindow`），背景是真正的高斯模糊。
- **Linux** 用透明的 GTK / WebKit 窗口。模糊由合成器提供：KWin、picom、Hyprland 可以模糊，GNOME Mutter 和 xfwm 只能透出后面的画面，没有等价的系统材质。

这是一个非官方的薄壳，不调用 DeepSeek 的私有接口，账号和对话都留在官网页面里。和深度求索没有隶属关系。

## 环境

Rust **1.90 或更新**（仓库根目录的 `rust-toolchain.toml` 固定 1.90.0）和 **Node.js 20 或更新**。Node 只用来跑 Tauri CLI 和打包那份很小的本地前端。

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### macOS

Xcode 命令行工具提供 `clang` 和 macOS SDK：

```bash
xcode-select --install
```

### Linux

在 Debian / Ubuntu 上，编译需要 WebKitGTK 4.1 和 GTK 3 的开发包（本仓库在 Ubuntu 上用这些包编过）：

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

| 发行版 | 对应的开发包 |
| --- | --- |
| Fedora | `webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel patchelf`，再加 `libxdo-devel`（或发行版里的 xdotool 开发包） |
| Arch | `webkit2gtk-4.1 base-devel curl wget file openssl libappindicator-gtk3 librsvg patchelf` 和 `xdotool` |

运行已经打好的包时还需要 WebKitGTK 4.1 运行库（`libwebkit2gtk-4.1-0`、`libgtk-3-0`）。`.deb` 会声明这些依赖。AppImage 需要 FUSE（`fuse3`）。

透明窗口要有一个正在工作的合成器。模糊不是 Tauri 画出来的，见下面「Linux 上的透明和模糊」。

### Windows

需要 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。窗口材质是 Mica，不行则 Acrylic。

## 运行和打包

三个系统同一套命令：

```bash
npm install
npm run tauri dev
npm run tauri build
```

开发时会先起一个本地 Vite（端口 1420）。真正的窗口加载的是 DeepSeek，不是这个页面。

打包结果：

| 系统 | 路径 |
| --- | --- |
| macOS | `src-tauri/target/release/bundle/macos/DeepSeek Glass.app` |
| Linux | `src-tauri/target/release/bundle/deb/` 和 `.../appimage/`（还有 rpm，如果工具链里有） |
| Windows | `src-tauri/target/release/bundle/msi/` 和 `.../nsis/` |

把 `.app` 拖进「应用程序」之后，Spotlight 和启动台可以搜到 **DeepSeek Glass**。Linux 上安装 `.deb` 之后，应用菜单里的名字也是 DeepSeek Glass。Bundle ID / GTK application id 是 `app.deepseekglass.launcher`。可执行文件名是 `deepseek-glass`。

## 日常怎么用

- **macOS**：红色关闭按钮和 **Command+W** 会隐藏窗口，进程还在。**Command+Q** 退出。窗口藏起来之后，再点一次 Dock 图标会把它带回前面。
- **Linux / Windows**：关闭按钮会退出进程。全局快捷键仍然可以在进程活着的时候隐藏和重新显示窗口。
- 默认全局快捷键是 **Command+Shift+D**（Linux / Windows 上是 **Ctrl+Shift+D**）。窗口已经在前面时再按一次会隐藏；不在前面时会显示并聚焦。
- macOS 上这个快捷键走 `RegisterEventHotKey`，不需要「辅助功能」权限。Linux 上走 Tauri 的全局快捷键插件。如果被别的应用占用，应用照常打开，终端里会有一行提示。
- 再启动一次不会开出第二个进程，只会把已有窗口带到前面。
- 窗口大小和位置会记住。

登录、对话、上传都是官网自己的页面。Google / Apple 登录弹出的窗口允许在应用内打开，这样登录态可以回到聊天页。

## 磨砂玻璃在哪配置

两处，各管一层。

1. **窗口**在 `src-tauri/tauri.conf.json` 的 `app.windows[0]`：

   ```json
   "transparent": true,
   "hiddenTitle": true,
   "titleBarStyle": "Transparent",
   "backgroundColor": "#00000000",
   "windowEffects": {
     "effects": ["hudWindow", "mica", "acrylic"],
     "state": "active",
     "radius": 12
   }
   ```

   `effects` 里每个系统只用自己认识的第一种：macOS 用 `hudWindow`（HUD 磨砂），Windows 11 用 `mica`，更早的 Windows 落到 `acrylic`。Linux 上 Tauri 会忽略这份列表（不报错），窗口仍然是透明的，模糊交给合成器。

   `state` 设为 `active` 时，窗口不在焦点也保持磨砂。改成 `followsWindowActiveState` 会随焦点变淡。`radius` 只在 macOS 上影响圆角。

   可以换成别的 macOS 材质，例如 `underWindowBackground`、`sidebar`、`contentBackground`、`windowBackground`。把想要的名字放在 `effects` 数组的第一项。

   `titleBarStyle: "Transparent"` 是 macOS 专用的，留下一条原生的透明标题栏（交通灯还在，标题栏区域可以拖动窗口）。想让页面铺到标题栏下面，改成 `"Overlay"`，并加上 `"trafficLightPosition": { "x": 14, "y": 18 }`。Overlay 时页面会盖住拖动区域，需要自己在页面里做拖动条，这个壳故意没有把 Tauri API 暴露给网页。Linux 上标题栏是窗口管理器画的（xfwm、Mutter 等），不是 macOS 那种覆盖式标题栏。GTK 不允许在窗口已经显示之后再换成自定义 header bar，所以这里不硬做一条半透明标题栏；客户端区域仍然透明。桌面如果自己用了客户端装饰，`src-tauri/src/linux_glass.rs` 里的 CSS 会把这条窗口里的 header bar 涂成半透明深色。

   `macOSPrivateApi: true` 让 Tauri 2.12 之前的版本打开透明窗口。2.12.1 起这项是空操作，透明窗口默认可用。这份配置保留它，是为了在常见的 2.x 工具链上都能编译。透明窗口用到系统私有能力，这个应用按直接分发 `.app` 来做，不是给 Mac App Store 上架的。在 Linux 上这项没有作用。

2. **页面背景**在 `src-tauri/scripts/glass.js`。官网页面本身是不透明的，会把窗口后面的桌面盖住，所以启动脚本在 `allowedHosts` 里的主机上，把大块纯色背景调成半透明。macOS、Windows、Linux 都会注入，只要 `glass.enabled` 是 `true`。

   - 只改 `background-color`，不改文字、边框、输入框、按钮、图片、对话框。
   - 子面板几乎铺满父级时，父级改为透明，只给内层上色，避免好几层半透明叠成一块实色。
   - 父级还有留白（比如居中的登录卡片）时，给父级上色，小卡片保持原样，卡片外面的文字仍有底。
   - 不读取对话内容，也不把任何页面数据送出去。
   - 样式不依赖 DeepSeek 的 class 名。站点改版后如果磨砂太重或看不出来，改下面的透明度，或把 `glass.enabled` 设为 `false` 完全恢复原页面。

   数值在 `src-tauri/launcher.json`，字段说明见下一节。

## Linux 上的透明和模糊

Linux 没有 `NSVisualEffectView`。Tauri 的 `windowEffects` 在 Linux 上是空操作。能做到的是：

| 能力 | 结果 |
| --- | --- |
| 透明窗口 | 有。GTK RGBA visual，WebKit 背景是透明的。 |
| 页面半透明 | 有，但是一层，不是 macOS 那种系统材质。WebKitGTK 会把叠在一起的半透明合成成一块白，透明像素还会盖掉 GTK 画在页面底下的颜色。所以 Linux 只在 `html` 上留一层约 50% 的白，由合成器去和桌面混合；`body` 清成透明。卡片、输入框自己的不透明底色还在。 |
| 标题栏 | 窗口管理器的普通标题栏（服务端装饰）。macOS 的透明标题栏不会出现在 Linux 上。窗口已经显示之后 GTK 不能再换成自定义 header bar。 |
| X11 + KWin | 应用会给窗口设置 `_KDE_NET_WM_BLUR_BEHIND_REGION`（空区域表示整窗）。KWin 的模糊特效打开时，窗口背后是高斯模糊。 |
| X11 + picom | picom 会模糊带透明通道的窗口，不需要上面那个原子。在 `picom.conf` 里打开 `blur-background`，例如 `blur-method = "dual_kawase"`。 |
| X11 + xfwm4 | 合成打开时，透明区域能看到壁纸或后面的窗口，**不会**高斯模糊。 |
| Wayland + Hyprland | 窗口是透明的。模糊要自己加规则，例如 `windowrulev2 = blur, match:app_id app.deepseekglass.launcher`。 |
| Wayland 原生 + KWin | GTK 3 / Tauri 没有实现 KWin 的 Wayland blur 协议。跑在 XWayland 里时，上面的 X11 原子仍然会设置。 |
| GNOME Mutter | 可以透出壁纸。没有按窗口的背景模糊，和 macOS vibrancy 不是同一件事。 |

合成器没在跑时，透明区域通常是黑的，而不是桌面。X11 上常见的标志是没有程序持有 `_NET_WM_CM_S0`（picom 的新 GLX 后端有时已经在合成，却不设置这个原子，以窗口后面能不能看到壁纸为准）。xfce 里打开「窗口管理器微调 → 合成器」，或另外启动 picom。xfwm 在只有 llvmpipe 的机器上会拒绝打开自己的合成器。

应用不会设置 `_NET_WM_WINDOW_OPACITY`。那个属性会把文字一起变淡。也不要用 CSS `backdrop-filter` 假装桌面模糊：网页里的 `backdrop-filter` 只模糊页面自己的内容。

Wayland 上的应用 id 是 `app.deepseekglass.launcher`。X11 上的 `WM_CLASS` 是 `deepseek-glass` / `Deepseek-glass`（Hyprland 规则匹配应用 id，picom / KWin 规则匹配这个 class）。启动时终端会打一行会话信息：环境变量猜的是 Wayland、XWayland 还是 X11，GDK 实际用的后端，以及 KWin 原子有没有设上。设不上不影响窗口打开。

WebKitGTK 有两个限制，所以 Linux 的磨砂不是把 `shellAlpha` 原样画进页面。叠了好几层的半透明会被合成成一块白色；页面里全透明的像素会直接变成窗口透明，GTK 画在网页底下的颜色露不出来。应用因此只在 `html` 上留一层约 50% 的白，让合成器去和桌面混合，并把 `body` 清掉。输入框和按钮自己的底色不动。没有 DRI3 时（llvmpipe、不少 VNC）再叠一层加速合成还会把半透明铺白，应用默认设置 `WEBKIT_DISABLE_COMPOSITING_MODE=1`。有正常 GPU、想走加速时，启动前设 `WEBKIT_DISABLE_COMPOSITING_MODE=0`。

## 自定义

首次启动会把内置的 `src-tauri/launcher.json` 写到系统配置目录。之后只读那一份，改完要重启应用。

| 系统 | 路径 |
| --- | --- |
| macOS | `~/Library/Application Support/app.deepseekglass.launcher/launcher.json` |
| Linux | `~/.config/app.deepseekglass.launcher/launcher.json` |
| Windows | `%APPDATA%\app.deepseekglass.launcher\launcher.json` |

也可以用环境变量指到别的文件：`DEEPSEEK_GLASS_CONFIG=/path/to/launcher.json`。

删掉配置目录里的 `launcher.json` 会在下次启动时按仓库里的默认文件重新生成。

```json
{
  "chatUrl": "https://chat.deepseek.com/",
  "shortcut": "CommandOrControl+Shift+D",
  "allowedHosts": ["chat.deepseek.com"],
  "glass": {
    "enabled": true,
    "forceOnUnsupported": false,
    "shellAlpha": 0.74,
    "panelAlpha": 0.88,
    "shellCoverage": 0.82,
    "panelWidthCoverage": 0.28,
    "panelHeightCoverage": 0.62
  }
}
```

| 字段 | 作用 |
| --- | --- |
| `chatUrl` | 必须是 `https`。窗口打开的地址。 |
| `shortcut` | 全局快捷键，语法同 Tauri，`CommandOrControl` 在 macOS 上是 Command，在 Linux 和 Windows 上是 Control。 |
| `allowedHosts` | 只在这些主机上注入样式。写成 `https://chat.deepseek.com` 也可以，会取主机名。空数组会退回 `chat.deepseek.com`。 |
| `glass.enabled` | `false` 时页面保持官网原样。macOS / Windows 的窗口材质还在；Linux 的窗口仍然透明，但页面自己的底色会把后面挡住。 |
| `glass.forceOnUnsupported` | macOS、Windows、Linux 上不需要。只在这三者之外的系统上，设为 `true` 才会注入页面半透明。 |
| `glass.shellAlpha` | 铺满窗口的底色不透明度，范围 0.55–1。越小越透。 |
| `glass.panelAlpha` | 侧栏、对话区这种大面板的不透明度，范围同上。 |
| `shellCoverage` / `panelWidthCoverage` / `panelHeightCoverage` | 一个元素要占窗口多大比例才算「大色块」。 |

窗口尺寸、最小尺寸、标题栏和 `windowEffects` 改 `src-tauri/tauri.conf.json`。聊天地址两处都写了：运行时以配置目录里的 `chatUrl` 为准。

图标源文件是 `src-tauri/icons/source.png`（用 `scripts/render-icon.py` 画的，不是 DeepSeek 的标志）。换图之后：

```bash
npm run tauri icon src-tauri/icons/source.png
```

## 权限

应用只做这几件事：

- 用系统 WebView 打开你配置的 https 页面，以及登录时弹出的 https 窗口。
- 注册一个全局快捷键。
- 记住窗口位置。文件在同一个配置目录，名字是 `.window-state.json`。

网页拿不到 Tauri 命令（没有文件系统、没有 shell、没有远程域名 IPC）。`dragDropEnabled` 设为 `false`，是为了把文件拖放留给网页自己的上传控件。不申请麦克风、相机或辅助功能。

顶层跳转只允许 `https`、`http`、`about` 和 `blob`。`file:` 和 `javascript:` 会被拒绝。

## English

Unofficial desktop launcher for the public DeepSeek chat at `https://chat.deepseek.com/`. macOS and Linux are both supported. It does not call a private API.

**macOS.** Xcode Command Line Tools, Rust 1.90+ (`rust-toolchain.toml`), Node 20+. Blur is real vibrancy (`hudWindow` in `src-tauri/tauri.conf.json`). The red close button hides the window; Command+Q quits. The `.app` lands in `src-tauri/target/release/bundle/macos/`.

**Linux.** Same Rust and Node versions. On Debian/Ubuntu, install the Tauri 2 WebKitGTK 4.1 toolchain before `tauri dev` or `tauri build`:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Fedora uses `webkit2gtk4.1-devel`, `openssl-devel`, `libappindicator-gtk3-devel`, `librsvg2-devel`, and `patchelf`. Arch uses `webkit2gtk-4.1` and the matching `base-devel` packages. A built `.deb` depends on the WebKitGTK 4.1 runtime; an AppImage also needs FUSE.

```bash
npm install
npm run tauri dev
npm run tauri build
```

Packages are written under `src-tauri/target/release/bundle/deb/` and `.../appimage/`. The GTK application id is `app.deepseekglass.launcher`. Closing the window quits. Ctrl+Shift+D toggles the window while the process is running. Settings live in `~/.config/app.deepseekglass.launcher/launcher.json`.

Linux blur is not vibrancy. The window is actually transparent (GTK RGBA visual, transparent WebKit background). The title bar is the window manager's frame; GTK refuses a custom header bar once the window is realized, so this is not the macOS transparent title bar. If the desktop uses client-side decorations, CSS in `src-tauri/src/linux_glass.rs` tints that header bar and is attached only to this window's widgets. `windowEffects` is ignored here and does not error. On X11 the app sets `_KDE_NET_WM_BLUR_BEHIND_REGION` so KWin can blur the whole window; the X11 window class is `deepseek-glass` / `Deepseek-glass`. picom blurs ARGB windows when `blur-background` is enabled. On Wayland the app id is `app.deepseekglass.launcher` (Hyprland: `windowrulev2 = blur, match:app_id app.deepseekglass.launcher`). Mutter and xfwm composite the transparent pixels and do not gaussian-blur the backdrop. With no compositor, the transparent areas go black. The page-alpha script `src-tauri/scripts/glass.js` still runs, including through open shadow roots, so the site's solid backgrounds do not cover the desktop.

On Linux WebKitGTK flattens stacked translucent CSS into a solid white page, and fully transparent webview pixels replace any GTK fill underneath them. The frost is a single layer: `html` at about 50% white, which the compositor blends with the desktop, while `body` is cleared. Inputs and buttons keep their own opaque backgrounds. `WEBKIT_DISABLE_COMPOSITING_MODE=1` is set unless you already exported it, so a machine without DRI3 (llvmpipe, many VNC servers) does not flatten that layer. Export `WEBKIT_DISABLE_COMPOSITING_MODE=0` to prefer the GPU path.

**Windows.** WebView2, then the same npm commands. Mica, then Acrylic.

The remote page is not granted Tauri IPC on any platform.
