/* eslint-disable react-native/no-inline-styles */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button } from 'react-native';
import {
  Camera,
  useCameraDevices,
  useCodeScanner
} from 'react-native-vision-camera';
import { handleVcApiExchangeComplete } from '../../lib/exchanges';
import { Ed25519Signature2020 } from '@digitalcredentials/ed25519-signature-2020';
import { Ed25519VerificationKey2020 } from '@digitalcredentials/ed25519-verification-key-2020';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WAS_KEYS } from '../../../app.config';

export default function ZapQRScreen() {
  const [hasPermission, setHasPermission] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState('');
  const cameraRef = useRef(null);
  const devices = useCameraDevices();
  const device = devices.find(d => d.position === 'back');

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const processPayload = async (payload: any) => {
    const { protocols } = payload;
    const requestUrl = protocols?.vcapi;
    if (!requestUrl) return setMessage('❌ Missing requestUrl in QR');

    try {
      setMessage('🔄 Preparing signer...');
      const signerStr = await AsyncStorage.getItem(WAS_KEYS.SIGNER_JSON);
      if (!signerStr) throw new Error('No signer found in storage');
      const key = await Ed25519VerificationKey2020.from(JSON.parse(signerStr));

      setMessage('🔐 Initiating credential exchange...');
      const result = await handleVcApiExchangeComplete({
        url: requestUrl,
        holder: key.controller,
        suite: new Ed25519Signature2020({ key })
      });

      console.log('✅ Exchange result:', result);
      setMessage('✅ Done! Access granted.');
    } catch (err: any) {
      console.error('❌ Failed:', err);
      setMessage(`❌ Error: ${err.message}`);
    }
  };

  const onCodeScanned = (codes: any) => {
    if (!scanning || codes.length === 0) return;
    const raw = codes[0].value;
    console.log('📷 QR Raw:', raw);

    try {
      const requestParam = raw.split('request=')[1];
      const decoded = decodeURIComponent(requestParam);
      const parsed = JSON.parse(decoded);

      setScanning(false);
      processPayload(parsed);
    } catch (err) {
      setMessage('❌ Invalid QR code.');
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned
  });

  if (!hasPermission) return <Text>No camera permission</Text>;

  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      {scanning ? (
        <>
          {device ? (
            <Camera ref={cameraRef} style={{ flex: 1 }} device={device} isActive codeScanner={codeScanner} />
          ) : (
            <Text>Loading camera...</Text>
          )}
          <Button title="Cancel Scan" onPress={() => setScanning(false)} />
        </>
      ) : (
        <>
          <Text>Tap to scan QR from Resume Author</Text>
          <Button title="Start Scan" onPress={() => setScanning(true)} />
          {!!message && <Text>{message}</Text>}
        </>
      )}
    </View>
  );
}
