//! User-facing launcher settings.
//!
//! The copy in `src-tauri/launcher.json` is the built-in default. On first
//! launch the app writes that file to the OS config directory and reads it
//! from there afterwards, so a daily shortcut can be changed without a rebuild.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, utils::config::WindowConfig};
use url::Url;

pub const DEFAULT_CHAT_URL: &str = "https://chat.deepseek.com/";
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+D";
pub const CONFIG_FILE: &str = "launcher.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    #[serde(default = "default_chat_url")]
    pub chat_url: String,
    #[serde(default = "default_shortcut")]
    pub shortcut: String,
    #[serde(default = "default_hosts")]
    pub allowed_hosts: Vec<String>,
    pub glass: GlassSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GlassSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub force_on_unsupported: bool,
    #[serde(default = "default_shell_alpha")]
    pub shell_alpha: f64,
    #[serde(default = "default_panel_alpha")]
    pub panel_alpha: f64,
    #[serde(default = "default_shell_coverage")]
    pub shell_coverage: f64,
    #[serde(default = "default_panel_width")]
    pub panel_width_coverage: f64,
    #[serde(default = "default_panel_height")]
    pub panel_height_coverage: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GlassInject<'a> {
    enabled: bool,
    shell_alpha: f64,
    panel_alpha: f64,
    shell_coverage: f64,
    panel_width_coverage: f64,
    panel_height_coverage: f64,
    /// Linux only. WebKitGTK flattens a translucent CSS color against white,
    /// so the shell is cleared and the frost is painted by GTK underneath.
    clear_shell: bool,
    allowed_hosts: &'a [String],
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            chat_url: DEFAULT_CHAT_URL.into(),
            shortcut: DEFAULT_SHORTCUT.into(),
            allowed_hosts: default_hosts(),
            glass: GlassSettings::default(),
        }
    }
}

impl Default for GlassSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            force_on_unsupported: false,
            shell_alpha: default_shell_alpha(),
            panel_alpha: default_panel_alpha(),
            shell_coverage: default_shell_coverage(),
            panel_width_coverage: default_panel_width(),
            panel_height_coverage: default_panel_height(),
        }
    }
}

impl Settings {
    pub fn builtin() -> Self {
        Self::parse(include_str!("../launcher.json")).unwrap_or_default()
    }

    pub fn load(app: &AppHandle) -> Self {
        if let Some(path) = std::env::var_os("DEEPSEEK_GLASS_CONFIG") {
            return read_or_builtin(Path::new(&path));
        }

        let Some(path) = config_file(app) else {
            return Self::builtin();
        };

        if path.exists() {
            return read_or_builtin(&path);
        }

        if let Some(parent) = path.parent() {
            match std::fs::create_dir_all(parent)
                .and_then(|_| std::fs::write(&path, include_str!("../launcher.json")))
            {
                Ok(()) => {
                    eprintln!(
                        "DeepSeek Glass: wrote default settings to {}",
                        path.display()
                    );
                }
                Err(error) => {
                    eprintln!(
                        "DeepSeek Glass: could not write {} ({error}). Using built-in settings.",
                        path.display()
                    );
                }
            }
        }

        Self::builtin()
    }

    pub fn parse(raw: &str) -> Result<Self, String> {
        let parsed: Settings = serde_json::from_str(raw).map_err(|error| error.to_string())?;
        parsed.validated()
    }

    pub fn apply_chat_url(&self, window: &mut WindowConfig) -> Result<(), String> {
        let url = Url::parse(&self.chat_url).map_err(|error| error.to_string())?;
        if url.scheme() != "https" || url.host_str().is_none() {
            return Err("chatUrl must be an https URL with a host".into());
        }
        window.url = WebviewUrl::External(url);
        Ok(())
    }

    /// Page softening runs on macOS, Windows, and Linux.
    /// `windowEffects` still only exist on macOS and Windows; on Linux the
    /// window is transparent and blur comes from the compositor.
    /// `forceOnUnsupported` is for every other platform.
    pub fn glass_applies(&self) -> bool {
        if !self.glass.enabled {
            return false;
        }
        if cfg!(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux"
        )) {
            return true;
        }
        self.glass.force_on_unsupported
    }

    pub fn prelude_script(&self) -> String {
        let payload = GlassInject {
            enabled: self.glass_applies(),
            shell_alpha: self.glass.shell_alpha,
            panel_alpha: self.glass.panel_alpha,
            shell_coverage: self.glass.shell_coverage,
            panel_width_coverage: self.glass.panel_width_coverage,
            panel_height_coverage: self.glass.panel_height_coverage,
            clear_shell: cfg!(target_os = "linux"),
            allowed_hosts: &self.allowed_hosts,
        };
        let json = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
        format!("window.__DEEPSEEK_GLASS__={json};")
    }

    fn validated(mut self) -> Result<Self, String> {
        self.chat_url = self.chat_url.trim().to_string();
        let url = Url::parse(&self.chat_url).map_err(|error| format!("chatUrl: {error}"))?;
        if url.scheme() != "https" || url.host_str().is_none() {
            return Err("chatUrl must be an https URL with a host".into());
        }
        self.chat_url = url.to_string();

        self.shortcut = self.shortcut.trim().to_string();
        if self.shortcut.is_empty() {
            return Err("shortcut must not be empty".into());
        }

        let hosts = self
            .allowed_hosts
            .iter()
            .filter_map(|host| normalize_host(host))
            .collect::<Vec<_>>();
        self.allowed_hosts = if hosts.is_empty() {
            default_hosts()
        } else {
            hosts
        };

        self.glass.shell_alpha = clamp_alpha(self.glass.shell_alpha, default_shell_alpha());
        self.glass.panel_alpha = clamp_alpha(self.glass.panel_alpha, default_panel_alpha());
        self.glass.shell_coverage =
            clamp_unit(self.glass.shell_coverage, default_shell_coverage(), 0.5);
        self.glass.panel_width_coverage =
            clamp_unit(self.glass.panel_width_coverage, default_panel_width(), 0.15);
        self.glass.panel_height_coverage = clamp_unit(
            self.glass.panel_height_coverage,
            default_panel_height(),
            0.3,
        );
        Ok(self)
    }
}

fn read_or_builtin(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(raw) => match Settings::parse(&raw) {
            Ok(settings) => settings,
            Err(error) => {
                eprintln!(
                    "DeepSeek Glass: {} is invalid ({error}). Using built-in settings.",
                    path.display()
                );
                Settings::builtin()
            }
        },
        Err(error) => {
            eprintln!(
                "DeepSeek Glass: could not read {} ({error}). Using built-in settings.",
                path.display()
            );
            Settings::builtin()
        }
    }
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(CONFIG_FILE))
}

fn normalize_host(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains("://") {
        return Url::parse(trimmed)
            .ok()
            .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()));
    }
    let host = trimmed.to_ascii_lowercase();
    if host.contains('/') || host.contains(' ') || host.contains('@') {
        return None;
    }
    Some(host)
}

fn clamp_alpha(value: f64, fallback: f64) -> f64 {
    clamp_unit(value, fallback, 0.55)
}

fn clamp_unit(value: f64, fallback: f64, min: f64) -> f64 {
    if !value.is_finite() {
        return fallback;
    }
    value.clamp(min, 1.0)
}

fn default_true() -> bool {
    true
}

fn default_chat_url() -> String {
    DEFAULT_CHAT_URL.into()
}

fn default_shortcut() -> String {
    DEFAULT_SHORTCUT.into()
}

fn default_hosts() -> Vec<String> {
    vec!["chat.deepseek.com".into()]
}

fn default_shell_alpha() -> f64 {
    0.74
}

fn default_panel_alpha() -> f64 {
    0.88
}

fn default_shell_coverage() -> f64 {
    0.82
}

fn default_panel_width() -> f64 {
    0.28
}

fn default_panel_height() -> f64 {
    0.62
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_file_parses() {
        let settings = Settings::builtin();
        assert_eq!(settings.chat_url, "https://chat.deepseek.com/");
        assert_eq!(settings.shortcut, DEFAULT_SHORTCUT);
        assert_eq!(
            settings.allowed_hosts,
            vec!["chat.deepseek.com".to_string()]
        );
        assert!(settings.glass.enabled);
        assert!((settings.glass.shell_alpha - 0.74).abs() < f64::EPSILON);
    }

    #[test]
    fn rejects_insecure_chat_url() {
        let error = Settings::parse(
            r#"{"chatUrl":"http://chat.deepseek.com/","shortcut":"CommandOrControl+Shift+D"}"#,
        )
        .unwrap_err();
        assert!(error.contains("https"), "{error}");
    }

    #[test]
    fn clamps_glass_alpha_and_normalizes_hosts() {
        let settings = Settings::parse(
            r#"{
                "chatUrl": "https://chat.deepseek.com/sign_in",
                "shortcut": " Alt+Space ",
                "allowedHosts": ["https://Chat.DeepSeek.com/path", "bad host", ""],
                "glass": { "shellAlpha": 0.1, "panelAlpha": 2.0 }
            }"#,
        )
        .unwrap();

        assert_eq!(settings.chat_url, "https://chat.deepseek.com/sign_in");
        assert_eq!(settings.shortcut, "Alt+Space");
        assert_eq!(
            settings.allowed_hosts,
            vec!["chat.deepseek.com".to_string()]
        );
        assert!((settings.glass.shell_alpha - 0.55).abs() < f64::EPSILON);
        assert!((settings.glass.panel_alpha - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn empty_host_list_falls_back_to_official_chat() {
        let settings =
            Settings::parse(r#"{"chatUrl":"https://chat.deepseek.com/","allowedHosts":[]}"#)
                .unwrap();
        assert_eq!(settings.allowed_hosts, default_hosts());
        assert_eq!(settings.shortcut, DEFAULT_SHORTCUT);
    }

    #[test]
    fn desktop_targets_apply_glass_when_enabled() {
        let settings = Settings::builtin();
        let desktop = cfg!(any(
            target_os = "macos",
            target_os = "windows",
            target_os = "linux"
        ));
        if desktop {
            assert!(settings.glass_applies());
            let mut disabled = settings;
            disabled.glass.enabled = false;
            assert!(!disabled.glass_applies());
        } else {
            assert!(!settings.glass_applies());
            let mut forced = settings;
            forced.glass.force_on_unsupported = true;
            assert!(forced.glass_applies());
        }
    }

    #[test]
    fn prelude_disables_glass_when_requested() {
        let mut settings = Settings::builtin();
        settings.glass.enabled = false;
        let script = settings.prelude_script();
        assert!(script.contains("\"enabled\":false"), "{script}");
        assert!(script.starts_with("window.__DEEPSEEK_GLASS__="));
    }

    #[test]
    fn glass_script_is_host_gated() {
        let js = include_str!("../scripts/glass.js");
        assert!(js.contains("location.hostname"));
        assert!(js.contains("allowedHosts"));
        assert!(js.contains("background-color"));
        assert!(js.contains("shadowRoot"));
        assert!(js.contains("elementFromPoint"));
        assert!(js.contains("clearShell"));
    }

    #[test]
    fn linux_clears_shell_other_desktops_keep_the_tint() {
        let script = Settings::builtin().prelude_script();
        if cfg!(target_os = "linux") {
            assert!(script.contains("\"clearShell\":true"), "{script}");
        } else {
            assert!(script.contains("\"clearShell\":false"), "{script}");
        }
    }
}
