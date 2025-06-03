
/* eslint-disable react-native/no-color-literals */
if (typeof btoa === 'undefined') {
  // eslint-disable-next-line no-global-assign
  globalThis.btoa = (str: any) => Buffer.from(str, 'binary').toString('base64');
  globalThis.btoa = (str: any) => Buffer.from(str, 'binary').toString('base64');
}

import 'react-native-get-random-values';

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NavHeader } from '../../components';
import { navigationRef } from '../../navigation';
import { Ed25519Signer } from '@did.coop/did-key-ed25519';
import { WalletStorage } from '@did-coop/wallet-attached-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { WAS_BASE_URL } from '../../../app.config';
import { useThemeContext } from '../../hooks';

if (typeof globalThis.base64FromArrayBuffer !== 'function') {
  globalThis.base64FromArrayBuffer = function base64FromArrayBuffer(arrayBuffer) {
    var base64    = '';
    var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    var bytes         = new Uint8Array(arrayBuffer);
    var byteLength    = bytes.byteLength;
    var byteRemainder = byteLength % 3;
    var mainLength    = byteLength - byteRemainder;

    var a, b, c, d;
    var chunk;

    // Main loop deals with bytes in chunks of 3
    for (var i = 0; i < mainLength; i = i + 3) {
      // Combine the three bytes into a single integer
      chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

      // Use bitmasks to extract 6-bit segments from the triplet
      a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
      b = (chunk & 258048)   >> 12; // 258048   = (2^6 - 1) << 12
      c = (chunk & 4032)     >>  6; // 4032     = (2^6 - 1) << 6
      d = chunk & 63;               // 63       = 2^6 - 1

      // Convert the raw binary segments to the appropriate ASCII encoding
      base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
    }

    // Deal with the remaining bytes and padding
    if (byteRemainder == 1) {
      chunk = bytes[mainLength];

      a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

      // Set the 4 least significant bits to zero
      b = (chunk & 3)   << 4; // 3   = 2^2 - 1

      base64 += encodings[a] + encodings[b] + '==';
    } else if (byteRemainder == 2) {
      chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

      a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
      b = (chunk & 1008)  >>  4; // 1008  = (2^6 - 1) << 4

      // Set the 2 least significant bits to zero
      c = (chunk & 15)    <<  2; // 15    = 2^4 - 1

      base64 += encodings[a] + encodings[b] + encodings[c] + '=';
    }

    return base64;
  }

}

export const WAS_STORAGE_KEYS = {
  SPACE_ID: 'was_space_id',
  SIGNER_JSON: 'was_signer_json',
  APP_DID_SIGNER: 'was_app_did_signer',
};

export const WAS_BASE_URL = 'https://data.pub';

const WASScreen = () => {
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [message, setMessage] = useState<string>('');

  const provisionWAS = async () => {
    try {
      setStatus('loading');
      setMessage('Generating signer...');

      const appDidSigner = await Ed25519Signer.generate();
      await AsyncStorage.setItem(WAS_STORAGE_KEYS.APP_DID_SIGNER, JSON.stringify(appDidSigner));
      console.log('Generated signer:', appDidSigner.id);

      setMessage('Creating space...');
      const spaceId = `urn:uuid:${uuidv4()}`;
      console.log('Creating space with ID:', spaceId);

      const space = await WalletStorage.provisionSpace({
        url: WAS_BASE_URL,
        signer: appDidSigner,
        id: spaceId as `urn:uuid:${string}`,
      });
      console.log('Space provisioned successfully:', space);

      // Store signer and spaceId in AsyncStorage
      const signerJson = await appDidSigner.toJSON();
      // Ensure signer has an ID
      if (!signerJson.id && signerJson.controller && signerJson.publicKeyMultibase) {
        signerJson.id = `${signerJson.controller}#${signerJson.publicKeyMultibase}`;
      }
      await AsyncStorage.setItem(
        WAS_STORAGE_KEYS.SIGNER_JSON,
        JSON.stringify(signerJson)
      );
      // Store the full space ID with urn:uuid: prefix
      await AsyncStorage.setItem(WAS_STORAGE_KEYS.SPACE_ID, spaceId);
      console.log('Stored space ID:', spaceId);

      setStatus('success');
      setMessage('WAS storage successfully provisioned!');
    } catch (error) {
      console.error('Error in wallet storage provisioning:', error);
      setStatus('error');
      setMessage(
        error instanceof Error
          ? error.message
          : 'Failed to provision WAS storage'
      );

      // Clear stored items if provisioning failed
      await AsyncStorage.removeItem(WAS_STORAGE_KEYS.SIGNER_JSON);
      await AsyncStorage.removeItem(WAS_STORAGE_KEYS.SPACE_ID);
    }
  };

  useEffect(() => {
    provisionWAS();
  }, []);

  const renderContent = () => {
    switch (status) {
    case 'loading':
      return (
        <View style={styles.content}>
          <ActivityIndicator
            size='large'
            color='#0000ff'
          />
          <Text style={styles.message}>{message}</Text>
        </View>
      );
    case 'success':
      return (
        <View style={styles.content}>
          <Text style={[styles.message, styles.successMessage]}>
            {message}
          </Text>
        </View>
      );
    case 'error':
      return (
        <View style={styles.content}>
          <Text style={[styles.message, styles.errorMessage]}>{message}</Text>
        </View>
      );
    default:
      return null;
    }
  };

  return (
    <>
      <NavHeader
        title={hasConnection ? 'W.A.S. Connection' : 'W.A.S'}
        goBack={navigationRef.goBack}
      />
      <View style={styles.container}>{renderContent()}</View>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  message: {
    marginTop: 20,
    fontSize: 16,
    textAlign: 'center',
  },
  successMessage: {
    color: '#4CAF50', // Material Design Green
  },
  errorMessage: {
    color: '#F44336', // Material Design Red
  },
});

export default WASScreen;
