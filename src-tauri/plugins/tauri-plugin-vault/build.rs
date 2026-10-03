const COMMANDS: &[&str] = &[
    "secure_store_set",
    "secure_store_get",
    "secure_store_delete",
    "biometric_status",
    "biometric_authenticate",
    "set_screen_capture_blocked",
    "clipboard_write_sensitive",
    "clipboard_clear_if_matches",
    "clipboard_schedule_clear",
    "clipboard_cancel_scheduled_clear",
    "export_vault",
    "import_vault",
    "type_text",
    "press_tab",
    "keyboard_status",
    "open_keyboard_settings",
    // Not app commands — these back `addPluginListener` on Android, which the
    // OAuth redirect delivery (Kotlin `trigger("oauth-callback", ...)`) needs.
    // Tauri's ACL gates them exactly like any other command: without an entry
    // here, no permission for them exists at all, and every call is rejected
    // as "not allowed. Command not found" regardless of platform.
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
