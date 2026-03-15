import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
  Alert,
  ActivityIndicator,
  Clipboard,
  RefreshControl,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ethers } from 'ethers';
import { ApiService, StorageService } from './src/services/api';
import { CHAINS, useWallet, useTransactions } from './src/hooks/useWallet';

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

// Wallet Context
const WalletContext = createContext<any>(null);
export const useWalletContext = () => useContext(WalletContext);

function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

// Home Screen
function HomeScreen({ navigation }: any) {
  const { address, chain, balance, hiddenBalance, loading, fetchBalance, connect, disconnect } = useWalletContext();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBalance();
    setRefreshing(false);
  };

  // Demo connect - in production, use Web3Modal
  const handleConnect = async () => {
    Alert.prompt(
      'Enter Wallet Address',
      'For demo, enter an Ethereum address:',
      (text) => {
        if (text && ethers.isAddress(text)) {
          // @ts-ignore
          useWalletContext().setAddress?.(text);
        } else {
          Alert.alert('Invalid address');
        }
      }
    );
  };

  if (!address) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.logo}>UPL</Text>
          <Text style={styles.tagline}>Universal Privacy Layer</Text>
          <Text style={styles.subtitle}>The HTTPS of Web3</Text>
          
          <TouchableOpacity style={styles.connectBtn} onPress={handleConnect}>
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
            {loading ? '...' : balance || '0.00'} <Text style={styles.symbol}>{CHAINS[chain].symbol}</Text>
          </Text>
          {hiddenBalance?.chains?.[chain] && (
            <View style={styles.hiddenBalanceRow}>
              <Text style={styles.hiddenLabel}>Hidden (Stealth)</Text>
              <Text style={styles.hiddenValue}>
                {parseFloat(hiddenBalance.chains[chain].stealth_balance || 0).toFixed(6)} {CHAINS[chain].symbol}
              </Text>
            </View>
          )}
        </View>

        {/* Address */}
        <TouchableOpacity style={styles.addressCard} onPress={() => Clipboard.setString(address)}>
          <Text style={styles.addressText}>{address.slice(0, 10)}...{address.slice(-8)}</Text>
          <Text style={styles.copyHint}>Tap to copy</Text>
        </TouchableOpacity>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionGrid}>
          {[
            { title: 'Receive', screen: 'Receive', color: COLORS.success },
            { title: 'Send', screen: 'Send', color: COLORS.primary },
            { title: 'Split', screen: 'Split', color: '#00D9FF' },
            { title: 'History', screen: 'History', color: COLORS.warning },
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

        {/* Chain Selector */}
        <Text style={styles.sectionTitle}>Select Chain</Text>
        <View style={styles.chainGrid}>
          {Object.entries(CHAINS).map(([key, config]) => (
            <TouchableOpacity
              key={key}
              style={[styles.chainItem, chain === key && styles.chainItemActive]}
              // @ts-ignore
              onPress={() => useWalletContext().switchChain(key)}
            >
              <View style={[styles.chainDot, { backgroundColor: config.color }]} />
              <Text style={styles.chainName}>{config.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Features */}
        <Text style={styles.sectionTitle}>Privacy Features</Text>
        {[
          { title: 'Hidden Balance', screen: 'HiddenBalance' },
          { title: 'ZKP Proofs', screen: 'ZKP' },
          { title: 'Encrypted Messaging', screen: 'Messaging' },
          { title: 'Privacy Setup', screen: 'Setup' },
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
      </ScrollView>
    </SafeAreaView>
  );
}

// Receive Screen
function ReceiveScreen() {
  const { generateStealthAddress, privacyWallet, chain } = useWalletContext();
  const [stealthAddress, setStealthAddress] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    StorageService.getStealthAddresses().then(setHistory);
  }, [stealthAddress]);

  const generate = async () => {
    if (!privacyWallet) {
      Alert.alert('Setup Required', 'Please set up your privacy wallet first');
      return;
    }
    setLoading(true);
    const result = await generateStealthAddress();
    if (result) setStealthAddress(result);
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
                onPress={() => Clipboard.setString(stealthAddress.stealth_address)}
              >
                <Text style={styles.secondaryBtnText}>Copy Address</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStealthAddress(null)}>
                <Text style={styles.secondaryBtnText}>Generate New</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={generate}
            disabled={loading}
          >
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
                onPress={() => Clipboard.setString(item.stealth_address)}
              >
                <Text style={styles.historyAddress}>
                  {item.stealth_address?.slice(0, 16)}...
                </Text>
                <Text style={styles.historyChain}>{item.chain}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Send Screen
function SendScreen() {
  const { address, chain, privacyWallet } = useWalletContext();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!recipient || !amount) {
      Alert.alert('Error', 'Please fill all fields');
      return;
    }
    if (!ethers.isAddress(recipient)) {
      Alert.alert('Error', 'Invalid recipient address');
      return;
    }
    setLoading(true);
    // In production, this would connect to the wallet and sign the transaction
    Alert.alert(
      'Transaction Ready',
      `Send ${amount} ${CHAINS[chain].symbol} to ${recipient.slice(0, 10)}...`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: () => Alert.alert('Success', 'Transaction would be sent via wallet') }
      ]
    );
    setLoading(false);
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

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={send}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.background} />
          ) : (
            <Text style={styles.primaryBtnText}>Send Privately</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Split Screen
function SplitScreen() {
  const { address, chain } = useWalletContext();
  const [amount, setAmount] = useState('');
  const [splits, setSplits] = useState([
    { chain: 'base', percentage: 50 },
    { chain: 'arbitrum', percentage: 50 },
  ]);

  const addSplit = () => {
    if (splits.length >= 7) return;
    setSplits([...splits, { chain: 'polygon', percentage: 0 }]);
  };

  const prepare = async () => {
    const total = splits.reduce((sum, s) => sum + s.percentage, 0);
    if (total !== 100) {
      Alert.alert('Error', 'Percentages must total 100%');
      return;
    }
    Alert.alert('Split Ready', `Ready to split ${amount} across ${splits.length} chains`);
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
            <View style={[styles.chainDot, { backgroundColor: CHAINS[split.chain as keyof typeof CHAINS]?.color }]} />
            <Text style={styles.splitChain}>{CHAINS[split.chain as keyof typeof CHAINS]?.name}</Text>
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

// History Screen
function HistoryScreen() {
  const { address } = useWalletContext();
  const { transactions, loading, refresh } = useTransactions(address);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.screenContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.text} />}
      >
        <Text style={styles.screenTitle}>Transaction History</Text>

        {transactions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No transactions yet</Text>
          </View>
        ) : (
          transactions.map((tx, idx) => (
            <View key={idx} style={styles.txItem}>
              <View style={[styles.txIcon, { backgroundColor: tx.direction === 'out' ? COLORS.error + '20' : COLORS.success + '20' }]}>
                <Text style={{ color: tx.direction === 'out' ? COLORS.error : COLORS.success }}>
                  {tx.direction === 'out' ? '↑' : '↓'}
                </Text>
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txType}>{tx.tx_type?.replace('_', ' ').toUpperCase() || 'Transfer'}</Text>
                <Text style={styles.txDate}>{new Date(tx.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={[styles.txAmount, { color: tx.direction === 'out' ? COLORS.error : COLORS.success }]}>
                {tx.direction === 'out' ? '-' : '+'}
                {ethers.formatEther(tx.amount_wei || '0').slice(0, 8)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Setup Screen (Privacy Wallet)
function SetupScreen() {
  const { privacyWallet, setupPrivacyWallet } = useWalletContext();
  const [mainSeed, setMainSeed] = useState('');
  const [privacySeed, setPrivacySeed] = useState('');
  const [loading, setLoading] = useState(false);

  const setup = async () => {
    if (!mainSeed || !privacySeed) {
      Alert.alert('Error', 'Please enter both seed phrases');
      return;
    }
    setLoading(true);
    await setupPrivacyWallet(mainSeed, privacySeed);
    setLoading(false);
    Alert.alert('Success', 'Privacy wallet configured!');
  };

  if (privacyWallet) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.screenContent}>
          <Text style={styles.screenTitle}>Privacy Wallet</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Status</Text>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: COLORS.success }]} />
              <Text style={styles.statusText}>Configured</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.dangerBtn} onPress={() => Alert.alert('Warning', 'This will clear your privacy wallet')}>
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
          Set up your dual-seed privacy wallet for enhanced transaction privacy.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Main Seed Phrase</Text>
          <TextInput
            style={[styles.input, styles.seedInput]}
            placeholder="Enter 12-word seed phrase"
            placeholderTextColor={COLORS.textSecondary}
            value={mainSeed}
            onChangeText={setMainSeed}
            multiline
            secureTextEntry
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Privacy Seed Phrase</Text>
          <TextInput
            style={[styles.input, styles.seedInput]}
            placeholder="Enter different 12-word seed phrase"
            placeholderTextColor={COLORS.textSecondary}
            value={privacySeed}
            onChangeText={setPrivacySeed}
            multiline
            secureTextEntry
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={setup} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={COLORS.background} />
          ) : (
            <Text style={styles.primaryBtnText}>Configure Privacy Wallet</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// Placeholder screens
function HiddenBalanceScreen() {
  const { hiddenBalance, fetchHiddenBalance } = useWalletContext();
  
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.screenContent}>
        <Text style={styles.screenTitle}>Hidden Balance</Text>
        {hiddenBalance?.chains && Object.entries(hiddenBalance.chains).map(([key, data]: [string, any]) => (
          <View key={key} style={styles.balanceItem}>
            <View style={[styles.chainDot, { backgroundColor: data.color }]} />
            <Text style={styles.balanceChain}>{data.name}</Text>
            <Text style={styles.balanceValue}>{parseFloat(data.total_balance || 0).toFixed(6)} {data.symbol}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ZKPScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>ZKP Proofs</Text>
        <Text style={styles.description}>Zero-knowledge proof verification for privacy transactions.</Text>
      </View>
    </SafeAreaView>
  );
}

function MessagingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screenContent}>
        <Text style={styles.screenTitle}>Encrypted Messaging</Text>
        <Text style={styles.description}>Send encrypted messages with stealth addresses.</Text>
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
          <Stack.Screen name="Receive" component={ReceiveScreen} options={{ title: 'Private Receive' }} />
          <Stack.Screen name="Send" component={SendScreen} options={{ title: 'Private Send' }} />
          <Stack.Screen name="Split" component={SplitScreen} options={{ title: 'Cross-Chain Split' }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Transaction History' }} />
          <Stack.Screen name="HiddenBalance" component={HiddenBalanceScreen} options={{ title: 'Hidden Balance' }} />
          <Stack.Screen name="ZKP" component={ZKPScreen} options={{ title: 'ZKP Proofs' }} />
          <Stack.Screen name="Messaging" component={MessagingScreen} options={{ title: 'Encrypted Messaging' }} />
          <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'Privacy Setup' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </WalletProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { padding: 16 },
  screenContent: { flex: 1, padding: 16 },
  logo: { fontSize: 64, fontWeight: '800', color: COLORS.text, letterSpacing: 8, marginBottom: 8 },
  tagline: { fontSize: 18, color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 48 },
  connectBtn: { backgroundColor: COLORS.text, paddingHorizontal: 32, paddingVertical: 16, marginBottom: 24 },
  connectBtnText: { color: COLORS.background, fontSize: 16, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 2 },
  chainBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  chainBadgeText: { color: COLORS.textSecondary, fontSize: 12 },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 20, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardLabel: { color: COLORS.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  disconnectText: { color: COLORS.error, fontSize: 12 },
  balanceText: { color: COLORS.text, fontSize: 36, fontWeight: '600' },
  symbol: { color: COLORS.textSecondary, fontSize: 20 },
  hiddenBalanceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  hiddenLabel: { color: COLORS.textSecondary, fontSize: 12 },
  hiddenValue: { color: COLORS.success, fontSize: 14, fontFamily: 'monospace' },
  addressCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 24, alignItems: 'center' },
  addressText: { color: COLORS.text, fontSize: 14, fontFamily: 'monospace' },
  addressTextSmall: { color: COLORS.text, fontSize: 11, fontFamily: 'monospace', marginVertical: 12 },
  copyHint: { color: COLORS.textSecondary, fontSize: 10, marginTop: 4 },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  actionBtn: { width: '47%', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 16, alignItems: 'center' },
  actionIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  actionDot: { width: 16, height: 16, borderRadius: 8 },
  actionTitle: { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  chainGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  chainItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border },
  chainItemActive: { borderColor: COLORS.success },
  chainDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chainName: { color: COLORS.text, fontSize: 12 },
  featureItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 8 },
  featureTitle: { color: COLORS.text, fontSize: 14 },
  arrow: { color: COLORS.textSecondary, fontSize: 18 },
  screenTitle: { color: COLORS.text, fontSize: 24, fontWeight: '700', marginBottom: 8 },
  description: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 24, lineHeight: 20 },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: COLORS.textSecondary, fontSize: 12, textTransform: 'uppercase', marginBottom: 8 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 14, color: COLORS.text, fontSize: 14 },
  seedInput: { height: 80, textAlignVertical: 'top' },
  primaryBtn: { backgroundColor: COLORS.text, padding: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: COLORS.background, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, padding: 12, alignItems: 'center' },
  secondaryBtnText: { color: COLORS.textSecondary, fontSize: 12, textTransform: 'uppercase' },
  dangerBtn: { borderWidth: 1, borderColor: COLORS.error, padding: 14, alignItems: 'center', marginTop: 16 },
  dangerBtnText: { color: COLORS.error, fontSize: 12, textTransform: 'uppercase' },
  buttonRow: { flexDirection: 'row', gap: 12 },
  historySection: { marginTop: 24 },
  historyItem: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: COLORS.surface, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  historyAddress: { color: COLORS.text, fontSize: 11, fontFamily: 'monospace' },
  historyChain: { color: COLORS.textSecondary, fontSize: 11 },
  splitItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  splitChain: { flex: 1, color: COLORS.text, fontSize: 14, marginLeft: 8 },
  splitInput: { width: 50, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, padding: 8, color: COLORS.text, textAlign: 'center' },
  percentSign: { color: COLORS.textSecondary, marginLeft: 4 },
  addBtn: { alignItems: 'center', padding: 12, borderWidth: 1, borderColor: COLORS.success, borderStyle: 'dashed', marginBottom: 16 },
  addBtnText: { color: COLORS.success, fontSize: 12 },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyText: { color: COLORS.textSecondary },
  txItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  txIcon: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  txInfo: { flex: 1 },
  txType: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
  txDate: { color: COLORS.textSecondary, fontSize: 11 },
  txAmount: { fontSize: 14, fontFamily: 'monospace' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  statusText: { color: COLORS.success, fontSize: 14, marginLeft: 8 },
  balanceItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  balanceChain: { flex: 1, color: COLORS.text, marginLeft: 8 },
  balanceValue: { color: COLORS.text, fontFamily: 'monospace' },
});

export default App;
