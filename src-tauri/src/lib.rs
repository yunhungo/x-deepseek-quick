//! DeepSeek Glass — a native window around the public DeepSeek chat page.
//!
//! The webview loads `https://chat.deepseek.com/` (or the URL in launcher.json).
//! Window material, transparency, and the title bar live in `tauri.conf.json`.
//! Rust adds three things the config file cannot express: the background
//! softening script, popup handling for sign-in, and the show/hide hotkey.

mod config;

#[cfg(target_os = "linux")]
mod linux_glass;

use std::sync::atomic::{AtomicBool, Ordering};

use config::Settings;
use tauri::{
    AppHandle, Manager, RunEvent, WindowEvent,
    webview::{NewWindowResponse, WebviewWindow, WebviewWindowBuilder},
};
use url::Url;

const MAIN_LABEL: &str = "main";

struct QuitFlag(AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Accelerated WebKit compositing needs DRI3. Without it (llvmpipe, many
    // VNC servers) a translucent CSS color is flattened against white, so the
    // frosted page looks solid. Software compositing keeps the alpha channel
    // and lets the window compositor show through. Set the variable to 0
    // before launch to opt back into the GPU path.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        // SAFETY: this runs before Tauri spawns threads, so no other thread
        // is reading the environment at the same time.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri_plugin_window_state::StateFlags;

        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                reveal(app);
            }))
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    )
                    .build(),
            );
    }

    builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.manage(QuitFlag(AtomicBool::new(false)));

            let settings = Settings::load(app.handle());
            open_main(app.handle(), &settings)?;
            register_hotkey(app.handle(), &settings)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build DeepSeek Glass")
        .run(on_run_event);
}

fn on_run_event(app: &AppHandle, event: RunEvent) {
    // ExitRequested is emitted before windows are torn down, so the close
    // handler can tell a real quit (Command+Q) from the red close button.
    #[cfg(target_os = "macos")]
    match event {
        RunEvent::ExitRequested { .. } => {
            app.state::<QuitFlag>().0.store(true, Ordering::SeqCst);
        }
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => reveal(app),
        _ => {}
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, event);
    }
}

fn open_main(app: &AppHandle, settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    let mut window_cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_LABEL)
        .cloned()
        .ok_or("tauri.conf.json is missing the main window")?;

    if let Err(error) = settings.apply_chat_url(&mut window_cfg) {
        eprintln!("DeepSeek Glass: {error}. Using the URL from tauri.conf.json.");
    }

    let prelude = settings.prelude_script();
    let window = WebviewWindowBuilder::from_config(app, &window_cfg)?
        .initialization_script(prelude)
        .initialization_script(include_str!("../scripts/glass.js"))
        .on_navigation(navigation_allowed)
        .on_new_window(|url, _features| {
            if popup_allowed(&url) {
                NewWindowResponse::Allow
            } else {
                NewWindowResponse::Deny
            }
        })
        .on_document_title_changed(|window, title| {
            let trimmed = title.trim();
            if !trimmed.is_empty() {
                let _ = window.set_title(trimmed);
            }
        })
        .build()?;

    // macOS vibrancy and Windows Mica are applied by Tauri from `windowEffects`.
    // Linux keeps the transparent window and asks the compositor for blur.
    #[cfg(target_os = "linux")]
    linux_glass::apply(&window);

    #[cfg(target_os = "macos")]
    hide_instead_of_close(&window);
    // Typecheck the macOS close path on other hosts. It is not installed there.
    #[cfg(not(target_os = "macos"))]
    let _ = hide_instead_of_close;

    eprintln!(
        "DeepSeek Glass: chat {} | hotkey {} | glass {}",
        settings.chat_url,
        settings.shortcut,
        if settings.glass_applies() {
            "on"
        } else {
            "off"
        }
    );
    let _ = window;
    Ok(())
}

/// Top-level navigations. Subresource requests are not affected.
fn navigation_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http" | "about" | "blob")
}

/// `window.open` / `target=_blank`. Sign-in popups (Google, Apple) need to
/// stay inside a webview so they can post the session back to the chat page.
fn popup_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http" | "about" | "blob")
}

fn hide_instead_of_close(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let quitting = app.state::<QuitFlag>().0.load(Ordering::SeqCst);
            if !quitting {
                api.prevent_close();
                if let Some(main) = app.get_webview_window(MAIN_LABEL) {
                    let _ = main.hide();
                }
            }
        }
    });
}

fn register_hotkey(app: &AppHandle, settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;

        let registered =
            tauri_plugin_global_shortcut::Builder::new().with_shortcut(settings.shortcut.as_str());
        let builder = match registered {
            Ok(builder) => builder.with_handler(|app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                toggle(app);
            }),
            Err(error) => {
                eprintln!(
                    "DeepSeek Glass: shortcut {:?} was rejected ({error}). The Dock icon still opens the app.",
                    settings.shortcut
                );
                tauri_plugin_global_shortcut::Builder::new()
            }
        };
        app.plugin(builder.build())?;
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, settings);
    }
    Ok(())
}

fn reveal(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused && !minimized {
        let _ = window.hide();
        return;
    }
    reveal(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_chat_and_oauth_navigations() {
        let chat = Url::parse("https://chat.deepseek.com/a/chat/s/new").unwrap();
        let google = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        let blank = Url::parse("about:blank").unwrap();
        assert!(navigation_allowed(&chat));
        assert!(popup_allowed(&google));
        assert!(popup_allowed(&blank));
    }

    #[test]
    fn blocks_local_and_script_navigations() {
        let file = Url::parse("file:///etc/passwd").unwrap();
        let script = Url::parse("javascript:alert(1)").unwrap();
        assert!(!navigation_allowed(&file));
        assert!(!navigation_allowed(&script));
        assert!(!popup_allowed(&file));
        assert!(!popup_allowed(&script));
    }
}
