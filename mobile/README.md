# UPL Mobile App

React Native mobile application for Universal Privacy Layer.

## Prerequisites

- Node.js 18+
- React Native CLI
- Xcode (for iOS)
- Android Studio (for Android)

## Setup

```bash
# Install dependencies
npm install

# iOS specific
cd ios && pod install && cd ..

# Run on iOS
npm run ios

# Run on Android
npm run android
```

## Project Structure

```
mobile/
├── src/
│   ├── screens/        # Screen components
│   ├── components/     # Reusable components
│   ├── services/       # API services
│   ├── hooks/          # Custom hooks
│   ├── utils/          # Utility functions
│   └── navigation/     # Navigation config
├── App.tsx             # Root component
└── index.js            # Entry point
```

## Features

- Private Receive (Stealth Addresses)
- Private Send
- Private Swap
- Cross-Chain Split
- Transaction History
- Biometric Authentication
- Push Notifications

## API Integration

The app connects to the same backend API as the web app:
- Base URL: `https://privacycloak.in/api`
- Authentication: Wallet signature

## Building for Production

### iOS
```bash
cd ios
xcodebuild -workspace UPLMobile.xcworkspace -scheme UPLMobile -configuration Release archive
```

### Android
```bash
cd android
./gradlew assembleRelease
```

## Security

- Secure storage for private keys
- Biometric authentication
- No sensitive data in logs
- Certificate pinning for API calls
