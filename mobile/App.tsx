import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// API Configuration
const API_BASE = 'https://privacycloak.in/api';

// Theme colors
const COLORS = {
  background: '#050505',
  surface: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.1)',
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.5)',
  primary: '#0052FF',
  success: '#00FF88',
  error: '#FF4444',
};

// Chain configuration
const CHAINS = {
  base: { name: 'Base', color: '#0052FF', symbol: 'ETH' },
  arbitrum: { name: 'Arbitrum', color: '#28A0F0', symbol: 'ETH' },
  polygon: { name: 'Polygon', color: '#8247E5', symbol: 'POL' },
  optimism: { name: 'Optimism', color: '#FF0420', symbol: 'ETH' },
  bnb: { name: 'BNB Chain', color: '#F3BA2F', symbol: 'BNB' },
  avalanche: { name: 'Avalanche', color: '#E84142', symbol: 'AVAX' },
  hyperliquid: { name: 'Hyperliquid', color: '#00FF88', symbol: 'HYPE' },
};

// Wallet Context
const WalletContext = createContext(null);
export const useWallet = () => useContext(WalletContext);

function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState('base');
  const [balance, setBalance] = useState(null);

  const connect = async () => {
    // Web3Modal integration would go here
    Alert.alert('Connect Wallet', 'Web3Modal wallet connection');
  };

  const disconnect = () => {
    setAddress(null);
    setBalance(null);
  };

  return (
    <WalletContext.Provider value={{ address, chain, balance, connect, disconnect, setChain }}>
      {children}
    </WalletContext.Provider>
  );
}

// Home Screen
function HomeScreen({ navigation }) {
  const { address, chain, balance, connect } = useWallet();

  if (!address) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.logo}>UPL</Text>
          <Text style={styles.tagline}>Universal Privacy Layer</Text>
          <Text style={styles.subtitle}>The HTTPS of Web3</Text>
          
          <TouchableOpacity style={styles.connectBtn} onPress={connect}>
            <Text style={styles.connectBtnText}>Connect Wallet</Text>
          </TouchableOpacity>

          <View style={styles.chainBadge}>
            <View style={[styles.dot, { backgroundColor: COLORS.success }]} />
            <Text style={styles.chainBadgeText}>7 Chains Live</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Balance Card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Balance on {CHAINS[chain].name}</Text>
          <Text style={styles.balanceText}>
            {balance || '0.00'} <Text style={styles.symbol}>{CHAINS[chain].symbol}</Text>
          </Text>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {[
            { title: 'Receive', screen: 'Receive', color: COLORS.success },
            { title: 'Send', screen: 'Send', color: COLORS.primary },
            { title: 'Swap', screen: 'Swap', color: '#8247E5' },
            { title: 'Split', screen: 'Split', color: '#00D9FF' },
          ].map((action, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.actionBtn}
              onPress={() => navigation.navigate(action.screen)}
            >
              <View style={[styles.actionIcon, { backgroundColor: action.color + '20' }]}>
                <View style={[styles.actionDot, { backgroundColor: action.color }]} />
              </View>
              <Text style={styles.actionTitle}>{action.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Features */}
        <Text style={styles.sectionTitle}>Privacy Features</Text>
        <View style={styles.featureList}>
          {[
            { title: 'Transaction History', screen: 'History' },
            { title: 'Hidden Balance', screen: 'HiddenBalance' },
            { title: 'ZKP Proofs', screen: 'ZKP' },
            { title: 'Encrypted Messaging', screen: 'Messaging' },
          ].map((feature, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.featureItem}
              onPress={() => navigation.navigate(feature.screen)}
            >
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.arrow}>→</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Receive Screen
function ReceiveScreen() {
  const [stealthAddress, setStealthAddress] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateStealth = async () => {
    setLoading(true);
    try {
      // API call would go here
      setStealthAddress('0x' + '0'.repeat(40));
    } catch (e) {
      Alert.alert('Error', 'Failed to generate stealth address');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Private Receive</Text>
        <Text style={styles.description}>
          Generate a one-time stealth address for private receiving.
        </Text>

        {stealthAddress ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Stealth Address</Text>
            <Text style={styles.addressText}>{stealthAddress}</Text>
            <TouchableOpacity style={styles.copyBtn}>
              <Text style={styles.copyBtnText}>Copy Address</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={generateStealth}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>
              {loading ? 'Generating...' : 'Generate Stealth Address'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// Send Screen
function SendScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Private Send</Text>
        <Text style={styles.description}>
          Send funds privately through stealth addresses.
        </Text>
        {/* Send form would go here */}
      </View>
    </SafeAreaView>
  );
}

// Placeholder screens
function SwapScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Private Swap</Text>
      </View>
    </SafeAreaView>
  );
}

function SplitScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Cross-Chain Split</Text>
      </View>
    </SafeAreaView>
  );
}

function HistoryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Transaction History</Text>
      </View>
    </SafeAreaView>
  );
}

function HiddenBalanceScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Hidden Balance</Text>
      </View>
    </SafeAreaView>
  );
}

function ZKPScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>ZKP Proofs</Text>
      </View>
    </SafeAreaView>
  );
}

function MessagingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Encrypted Messaging</Text>
      </View>
    </SafeAreaView>
  );
}

// Navigation
const Stack = createNativeStackNavigator();

function App() {
  return (
    <WalletProvider>
      <NavigationContainer>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: COLORS.background },
            headerTintColor: COLORS.text,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: COLORS.background },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Receive" component={ReceiveScreen} />
          <Stack.Screen name="Send" component={SendScreen} />
          <Stack.Screen name="Swap" component={SwapScreen} />
          <Stack.Screen name="Split" component={SplitScreen} />
          <Stack.Screen name="History" component={HistoryScreen} />
          <Stack.Screen name="HiddenBalance" component={HiddenBalanceScreen} />
          <Stack.Screen name="ZKP" component={ZKPScreen} />
          <Stack.Screen name="Messaging" component={MessagingScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </WalletProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  scrollContent: {
    padding: 16,
  },
  screenContent: {
    flex: 1,
    padding: 16,
  },
  logo: {
    fontSize: 64,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 8,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 18,
    color: COLORS.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 48,
  },
  connectBtn: {
    backgroundColor: COLORS.text,
    paddingHorizontal: 32,
    paddingVertical: 16,
    marginBottom: 24,
  },
  connectBtnText: {
    color: COLORS.background,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  chainBadgeText: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    marginBottom: 24,
  },
  cardLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  balanceText: {
    color: COLORS.text,
    fontSize: 36,
    fontWeight: '600',
  },
  symbol: {
    color: COLORS.textSecondary,
    fontSize: 20,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  actionBtn: {
    width: '48%',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    alignItems: 'center',
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  actionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  featureList: {
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 8,
  },
  featureTitle: {
    color: COLORS.text,
    fontSize: 14,
  },
  arrow: {
    color: COLORS.textSecondary,
    fontSize: 18,
  },
  screenTitle: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: 14,
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: COLORS.text,
    padding: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: COLORS.background,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  addressText: {
    color: COLORS.text,
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  copyBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    alignItems: 'center',
  },
  copyBtnText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    textTransform: 'uppercase',
  },
});

export default App;
