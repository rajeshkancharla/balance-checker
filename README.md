# Balance Checker

Balance Checker is a local-first mobile app for checking prepaid card balances through `https://www.cardbalance.com.au/`.

It stores card number and expiry on the device using Expo SecureStore, unlocks with the phone's biometric or passcode prompt when available, asks for CVV only at check time, opens the official balance website in an in-app WebView, fills the form, submits it, and tries to read the displayed balance.

## Quick Start

1. Install Node.js 22.13 or newer.
2. Install Expo tooling:

   ```sh
   npm install
   npx expo start
   ```

3. Install **Expo Go** on your phone.
4. Scan the QR code shown by Expo.

For a permanent app icon, build a development or production app with EAS:

```sh
npm install -g eas-cli
eas build --platform android
```

For iPhone builds, you need an Apple Developer account or a local Xcode setup. Face ID is limited in Expo Go, so use a development build for proper iPhone biometric testing.

## Use

1. Open the app.
2. Unlock with Face ID, fingerprint, or device passcode if your phone supports it.
3. Add a card nickname, card number, and expiry date.
4. Tap **Check**, enter the CVV, and the app opens the official balance site.

## Security Notes

- CVV is not saved. It is only kept in memory long enough to fill the official balance page.
- Card details are stored locally with SecureStore, backed by the platform secure storage where available.
- There is no backend service, analytics, or cloud sync.
- Do not put real card data in screenshots, issue reports, or logs.

## Known Limits

- There is no public documented API for `cardbalance.com.au`, so this uses the official website form.
- The site may change its field names, layout, validation, or bot protection. If that happens, the automation may need updating.
- If the app cannot identify the form fields, it leaves you on the official page so you can complete the check manually.
