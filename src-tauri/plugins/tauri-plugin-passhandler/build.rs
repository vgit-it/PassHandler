const COMMANDS: &[&str] = &[
    "secure_store_set",
    "secure_store_get",
    "secure_store_delete",
    "biometric_status",
    "biometric_authenticate",
    "set_screen_capture_blocked",
    "clipboard_write_sensitive",
    "clipboard_clear_if_matches",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
