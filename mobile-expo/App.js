import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ApiService, StorageService } from './src/services/api';

// Theme
const COLORS = {
  background: '#050505',
  surface: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.1)',
  text: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.5)',
  primary: '#0052FF',
  success: '#00FF88',
  error: '#FF4444',
  warning: '#FFB800',
};

// Chain config
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
const useWallet = () => useContext(WalletContext);

function WalletProvider({ children }) {
  const [address, setAddress] = useState(null);
  const [chain, setChain] = useState('base');
  const [balance, setBalance] = useState(null);
  const [hiddenBalance, setHiddenBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [privacyWallet, setPrivacyWallet] = useState(null);

  useEffect(() => {
    StorageService.getPrivacyWallet().then(wallet => {
      if (wallet) setPrivacyWallet(wallet);
    });
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const data = await ApiService.getBalance(address, chain);
      setBalance(data.total_balance_eth || '0');
    } catch (e) {
      console.log('Balance error:', e.message);
    }
    setLoading(false);
  }, [address, chain]);

  const fetchHiddenBalance = useCallback(async () => {
    if (!address) return;
    try {
      const data = await ApiService.getHiddenBalance(address);
      setHiddenBalance(data);
    } catch (e) {
      console.log('Hidden balance error:', e.message);
    }
  }, [address]);

  useEffect(() => {
    if (address) {
      fetchBalance();
      fetchHiddenBalance();
    }
  }, [address, chain]);

  const disconnect = () => {
    setAddress(null);
    setBalance(null);
    setHiddenBalance(null);
  };

  return (
    <WalletContext.Provider value={{
      address, setAddress, chain, setChain, balance, hiddenBalance,
      loading, privacyWallet, setPrivacyWallet, fetchBalance, fetchHiddenBalance, disconnect
    }}>
      {children}
    </WalletContext.Provider>
  );
}

// ============ SCREENS ============

function HomeScreen({ navigation }) {
  const { address, setAddress, chain, setChain, balance, hiddenBalance, loading, fetchBalance, disconnect } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [inputAddress, setInputAddress] = useState('');

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBalance();
    setRefreshing(false);
  };

  const handleConnect = () => {
    if (inputAddress && inputAddress.startsWith('0x') && inputAddress.length === 42) {
      setAddress(inputAddress);
      setInputAddress('');
    } else {
      Alert.alert('Invalid Address', 'Please enter a valid Ethereum address (0x...)');
    }
  };

  // Landing (not connected)
  if (!address) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <Text style={styles.logo}>UPL</Text>
          <Text style={styles.tagline}>Universal Privacy Layer</Text>
          <Text style={styles.subtitle}>The HTTPS of Web3</Text>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.addressInput}
              placeholder="Enter wallet address (0x...)"
              placeholderTextColor={COLORS.textSecondary}
              value={inputAddress}
              onChangeText={setInputAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
              <Text style={styles.connectBtnText}>Connect</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.chainBadge}>
            <View style={[styles.dot, { backgroundColor: COLORS.success }]} />
            <Text style={styles.chainBadgeText}>7 Chains Live</Text>
          </View>

          <Text style={styles.demoText}>Demo Mode - Enter any ETH address to explore</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Dashboard (connected)
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />}
      >
        {/* Balance Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardLabel}>Balance on {CHAINS[chain].name}</Text>
            <TouchableOpacity onPress={disconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.balanceText}>
            {loading ? '...' : parseFloat(balance || 0).toFixed(6)}
            <Text style={styles.symbol}> {CHAINS[chain].symbol}</Text>
          </Text>
          {hiddenBalance?.chains?.[chain] && (
            <View style={styles.hiddenRow}>
              <Text style={styles.hiddenLabel}>Hidden (Stealth)</Text>
              <Text style={styles.hiddenValue}>
                {parseFloat(hiddenBalance.chains[chain].stealth_balance || 0).toFixed(6)} {CHAINS[chain].symbol}
              </Text>
            </View>
          )}
        </View>

        {/* Address */}
        <TouchableOpacity style={styles.addressCard} onPress={() => Clipboard.setStringAsync(address)}>
          <Text style={styles.addressText}>{address.slice(0, 12)}...{address.slice(-10)}</Text>
          <Text style={styles.copyHint}>Tap to copy</Text>
        </TouchableOpacity>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {[
            { title: 'Receive', screen: 'Receive', icon: 'arrow-down', color: COLORS.success },
            { title: 'Send', screen: 'Send', icon: 'arrow-up', color: COLORS.primary },
            { title: 'Split', screen: 'Split', icon: 'git-branch', color: '#00D9FF' },
            { title: 'History', screen: 'History', icon: 'time', color: COLORS.warning },
          ].map((action, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.actionBtn}
              onPress={() => navigation.navigate(action.screen)}
            >
              <View style={[styles.actionIcon, { backgroundColor: action.color + '20' }]}>
                <Ionicons name={action.icon} size={24} color={action.color} />
              </View>
              <Text style={styles.actionTitle}>{action.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chain Selector */}
        <Text style={styles.sectionTitle}>Select Chain</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chainScroll}>
          {Object.entries(CHAINS).map(([key, config]) => (
            <TouchableOpacity
              key={key}
              style={[styles.chainItem, chain === key && styles.chainItemActive]}
              onPress={() => setChain(key)}
            >
              <View style={[styles.chainDot, { backgroundColor: config.color }]} />
              <Text style={styles.chainName}>{config.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Features */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Privacy Features</Text>
        {[
          { title: 'Hidden Balance', screen: 'HiddenBalance', icon: 'eye-off' },
          { title: 'Privacy Setup', screen: 'Setup', icon: 'key' },
          { title: 'About UPL', screen: 'About', icon: 'information-circle' },
        ].map((feature, idx) => (
          <TouchableOpacity
            key={idx}
            style={styles.featureItem}
            onPress={() => navigation.navigate(feature.screen)}
          >
            <Ionicons name={feature.icon} size={20} color={COLORS.textSecondary} />
            <Text style={styles.featureTitle}>{feature.title}</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReceiveScreen() {
  const { privacyWallet, chain } = useWallet();
  const [stealthAddress, setStealthAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    StorageService.getStealthAddresses().then(setHistory);
  }, [stealthAddress]);

  const generate = async () => {
    if (!privacyWallet) {
      Alert.alert('Setup Required', 'Please set up your privacy wallet first in Privacy Setup');
      return;
    }
    setLoading(true);
    try {
      const result = await ApiService.generateStealthAddress(
        privacyWallet.spending_public_key,
        privacyWallet.viewing_public_key
      );
      setStealthAddress(result);
      await StorageService.addStealthAddress({
        ...result,
        chain,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to generate stealth address');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContent}>
        <Text style={styles.screenTitle}>Private Receive</Text>
        <Text style={styles.description}>
          Generate a one-time stealth address for receiving funds privately on {CHAINS[chain].name}.
        </Text>

        {stealthAddress ? (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Stealth Address</Text>
            <Text style={styles.addressTextSmall}>{stealthAddress.stealth_address}</Text>
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => Clipboard.setStringAsync(stealthAddress.stealth_address)}
              >
                <Text style={styles.secondaryBtnText}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStealthAddress(null)}>
                <Text style={styles.secondaryBtnText}>New</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={generate} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={COLORS.background} />
            ) : (
              <Text style={styles.primaryBtnText}>Generate Stealth Address</Text>
            )}
          </TouchableOpacity>
        )}

        {history.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>Recent Addresses</Text>
            {history.slice(-5).reverse().map((item, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.historyItem}
                onPress={() => Clipboard.setStringAsync(item.stealth_address)}
              >
                <Text style={styles.historyAddress}>{item.stealth_address?.slice(0, 20)}...</Text>
                <Text style={styles.historyChain}>{item.chain}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SendScreen() {
  const { chain } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');

  const send = () => {
    if (!recipient || !amount) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    Alert.alert(
      'Transaction Ready',
      `Send ${amount} ${CHAINS[chain].symbol} to ${recipient.slice(0, 10)}...\n\nIn production, this would connect to your wallet for signing.`,
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Private Send</Text>
        <Text style={styles.description}>
          Send funds privately through the relayer on {CHAINS[chain].name}.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Recipient Address</Text>
          <TextInput
            style={styles.input}
            placeholder="0x..."
            placeholderTextColor={COLORS.textSecondary}
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Amount ({CHAINS[chain].symbol})</Text>
          <TextInput
            style={styles.input}
            placeholder="0.01"
            placeholderTextColor={COLORS.textSecondary}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={send}>
          <Text style={styles.primaryBtnText}>Send Privately</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function SplitScreen() {
  const [amount, setAmount] = useState('');
  const [splits, setSplits] = useState([
    { chain: 'base', percentage: 50 },
    { chain: 'arbitrum', percentage: 50 },
  ]);

  const addSplit = () => {
    if (splits.length >= 7) return;
    setSplits([...splits, { chain: 'polygon', percentage: 0 }]);
  };

  const prepare = () => {
    const total = splits.reduce((sum, s) => sum + s.percentage, 0);
    if (total !== 100) {
      Alert.alert('Error', `Percentages must total 100% (currently ${total}%)`);
      return;
    }
    Alert.alert('Split Ready', `Ready to split ${amount} ETH across ${splits.length} chains`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContent}>
        <Text style={styles.screenTitle}>Cross-Chain Split</Text>
        <Text style={styles.description}>
          Split a payment across multiple chains for enhanced privacy.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Total Amount (ETH)</Text>
          <TextInput
            style={styles.input}
            placeholder="0.1"
            placeholderTextColor={COLORS.textSecondary}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        <Text style={styles.sectionTitle}>Split Configuration</Text>
        {splits.map((split, idx) => (
          <View key={idx} style={styles.splitItem}>
            <View style={[styles.chainDot, { backgroundColor: CHAINS[split.chain]?.color }]} />
            <Text style={styles.splitChain}>{CHAINS[split.chain]?.name}</Text>
            <TextInput
              style={styles.splitInput}
              value={String(split.percentage)}
              onChangeText={(t) => {
                const newSplits = [...splits];
                newSplits[idx].percentage = parseInt(t) || 0;
                setSplits(newSplits);
              }}
              keyboardType="number-pad"
            />
            <Text style={styles.percentSign}>%</Text>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={addSplit}>
          <Text style={styles.addBtnText}>+ Add Chain</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.primaryBtn} onPress={prepare}>
          <Text style={styles.primaryBtnText}>Prepare Split</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function HistoryScreen() {
  const { address } = useWallet();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (address) {
      ApiService.getTransactionHistory(address)
        .then(data => setTransactions(data.transactions || []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [address]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContent}>
        <Text style={styles.screenTitle}>Transaction History</Text>

        {loading ? (
          <ActivityIndicator color={COLORS.text} style={{ marginTop: 40 }} />
        ) : transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        ) : (
          transactions.map((tx, idx) => (
            <View key={idx} style={styles.txItem}>
              <View style={[styles.txIcon, { backgroundColor: tx.direction === 'out' ? COLORS.error + '20' : COLORS.success + '20' }]}>
                <Ionicons
                  name={tx.direction === 'out' ? 'arrow-up' : 'arrow-down'}
                  size={18}
                  color={tx.direction === 'out' ? COLORS.error : COLORS.success}
                />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txType}>{tx.tx_type?.replace('_', ' ').toUpperCase() || 'Transfer'}</Text>
                <Text style={styles.txDate}>{new Date(tx.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={[styles.txAmount, { color: tx.direction === 'out' ? COLORS.error : COLORS.success }]}>
                {tx.direction === 'out' ? '-' : '+'}{tx.amount_wei ? (parseInt(tx.amount_wei) / 1e18).toFixed(6) : '0'}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function HiddenBalanceScreen() {
  const { hiddenBalance, fetchHiddenBalance } = useWallet();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHiddenBalance();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.text} />}
      >
        <Text style={styles.screenTitle}>Hidden Balance</Text>
        <Text style={styles.description}>
          Aggregated balance across all your stealth addresses.
        </Text>

        {hiddenBalance?.chains ? (
          Object.entries(hiddenBalance.chains).map(([key, data]) => (
            <View key={key} style={styles.balanceItem}>
              <View style={[styles.chainDot, { backgroundColor: data.color }]} />
              <Text style={styles.balanceChain}>{data.name}</Text>
              <View style={styles.balanceRight}>
                <Text style={styles.balanceValue}>
                  {parseFloat(data.total_balance || 0).toFixed(6)} {data.symbol}
                </Text>
                <Text style={styles.balanceBreakdown}>
                  Main: {parseFloat(data.main_balance || 0).toFixed(4)} | Stealth: {parseFloat(data.stealth_balance || 0).toFixed(4)}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Connect wallet to view balances</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SetupScreen() {
  const { privacyWallet, setPrivacyWallet } = useWallet();
  const [spending, setSpending] = useState('');
  const [viewing, setViewing] = useState('');

  const setup = async () => {
    if (!spending || !viewing) {
      Alert.alert('Error', 'Please enter both keys');
      return;
    }
    const wallet = {
      spending_public_key: spending,
      viewing_public_key: viewing,
    };
    await StorageService.savePrivacyWallet(wallet);
    setPrivacyWallet(wallet);
    Alert.alert('Success', 'Privacy wallet configured!');
  };

  const reset = async () => {
    Alert.alert('Reset Wallet', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await StorageService.clearAll();
          setPrivacyWallet(null);
        }
      }
    ]);
  };

  if (privacyWallet) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.screenContent}>
          <Text style={styles.screenTitle}>Privacy Setup</Text>
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
              <Text style={styles.statusText}>Privacy Wallet Configured</Text>
            </View>
            <Text style={styles.keyPreview}>
              Spending: {privacyWallet.spending_public_key?.slice(0, 20)}...
            </Text>
          </View>
          <TouchableOpacity style={styles.dangerBtn} onPress={reset}>
            <Text style={styles.dangerBtnText}>Reset Wallet</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContent}>
        <Text style={styles.screenTitle}>Privacy Setup</Text>
        <Text style={styles.description}>
          Configure your privacy wallet with spending and viewing keys.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Spending Public Key</Text>
          <TextInput
            style={styles.input}
            placeholder="0x..."
            placeholderTextColor={COLORS.textSecondary}
            value={spending}
            onChangeText={setSpending}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Viewing Public Key</Text>
          <TextInput
            style={styles.input}
            placeholder="0x..."
            placeholderTextColor={COLORS.textSecondary}
            value={viewing}
            onChangeText={setViewing}
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={setup}>
          <Text style={styles.primaryBtnText}>Configure Privacy Wallet</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function AboutScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContent}>
        <Text style={styles.logo}>UPL</Text>
        <Text style={styles.tagline}>Universal Privacy Layer</Text>
        <Text style={styles.subtitle}>The HTTPS of Web3</Text>

        <View style={[styles.card, { marginTop: 32 }]}>
          <Text style={styles.aboutText}>
            UPL provides private transactions across 7 EVM chains using stealth addresses and zero-knowledge proofs.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Supported Chains</Text>
        {Object.entries(CHAINS).map(([key, config]) => (
          <View key={key} style={styles.chainListItem}>
            <View style={[styles.chainDot, { backgroundColor: config.color }]} />
            <Text style={styles.chainListName}>{config.name}</Text>
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          </View>
        ))}

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Features</Text>
        {[
          'Stealth Addresses',
          'ZKP Verification',
          'Cross-Chain Splits',
          'Hidden Balance Aggregation',
          'Encrypted Messaging',
        ].map((feature, idx) => (
          <View key={idx} style={styles.featureListItem}>
            <Ionicons name="checkmark" size={18} color={COLORS.success} />
            <Text style={styles.featureListText}>{feature}</Text>
          </View>
        ))}

        <Text style={styles.versionText}>Version 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// Navigation
const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <WalletProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: COLORS.background },
            headerTintColor: COLORS.text,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: COLORS.background },
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Receive" component={ReceiveScreen} options={{ title: 'Private Receive' }} />
          <Stack.Screen name="Send" component={SendScreen} options={{ title: 'Private Send' }} />
          <Stack.Screen name="Split" component={SplitScreen} options={{ title: 'Cross-Chain Split' }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Transaction History' }} />
          <Stack.Screen name="HiddenBalance" component={HiddenBalanceScreen} options={{ title: 'Hidden Balance' }} />
          <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Privacy Setup' }} />
          <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About UPL' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </WalletProvider>
  );
}

// ============ STYLES ============
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  screenContent: { padding: 16, paddingBottom: 40 },
  logo: { fontSize: 56, fontWeight: '800', color: COLORS.text, letterSpacing: 8, marginBottom: 8 },
  tagline: { fontSize: 18, color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 32 },
  inputContainer: { width: '100%', marginBottom: 24 },
  addressInput: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 14, color: COLORS.text, fontSize: 14, marginBottom: 12 },
  connectBtn: { backgroundColor: COLORS.text, padding: 16, alignItems: 'center' },
  connectBtnText: { color: COLORS.background, fontSize: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2 },
  chainBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border, marginTop: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  chainBadgeText: { color: COLORS.textSecondary, fontSize: 13 },
  demoText: { color: COLORS.textSecondary, fontSize: 11, marginTop: 24, textAlign: 'center' },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 20, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  disconnectText: { color: COLORS.error, fontSize: 12 },
  balanceText: { color: COLORS.text, fontSize: 32, fontWeight: '700' },
  symbol: { color: COLORS.textSecondary, fontSize: 18, fontWeight: '400' },
  hiddenRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  hiddenLabel: { color: COLORS.textSecondary, fontSize: 12 },
  hiddenValue: { color: COLORS.success, fontSize: 14, fontFamily: 'monospace' },
  addressCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 24, alignItems: 'center' },
  addressText: { color: COLORS.text, fontSize: 13, fontFamily: 'monospace' },
  addressTextSmall: { color: COLORS.text, fontSize: 11, fontFamily: 'monospace', marginVertical: 12 },
  copyHint: { color: COLORS.textSecondary, fontSize: 10, marginTop: 4 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 24 },
  actionBtn: { width: '48%', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 16, alignItems: 'center', marginBottom: 12 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  actionTitle: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
  chainScroll: { marginBottom: 8 },
  chainItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border, marginRight: 8 },
  chainItemActive: { borderColor: COLORS.success, backgroundColor: COLORS.success + '10' },
  chainDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  chainName: { color: COLORS.text, fontSize: 12 },
  featureItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 8 },
  featureTitle: { flex: 1, color: COLORS.text, fontSize: 14, marginLeft: 12 },
  screenTitle: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  description: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 24, lineHeight: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 14, color: COLORS.text, fontSize: 14 },
  primaryBtn: { backgroundColor: COLORS.text, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: COLORS.background, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, padding: 12, alignItems: 'center', marginHorizontal: 4 },
  secondaryBtnText: { color: COLORS.textSecondary, fontSize: 12, textTransform: 'uppercase' },
  dangerBtn: { borderWidth: 1, borderColor: COLORS.error, padding: 14, alignItems: 'center', marginTop: 24 },
  dangerBtnText: { color: COLORS.error, fontSize: 12, textTransform: 'uppercase' },
  buttonRow: { flexDirection: 'row', marginTop: 8 },
  historySection: { marginTop: 32 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: COLORS.surface, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  historyAddress: { color: COLORS.text, fontSize: 11, fontFamily: 'monospace' },
  historyChain: { color: COLORS.textSecondary, fontSize: 11 },
  splitItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  splitChain: { flex: 1, color: COLORS.text, fontSize: 14 },
  splitInput: { width: 50, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, padding: 8, color: COLORS.text, textAlign: 'center' },
  percentSign: { color: COLORS.textSecondary, marginLeft: 4 },
  addBtn: { alignItems: 'center', padding: 12, borderWidth: 1, borderColor: COLORS.success, borderStyle: 'dashed', marginBottom: 16 },
  addBtnText: { color: COLORS.success, fontSize: 12 },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { color: COLORS.textSecondary, marginTop: 12 },
  txItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  txIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  txInfo: { flex: 1 },
  txType: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
  txDate: { color: COLORS.textSecondary, fontSize: 11 },
  txAmount: { fontSize: 14, fontFamily: 'monospace' },
  balanceItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  balanceChain: { flex: 1, color: COLORS.text, marginLeft: 8 },
  balanceRight: { alignItems: 'flex-end' },
  balanceValue: { color: COLORS.text, fontFamily: 'monospace', fontSize: 14 },
  balanceBreakdown: { color: COLORS.textSecondary, fontSize: 10, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusText: { color: COLORS.success, fontSize: 14, marginLeft: 8 },
  keyPreview: { color: COLORS.textSecondary, fontSize: 11, fontFamily: 'monospace', marginTop: 12 },
  aboutText: { color: COLORS.text, fontSize: 14, lineHeight: 22 },
  chainListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  chainListName: { flex: 1, color: COLORS.text, marginLeft: 8 },
  liveBadge: { backgroundColor: COLORS.success + '20', paddingHorizontal: 8, paddingVertical: 4 },
  liveBadgeText: { color: COLORS.success, fontSize: 10, fontWeight: '600' },
  featureListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  featureListText: { color: COLORS.text, marginLeft: 8 },
  versionText: { color: COLORS.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 32 },
});
