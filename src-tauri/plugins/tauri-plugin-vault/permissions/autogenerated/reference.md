## Default Permission

The full set of Vault's native commands. Every one of these is required by
the app, and none of them is a general-purpose capability: the secure store is
keyed to fixed account names, the biometric commands only gate access to key
material this app wrote, and the clipboard commands only touch the clipboard.

#### This default permission set includes the following:

- `allow-secure-store-set`
- `allow-secure-store-get`
- `allow-secure-store-delete`
- `allow-biometric-status`
- `allow-biometric-authenticate`
- `allow-set-screen-capture-blocked`
- `allow-clipboard-write-sensitive`
- `allow-clipboard-clear-if-matches`
- `allow-clipboard-schedule-clear`
- `allow-clipboard-cancel-scheduled-clear`
- `allow-export-vault`
- `allow-import-vault`
- `allow-type-text`
- `allow-press-tab`
- `allow-keyboard-status`
- `allow-open-keyboard-settings`
- `allow-register-listener`
- `allow-remove-listener`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`vault:allow-biometric-authenticate`

</td>
<td>

Enables the biometric_authenticate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-biometric-authenticate`

</td>
<td>

Denies the biometric_authenticate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-biometric-status`

</td>
<td>

Enables the biometric_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-biometric-status`

</td>
<td>

Denies the biometric_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-clipboard-cancel-scheduled-clear`

</td>
<td>

Enables the clipboard_cancel_scheduled_clear command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-clipboard-cancel-scheduled-clear`

</td>
<td>

Denies the clipboard_cancel_scheduled_clear command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-clipboard-clear-if-matches`

</td>
<td>

Enables the clipboard_clear_if_matches command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-clipboard-clear-if-matches`

</td>
<td>

Denies the clipboard_clear_if_matches command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-clipboard-schedule-clear`

</td>
<td>

Enables the clipboard_schedule_clear command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-clipboard-schedule-clear`

</td>
<td>

Denies the clipboard_schedule_clear command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-clipboard-write-sensitive`

</td>
<td>

Enables the clipboard_write_sensitive command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-clipboard-write-sensitive`

</td>
<td>

Denies the clipboard_write_sensitive command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-export-vault`

</td>
<td>

Enables the export_vault command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-export-vault`

</td>
<td>

Denies the export_vault command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-import-vault`

</td>
<td>

Enables the import_vault command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-import-vault`

</td>
<td>

Denies the import_vault command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-keyboard-status`

</td>
<td>

Enables the keyboard_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-keyboard-status`

</td>
<td>

Denies the keyboard_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-open-keyboard-settings`

</td>
<td>

Enables the open_keyboard_settings command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-open-keyboard-settings`

</td>
<td>

Denies the open_keyboard_settings command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-press-tab`

</td>
<td>

Enables the press_tab command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-press-tab`

</td>
<td>

Denies the press_tab command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-register-listener`

</td>
<td>

Enables the register_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-register-listener`

</td>
<td>

Denies the register_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-remove-listener`

</td>
<td>

Enables the remove_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-remove-listener`

</td>
<td>

Denies the remove_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-secure-store-delete`

</td>
<td>

Enables the secure_store_delete command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-secure-store-delete`

</td>
<td>

Denies the secure_store_delete command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-secure-store-get`

</td>
<td>

Enables the secure_store_get command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-secure-store-get`

</td>
<td>

Denies the secure_store_get command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-secure-store-set`

</td>
<td>

Enables the secure_store_set command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-secure-store-set`

</td>
<td>

Denies the secure_store_set command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-set-screen-capture-blocked`

</td>
<td>

Enables the set_screen_capture_blocked command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-set-screen-capture-blocked`

</td>
<td>

Denies the set_screen_capture_blocked command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-type-credentials`

</td>
<td>

Enables the type_credentials command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-type-credentials`

</td>
<td>

Denies the type_credentials command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:allow-type-text`

</td>
<td>

Enables the type_text command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`vault:deny-type-text`

</td>
<td>

Denies the type_text command without any pre-configured scope.

</td>
</tr>
</table>
