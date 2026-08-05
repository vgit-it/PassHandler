## Default Permission

The full set of Pass Handler native commands. Every one of these is required by
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

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`passhandler:allow-biometric-authenticate`

</td>
<td>

Enables the biometric_authenticate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-biometric-authenticate`

</td>
<td>

Denies the biometric_authenticate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-biometric-status`

</td>
<td>

Enables the biometric_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-biometric-status`

</td>
<td>

Denies the biometric_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-clipboard-clear-if-matches`

</td>
<td>

Enables the clipboard_clear_if_matches command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-clipboard-clear-if-matches`

</td>
<td>

Denies the clipboard_clear_if_matches command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-clipboard-write-sensitive`

</td>
<td>

Enables the clipboard_write_sensitive command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-clipboard-write-sensitive`

</td>
<td>

Denies the clipboard_write_sensitive command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-secure-store-delete`

</td>
<td>

Enables the secure_store_delete command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-secure-store-delete`

</td>
<td>

Denies the secure_store_delete command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-secure-store-get`

</td>
<td>

Enables the secure_store_get command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-secure-store-get`

</td>
<td>

Denies the secure_store_get command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-secure-store-set`

</td>
<td>

Enables the secure_store_set command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-secure-store-set`

</td>
<td>

Denies the secure_store_set command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:allow-set-screen-capture-blocked`

</td>
<td>

Enables the set_screen_capture_blocked command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`passhandler:deny-set-screen-capture-blocked`

</td>
<td>

Denies the set_screen_capture_blocked command without any pre-configured scope.

</td>
</tr>
</table>
