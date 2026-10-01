import React, { useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, TouchableOpacity, StatusBar } from 'react-native';

export default function App() {
  const [lang, setLang] = useState('en');

  const content = {
    en: {
      title: 'Krishi Suraksha',
      subtitle: 'Farmer Direct Marketplace',
      tagline: 'Sell high-value crops directly to bulk buyers at fair pre-harvest rates.',
      welcome: 'Welcome, Farmer Partner',
      switchBtn: 'ಕನ್ನಡದಲ್ಲಿ ನೋಡಿ (Kannada)'
    },
    kn: {
      title: 'ಕೃಷಿ ಸುರಕ್ಷಾ',
      subtitle: 'ರೈತರ ನೇರ ಮಾರುಕಟ್ಟೆ',
      tagline: 'ಮಧ್ಯವರ್ತಿಗಳಿಲ್ಲದೆ ಹೆಚ್ಚಿನ ಮೌಲ್ಯದ ಬೆಳೆಗಳನ್ನು ನೇರವಾಗಿ ಮಾರಾಟ ಮಾಡಿ ನ್ಯಾಯಯುತ ಬೆಲೆ ಪಡೆಯಿರಿ.',
      welcome: 'ಸ್ವಾಗತ, ರೈತ ಮಿತ್ರರೇ',
      switchBtn: 'View in English'
    }
  };

  const t = content[lang];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#15803d" />
      <View style={styles.header}>
        <Text style={styles.logoIcon}>🌱</Text>
        <Text style={styles.headerTitle}>{t.title}</Text>
        <Text style={styles.headerSubtitle}>{t.subtitle}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.welcomeText}>{t.welcome}</Text>
        <Text style={styles.bodyText}>{t.tagline}</Text>

        <TouchableOpacity 
          style={styles.langButton}
          onPress={() => setLang(lang === 'en' ? 'kn' : 'en')}
        >
          <Text style={styles.langButtonText}>{t.switchBtn}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    backgroundColor: '#15803d',
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  logoIcon: {
    fontSize: 42,
    marginBottom: 8,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#dcfce7',
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    margin: 20,
    padding: 24,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 10,
  },
  bodyText: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 22,
    marginBottom: 20,
  },
  langButton: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  langButtonText: {
    color: '#15803d',
    fontSize: 14,
    fontWeight: '600',
  }
});
