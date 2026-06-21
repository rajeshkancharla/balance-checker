# Local Card Balance Helper

This is a local Chrome/Edge extension prototype for prepaid cards checked through `https://www.cardbalance.com.au/`.

It stores card number and expiry in an encrypted vault inside the browser profile. It does **not** save CVV in the vault. When you check a balance, the extension asks for CVV, opens the official balance website, fills the form, submits it, and tries to read the displayed balance.

## Install

1. Open Chrome or Edge.
2. Go to `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select this folder: `officeworks-card-balance-extension`.

## Use

1. Click the extension icon.
2. Create a vault password.
3. Add a card nickname, card number, and expiry date.
4. Optionally choose **Set up device check** to ask the browser for platform verification before unlocking.
5. Click **Check**, enter the CVV, and the extension opens the official balance website.

## Security Notes

- CVV is only held long enough to hand it to the newly opened balance tab. It is not written to the encrypted vault or `chrome.storage.local`.
- Card details are encrypted with AES-GCM using a key derived from your vault password with PBKDF2.
- The vault lives only in `chrome.storage.local` for this browser profile.
- Device verification uses the browser WebAuthn/passkey prompt where available. It is an extra local unlock gate, not a replacement for the vault password.
- Do not sync or upload this extension folder with real card data in screenshots, logs, or bug reports.

## Known Limits

- There is no public documented API for `cardbalance.com.au`, so this uses the official website form.
- The site may change its field names, layout, validation, or bot protection. If that happens, the automation may need updating.
- If the extension cannot identify the form fields, it leaves you on the official page so you can complete the check manually.
