// Polyfill
if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = str => Buffer.from(str, 'binary').toString('base64');
}
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () =>
    uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
}

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NavHeader } from '../../components';
import { navigationRef } from '../../navigation';
import { Ed25519Signer } from '@did.coop/did-key-ed25519';
import { WalletStorage } from '@did-coop/wallet-attached-storage';

const WASScreen = () => {
  const testingWalletStorage = async () => {
    try {
      const appDidSigner = await Ed25519Signer.generate();
      const space = await WalletStorage.provisionSpace({
        url: 'https://cors-anywhere.herokuapp.com/https://data.pub',
        signer: appDidSigner,
      });
      console.log('🚀 ~ testingWalletStoragge ~ space:', space);
    } catch (error) {
      console.error(error);
    }
  };
  useEffect(() => {
    testingWalletStorage();
  }, []);
  return (
    <>
      <NavHeader
        title="W.A.S"
        goBack={navigationRef.goBack}
      />
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.text}>Hello!</Text>
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 24,
    color: 'white',
  },
});

export default WASScreen;
