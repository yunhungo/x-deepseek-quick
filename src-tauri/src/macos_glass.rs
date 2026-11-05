// @created 2026-11-05
// @description 保留系统背景模糊并保守移除材质染色，未知结构使用原生材质
// @author yunhungo

use std::{collections::VecDeque, ffi::CStr, sync::OnceLock};

use objc2::{
    class, msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject, ClassBuilder, Sel},
    sel,
};
use objc2_core_graphics::CGColor;
use objc2_foundation::NSRect;
use tauri::webview::WebviewWindow;

const MAX_LAYERS: usize = 64;
const MAX_DEPTH: usize = 6;
static EFFECT_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

/// Uses NSVisualEffectView to keep the full rounded window in the compositor.
/// Only our own material layer tree is inspected, never WebKit or page content.
pub fn apply(window: &WebviewWindow) -> tauri::Result<()> {
    // SAFETY: setup runs on the AppKit main thread with a live NSWindow.
    unsafe {
        let native = window.ns_window()? as *mut AnyObject;
        let content: *mut AnyObject = msg_send![native, contentView];
        let bounds: NSRect = msg_send![content, bounds];
        let allocated: *mut AnyObject = msg_send![effect_class(), alloc];
        let view: *mut AnyObject = msg_send![allocated, initWithFrame: bounds];
        let Some(view) = Retained::from_raw(view) else {
            return Ok(()); // Keep Tauri's existing material if allocation fails.
        };
        let _: () = msg_send![&*view, setMaterial: 21_isize]; // UnderWindowBackground
        let _: () = msg_send![&*view, setBlendingMode: 0_isize]; // BehindWindow
        let _: () = msg_send![&*view, setState: 1_isize]; // Active
        let _: () = msg_send![&*view, setAutoresizingMask: 18_usize]; // Width + height
        let _: () = msg_send![&*view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![&*view, layer];
        if layer.is_null() {
            return Ok(());
        }
        let _: () = msg_send![layer, setCornerRadius: 20.0_f64];
        let _: () = msg_send![layer, setMasksToBounds: true];
        window.set_effects(None)?;
        let _: () = msg_send![content, addSubview: &*view,
            positioned: -1_isize, relativeTo: std::ptr::null::<AnyObject>()];
        // The content view now retains the effect. It resizes and updates with
        // AppKit; there is no timer and no dependence on the website's DOM.
        eprintln!("DSQuick: native backdrop with conservative tint removal enabled");
    }
    Ok(())
}

fn effect_class() -> &'static AnyClass {
    EFFECT_CLASS.get_or_init(|| {
        let mut builder =
            ClassBuilder::new(c"DSQuickGaussianEffectView", class!(NSVisualEffectView))
                .expect("unique DSQuick visual effect class");
        // SAFETY: the callback matches NSObject's void updateLayer signature.
        unsafe {
            builder.add_method(sel!(updateLayer), update_layer as extern "C" fn(_, _));
        }
        builder.register()
    })
}

extern "C" fn update_layer(view: &AnyObject, _: Sel) {
    // SAFETY: AppKit invokes updateLayer on its main thread. All inspected
    // layers belong to this effect view and remain retained for this callback.
    unsafe {
        let _: () = msg_send![super(view, class!(NSVisualEffectView)), updateLayer];
        let root: *mut AnyObject = msg_send![view, layer];
        let Some(layers) = material_layers(root) else {
            return;
        };
        // Inspect first, mutate second. An unknown or oversized hierarchy keeps
        // the complete native material, rather than losing its backdrop.
        let has_backdrop = layers.iter().any(|layer| {
            (**layer)
                .class()
                .name()
                .to_bytes()
                .windows(13)
                .any(|part| part == b"BackdropLayer")
        });
        let mut descriptions = Vec::with_capacity(layers.len());
        for layer in &layers {
            let filters: *mut AnyObject = msg_send![*layer, filters];
            let Some(names) = filter_descriptions(filters) else {
                return;
            };
            descriptions.push((filters, names));
        }
        let has_blur = descriptions
            .iter()
            .any(|(_, names)| names.iter().any(|name| name.contains("gaussianblur")));
        if !has_backdrop || !has_blur {
            static FALLBACK_REPORTED: std::sync::atomic::AtomicBool =
                std::sync::atomic::AtomicBool::new(false);
            if !FALLBACK_REPORTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                eprintln!("DSQuick: material layout not recognized; preserving system tint");
            }
            return;
        }
        static REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !REPORTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            eprintln!("DSQuick: Gaussian backdrop recognized; removing material tint only");
        }
        for (layer, (filters, names)) in layers.into_iter().zip(descriptions) {
            let _: () = msg_send![layer, setBackgroundColor: std::ptr::null::<CGColor>()];
            if (*layer).class().name().to_bytes() == b"CAChameleonLayer" {
                let _: () = msg_send![layer, setHidden: true];
                continue;
            }
            if !names.iter().any(|name| is_saturation(name)) {
                continue;
            }
            let kept: *mut AnyObject = msg_send![class!(NSMutableArray), array];
            for (index, name) in names.iter().enumerate() {
                if !is_saturation(name) {
                    let filter: *mut AnyObject = msg_send![filters, objectAtIndex: index];
                    let _: () = msg_send![kept, addObject: filter];
                }
            }
            let _: () = msg_send![layer, setFilters: kept];
        }
    }
}

unsafe fn material_layers(root: *mut AnyObject) -> Option<Vec<*mut AnyObject>> {
    if root.is_null() {
        return None;
    }
    let mut layers = Vec::new();
    let mut queue = VecDeque::from([(root, 0)]);
    while let Some((layer, depth)) = queue.pop_front() {
        if layers.len() >= MAX_LAYERS || depth > MAX_DEPTH {
            return None;
        }
        layers.push(layer);
        // SAFETY: CALayer owns its sublayers for the duration of updateLayer.
        unsafe {
            let children: *mut AnyObject = msg_send![layer, sublayers];
            if children.is_null() {
                continue;
            }
            let count: usize = msg_send![children, count];
            if layers.len() + queue.len() + count > MAX_LAYERS {
                return None;
            }
            for index in 0..count {
                let child: *mut AnyObject = msg_send![children, objectAtIndex: index];
                queue.push_back((child, depth + 1));
            }
        }
    }
    Some(layers)
}

unsafe fn filter_descriptions(filters: *mut AnyObject) -> Option<Vec<String>> {
    if filters.is_null() {
        return Some(Vec::new());
    }
    // SAFETY: the value is a live CALayer filters array.
    unsafe {
        let count: usize = msg_send![filters, count];
        if count > MAX_LAYERS {
            return None;
        }
        Some(
            (0..count)
                .map(|index| {
                    let filter: *mut AnyObject = msg_send![filters, objectAtIndex: index];
                    let description: *mut AnyObject = msg_send![filter, description];
                    if description.is_null() {
                        return String::new();
                    }
                    let text: *const std::ffi::c_char = msg_send![description, UTF8String];
                    if text.is_null() {
                        String::new()
                    } else {
                        CStr::from_ptr(text).to_string_lossy().to_ascii_lowercase()
                    }
                })
                .collect(),
        )
    }
}

fn is_saturation(name: &str) -> bool {
    name.contains("colorsaturate") || name.contains("saturation")
}
