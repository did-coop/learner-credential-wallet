/* eslint-disable react-native/no-inline-styles */
import 'react-native-get-random-values';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button } from 'react-native';
import {
  Camera,
  useCameraDevices,
  useCodeScanner,
} from 'react-native-vision-camera';

const WASScreen = () => {
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
    const { requestUrl } = payload;
    setMessage('Requesting VC from server...');

    try {
      await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      setMessage('Storing and sending resume...');

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verifiablePresentation: {
            verifiableCredential: [payload],
          },
        }),
      });

      const result = await response.json();
      console.log('✅ Confirmed:', result);
      setMessage('✅ Resume sent to Resume Author!');
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
      const payloadParam = raw.split('payload=')[1];
      const decoded = decodeURIComponent(payloadParam);
      const parsed = JSON.parse(decoded);
      setScanning(false);
      processPayload(parsed);
    } catch (err: any) {
      setMessage('❌ Invalid QR or Payload');
      console.error(err);
    }
  };

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned,
  });

  if (!hasPermission) {
    return (
      <View>
        <Text>No camera permission</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
      {scanning ? (
        <>
          {device ? (
            <Camera
              ref={cameraRef}
              style={{ flex: 1 }}
              device={device}
              isActive
              codeScanner={codeScanner}
            />
          ) : (
            <Text>Loading camera...</Text>
          )}
          <Button
            title='Cancel'
            onPress={() => setScanning(false)}
          />
        </>
      ) : (
        <>
          <Text style={{ marginBottom: 10 }}>Tap below to scan QR code:</Text>
          <Button
            title='Start Scan'
            onPress={() => setScanning(true)}
          />
          <Text style={{ marginTop: 20 }}>{message}</Text>
        </>
      )}
    </View>
  );
};

export default WASScreen;
