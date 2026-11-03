//! Linux window material.
//!
//! macOS vibrancy (`NSVisualEffectView` / `hudWindow`) and Windows Mica have no
//! equivalent in Tauri or GTK. What Linux does have is a real transparent
//! window: Tao installs an RGBA visual and paints the client area clear, and
//! WebKitGTK is given a transparent background when `transparent` is true.
//!
//! This module does the two extra steps those libraries leave out:
//! - CSS on this window only, so the GTK header bar is translucent instead of
//!   the theme's opaque bar. The provider is attached to this window's widgets,
//!   not to the screen.
//! - On X11, the KWin hint `_KDE_NET_WM_BLUR_BEHIND_REGION` (empty CARDINAL =
//!   the whole window). KWin blurs the backdrop. picom blurs ARGB windows on
//!   its own and does not need the hint. Nothing here sets
//!   `_NET_WM_WINDOW_OPACITY`, which would fade the text as well.
//!
//! Wayland has no GTK API for the KWin blur protocol. The window stays
//! transparent; blur is a compositor rule (see the README). Failure to set the
//! X11 hint is logged and does not stop the app.

use std::sync::atomic::{AtomicBool, Ordering};

use gtk::prelude::*;

const STYLE_MARK: &str = "deepseek-glass-styled";

/// Header bar is a dark translucent sheet. Everything else in this window is
/// cleared so the page and the compositor show through. Selectors are the
/// widget's own CSS node, because the provider is added per widget.
const WINDOW_CSS: &str = r#"
window, window.background {
  background-color: rgba(0, 0, 0, 0);
}
box {
  background-color: rgba(0, 0, 0, 0);
}
headerbar, .titlebar {
  background-color: rgba(16, 22, 26, 0.72);
  background-image: none;
  color: #f2f6f8;
  border-color: transparent;
  box-shadow: none;
}
"#;

/// Environment-only session hint. The live GDK backend decides whether the
/// X11 blur property is set; this label is for the log line and for tests.
pub fn session_label(has_wayland: bool, has_display: bool) -> &'static str {
    match (has_wayland, has_display) {
        (true, true) => "wayland-with-xwayland",
        (true, false) => "wayland",
        (false, true) => "x11",
        (false, false) => "unknown",
    }
}

pub fn apply(window: &tauri::WebviewWindow) {
    let gtk_window = match window.gtk_window() {
        Ok(gtk_window) => gtk_window,
        Err(error) => {
            eprintln!("DeepSeek Glass: Linux glass skipped ({error}).");
            return;
        }
    };

    gtk_window.set_app_paintable(true);
    if let Some(screen) = gtk::prelude::GtkWindowExt::screen(&gtk_window)
        && let Some(visual) = screen.rgba_visual()
    {
        gtk_window.set_visual(Some(&visual));
    }

    let provider = gtk::CssProvider::new();
    if let Err(error) = provider.load_from_data(WINDOW_CSS.as_bytes()) {
        eprintln!("DeepSeek Glass: Linux window CSS was rejected ({error}).");
    } else {
        style_tree(gtk_window.upcast_ref(), &provider);
        let provider_for_map = provider.clone();
        gtk_window.connect_map(move |mapped| {
            style_tree(mapped.upcast_ref(), &provider_for_map);
        });
    }

    // Underpaint for pixels the page leaves fully clear. WebKit's transparent
    // pixels usually replace this rather than showing it; the visible frost is
    // the single translucent layer glass.js puts on <html>. (u8, u8, u8, u8)
    // matches tao's RGBA.
    // SAFETY: tao's private window data, written once on the main thread.
    unsafe {
        gtk_window.set_data("background_color", Some((237_u8, 242_u8, 245_u8, 107_u8)));
    }
    gtk_window.queue_draw();

    log_session(&gtk_window);
    let gtk_for_map = gtk_window.clone();
    gtk_window.connect_map(move |_| {
        apply_blur_hint(&gtk_for_map);
    });
    apply_blur_hint(&gtk_window);
}

fn style_tree(widget: &gtk::Widget, provider: &gtk::CssProvider) {
    let context = widget.style_context();
    if !context.has_class(STYLE_MARK) {
        context.add_class(STYLE_MARK);
        context.add_provider(provider, gtk::STYLE_PROVIDER_PRIORITY_USER);
    }
    if let Some(container) = widget.downcast_ref::<gtk::Container>() {
        container.forall(|child| style_tree(child, provider));
    }
}

fn log_session(window: &gtk::ApplicationWindow) {
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_display = std::env::var_os("DISPLAY").is_some();
    let hint = session_label(has_wayland, has_display);
    let backend = window.display().backend();
    let app_id = window
        .application()
        .and_then(|app| app.application_id())
        .map(|id| id.to_string())
        .unwrap_or_else(|| "app.deepseekglass.launcher".into());

    eprintln!(
        "DeepSeek Glass: Linux session hint {hint}, GDK backend {backend:?}, app id {app_id}. The window is transparent. hudWindow / mica / acrylic are not applied on Linux."
    );
    if backend.is_wayland() {
        eprintln!(
            "DeepSeek Glass: Wayland has no GTK blur-behind API. Blur needs the compositor (Hyprland window rule on app id {app_id}, KWin blur for XWayland, or a picom-style compositor). Mutter can show the wallpaper through the window and does not blur per window."
        );
    }
}

fn apply_blur_hint(window: &gtk::ApplicationWindow) {
    static LOGGED: AtomicBool = AtomicBool::new(false);

    if !window.display().backend().is_x11() {
        return;
    }
    window.realize();
    let Some(gdk_window) = window.window() else {
        if !LOGGED.swap(true, Ordering::SeqCst) {
            eprintln!("DeepSeek Glass: X11 window has no GDK surface yet; blur hint skipped.");
        }
        return;
    };
    let Ok(x11_window) = gdk_window.downcast::<gdkx11::X11Window>() else {
        if !LOGGED.swap(true, Ordering::SeqCst) {
            eprintln!("DeepSeek Glass: GDK surface is not X11; blur hint skipped.");
        }
        return;
    };

    let xid = x11_window.xid() as u32;
    match set_kwin_blur(xid) {
        Ok(()) => {
            if !LOGGED.swap(true, Ordering::SeqCst) {
                eprintln!(
                    "DeepSeek Glass: set _KDE_NET_WM_BLUR_BEHIND_REGION on {xid:#x} (whole window). KWin blurs that region. picom blurs ARGB windows when blur-background is on and ignores this hint. xfwm composites transparency and does not blur."
                );
            }
        }
        Err(error) => {
            if !LOGGED.swap(true, Ordering::SeqCst) {
                eprintln!(
                    "DeepSeek Glass: could not set the KWin blur property ({error}). The window stays transparent."
                );
            }
        }
    }
}

fn set_kwin_blur(xid: u32) -> Result<(), String> {
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, PropMode};
    use x11rb::wrapper::ConnectionExt as _;

    let (conn, _) = x11rb::connect(None).map_err(|error| error.to_string())?;
    let atom = conn
        .intern_atom(false, b"_KDE_NET_WM_BLUR_BEHIND_REGION")
        .map_err(|error| error.to_string())?
        .reply()
        .map_err(|error| error.to_string())?
        .atom;
    // An empty CARDINAL region means "the whole window" to KWin.
    conn.change_property32(PropMode::REPLACE, xid, atom, AtomEnum::CARDINAL, &[])
        .map_err(|error| error.to_string())?
        .check()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::session_label;

    #[test]
    fn session_label_matches_display_environment() {
        assert_eq!(session_label(false, true), "x11");
        assert_eq!(session_label(true, false), "wayland");
        assert_eq!(session_label(true, true), "wayland-with-xwayland");
        assert_eq!(session_label(false, false), "unknown");
    }
}
