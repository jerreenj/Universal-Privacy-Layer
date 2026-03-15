# 📱 UPL Mobile App - Test on Your Phone

## Quick Start (2 minutes)

### Step 1: Download the Code
Download the `/app/mobile-expo` folder from this project.

### Step 2: Install Expo Go on Your Phone
- **iOS**: [App Store - Expo Go](https://apps.apple.com/app/expo-go/id982107779)
- **Android**: [Play Store - Expo Go](https://play.google.com/store/apps/details?id=host.exp.exponent)

### Step 3: Run Locally
On your computer (Mac/Windows/Linux):

```bash
# Navigate to the downloaded folder
cd mobile-expo

# Install dependencies
npm install

# Start Expo
npx expo start
```

### Step 4: Scan QR Code
- A QR code will appear in your terminal
- **iOS**: Open Camera app and scan the QR code
- **Android**: Open Expo Go app and scan the QR code

That's it! The app will load on your phone.

---

## What's Included

### Screens
- 🏠 **Home** - Balance display, quick actions, chain selector
- 📥 **Receive** - Generate stealth addresses
- 📤 **Send** - Private send interface
- 🔀 **Split** - Cross-chain split configuration
- 📜 **History** - Transaction history
- 💰 **Hidden Balance** - Aggregated stealth balances
- ⚙️ **Setup** - Privacy wallet configuration
- ℹ️ **About** - App information

### Features
- ✅ Connect with any ETH address (demo mode)
- ✅ View balances on 7 chains
- ✅ Generate stealth addresses
- ✅ Cross-chain split configuration
- ✅ Dark theme matching web app
- ✅ Pull-to-refresh
- ✅ Clipboard support

### API Connection
The app connects to your live backend:
```
https://privacy-dex-pro.preview.emergentagent.com/api
```

---

## Project Structure

```
mobile-expo/
├── App.js              # Main app with all screens
├── app.json            # Expo configuration
├── package.json        # Dependencies
├── babel.config.js     # Babel config
├── assets/             # App icons & splash
│   ├── icon.png
│   ├── adaptive-icon.png
│   ├── splash.png
│   └── favicon.png
└── src/
    └── services/
        └── api.js      # API service layer
```

---

## Building for Production

### Android APK
```bash
npx expo build:android -t apk
```

### iOS IPA (requires Apple Developer account)
```bash
npx expo build:ios -t archive
```

### Using EAS Build (recommended)
```bash
npm install -g eas-cli
eas build --platform android
eas build --platform ios
```

---

## Troubleshooting

**"Unable to connect to server"**
- Make sure your phone and computer are on the same WiFi
- Try `npx expo start --tunnel` for remote testing

**"Module not found"**
```bash
rm -rf node_modules
npm install
npx expo start -c  # Clear cache
```

**Slow loading?**
- First load downloads JavaScript bundle (~2MB)
- Subsequent loads are instant
